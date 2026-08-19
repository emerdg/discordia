import { getPrefs, patchPrefs } from './storage';
import type { Theme } from '../types';

export interface ThemeOption {
  id: Theme;
  label: string;
  /** Cor primária do gradiente (para o seletor). */
  a: string;
  /** Cor secundária do gradiente. */
  b: string;
}

export const THEMES: ThemeOption[] = [
  { id: 'dark', label: 'Discórdia', a: '#6c7bff', b: '#a855f7' },
  { id: 'light', label: 'Discórdia Claro', a: '#6c7bff', b: '#a855f7' },
  { id: 'nvidia-dark', label: 'NVIDIA', a: '#76b900', b: '#8be04a' },
  { id: 'nvidia-light', label: 'NVIDIA Claro', a: '#76b900', b: '#8be04a' },
  { id: 'amd-dark', label: 'AMD', a: '#ff3b30', b: '#ed1c24' },
  { id: 'amd-light', label: 'AMD Claro', a: '#ff3b30', b: '#ed1c24' },
  { id: 'intel-dark', label: 'Intel', a: '#0071c5', b: '#00a2ff' },
  { id: 'intel-light', label: 'Intel Claro', a: '#0071c5', b: '#00a2ff' },
];

function isLight(t: Theme): boolean {
  return t.endsWith('-light') || t === 'light';
}

/** Aplica o tema (claro/escuro e paleta de marca) no <html>. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = isLight(theme) ? 'light' : 'dark';
}

/** Aplica o tema salvo nas preferências (escuro por padrão). */
export function initTheme(): void {
  applyTheme(getPrefs().theme);
}

/** Altera e salva o tema. */
export function setTheme(theme: Theme): void {
  patchPrefs({ theme });
  applyTheme(theme);
}