export type Resolution = '1080p' | '720p' | '480p';
export type ChatSide = 'left' | 'right';
export type ChatHistoryLimit = 0 | 25 | 50 | 100;
export type Theme = 'dark' | 'light';
export type CodecPref = 'vp8' | 'h264';

export interface UserPrefs {
  name: string;
  emoji: string;
  color: string;
  chatSide: ChatSide;
  historyLimit: ChatHistoryLimit;
  resolution: Resolution;
  mic: boolean;
  pcAudio: boolean;
  theme: Theme;
  codec: CodecPref;
}

export interface RecentRoom {
  name: string;
  id: string;
  lastUsed: number;
}

export interface RoomMeta {
  name: string;
  maxUsers: number;
  hostId: string;
  createdAt: number;
}

/** Dados de um membro da sala, publicado no andar de presença do RTDB. */
export interface MemberInfo {
  peerId: string;
  name: string;
  emoji: string;
  color: string;
  sharing: boolean;
  joinedAt: number;
}

export interface ChatMessage {
  /** Id único gerado pelo remetente, para deduplicar ecos. */
  id: string;
  from: string;
  name: string;
  emoji: string;
  color: string;
  text: string;
  ts: number;
}