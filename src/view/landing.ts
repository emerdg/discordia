import { CONFIG } from '../lib/config';
import { getPrefs, setName } from '../lib/storage';
import { escapeHtml } from '../util/dom';

export function renderLanding(container: HTMLElement): void {
  const prefs = getPrefs();
  const currentName = prefs.name;

  container.innerHTML = `
    <div class="landing">
      <header class="landing-hero">
        <div class="logo">📡</div>
        <h1>Discórdia</h1>
        <p class="tagline">Compartilhe sua tela com amigos, sem depender de servidores.</p>
        <p class="subline">
          Transmissão 100% <strong>P2P</strong> entre os participantes. O vídeo sai da sua GPU
          direto para as outras máquinas (WebRTC) usando o encoder de hardware
          da placa de vídeo — <strong>NVENC</strong> (NVIDIA), <strong>Quick Sync</strong> (Intel)
          ou <strong>VCN</strong> (AMD). Nada do conteúdo passa por servidor.
        </p>
      </header>

      <form id="landing-form" class="landing-form card">
        <label for="landing-name">Como você quer aparecer?</label>
        <div class="landing-row">
          <input id="landing-name" type="text" placeholder="Ex.: ${escapeHtml(currentName || 'Elias')}"
                 value="${escapeHtml(currentName)}" autocomplete="off" maxlength="24" />
          <button type="submit" class="primary">Entrar</button>
        </div>
        <p class="hint">Seu nome, emoji e cor ficam salvos <strong>no seu navegador</strong>.</p>
      </form>

      <footer class="landing-footer">
        <a href="${CONFIG.githubUrl}" target="_blank" rel="noopener noreferrer">Código no GitHub ↗</a>
        <span class="dot">·</span>
        <span>WebRTC P2P · Firebase só conecta os usuários · seus dados ficam no seu navegador</span>
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