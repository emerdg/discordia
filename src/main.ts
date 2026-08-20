import '@fontsource-variable/inter';
import '@fontsource-variable/sora';
import './style.css';
import { renderLanding } from './view/landing';
import { renderUser } from './view/user';
import { renderRoom } from './view/room';
import { initTheme } from './lib/theme';

initTheme();

console.log(`[discordia] build-live: fix-media-b3`);

const app = document.getElementById('app');
if (!app) throw new Error('#app não encontrado');
const root = app;

let cleanup: (() => void | Promise<void>) | null = null;

function route(): void {
  if (cleanup) {
    void cleanup();
    cleanup = null;
  }
  const hash = location.hash || '#/';
  if (hash.startsWith('#/room/')) {
    const roomId = decodeURIComponent(hash.slice('#/room/'.length));
    cleanup = renderRoom(root, roomId);
  } else if (hash === '#/user' || hash.startsWith('#/user?')) {
    renderUser(root);
  } else {
    renderLanding(root);
  }
}

window.addEventListener('hashchange', route);
route();