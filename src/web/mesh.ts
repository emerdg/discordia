import { watchAnswer, watchIce, watchOffer, sendOffer, sendAnswer, sendIce, clearSignal } from '../lib/signaling';
import { joinPresence, leavePresence, setSharing, watchMembers } from '../lib/presence';
import { decodeWire, encodeWire, type Wire } from '../lib/protocol';
import { encodingsFor, iceConfig, preferredVideoCodecs } from './media';
import type { ChatMessage, MemberInfo, Resolution } from '../types';

export interface MeshEvents {
  onRoster(members: MemberInfo[]): void;
  onChat(message: ChatMessage): void;
  onRoomInfo(info: { name: string }): void;
  onRemoteWatch(peerId: string, started: boolean): void;
  onReceiveStream(peerId: string, stream: MediaStream): void;
  onReceiveEnd(peerId: string): void;
}

interface PeerLink {
  peerId: string;
  dataPc: RTCPeerConnection | null;
  dc: RTCDataChannel | null;
  established: boolean;
  cleanups: Array<() => void>;
  retryTimer: number | null;
}

function candidateInit(c: RTCIceCandidate): RTCIceCandidateInit {
  return {
    candidate: c.candidate,
    sdpMid: c.sdpMid ?? undefined,
    sdpMLineIndex: c.sdpMLineIndex ?? undefined,
    usernameFragment: c.usernameFragment ?? undefined,
  };
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
  private readonly unsubs: Array<() => void> = [];

  private members = new Map<string, MemberInfo>();
  private roomName = '';
  private roomMaxUsers = 0;
  private localStream: MediaStream | null = null;
  private resolution: Resolution = '720p';
  private msgSeq = 0;
  private infoRequested = false;
  private stopped = false;

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

  /** Resolução usada ao enviar a própria transmissão. */
  setResolution(res: Resolution): void {
    this.resolution = res;
  }

  // ----------------------------------------------------------------- join

  async join(): Promise<void> {
    this.stopped = false;
    await joinPresence(this.roomId, { ...this.me, peerId: this.myId });

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

    link.cleanups.push(
      watchAnswer(this.roomId, peerId, me, async (ans) => {
        if (pc.signalingState !== 'stable') {
          try {
            await pc.setRemoteDescription(ans);
          } catch {
            /* oferecimento recusado */
          }
        }
      }),
      watchIce(this.roomId, peerId, me, (c) => {
        void pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => undefined);
      }),
    );

    pc.onicecandidate = (e) => {
      if (e.candidate) void sendIce(this.roomId, me, peerId, candidateInit(e.candidate));
    };
    this.wirePcEvents(pc, () => this.handleLinkClosed(link));
    void (async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendOffer(this.roomId, me, peerId, offer);
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
      watchOffer(this.roomId, peerId, me, async (offer) => {
        if (!this.links.has(peerId) || this.stopped || link.dataPc) return;
        const pc = new RTCPeerConnection(iceConfig());
        link.dataPc = pc;
        pc.ondatachannel = (e) => {
          link.dc = e.channel;
          this.wireDataChannel(link);
        };
        link.cleanups.push(
          watchIce(this.roomId, peerId, me, (c) => {
            void pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => undefined);
          }),
        );
        pc.onicecandidate = (e) => {
          if (e.candidate) void sendIce(this.roomId, me, peerId, candidateInit(e.candidate));
        };
        this.wirePcEvents(pc, () => this.handleLinkClosed(link));
        try {
          await pc.setRemoteDescription(offer);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await sendAnswer(this.roomId, me, peerId, answer);
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

  private wireDataChannel(link: PeerLink): void {
    const dc = link.dc;
    if (!dc) return;
    dc.onmessage = (e) => {
      const wire = decodeWire(e.data);
      if (wire) this.handleWire(link.peerId, wire);
    };
    dc.onclose = () => this.handleLinkClosed(link);
  }

  private onLinkOpen(link: PeerLink): void {
    const dc = link.dc;
    if (!dc) return;
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
      case 'chat':
        this.events.onChat(wire.message);
        break;
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
        this.roomName = wire.name;
        this.events.onRoomInfo({ name: wire.name });
        break;
      case 'unwatch':
        this.unwatchMe(fromId);
        break;
      default:
        break;
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
    const pc = this.mediaIn.get(fromId);
    if (pc) {
      try {
        pc.close();
      } catch {
        /* noop */
      }
    }
    void clearSignal(this.roomId, fromId, this.myId);
    this.mediaIn.delete(fromId);
    this.events.onRemoteWatch(fromId, false);
  }

  // ------------------------------------------------------------- mídia (assistir)

  async watch(peerId: string): Promise<boolean> {
    if (this.stopped || peerId === this.myId) return false;
    if (this.mediaOut.has(peerId)) return true;

    const member = this.members.get(peerId);
    if (!member?.sharing) return false;

    const pc = new RTCPeerConnection(iceConfig());
    this.mediaOut.set(peerId, pc);
    this.events.onReceiveEnd(peerId);

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (stream) this.events.onReceiveStream(peerId, stream);
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) void sendIce(this.roomId, this.myId, peerId, candidateInit(e.candidate));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.teardownWatch(peerId);
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') this.teardownWatch(peerId);
    };

    const unsubAnswer = watchAnswer(this.roomId, peerId, this.myId, async (ans) => {
      if (pc.signalingState !== 'stable') {
        try {
          await pc.setRemoteDescription(ans);
        } catch {
          /* noop */
        }
      }
    });
    const unsubIce = watchIce(this.roomId, peerId, this.myId, (c) => {
      void pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => undefined);
    });

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendOffer(this.roomId, this.myId, peerId, offer);
    } catch {
      unsubAnswer();
      unsubIce();
      this.teardownWatch(peerId);
      return false;
    }
    return true;
  }

  unwatch(peerId: string): void {
    if (!this.mediaOut.has(peerId)) return;
    const pc = this.mediaOut.get(peerId);
    try {
      pc?.close();
    } catch {
      /* noop */
    }
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

  private teardownWatch(peerId: string): void {
    const pc = this.mediaOut.get(peerId);
    if (pc) {
      void clearSignal(this.roomId, this.myId, peerId);
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
    const off = watchOffer(this.roomId, peerId, me, async (offer) => {
      if (this.stopped || this.mediaIn.has(peerId)) return;
      await this.answerMediaOffer(peerId, offer);
    });
    this.unsubs.push(off);
  }

  private async answerMediaOffer(peerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    const pc = new RTCPeerConnection(iceConfig());
    this.mediaIn.set(peerId, pc);

    const stream = this.localStream;
    if (stream) {
      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) void sendIce(this.roomId, this.myId, peerId, candidateInit(e.candidate));
    };
    const unsubIce = watchIce(this.roomId, peerId, this.myId, (c) => {
      void pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => undefined);
    });

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
        unsubIce();
        try {
          pc.close();
        } catch {
          /* noop */
        }
        this.mediaIn.delete(peerId);
        this.events.onRemoteWatch(peerId, false);
      }
    };

    try {
      await pc.setRemoteDescription(offer);
      for (const tr of pc.getTransceivers()) {
        tr.direction = 'sendonly';
        if (tr.sender?.track?.kind === 'video') {
          try {
            tr.setCodecPreferences(preferredVideoCodecs());
          } catch {
            /* noop */
          }
        }
      }
      for (const sender of pc.getSenders()) {
        if (sender.track?.kind === 'video') {
          const res = this.resolution as Resolution;
          try {
            const params = sender.getParameters();
            params.encodings = encodingsFor(sender.track, res);
            await sender.setParameters(params);
          } catch {
            /* parâmetros não suportados neste navegador */
          }
        }
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendAnswer(this.roomId, this.myId, peerId, answer);
      this.events.onRemoteWatch(peerId, true);
    } catch {
      try {
        pc.close();
      } catch {
        /* noop */
      }
      unsubIce();
      this.mediaIn.delete(peerId);
    }
  }

  // ----------------------------------------------------------------- leave

  async destroy(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    for (const link of [...this.links.values()]) {
      this.closeLink(link);
      void clearSignal(this.roomId, this.myId, link.peerId);
    }
    this.links.clear();

    for (const [peerId, pc] of [...this.mediaOut]) {
      try {
        pc.close();
      } catch {
        /* noop */
      }
      void clearSignal(this.roomId, this.myId, peerId);
    }
    this.mediaOut.clear();

    for (const peerId of [...this.mediaIn.keys()]) {
      void clearSignal(this.roomId, peerId, this.myId);
    }
    this.mediaIn.clear();

    this.unsubs.splice(0).forEach((fn) => fn());
    await leavePresence(this.roomId, this.myId);
  }

  /** Encerra todas as conexões de entrada (não assisto mais ninguém vê). */
  closeIncoming(): void {
    for (const [peerId, pc] of [...this.mediaIn]) {
      void clearSignal(this.roomId, peerId, this.myId);
      try {
        pc.close();
      } catch {
        /* noop */
      }
      this.mediaIn.delete(peerId);
      this.events.onRemoteWatch(peerId, false);
    }
  }

  private teardownPeer(peerId: string): void {
    const link = this.links.get(peerId);
    if (link) this.closeLink(link);
    this.teardownWatch(peerId);
    this.unwatchMe(peerId);
    void clearSignal(this.roomId, this.myId, peerId);
  }
}