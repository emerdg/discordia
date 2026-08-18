import { getPrefs, patchPrefs } from './storage';
import type { Theme } from '../types';

/** Aplica o tema (claro/escuro) no <html>. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

/** Aplica o tema salvo nas preferências (escuro por padrão). */
export function initTheme(): void {
  applyTheme(getPrefs().theme);
}

/** Alterna e salva o tema. */
export function setTheme(theme: Theme): void {
  patchPrefs({ theme });
  applyTheme(theme);
}