/**
 * Detecção de recursos WebRTC e utilidades de compatibilidade.
 *
 * A prioridade de suporte é: Blink (Chrome/Edge) → Gecko (Firefox) →
 * WebKit (Safari). Nenhum `RTCPeerConnection` é criado aqui: só leitura de
 * capabilities e normalização de dados, para os módulos de transmissão
 * escolherem o caminho mais compatível sem quebrar os demais motores.
 */

export type EngineName = 'blink' | 'gecko' | 'webkit' | 'unknown';

export interface EngineFlags {
  engine: EngineName;
  /** PC com suporte a track/transceiver (Unified Plan). False em WebKit Plan B. */
  hasTransceivers: boolean;
  /** RTCRtpSender.getCapabilities disponível (inexistente no Firefox antigo). */
  hasGetCapabilities: boolean;
  /** RTCRtpTransceiver.setCodecPreferences disponível. */
  hasSetCodecPreferences: boolean;
  /** RTCPeerConnection.restartIce disponível. */
  hasRestartIce: boolean;
  /** getDisplayMedia disponível. */
  hasGetDisplayMedia: boolean;
  /** Constraint `displaySurface` tratada de forma confiável (apenas Blink). */
  displaySurfaceSafe: boolean;
}

let cached: EngineFlags | null = null;

function detectEngine(): EngineFlags {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  let engine: EngineName = 'unknown';
  if (/\b(?:Chrome|Chromium|Edg|OPR|Opera)\b/.test(ua)) {
    engine = 'blink';
  } else if (/Firefox\//.test(ua)) {
    engine = 'gecko';
  } else if (/AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) {
    engine = 'webkit';
  }

  const hasPC = typeof RTCPeerConnection !== 'undefined';
  return {
    engine,
    hasTransceivers: hasPC && 'addTransceiver' in RTCPeerConnection.prototype,
    hasGetCapabilities:
      typeof RTCRtpSender !== 'undefined' && typeof RTCRtpSender.getCapabilities === 'function',
    hasSetCodecPreferences:
      typeof RTCRtpTransceiver !== 'undefined' &&
      'setCodecPreferences' in (RTCRtpTransceiver.prototype as object),
    hasRestartIce: hasPC && 'restartIce' in RTCPeerConnection.prototype,
    hasGetDisplayMedia:
      typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia),
    displaySurfaceSafe: engine === 'blink' || engine === 'unknown',
  };
}

/** Flags do motor atual (memorizadas para não re-detectar a cada chamada). */
export function engineFlags(): EngineFlags {
  if (!cached) cached = detectEngine();
  return cached;
}

/** Id curto aleatório para distinguir handshakes (connId). */
export function newConnId(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * RTCIceCandidateInit "limpado" para transporte por RTDB e para o construtor
 * de RTCIceCandidate — evita campos extras que derrubam motores estritos.
 */
export interface CleanIceInit {
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
  usernameFragment?: string;
}

/**
 * Normaliza um candidato ICE:
 * - preserva `sdpMLineIndex === 0` (checagens truthy clássicas o perdem);
 * - descarta candidatos vazios (fim de lista) que Gecko/WebKit tratam de
 *   forma inconsistente quando recebidos;
 * - remove campos desconhecidos/extras (protege WebKit de lançar exceção).
 */
export function stripIceCandidate(
  raw: RTCIceCandidate | RTCIceCandidateInit | null | undefined,
): CleanIceInit | null {
  if (!raw) return null;
  const candidate = typeof raw.candidate === 'string' ? raw.candidate : '';
  if (!candidate) return null;
  const out: CleanIceInit = { candidate };
  const mid = raw.sdpMid;
  if (typeof mid === 'string' && mid) out.sdpMid = mid;
  const idx = raw.sdpMLineIndex;
  if (typeof idx === 'number') out.sdpMLineIndex = idx;
  const ufrag = raw.usernameFragment;
  if (typeof ufrag === 'string' && ufrag) out.usernameFragment = ufrag;
  return out;
}

/** Tempo de tolerância do estado `disconnected` antes de encerrar a mídia. */
export const DISCONNECT_GRACE_MS = 2000;