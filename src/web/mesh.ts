import {
  watchAnswer,
  watchIce,
  watchOffer,
  sendOffer,
  sendAnswer,
  sendIce,
  clearSignal,
  connMatches,
  type SignalOfferPayload,
  type ConnId,
} from '../lib/signaling';
import { joinPresence, leavePresence, setSharing, watchMembers } from '../lib/presence';
import { ensureAuthed } from '../lib/firebase';
import { decodeWire, encodeWire, type Wire } from '../lib/protocol';
import { withTimeout } from '../util/dom';
import { encodingsFor, iceConfig, preferredVideoCodecs } from './media';
import { engineFlags, newConnId, stripIceCandidate, DISCONNECT_GRACE_MS, type CleanIceInit } from './compat';
import type { ChatMessage, CodecPref, MemberInfo, Resolution } from '../types';

export interface MeshEvents {
  onRoster(members: MemberInfo[]): void;
  onChat(message: ChatMessage): void;
  onRoomInfo(info: { name: string }): void;
  onRemoteWatch(peerId: string, started: boolean): void;
  onReceiveStream(peerId: string, stream: MediaStream): void;
  onReceiveEnd(peerId: string): void;
  onTxRequest(peerId: string): void;
  onTxApproved(): void;
  onTxDenied(): void;
  onTxCancelled(): void;
  onMessageDeleted(messageId: string): void;
}

interface PeerLink {
  peerId: string;
  dataPc: RTCPeerConnection | null;
  dc: RTCDataChannel | null;
  established: boolean;
  cleanups: Array<() => void>;
  retryTimer: number | null;
}

/**
 * Buffer de candidatos ICE. Candidatos em trickle podem chegar antes do
 * setRemoteDescription; adicioná-los cedo descarta a conexão. Espera o
 * remote description ser aplicado e então descarrega a fila.
 */
interface IceBuffer {
  queue: CleanIceInit[];
  flushed: boolean;
}

const newIceBuffer = (): IceBuffer => ({ queue: [], flushed: false });

function addIceBuffered(pc: RTCPeerConnection, cand: CleanIceInit, buf: IceBuffer): void {
  const ready = pc.remoteDescription !== null;
  if (!ready) {
    buf.queue.push(cand);
    return;
  }
  void pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => undefined);
}

async function flushIce(pc: RTCPeerConnection, buf: IceBuffer): Promise<void> {
  if (buf.flushed) return;
  buf.flushed = true;
  for (const cand of buf.queue.splice(0)) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(cand));
    } catch {
      /* candidato inválido para o estado atual */
    }
  }
}

/**
 * Malha P2P baseada em RTCPeerConnection.
 *
 * - Presença + roster: via RTDB (nuvem, apenas "hub").
 * - Chat, hello e controle: 1 canal de dados por par.
 * - Mídia: conexões sob demanda, criadas quando alguém assiste outro.
 *   O espectador inicia (recvonly) e o transmissor responde (sendonly) com
 *   as tracks atuais → o encoder de hardware só trabalha quando há
 *   espectador, economizando GPU/CPU.
 *
 * A mídia nunca passa pelo servidor: é 100% P2P após a sinalização inicial.
 */
export class Mesh {
  private readonly roomId: string;
  private readonly myId: string;
  private readonly me: { name: string; emoji: string; color: string };
  private readonly events: MeshEvents;

  private readonly links = new Map<string, PeerLink>();
  private readonly mediaOut = new Map<string, RTCPeerConnection>();
  private readonly mediaIn = new Map<string, RTCPeerConnection>();
  private readonly mediaOutUnsubs = new Map<string, () => void>();
  private readonly mediaInUnsubs = new Map<string, () => void>();
  private readonly mediaInConn = new Map<string, string>();
  private readonly disconnectTimers = new Map<string, number>();
  private readonly unsubs: Array<() => void> = [];

  private members = new Map<string, MemberInfo>();
  private roomName = '';
  private roomMaxUsers = 0;
  private localStream: MediaStream | null = null;
  private resolution: Resolution = '720p';
  private codecPref: CodecPref = 'vp8';
  private msgSeq = 0;
  private infoRequested = false;
  private stopped = false;
  /** uid do auth anônimo (usado no escrever sinalização/presença como dono). */
  private owner = '';
  /** UIDs (dono + moderadores) autorizados a aprovar/negar/cancelar transmissão. */
  private authorizedUids = new Set<string>();
  /** Evita loop de reconexão imposto por um par malicioso via refresh-media. */
  private readonly refreshCooldown = new Map<string, number>();

  constructor(
    roomId: string,
    myId: string,
    me: { name: string; emoji: string; color: string },
    events: MeshEvents,
  ) {
    this.roomId = roomId;
    this.myId = myId;
    this.me = me;
    this.events = events;
  }

  get peerId(): string {
    return this.myId;
  }

  /** Estado atual, usado pelo painel de diagnóstico da sala. */
  stats(): { peerId: string; roomId: string; members: number; links: number; linksTotal: number; watching: number; watchedBy: number } {
    return {
      peerId: this.myId,
      roomId: this.roomId,
      members: this.members.size,
      links: [...this.links.values()].filter((l) => l.established).length,
      linksTotal: this.links.size,
      watching: this.mediaOut.size,
      watchedBy: this.mediaIn.size,
    };
  }

  /** Resolução usada ao enviar a própria transmissão. */
  setResolution(res: Resolution): void {
    this.resolution = res;
  }

  /** Preferência de codec ao enviar a própria transmissão. */
  setCodecPref(pref: CodecPref): void {
    this.codecPref = pref;
  }

  /** Diagnóstico das conexões de mídia (codecs negociados, estado). */
  mediaDiagnostics(): { peer: string; role: 'out' | 'in'; state: string; codecs: string }[] {
    const result: { peer: string; role: 'out' | 'in'; state: string; codecs: string }[] = [];
    const collect = (role: 'out' | 'in', peerId: string, pc: RTCPeerConnection): void => {
      try {
        const rows: string[] = [];
        for (const tr of pc.getTransceivers()) {
          const isVideo = tr.receiver?.track?.kind === 'video' || tr.sender?.track?.kind === 'video';
          if (!isVideo) continue;
          const codecs =
            role === 'in'
              ? tr.sender?.getParameters().codecs
              : tr.receiver?.getParameters().codecs;
          const seen = new Set<string>();
          const names: string[] = [];
          for (const c of codecs ?? []) {
            if (!c.mimeType || ['video/rtx', 'video/red', 'video/ulpfec', 'video/flexfec'].includes(c.mimeType)) continue;
            const short = c.mimeType.split('/')[1] || c.mimeType;
            if (seen.has(short)) continue;
            seen.add(short);
            names.push(short);
            if (names.length >= 2) break;
          }
          rows.push(`${names.join('+') || '-'}@${tr.currentDirection ?? '-'}`);
        }
        result.push({
          peer: peerId,
          role,
          state: pc.connectionState,
          codecs: rows.join(' | ') || '-',
        });
      } catch {
        /* transceiver pode estar em estado intermediário */
      }
    };
    this.mediaOut.forEach((pc, peerId) => collect('out', peerId, pc));
    this.mediaIn.forEach((pc, peerId) => collect('in', peerId, pc));
    return result;
  }

  // ----------------------------------------------------------------- join

  async join(): Promise<void> {
    this.stopped = false;
    try {
      const owner = await ensureAuthed();
      this.owner = owner;
      await withTimeout(joinPresence(this.roomId, { ...this.me, peerId: this.myId, owner }), 6000, undefined);
    } catch (err) {
      console.error('[mesh] falha ao registrar presença:', err);
    }
    const off = watchMembers(this.roomId, (list) => {
      const next = new Map(list.map((m) => [m.peerId, m]));
      this.members = next;
      this.events.onRoster(list);
      for (const m of list) this.ensureLink(m.peerId);
      for (const prev of this.links.keys()) {
        if (!next.has(prev)) this.teardownPeer(prev);
      }
    });
    this.unsubs.push(off);
  }

  /** Metadados da sala conhecidos localmente (para responder room-info-req). */
  setRoomInfo(name: string, maxUsers: number): void {
    this.roomName = name;
    this.roomMaxUsers = maxUsers;
  }

  setLocalStream(stream: MediaStream | null): void {
    this.localStream = stream;
  }

  async setTransmitting(on: boolean): Promise<void> {
    await setSharing(this.roomId, this.myId, on);
  }

  /** Define os UIDs (dono + moderadores) autorizados a moderar a transmissão. */
  setAuthorizedModerators(uids: string[]): void {
    this.authorizedUids = new Set(uids.filter((u) => typeof u === 'string' && u.length > 0));
  }

  /**
   * Valida que uma mensagem de metadado veio de um membro cujo `owner`
   * registrado no RTDB bate com o `owner` declarado no pacote. As regras do
   * banco garantem que `owner` do membro é o uid real de quem o escreveu —
   * logo um invasor não consegue usar o peerId de um moderador/dono.
   */
  private okTx(peerId: string, owner: string | undefined, needModerator: boolean): boolean {
    if (!owner) return false;
    const m = this.members.get(peerId);
    if (!m || m.owner !== owner) return false;
    if (!needModerator) return true;
    return this.authorizedUids.has(owner);
  }

  // ----------------------------------------- controle de transmissão (P2P)

  private sendTo(peerId: string, wire: Wire): boolean {
    const dc = this.links.get(peerId)?.dc;
    if (!dc || dc.readyState !== 'open') return false;
    try {
      dc.send(encodeWire(wire));
      return true;
    } catch {
      return false;
    }
  }

  private broadcast(wire: Wire): void {
    for (const link of this.links.values()) {
      if (!link.established || !link.dc) continue;
      const dc = link.dc;
      try {
        dc.send(encodeWire(wire));
      } catch {
        /* par caiu no meio */
      }
    }
  }

  /** Pede ao criador/moderador autorização para iniciar transmissão. */
  requestTransmit(): void {
    this.broadcast({ type: 'tx-request', owner: this.owner });
  }

  /** Criador/moderador aprova o pedido de transmissão de um membro. */
  approveTransmit(peerId: string): void {
    this.sendTo(peerId, { type: 'tx-approve', owner: this.owner });
  }

  /** Criador/moderador nega o pedido de transmissão de um membro. */
  denyTransmit(peerId: string): void {
    this.sendTo(peerId, { type: 'tx-deny', owner: this.owner });
  }

  /** Criador/moderador encerra a transmissão ativa de um membro. */
  cancelTransmit(peerId: string): void {
    this.sendTo(peerId, { type: 'tx-cancel', owner: this.owner });
  }

  /** Solicita a deleção de uma mensagem por moderador/criador (P2P broadcast). */
  deleteMessage(messageId: string): void {
    this.broadcast({ type: 'tx-delete-message', messageId, owner: this.owner });
  }

  /**
   * A sinalização carrega o `owner` (uid) de quem a escreveu. Aceita apenas
   * se o remetente corresponde ao membro registrado com o mesmo owner.
   * Payloads de clientes antigos (sem owner) são aceitos por retrocompatibilidade.
   */
  private okSignal(peerId: string, owner: string | undefined): boolean {
    if (!owner) return true;
    const m = this.members.get(peerId);
    return Boolean(m && m.owner === owner);
  }

  // ------------------------------------------------------------- data links

  private ensureLink(peerId: string): void {
    if (this.stopped || peerId === this.myId || this.links.has(peerId)) return;
    if (this.myId < peerId) this.initiateDataLink(peerId);
    else this.answerDataLink(peerId);
  }

  private initiateDataLink(peerId: string): void {
    const me = this.myId;
    const link: PeerLink = {
      peerId,
      dataPc: null,
      dc: null,
      established: false,
      cleanups: [],
      retryTimer: null,
    };
    this.links.set(peerId, link);

    const pc = new RTCPeerConnection(iceConfig());
    link.dataPc = pc;
    const dc = pc.createDataChannel('discordia', { ordered: true });
    link.dc = dc;
    this.wireDataChannel(link);

    const connId: ConnId = newConnId();
    const iceBuf = newIceBuffer();
    link.cleanups.push(
      watchAnswer(this.roomId, peerId, me, 'data', (ans) => {
        if (!this.okSignal(peerId, ans.owner)) return;
        if (!connMatches(connId, ans.connId)) return;
        const desc = ans.description;
        if (pc.remoteDescription === null && pc.signalingState === 'have-local-offer') {
          void pc
            .setRemoteDescription(desc)
            .then(() => flushIce(pc, iceBuf))
            .catch(() => {
              /* oferecimento recusado */
            });
        }
      }),
      watchIce(this.roomId, peerId, me, 'data', (ice) => {
        if (!this.okSignal(peerId, ice.owner)) return;
        if (!connMatches(connId, ice.connId)) return;
        const clean = stripIceCandidate(ice.candidate);
        if (clean) addIceBuffered(pc, clean, iceBuf);
      }),
    );

pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const clean = stripIceCandidate(e.candidate);
      if (clean) void sendIce(this.roomId, this.myId, peerId, 'media', clean, this.owner, connId);
    };
    this.wirePcEvents(pc, () => this.handleLinkClosed(link));
    void (async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendOffer(this.roomId, me, peerId, offer, 'data', this.owner, { connId });
    })().catch(() => this.handleLinkClosed(link));
  }

  private answerDataLink(peerId: string): void {
    const me = this.myId;
    const link: PeerLink = {
      peerId,
      dataPc: null,
      dc: null,
      established: false,
      cleanups: [],
      retryTimer: null,
    };
    this.links.set(peerId, link);

    link.cleanups.push(
      watchOffer(this.roomId, peerId, me, 'data', async (payload) => {
        if (!this.okSignal(peerId, payload.owner)) return;
        if (!this.links.has(peerId) || this.stopped || link.dataPc) return;
        const connId: ConnId = payload.connId ?? '';
        const pc = new RTCPeerConnection(iceConfig());
        link.dataPc = pc;
        const iceBuf = newIceBuffer();
        pc.ondatachannel = (e) => {
          link.dc = e.channel;
          this.wireDataChannel(link);
        };
        link.cleanups.push(
          watchIce(this.roomId, peerId, me, 'data', (ice) => {
            if (!this.okSignal(peerId, ice.owner)) return;
            if (!connMatches(connId, ice.connId)) return;
            const clean = stripIceCandidate(ice.candidate);
            if (clean) addIceBuffered(pc, clean, iceBuf);
          }),
        );
        pc.onicecandidate = (e) => {
          if (!e.candidate) return;
          const clean = stripIceCandidate(e.candidate);
          if (clean) void sendIce(this.roomId, me, peerId, 'data', clean, this.owner, connId);
        };
        this.wirePcEvents(pc, () => this.handleLinkClosed(link));
        try {
          await pc.setRemoteDescription(payload.description);
          await flushIce(pc, iceBuf);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await sendAnswer(this.roomId, me, peerId, answer, 'data', this.owner, connId);
        } catch {
          this.handleLinkClosed(link);
        }
      }),
    );
  }

  private wirePcEvents(pc: RTCPeerConnection, onClosed: () => void): void {
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        const link = this.links.get(this.findPeerOf(pc));
        if (link && !link.established) {
          link.established = true;
          this.onLinkOpen(link);
        }
      } else if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed' ||
        pc.connectionState === 'disconnected'
      ) {
        onClosed();
      }
    };
  }

  private findPeerOf(pc: RTCPeerConnection): string {
    for (const [id, link] of this.links) {
      if (link.dataPc === pc) return id;
    }
    for (const [id, p] of this.mediaOut) {
      if (p === pc) return id;
    }
    for (const [id, p] of this.mediaIn) {
      if (p === pc) return id;
    }
    return '';
  }

  // -------------------------------------------------------- tolerância de rede

  /** Estado `disconnected` é transitório (principalmente Gecko/WebKit). */
  private armDisconnectGrace(peerId: string, teardown: () => void): void {
    this.clearDisconnectGrace(peerId);
    const t = window.setTimeout(() => {
      this.disconnectTimers.delete(peerId);
      teardown();
    }, DISCONNECT_GRACE_MS);
    this.disconnectTimers.set(peerId, t);
  }

  private clearDisconnectGrace(peerId: string): void {
    const t = this.disconnectTimers.get(peerId);
    if (t != null) {
      clearTimeout(t);
      this.disconnectTimers.delete(peerId);
    }
  }

  private clearAllDisconnectTimers(): void {
    for (const t of this.disconnectTimers.values()) clearTimeout(t);
    this.disconnectTimers.clear();
  }

  private wireDataChannel(link: PeerLink): void {
    const dc = link.dc;
    if (!dc) return;
    dc.binaryType = 'arraybuffer';
    dc.onmessage = (e) => {
      const wire = decodeWire(e.data);
      if (wire) this.handleWire(link.peerId, wire);
    };
    dc.onclose = () => this.handleLinkClosed(link);
  }

  private onLinkOpen(link: PeerLink): void {
    const dc = link.dc;
    if (!dc) return;
    console.debug(`[mesh] data link aberto com ${link.peerId}`);
    try {
      dc.send(encodeWire({ type: 'hello', ...this.me }));
      if (!this.infoRequested) {
        this.infoRequested = true;
        dc.send(encodeWire({ type: 'room-info-req' }));
      }
    } catch {
      /* ainda processando */
    }
  }

  private handleLinkClosed(link: PeerLink): void {
    console.debug(`[mesh] link com ${link.peerId} encerrado`);
    if (this.stopped) return;
    this.closeLink(link);
    const stillHere = this.members.has(link.peerId);
    if (stillHere) {
      link.retryTimer = window.setTimeout(() => {
        if (!this.stopped && !this.links.has(link.peerId)) this.ensureLink(link.peerId);
      }, 1500);
    }
  }

  private closeLink(link: PeerLink): void {
    if (link.retryTimer != null) clearTimeout(link.retryTimer);
    link.cleanups.splice(0).forEach((fn) => fn());
    try {
      link.dc?.close();
    } catch {
      /* noop */
    }
    try {
      link.dataPc?.close();
    } catch {
      /* noop */
    }
    this.links.delete(link.peerId);
  }

  private handleWire(fromId: string, wire: Wire): void {
    switch (wire.type) {
      case 'chat': {
        // O remetente do canal de dados deve ser o autor da mensagem. Nome/
        // emoji/cor são derivados do membro conhecido no roster (sem spoof).
        if (!wire.message || wire.message.from !== fromId) break;
        const member = this.members.get(fromId);
        if (member) {
          wire.message = { ...wire.message, name: member.name, emoji: member.emoji, color: member.color };
        }
        this.events.onChat(wire.message);
        break;
      }
      case 'room-info-req': {
        const target = this.links.get(fromId)?.dc;
        if (target) {
          try {
            target.send(encodeWire({ type: 'room-info-res', name: this.roomName, maxUsers: this.roomMaxUsers }));
          } catch {
            /* noop */
          }
        }
        break;
      }
      case 'room-info-res':
        // Só aceita o nome da sala de quem é membro do roster.
        if (!this.members.has(fromId)) break;
        this.roomName = wire.name;
        this.events.onRoomInfo({ name: wire.name });
        break;
      case 'unwatch':
        this.unwatchMe(fromId);
        break;
      case 'refresh-media': {
        // O transmissor reaplicou configurações: espectadores reconectam.
        // Throttle mínimo de 2s por par evita loop de reconexão forçada.
        const last = this.refreshCooldown.get(fromId);
        if (last !== undefined && Date.now() - last < 2000) break;
        this.refreshCooldown.set(fromId, Date.now());
        if (this.mediaOut.has(fromId)) {
          this.unwatch(fromId);
          window.setTimeout(() => {
            if (!this.stopped && this.members.get(fromId)?.sharing) {
              void this.watch(fromId);
            }
          }, 400);
        }
        break;
      }
      case 'tx-request': {
        if (fromId === this.myId) break;
        if (this.okTx(fromId, wire.owner, false)) this.events.onTxRequest(fromId);
        break;
      }
      case 'tx-approve': {
        if (this.okTx(fromId, wire.owner, true)) this.events.onTxApproved();
        break;
      }
      case 'tx-deny': {
        if (this.okTx(fromId, wire.owner, true)) this.events.onTxDenied();
        break;
      }
      case 'tx-cancel': {
        if (this.okTx(fromId, wire.owner, true)) this.events.onTxCancelled();
        break;
      }
      case 'tx-delete-message': {
        // Apenas criador/moderador pode solicitar deleção de mensagens.
        if (this.okTx(fromId, wire.owner, true)) this.events.onMessageDeleted(wire.messageId);
        break;
      }
      default:
        break;
    }
  }

  /** Pede aos espectadores que reconectem sua transmissão (configs aplicadas). */
  requestMediaRefresh(): void {
    for (const link of this.links.values()) {
      if (!link.established || !link.dc) continue;
      try {
        link.dc.send(encodeWire({ type: 'refresh-media' }));
      } catch {
        /* par caiu no meio */
      }
    }
  }

  // ------------------------------------------------------------- chat

  sendChat(text: string): void {
    this.msgSeq += 1;
    const ts = Date.now();
    const message: ChatMessage = {
      id: `${this.myId}:${this.msgSeq}:${ts}`,
      from: this.myId,
      name: this.me.name,
      emoji: this.me.emoji,
      color: this.me.color,
      text,
      ts,
    };
    this.events.onChat(message);
    for (const link of this.links.values()) {
      if (!link.established || !link.dc) continue;
      try {
        link.dc.send(encodeWire({ type: 'chat', message }));
      } catch {
        /* par caiu no meio */
      }
    }
  }

  private unwatchMe(fromId: string): void {
    this.clearDisconnectGrace(fromId);
    const pc = this.mediaIn.get(fromId);
    if (pc) {
      const unsub = this.mediaInUnsubs.get(fromId);
      if (unsub) {
        unsub();
        this.mediaInUnsubs.delete(fromId);
      }
      try {
        pc.close();
      } catch {
        /* noop */
      }
    }
    void clearSignal(this.roomId, fromId, this.myId);
    this.mediaIn.delete(fromId);
    this.mediaInConn.delete(fromId);
    this.events.onRemoteWatch(fromId, false);
  }

  // ------------------------------------------------------------- mídia (assistir)

  async watch(peerId: string, opts?: { wantedRes?: Resolution }): Promise<boolean> {
    if (this.stopped || peerId === this.myId) return false;
    if (this.mediaOut.has(peerId)) return true;

    const member = this.members.get(peerId);
    if (!member?.sharing) return false;

    const connId: ConnId = newConnId();
    const pc = new RTCPeerConnection(iceConfig());
    this.mediaOut.set(peerId, pc);

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    const flags = engineFlags();
    if (flags.hasSetCodecPreferences && flags.engine === 'blink') {
      // Preferência de codec aplicada no OFERECEDOR (Chrome): a lista fica no
      // offer e o respondedor só a reflete. No respondedor (Firefox), o
      // setCodecPreferences gerava um SDP de answer que o Chrome recusava
      // parsear ("Failed to parse codecs correctly").
      try {
        const pref = preferredVideoCodecs(this.codecPref);
        if (pref.length) {
          for (const tr of pc.getTransceivers()) {
            if (tr.receiver?.track?.kind === 'video') {
              tr.setCodecPreferences(pref);
            }
          }
        }
      } catch {
        /* navegador sem suporte — usa a ordem padrão */
      }
    }
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      this.events.onReceiveStream(peerId, stream);
    };
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const clean = stripIceCandidate(e.candidate);
      if (clean) void sendIce(this.roomId, this.myId, peerId, 'media', clean, connId);
    };
    pc.onconnectionstatechange = () => {
      console.debug(`[mesh] mediaOut ${peerId} → ${pc.connectionState}`);
      const s = pc.connectionState;
      if (s === 'failed' || s === 'closed') this.handleMediaOutClosed(peerId);
      else if (s === 'disconnected') this.armDisconnectGrace(peerId, () => this.handleMediaOutClosed(peerId));
      else if (s === 'connected') this.clearDisconnectGrace(peerId);
    };
    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === 'failed' || s === 'closed') this.handleMediaOutClosed(peerId);
      else if (s === 'disconnected') this.armDisconnectGrace(peerId, () => this.handleMediaOutClosed(peerId));
      else if (s === 'connected' || s === 'completed') this.clearDisconnectGrace(peerId);
    };

    const iceBuf = newIceBuffer();
    const unsubAnswer = watchAnswer(this.roomId, peerId, this.myId, 'media', (ans) => {
      if (!this.okSignal(peerId, ans.owner)) return;
      console.debug(
        `[mesh] answer recebido de ${peerId}: connId esperado=${connId} recebido=${ans.connId ?? '(vazio)'} state=${pc.signalingState}`,
      );
      if (!connMatches(connId, ans.connId)) return;
      const desc = ans.description;
      if (pc.remoteDescription === null && pc.signalingState === 'have-local-offer') {
        void pc
          .setRemoteDescription(desc)
          .then(() => flushIce(pc, iceBuf))
          .catch((err) => console.debug(`[mesh] setRemoteDescription(media answer) falhou:`, err));
      }
    });
    const unsubIce = watchIce(this.roomId, peerId, this.myId, 'media', (ice) => {
      if (!this.okSignal(peerId, ice.owner)) return;
      if (!connMatches(connId, ice.connId)) return;
      const clean = stripIceCandidate(ice.candidate);
      if (clean) addIceBuffered(pc, clean, iceBuf);
    });
    this.mediaOutUnsubs.set(peerId, () => {
      unsubAnswer();
      unsubIce();
    });

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendOffer(this.roomId, this.myId, peerId, offer, 'media', this.owner, {
        ...(opts?.wantedRes ? { wantedRes: opts.wantedRes } : {}),
        connId,
      });
      console.debug(`[mesh] assistindo ${peerId} — offer enviado`);
    } catch {
      this.teardownWatch(peerId);
      return false;
    }
    return true;
  }

  unwatch(peerId: string): void {
    if (!this.mediaOut.has(peerId)) return;
    this.clearDisconnectGrace(peerId);
    this.teardownWatch(peerId);
    const dc = this.links.get(peerId)?.dc;
    if (dc && dc.readyState === 'open') {
      try {
        dc.send(encodeWire({ type: 'unwatch' }));
      } catch {
        /* noop */
      }
    }
  }

  private handleMediaOutClosed(peerId: string): void {
    this.clearDisconnectGrace(peerId);
    if (!this.mediaOut.has(peerId)) return;
    this.teardownWatch(peerId);
  }

  private teardownWatch(peerId: string): void {
    this.clearDisconnectGrace(peerId);
    const pc = this.mediaOut.get(peerId);
    if (pc) {
      void clearSignal(this.roomId, this.myId, peerId);
      const unsubs = this.mediaOutUnsubs.get(peerId);
      if (unsubs) {
        unsubs();
        this.mediaOutUnsubs.delete(peerId);
      }
      try {
        pc.close();
      } catch {
        /* noop */
      }
    }
    this.mediaOut.delete(peerId);
    this.events.onReceiveEnd(peerId);
  }

  // ------------------------------------------------------- mídia (ser assistido)

  /** Observa offers de mídia vindos de um par que quer me assistir. */
  watchIncomingMedia(peerId: string): void {
    const me = this.myId;
    const off = watchOffer(this.roomId, peerId, me, 'media', async (payload) => {
      if (this.stopped) return;
      const incoming = payload.connId ?? '';
      if (this.mediaIn.has(peerId)) {
        if (this.mediaInConn.get(peerId) === incoming) return;
        // Offer novo (connId distinto): substitui uma conexão antiga/órfã que
        // ficou ocupando o slot (ex.: re-clique no mesmo usuário). Sem isso,
        // o novo offer era ignorado para sempre e o tile ficava "conectando".
        this.handleMediaInClosed(peerId);
      }
      await this.answerMediaOffer(peerId, payload);
    });
    this.unsubs.push(off);
  }

  private async answerMediaOffer(peerId: string, payload: SignalOfferPayload): Promise<void> {
    if (!this.okSignal(peerId, payload.owner)) return;
    const connId: ConnId = payload.connId ?? '';
    this.mediaInConn.set(peerId, connId);
    const pc = new RTCPeerConnection(iceConfig());
    this.mediaIn.set(peerId, pc);

    const stream = this.localStream;
    if (stream) {
      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }
    }

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const clean = stripIceCandidate(e.candidate);
      if (clean) void sendIce(this.roomId, this.myId, peerId, 'media', clean, this.owner, connId);
    };
    const iceBuf = newIceBuffer();
    const unsubIce = watchIce(this.roomId, peerId, this.myId, 'media', (ice) => {
      if (!this.okSignal(peerId, ice.owner)) return;
      if (!connMatches(connId, ice.connId)) return;
      const clean = stripIceCandidate(ice.candidate);
      if (clean) addIceBuffered(pc, clean, iceBuf);
    });
    this.mediaInUnsubs.set(peerId, unsubIce);

    pc.onconnectionstatechange = () => {
      console.debug(`[mesh] mediaIn ${peerId} → ${pc.connectionState}`);
      const s = pc.connectionState;
      if (s === 'failed' || s === 'closed') this.handleMediaInClosed(peerId);
      else if (s === 'disconnected') this.armDisconnectGrace(peerId, () => this.handleMediaInClosed(peerId));
      else if (s === 'connected') this.clearDisconnectGrace(peerId);
    };

    try {
      await pc.setRemoteDescription(payload.description);
      await flushIce(pc, iceBuf);
      for (const tr of pc.getTransceivers()) {
        if (!tr.sender?.track) continue;
        tr.direction = 'sendonly';
        // NOTA: sem setCodecPreferences aqui — o SDP de answer resultante
        // (Firefox) era recusado pelo Chrome no setRemoteDescription
        // ("Failed to parse codecs correctly"). A preferência de codec agora
        // é aplicada no offer (oferecedor) quando o navegador é Chrome.
      }
      for (const sender of pc.getSenders()) {
        if (sender.track?.kind === 'video') {
          const effective = (payload.wantedRes ?? this.resolution) as Resolution;
          try {
            const params = sender.getParameters();
            params.encodings = encodingsFor(sender.track, effective);
            await sender.setParameters(params);
          } catch {
            /* parâmetros não suportados neste navegador */
          }
        }
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendAnswer(this.roomId, this.myId, peerId, answer, 'media', this.owner, connId);
      this.events.onRemoteWatch(peerId, true);
    } catch {
      this.handleMediaInClosed(peerId);
    }
  }

  private handleMediaInClosed(peerId: string): void {
    this.clearDisconnectGrace(peerId);
    const pc = this.mediaIn.get(peerId);
    if (!pc) return;
    const unsub = this.mediaInUnsubs.get(peerId);
    if (unsub) {
      unsub();
      this.mediaInUnsubs.delete(peerId);
    }
    try {
      pc.close();
    } catch {
      /* noop */
    }
    this.mediaIn.delete(peerId);
    this.mediaInConn.delete(peerId);
    this.events.onRemoteWatch(peerId, false);
  }

  // ----------------------------------------------------------------- leave

  async destroy(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.clearAllDisconnectTimers();

    for (const link of [...this.links.values()]) {
      this.closeLink(link);
      void clearSignal(this.roomId, this.myId, link.peerId);
    }
    this.links.clear();

    for (const [peerId, pc] of [...this.mediaOut]) {
      const unsubs = this.mediaOutUnsubs.get(peerId);
      if (unsubs) {
        unsubs();
        this.mediaOutUnsubs.delete(peerId);
      }
      try {
        pc.close();
      } catch {
        /* noop */
      }
      void clearSignal(this.roomId, this.myId, peerId);
    }
    this.mediaOut.clear();

    for (const peerId of [...this.mediaIn.keys()]) {
      const unsub = this.mediaInUnsubs.get(peerId);
      if (unsub) {
        unsub();
        this.mediaInUnsubs.delete(peerId);
      }
      void clearSignal(this.roomId, peerId, this.myId);
    }
    this.mediaIn.clear();
    this.mediaInConn.clear();

    this.unsubs.splice(0).forEach((fn) => fn());
    await leavePresence(this.roomId, this.myId);
  }

  /** Encerra todas as conexões de entrada (não assisto mais ninguém vê). */
  closeIncoming(): void {
    for (const [peerId, pc] of [...this.mediaIn]) {
      this.clearDisconnectGrace(peerId);
      const unsub = this.mediaInUnsubs.get(peerId);
      if (unsub) {
        unsub();
        this.mediaInUnsubs.delete(peerId);
      }
      void clearSignal(this.roomId, peerId, this.myId);
      try {
        pc.close();
      } catch {
        /* noop */
      }
      this.mediaIn.delete(peerId);
      this.mediaInConn.delete(peerId);
      this.events.onRemoteWatch(peerId, false);
    }
  }

  private teardownPeer(peerId: string): void {
    this.clearDisconnectGrace(peerId);
    const link = this.links.get(peerId);
    if (link) this.closeLink(link);
    this.teardownWatch(peerId);
    this.unwatchMe(peerId);
    void clearSignal(this.roomId, this.myId, peerId);
  }
}