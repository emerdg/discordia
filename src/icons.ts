/** Ícones SVG inline (estilo stroke, consistentes) — sem dependências. */

export type IconName =
  | 'mic'
  | 'audio'
  | 'send'
  | 'copy'
  | 'fullscreen'
  | 'diag'
  | 'leave'
  | 'plus'
  | 'trash'
  | 'back'
  | 'monitor'
  | 'users'
  | 'volHigh'
  | 'volMid'
  | 'volMute'
  | 'play'
  | 'pause'
  | 'chat'
  | 'clock'
  | 'broadcast'
  | 'link'
  | 'shield'
  | 'settings'
  | 'sun'
  | 'moon'
  | 'x';

const PATHS: Record<IconName, string> = {
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 19v3"/>',
  audio: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  fullscreen:
    '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  diag: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/>',
  leave: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  volHigh: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
  volMid: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
  volMute: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m23 9-6 6"/><path d="m17 9 6 6"/>',
  play: '<path d="m7 4 13 8-13 8V4Z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  broadcast:
    '<circle cx="12" cy="12" r="2"/><path d="M7.7 16.3a6 6 0 0 1 0-8.6"/><path d="M16.3 7.7a6 6 0 0 1 0 8.6"/><path d="M4.9 19.1a10 10 0 0 1 0-14.2"/><path d="M19.1 4.9a10 10 0 0 1 0 14.2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="m4.5 4.5 2.5 2.5"/><path d="m17 17 2.5 2.5"/><path d="m19.5 4.5-2.5 2.5"/><path d="m7 17-2.5 2.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

/** Ícone em SVG string, herdando cor atual. */
export function icon(name: IconName, size = 20): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
}

/** Marca da Discórdia (gradiente + ondas de sinal, espelhadas em forma de "D"). */
export function logoMark(size = 44): string {
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true"><defs><linearGradient id="dlg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6c7bff"/><stop offset="1" stop-color="#a855f7"/></linearGradient></defs><rect x="4" y="4" width="56" height="56" rx="16" fill="url(#dlg)"/><g transform="translate(64 0) scale(-1 1)"><path d="M20 42a14 14 0 0 1 0-20" stroke="#fff" stroke-width="5" stroke-linecap="round" fill="none"/><path d="M28 38a6 6 0 0 1 0-12" stroke="#fff" stroke-width="5" stroke-linecap="round" fill="none"/><circle cx="33" cy="32" r="3.5" fill="#fff"/></g></svg>`;
}