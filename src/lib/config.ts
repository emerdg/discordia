export const CONFIG = {
  appName: 'Discórdia',
  githubUrl: import.meta.env.VITE_GITHUB_URL || 'https://github.com/emerdg/discordia',
  firebase: {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || '',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  },
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
      ],
    },
  ],
  roomIdLength: 7,
};

/** Alfabeto sem caracteres ambíguos (0/O, 1/I). */
const ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomId(length = CONFIG.roomIdLength): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

export function normalizeRoomId(id: string): string {
  return id.trim().toLowerCase();
}

export function isValidRoomId(id: string): boolean {
  return /^[a-z0-9]{4,16}$/.test(normalizeRoomId(id));
}

/** Id de par único por aba/sessão (usado também nas presenças e sinalização). */
export function newPeerId(): string {
  return `p${randomId(10)}`;
}