export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function $(container: ParentNode, id: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`#${id}`);
  if (!el) throw new Error(`Elemento #${id} não encontrado`);
  return el;
}

export function input$(container: ParentNode, id: string): HTMLInputElement {
  return $(container, id) as HTMLInputElement;
}

let toastTimer: number | null = null;

/** Resolve o mais cedo que der; se `ms` passar, usa `fallback` (evita travamentos). */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), ms);
    }),
  ]);
}

/** Notificação curta no canto da tela. */
export function toast(message: string): void {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'toast';
  t.textContent = message;
  document.body.append(t);
  if (toastTimer != null) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), 2200);
}