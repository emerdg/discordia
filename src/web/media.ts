import { CONFIG } from '../lib/config';
import { engineFlags } from './compat';
import type { CodecPref, Resolution } from '../types';

export interface CapturePrefs {
  resolution: Resolution;
  mic: boolean;
  pcAudio: boolean;
}

/**
 * Captura de tela + áudio. A captura do display é feita pelo pipeline do
 * sistema (GPU) e a codificação é delegada ao encoder de hardware do
 * navegador (NVENC / Intel Quick Sync / AMD VCN / VideoToolbox), sem pesar
 * na CPU. Para conferir qual encoder foi usado: chrome://media-internals.
 */
export async function startCapture(prefs: CapturePrefs): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Seu navegador não suporta captura de tela (getDisplayMedia).');
  }

  const screen = await navigator.mediaDevices.getDisplayMedia(buildCaptureConstraints(prefs));

  const screenTrack = screen.getVideoTracks()[0];
  if (screenTrack) {
    screenTrack.addEventListener('ended', () => {
      for (const t of screen.getTracks()) t.stop();
    });
  }

  const mic = await captureMic(prefs.mic);
  if (mic) {
    for (const track of mic.getAudioTracks()) {
      if (!screen.getAudioTracks().some((t) => t.enabled)) {
        screen.addTrack(track);
      } else {
        track.stop();
      }
    }
  }

  // Sem nenhuma track de áudio é normal (PC áudio desligado + mic desligado).
  if (prefs.mic && !screen.getAudioTracks().length) {
    // usuário negou o microfone: segue só com a tela
  }

  return screen;
}

/**
 * Restrições de vídeo da captura. `displaySurface` só é enviada em motores
 * que a tratam bem (Blink); em Gecko/WebKit fica fora para não gerar
 * escolha/rejeição inesperada do seletor do sistema.
 */
export function buildCaptureConstraints(prefs: CapturePrefs): DisplayMediaStreamOptions {
  const { width, height } = targetDimensions(prefs.resolution);
  const video: MediaTrackConstraints = {
    width: { ideal: width, max: 1920 },
    height: { ideal: height, max: 1080 },
    frameRate: { ideal: 30, max: 60 },
  };
  if (engineFlags().displaySurfaceSafe) {
    video.displaySurface = 'monitor';
  }
  return {
    video,
    audio: prefs.pcAudio,
  };
}

async function captureMic(on: boolean): Promise<MediaStream | null> {
  if (!on) return null;
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch {
    return null;
  }
}

export function targetDimensions(resolution: Resolution): { width: number; height: number } {
  switch (resolution) {
    case '1080p':
      return { width: 1920, height: 1080 };
    case '480p':
      return { width: 854, height: 480 };
    default:
      return { width: 1280, height: 720 };
  }
}

export function maxBitrate(resolution: Resolution): number {
  switch (resolution) {
    case '1080p':
      return 4_000_000;
    case '480p':
      return 900_000;
    default:
      return 2_500_000;
  }
}

/** Fator de redução para não enviar mais resolução que o selecionado. */
/** NOTA: scaleResolutionDownBy foi removido por compatibilidade entre navegadores. */

/** Parâmetros de codificação para a resolução escolhida (apenas bitrate). */
export function encodingsFor(track: MediaStreamTrack, resolution: Resolution): RTCRtpEncodingParameters[] {
  void track;
  return [{ maxBitrate: maxBitrate(resolution) }];
}

/**
 * Ordem de codecs preferida, de acordo com a configuração do usuário.
 * - 'vp8': VP8 primeiro (o mais universal entre Chrome/Edge/Firefox/Safari).
 * - 'h264': H.264 primeiro (permite aceleração de hardware NVENC/Quick Sync/VCN).
 *
 * Quando `RTCRtpSender.getCapabilities` não existe (Firefox antigo), retorna
 * vazio e o caller pula `setCodecPreferences` — a ordem nativa do navegador
 * (sem preferência) é usada, mantendo a negociação VP8 por padrão.
 */
export function preferredVideoCodecs(pref: CodecPref): RTCRtpCodec[] {
  if (!engineFlags().hasGetCapabilities) return [];
  const caps = RTCRtpSender.getCapabilities?.('video');
  if (!caps?.codecs) return [];
  const usable = caps.codecs.filter(
    (c) =>
      c.mimeType !== 'video/red' &&
      c.mimeType !== 'video/ulpfec' &&
      c.mimeType !== 'video/rtx' &&
      c.mimeType !== 'video/flexfec',
  );
  const rank = (mime: string): number => {
    if (mime === 'video/VP8') return pref === 'vp8' ? 0 : 3;
    if (mime === 'video/H264') return pref === 'h264' ? 0 : 1;
    if (mime === 'video/VP9') return 2;
    if (mime === 'video/AV1') return 4;
    return 5;
  };
  return usable.sort((a, b) => rank(a.mimeType) - rank(b.mimeType)).slice(0, 6);
}

export function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* noop */
    }
  }
}

export function iceConfig(): RTCConfiguration {
  return { iceServers: CONFIG.iceServers };
}