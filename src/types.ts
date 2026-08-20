export type Resolution = '1080p' | '720p' | '480p';
/** Quem pode iniciar uma transmissão na sala. */
export type BroadcastPolicy = 'creator_only' | 'everyone' | 'creator_approves';
export type ChatSide = 'left' | 'right';
export type ChatHistoryLimit = 0 | 25 | 50 | 100;
export type Theme =
  | 'dark'
  | 'light'
  | 'nvidia-dark'
  | 'nvidia-light'
  | 'amd-dark'
  | 'amd-light'
  | 'intel-dark'
  | 'intel-light';
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
  filterOffensive: boolean;
  autoDownscale: boolean;
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
  /** Censura global da sala: quando true aplica-se a todos (default true). */
  censorship?: boolean;
  /** Política de quem pode iniciar transmissão (default 'everyone'). */
  broadcastPolicy?: BroadcastPolicy;
  /** UIDs autorizados a aprovar/negar transmissões e cancelá-las. */
  moderators?: string[];
}

/** Dados de um membro da sala, publicado no andar de presença do RTDB. */
export interface MemberInfo {
  peerId: string;
  name: string;
  emoji: string;
  color: string;
  sharing: boolean;
  joinedAt: number;
  /** uid do auth anônimo que criou o registro (garante a propriedade do nó). */
  owner?: string;
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