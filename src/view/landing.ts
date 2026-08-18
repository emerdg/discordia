import { CONFIG } from '../lib/config';
import { getPrefs, setName } from '../lib/storage';
import { icon, logoMark } from '../icons';
import { escapeHtml } from '../util/dom';

export function renderLanding(container: HTMLElement): void {
  const prefs = getPrefs();
  const currentName = prefs.name;

  container.innerHTML = `
    <div class="landing">
      <header class="hero">
        <div class="logo-badge">${logoMark(54)}</div>
        <h1 class="brand-title">Discórdia</h1>
        <p class="tagline">Compartilhe sua tela com amigos, sem depender de servidores.</p>
        <p class="subline">
          Transmissão <strong>100% P2P</strong> entre os participantes. O vídeo sai da sua GPU
          direto para as outras máquinas (WebRTC) usando o encoder de hardware da sua placa —
          <strong>NVENC</strong> (NVIDIA), <strong>Quick Sync</strong> (Intel) ou
          <strong>VCN</strong> (AMD). Nada do conteúdo passa por servidor.
        </p>
      </header>

      <form id="landing-form" class="landing-card">
        <label class="field-label" for="landing-name">Como você quer aparecer?</label>
        <div class="input-row">
          <input id="landing-name" type="text" placeholder="${escapeHtml(currentName || 'Ex.: Elias')}"
                 value="${escapeHtml(currentName)}" autocomplete="off" maxlength="24" />
          <button type="submit" class="btn-primary">Entrar</button>
        </div>
        <p class="hint">Seu nome, emoji e cor ficam salvos <strong>no seu navegador</strong>.</p>
      </form>

      <footer class="landing-footer">
        <span class="foot-pill">${icon('shield', 14)} WebRTC P2P · seus dados ficam no seu navegador</span>
        <span class="foot-pill">${icon('chat', 14)} Firebase só conecta os usuários</span>
        <a class="foot-pill" href="${CONFIG.githubUrl}" target="_blank" rel="noopener noreferrer">
          ${icon('link', 14)} Código no GitHub ↗
        </a>
      </footer>
    </div>
  `;

  const form = container.querySelector<HTMLFormElement>('#landing-form');
  const nameInput = container.querySelector<HTMLInputElement>('#landing-name');
  if (form && nameInput) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      setName(name);
      location.hash = '#/user';
    });
  }
}