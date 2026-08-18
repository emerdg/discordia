import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';
import { CONFIG } from './config';

let app: FirebaseApp | null = null;
let db: Database | null = null;

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