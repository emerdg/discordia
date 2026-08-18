import type { RecentRoom, UserPrefs } from '../types';

const PREFIX = 'discordia:';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage cheio ou indisponível — segue sem persistir */
  }
}

export const PRESET_COLORS: { hex: string; label: string }[] = [
  { hex: '#ff5c5c', label: 'Vermelho' },
  { hex: '#40c4ff', label: 'Azul' },
  { hex: '#69f0ae', label: 'Verde' },
  { hex: '#ffd740', label: 'Amarelo' },
  { hex: '#e040fb', label: 'Roxo' },
];

export const DEFAULT_COLOR = PRESET_COLORS[0].hex;

export const EMOJIS = [
  '🐢', '🦊', '🐺', '🐸', '🐼', '🐨', '🐯', '🦁', '🐵', '🙈',
  '🔥', '⭐', '🌈', '🍕', '🌮', '🎮', '🎧', '🎬', '🎨', '⚽',
  '🏀', '🚀', '🚗', '🛸', '🌍', '🏔', '🎯', '💎', '🎲', '🃏',
  '🧠', '👾', '🤖', '👻', '🎃', '💀', '👑', '🎩', '🧢', '🥷',
  '😎', '🤠', '😍', '🥳', '😴', '🍻', '☕', '🎵', '📚', '🎹',
];

const DEFAULT_PREFS: UserPrefs = {
  name: '',
  emoji: EMOJIS[0],
  color: DEFAULT_COLOR,
  chatSide: 'left',
  historyLimit: 50,
  resolution: '720p',
  mic: false,
  pcAudio: false,
};

export function getPrefs(): UserPrefs {
  const saved = read<Partial<UserPrefs>>('prefs', {});
  return { ...DEFAULT_PREFS, ...saved };
}

export function savePrefs(prefs: UserPrefs): void {
  write('prefs', prefs);
}

export function patchPrefs(patch: Partial<UserPrefs>): UserPrefs {
  const next = { ...getPrefs(), ...patch };
  savePrefs(next);
  return next;
}

export function setName(name: string): void {
  patchPrefs({ name });
}

// ---------------- histórico de salas

export function getRooms(): RecentRoom[] {
  return read<RecentRoom[]>('rooms', []).sort((a, b) => b.lastUsed - a.lastUsed);
}

export function addRoom(name: string, id: string): void {
  const rooms = getRooms().filter((r) => r.id !== id);
  rooms.unshift({ name, id, lastUsed: Date.now() });
  write('rooms', rooms.slice(0, 12));
}

export function removeRoom(id: string): void {
  write('rooms', getRooms().filter((r) => r.id !== id));
}

export function clearRooms(): void {
  write('rooms', []);
}

export function getRoomHistory(id: string): RecentRoom | undefined {
  return getRooms().find((r) => r.id === id);
}