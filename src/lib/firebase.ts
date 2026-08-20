import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';
import { getAuth, onAuthStateChanged, signInAnonymously, type User } from 'firebase/auth';
import { CONFIG } from './config';

let app: FirebaseApp | null = null;
let db: Database | null = null;
let authed: Promise<string> | null = null;

export function firebaseReady(): boolean {
  return Boolean(CONFIG.firebase.apiKey && CONFIG.firebase.databaseURL);
}

export function firebaseMissing(): string[] {
  const missing: string[] = [];
  const f = CONFIG.firebase;
  if (!f.apiKey) missing.push('VITE_FIREBASE_API_KEY');
  if (!f.authDomain) missing.push('VITE_FIREBASE_AUTH_DOMAIN');
  if (!f.databaseURL) missing.push('VITE_FIREBASE_DATABASE_URL');
  if (!f.projectId) missing.push('VITE_FIREBASE_PROJECT_ID');
  if (!f.appId) missing.push('VITE_FIREBASE_APP_ID');
  return missing;
}

export function getApp(): FirebaseApp {
  if (!firebaseReady()) {
    throw new Error('Firebase não configurado. Preencha .env.local (veja .env.example).');
  }
  if (!app) app = initializeApp(CONFIG.firebase);
  return app;
}

export function getDb(): Database {
  if (!db) db = getDatabase(getApp());
  return db;
}

/**
 * Garante uma sessão anônima no Firebase Auth e resolve com o `uid`.
 * As regras do RTDB exigem `auth != null`; sem assinatura o hub fica offline.
 * Requer "Authentication → Sign-in method → Anônimo" habilitado no console.
 */
export function ensureAuthed(): Promise<string> {
  if (!authed) {
    authed = new Promise<string>((resolve, reject) => {
      const auth = getAuth(getApp());
      const current = auth.currentUser;
      if (current) {
        resolve(current.uid);
        return;
      }
      onAuthStateChanged(auth, (u) => {
        if (u) resolve(u.uid);
      });
      signInAnonymously(auth).then((cred) => resolve(cred.user.uid)).catch(reject);
    });
  }
  return authed;
}

/** uid da sessão atual, ou null enquanto não autenticado. */
export function getAuthUid(): string | null {
  try {
    return getAuth(getApp()).currentUser?.uid ?? null;
  } catch {
    return null;
  }
}

/** Sinaliza para o roteador que uma sessão precisa ser (re)estabelecida. */
export function resetAuthState(): void {
  authed = null;
}

export type { User };