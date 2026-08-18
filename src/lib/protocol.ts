import type { ChatMessage } from '../types';

export type WireChat = ChatMessage;

export type Wire =
  | { type: 'hello'; name: string; emoji: string; color: string }
  | { type: 'room-info-req' }
  | { type: 'room-info-res'; name: string; maxUsers: number }
  | { type: 'chat'; message: WireChat }
  | { type: 'unwatch' }
  | { type: 'refresh-media' }
  | { type: 'pong'; ts: number };

export function encodeWire(msg: Wire): string {
  return JSON.stringify(msg);
}

export function decodeWire(raw: string | ArrayBuffer | Blob): Wire | null {
  if (typeof raw !== 'string') return null;
  try {
    const obj = JSON.parse(raw) as Wire;
    if (obj && typeof obj === 'object' && typeof obj.type === 'string') return obj;
    return null;
  } catch {
    return null;
  }
}