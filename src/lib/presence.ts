import { get, onDisconnect, onValue, ref, remove, set, update } from 'firebase/database';
import { getDb } from './firebase';
import type { MemberInfo, RoomMeta } from '../types';

const node = {
  room: (roomId: string) => `rooms/${roomId}`,
  meta: (roomId: string) => `rooms/${roomId}/meta`,
  members: (roomId: string) => `rooms/${roomId}/members`,
  member: (roomId: string, peerId: string) => `rooms/${roomId}/members/${peerId}`,
};

// ------------------------------------------------------------------ meta

export async function readRoomMeta(roomId: string): Promise<RoomMeta | null> {
  try {
    const snap = await get(ref(getDb(), node.meta(roomId)));
    return snap.exists() ? (snap.val() as RoomMeta) : null;
  } catch {
    return null;
  }
}

export async function writeRoomMeta(roomId: string, meta: RoomMeta): Promise<void> {
  await set(ref(getDb(), node.meta(roomId)), meta);
}

/** Observa mudanças no metadado da sala. */
export function watchRoomMeta(roomId: string, cb: (meta: RoomMeta | null) => void): () => void {
  const r = ref(getDb(), node.meta(roomId));
  const off = onValue(r, (snap) => cb(snap.exists() ? (snap.val() as RoomMeta) : null));
  return () => off();
}

// ----------------------------------------------------------------- members

export async function countMembers(roomId: string): Promise<number> {
  try {
    const snap = await get(ref(getDb(), node.members(roomId)));
    if (!snap.exists()) return 0;
    const val = snap.val() as Record<string, unknown>;
    return Object.keys(val).length;
  } catch {
    return 0;
  }
}

export async function listMembers(roomId: string): Promise<MemberInfo[]> {
  try {
    const snap = await get(ref(getDb(), node.members(roomId)));
    if (!snap.exists()) return [];
    const val = snap.val() as Record<string, Omit<MemberInfo, 'peerId'>>;
    return Object.entries(val).map(([peerId, m]) => toMember(peerId, m));
  } catch {
    return [];
  }
}

function toMember(peerId: string, m: { name?: string; emoji?: string; color?: string; sharing?: boolean; joinedAt?: number }): MemberInfo {
  return {
    peerId,
    name: typeof m.name === 'string' ? m.name : 'Participante',
    emoji: typeof m.emoji === 'string' ? m.emoji : '🐢',
    color: typeof m.color === 'string' ? m.color : '#ff5c5c',
    sharing: Boolean(m.sharing),
    joinedAt: typeof m.joinedAt === 'number' ? m.joinedAt : Date.now(),
  };
}

/** Registra o membro na sala e limpa automaticamente ao fechar a aba. */
export async function joinPresence(
  roomId: string,
  info: { peerId: string; name: string; emoji: string; color: string },
): Promise<void> {
  const m = ref(getDb(), node.member(roomId, info.peerId));
  await set(m, {
    name: info.name,
    emoji: info.emoji,
    color: info.color,
    sharing: false,
    joinedAt: Date.now(),
  });
  onDisconnect(m).remove();
}

export async function leavePresence(roomId: string, peerId: string): Promise<void> {
  try {
    await remove(ref(getDb(), node.member(roomId, peerId)));
  } catch {
    /* noop */
  }
}

export async function setSharing(roomId: string, peerId: string, sharing: boolean): Promise<void> {
  try {
    await update(ref(getDb(), node.member(roomId, peerId)), { sharing });
  } catch {
    /* noop */
  }
}

/** Observa a lista de membros (presença + estado de transmissão). */
export function watchMembers(
  roomId: string,
  cb: (members: MemberInfo[]) => void,
): () => void {
  const r = ref(getDb(), node.members(roomId));
  const off = onValue(r, (snap) => {
    if (!snap.exists()) {
      cb([]);
      return;
    }
    const val = snap.val() as Record<string, never>;
    cb(Object.entries(val).map(([peerId, m]) => toMember(peerId, m)));
  });
  return () => off();
}