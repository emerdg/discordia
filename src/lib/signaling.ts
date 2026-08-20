import { off, onChildAdded, onValue, push, ref, remove, set } from 'firebase/database';
import { getDb } from './firebase';
import { newConnId } from '../web/compat';
import type { Resolution } from '../types';

/**
 * Sinalização WebRTC via Realtime Database (nuvem do Firebase).
 *
 * Estrutura por par (from → to) e tipo de conexão (data | media):
 *   rooms/:roomId/signal/:from/:to/:kind/{offer,answer,ice/}
 *
 * Cada lado escreve no nó "para mim" e observa o nó "para o outro".
 * O sufixo :kind mantém o data channel e a mídia em trilhos separados
 * (um offer de data nunca aciona o watcher de mídia e vice-versa).
 * Todos os dados são descartáveis (apenas permitem a conexão P2P).
 *
 * Idempotência por conexão:
 * O `connId` identifica um handshake (offer/answer/ICE de um mesmo
 * RTCPeerConnection). Clientes antigos não enviam `connId` — nesse caso o
 * receptor deve aceitar (retrocompatível). clientes novos ignoram eventos
 * de handshakes obsoletos, evitando que um offer/answer/ICE de uma conexão
 * antiga seja aplicado a uma conexão recém-criada.
 */

export type SignalKind = 'data' | 'media';
export type ConnId = string;

const node = (roomId: string, from: string, to: string, kind: SignalKind) =>
  `rooms/${roomId}/signal/${from}/${to}/${kind}`;

export type SignalDescription = RTCSessionDescriptionInit;

/** Offer de mídia com a resolução desejada (redução de banda em 3+ telas). */
export interface SignalOfferPayload {
  description: SignalDescription;
  wantedRes?: Resolution;
  /** Identificador do handshake; ausente em clientes antigos (aceitar sempre). */
  connId?: string;
  /** uid do auth que escreveu o nó; ausente em clientes antigos. */
  owner?: string;
}

export interface SignalAnswerPayload {
  description: SignalDescription;
  connId?: string;
  owner?: string;
}

export interface SignalIcePayload {
  candidate: RTCIceCandidateInit;
  connId?: string;
  owner?: string;
}

/** Um `connId` develve ser aceito se vier de cliente antigo (sem campo). */
export function connMatches(expected: ConnId, actual: ConnId | undefined): boolean {
  return !expected || actual === undefined || actual === expected;
}

export async function sendOffer(
  roomId: string,
  from: string,
  to: string,
  offer: SignalDescription,
  kind: SignalKind,
  owner: string,
  extra?: { wantedRes?: Resolution; connId?: string },
): Promise<void> {
  await set(ref(getDb(), `${node(roomId, from, to, kind)}/offer`), {
    type: offer.type,
    sdp: offer.sdp,
    owner,
    ...(extra?.wantedRes ? { wantedRes: extra.wantedRes } : {}),
    ...(extra?.connId ? { connId: extra.connId } : {}),
  });
}

export function watchOffer(
  roomId: string,
  from: string,
  to: string,
  kind: SignalKind,
  cb: (payload: SignalOfferPayload) => void,
): () => void {
  const r = ref(getDb(), `${node(roomId, from, to, kind)}/offer`);
  const handler = onValue(r, (snap) => {
    const val = snap.val() as {
      type?: string;
      sdp?: string;
      wantedRes?: Resolution;
      connId?: string;
      owner?: string;
    } | null;
    if (val) {
      cb({
        description: { type: (val.type ?? 'offer') as RTCSdpType, sdp: val.sdp ?? '' },
        wantedRes: val.wantedRes,
        connId: val.connId,
        owner: val.owner,
      });
    }
  });
  return () => off(r, 'value', handler);
}

export async function sendAnswer(
  roomId: string,
  from: string,
  to: string,
  answer: SignalDescription,
  kind: SignalKind,
  owner: string,
  connId?: string,
): Promise<void> {
  await set(ref(getDb(), `${node(roomId, from, to, kind)}/answer`), {
    type: answer.type,
    sdp: answer.sdp,
    owner,
    ...(connId ? { connId } : {}),
  });
}

export function watchAnswer(
  roomId: string,
  from: string,
  to: string,
  kind: SignalKind,
  cb: (payload: SignalAnswerPayload) => void,
): () => void {
  const r = ref(getDb(), `${node(roomId, from, to, kind)}/answer`);
  const handler = onValue(r, (snap) => {
    const val = snap.val() as { type?: string; sdp?: string; connId?: string; owner?: string } | null;
    if (val) {
      cb({
        description: { type: (val.type ?? 'answer') as RTCSdpType, sdp: val.sdp ?? '' },
        connId: val.connId,
        owner: val.owner,
      });
    }
  });
  return () => off(r, 'value', handler);
}

export async function sendIce(
  roomId: string,
  from: string,
  to: string,
  kind: SignalKind,
  candidate: RTCIceCandidateInit,
  owner: string,
  connId?: string,
): Promise<void> {
  await push(ref(getDb(), `${node(roomId, from, to, kind)}/ice`), {
    candidate,
    owner,
    ...(connId ? { connId } : {}),
  });
}

export function watchIce(
  roomId: string,
  from: string,
  to: string,
  kind: SignalKind,
  cb: (payload: SignalIcePayload) => void,
): () => void {
  const r = ref(getDb(), `${node(roomId, from, to, kind)}/ice`);
  const handler = onChildAdded(r, (snap) => {
    const val = snap.val() as {
      candidate?: RTCIceCandidateInit | null;
      connId?: string;
      owner?: string;
    } | null;
    if (val?.candidate) {
      cb({ candidate: val.candidate, connId: val.connId, owner: val.owner });
    }
  });
  return () => off(r, 'child_added', handler);
}

/** Remove toda a sinalização entre dois pares (ao fechar a conexão). */
export async function clearSignal(roomId: string, a: string, b: string): Promise<void> {
  try {
    await remove(ref(getDb(), `rooms/${roomId}/signal/${a}/${b}`));
    if (a !== b) await remove(ref(getDb(), `rooms/${roomId}/signal/${b}/${a}`));
  } catch {
    /* noop */
  }
}

export { newConnId };