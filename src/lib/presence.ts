import { get, onDisconnect, onValue, ref, remove, set, update } from 'firebase/database';
import { getDb } from './firebase';
import type { MemberInfo, RoomMeta } from '../types';

const node = {
  room: (roomId: string) => `rooms/${roomId}`,
  meta: (roomId: string) => `rooms/${roomId}/meta`,
  members: (roomId: string) => `rooms/${roomId}/members`,
  member: (roomId: string, peerId: string) => `rooms/${roomId}/members/${peerId}`,
};

/** Observa o estado da conexão com o Realtime Database (hub). */
export function watchHubConnection(cb: (online: boolean) => void): () => void {
  const r = ref(getDb(), '.info/connected');
  const off = onValue(r, (snap) => cb(Boolean(snap.val())));
  return () => off();
}

// ----------------------------------------------------------------- meta

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

function toMember(peerId: string, m: { name?: string; emoji?: string; color?: string; sharing?: boolean; joinedAt?: number; owner?: string }): MemberInfo {
  return {
    peerId,
    name: typeof m.name === 'string' ? m.name : 'Participante',
    emoji: typeof m.emoji === 'string' ? m.emoji : '🐢',
    color: typeof m.color === 'string' ? m.color : '#ff5c5c',
    sharing: Boolean(m.sharing),
    joinedAt: typeof m.joinedAt === 'number' ? m.joinedAt : Date.now(),
    ...(typeof m.owner === 'string' ? { owner: m.owner } : {}),
  };
}

/**
 * Normaliza campos do perfil antes de gravar. O XSS de renderização é
 * bloqueado com escapeHtml no cliente; aqui só garantimos formato/limites
 * compatíveis com as regras de validação do RTDB.
 */
const sanitizeName = (name: string): string => name.trim().slice(0, 48) || 'Participante';
const sanitizeEmoji = (emoji: string): string => [...emoji].slice(0, 16).join('') || '🐢';
const sanitizeColor = (color: string): string => (/^#[0-9a-f]{6}$/i.test(color) ? color : '#ff5c5c');

/** Registra o membro na sala e limpa automaticamente ao fechar a aba. */
export async function joinPresence(
  roomId: string,
  info: { peerId: string; name: string; emoji: string; color: string; owner: string },
): Promise<void> {
  const m = ref(getDb(), node.member(roomId, info.peerId));
  await set(m, {
    name: sanitizeName(info.name),
    emoji: sanitizeEmoji(info.emoji),
    color: sanitizeColor(info.color),
    sharing: false,
    owner: info.owner,
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