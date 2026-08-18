import { off, onChildAdded, onValue, push, ref, remove, set } from 'firebase/database';
import { getDb } from './firebase';

/**
 * Sinalização WebRTC via Realtime Database (nuvem do Firebase).
 *
 * Estrutura por par (from → to):
 *   rooms/:roomId/signal/:from/:to/{offer,answer,ice/}
 *
 * Cada lado escreve no nó "para mim" e observa o nó "para o outro".
 * Todos os dados são descartáveis (apenas permitem a conexão P2P).
 */

const node = (roomId: string, from: string, to: string) =>
  `rooms/${roomId}/signal/${from}/${to}`;

export type SignalDescription = RTCSessionDescriptionInit;

export async function sendOffer(
  roomId: string,
  from: string,
  to: string,
  offer: SignalDescription,
): Promise<void> {
  await set(ref(getDb(), `${node(roomId, from, to)}/offer`), {
    type: offer.type,
    sdp: offer.sdp,
  });
}

export function watchOffer(
  roomId: string,
  from: string,
  to: string,
  cb: (offer: SignalDescription) => void,
): () => void {
  const r = ref(getDb(), `${node(roomId, from, to)}/offer`);
  const handler = onValue(r, (snap) => {
    if (snap.exists()) cb(snap.val() as SignalDescription);
  });
  return () => off(r, 'value', handler);
}

export async function sendAnswer(
  roomId: string,
  from: string,
  to: string,
  answer: SignalDescription,
): Promise<void> {
  await set(ref(getDb(), `${node(roomId, from, to)}/answer`), {
    type: answer.type,
    sdp: answer.sdp,
  });
}

export function watchAnswer(
  roomId: string,
  from: string,
  to: string,
  cb: (answer: SignalDescription) => void,
): () => void {
  const r = ref(getDb(), `${node(roomId, from, to)}/answer`);
  const handler = onValue(r, (snap) => {
    if (snap.exists()) cb(snap.val() as SignalDescription);
  });
  return () => off(r, 'value', handler);
}

export async function sendIce(
  roomId: string,
  from: string,
  to: string,
  candidate: RTCIceCandidateInit,
): Promise<void> {
  await push(ref(getDb(), `${node(roomId, from, to)}/ice`), candidate);
}

export function watchIce(
  roomId: string,
  from: string,
  to: string,
  cb: (candidate: RTCIceCandidateInit) => void,
): () => void {
  const r = ref(getDb(), `${node(roomId, from, to)}/ice`);
  const handler = onChildAdded(r, (snap) => {
    const val = snap.val() as RTCIceCandidateInit;
    if (val) cb(val);
  });
  return () => off(r, 'child_added', handler);
}

/** Remove toda a sinalização entre dois pares (ao fechar a conexão). */
export async function clearSignal(roomId: string, a: string, b: string): Promise<void> {
  try {
    await remove(ref(getDb(), node(roomId, a, b)));
    if (a !== b) await remove(ref(getDb(), node(roomId, b, a)));
  } catch {
    /* noop */
  }
}