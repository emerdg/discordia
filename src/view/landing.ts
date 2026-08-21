import { CONFIG } from '../lib/config';
import { EMOJIS, getPrefs, patchPrefs, setName } from '../lib/storage';
import { hasOffensive } from '../lib/words';
import { icon, logoMark } from '../icons';
import { escapeHtml, toast } from '../util/dom';

export function renderLanding(container: HTMLElement): void {
  const prefs = getPrefs();
  const currentName = prefs.name;

  container.innerHTML = `
    <div class="landing">
      <div class="landing-grid">
        <header class="hero">
          <div class="logo-badge">${logoMark(60)}</div>
          <h1 class="brand-title">Discórdia</h1>
          <p class="tagline">Compartilhe sua tela com amigos, sem depender de servidores.</p>
          <p class="subline">
            Transmissão <strong>100% P2P</strong> (WebRTC): o vídeo sai da sua GPU direto para as
            outras máquinas, usando o encoder de hardware da sua placa — <strong>NVENC</strong>
            (NVIDIA), <strong>Quick Sync</strong> (Intel) ou <strong>VCN</strong> (AMD).
            Seus dados ficam <strong>no seu navegador</strong>; o Firebase apenas conecta os
            usuários. Nada do conteúdo passa por servidor.
          </p>
        </header>

        <form id="landing-form" class="landing-card">
          <label class="field-label" for="landing-name">Como você quer aparecer?</label>
          <div class="input-row">
            <span id="landing-emoji-preview" class="landing-emoji-preview">${prefs.emoji}</span>
            <input id="landing-name" type="text" placeholder="${escapeHtml(currentName || 'Ex.: Elias')}"
                   value="${escapeHtml(currentName)}" autocomplete="off" maxlength="24" />
            <button type="submit" id="landing-go" class="btn-primary" disabled>${icon('broadcast', 16)} Entrar</button>
          </div>
          <label class="field-label" for="landing-emoji-strip">Escolha seu emoji</label>
          <div class="emoji-strip" id="landing-emoji-strip"></div>
        </form>
      </div>

      <footer class="landing-footer">
        <a class="foot-pill" href="${CONFIG.githubUrl}" target="_blank" rel="noopener noreferrer">
          ${icon('link', 14)} Código no GitHub ↗
        </a>
      </footer>
    </div>
  `;

  const form = container.querySelector<HTMLFormElement>('#landing-form');
  const nameInput = container.querySelector<HTMLInputElement>('#landing-name');
  const goBtn = container.querySelector<HTMLButtonElement>('#landing-go');
  const strip = container.querySelector<HTMLElement>('#landing-emoji-strip');
  if (!form || !nameInput || !goBtn || !strip) return;

  let selectedEmoji: string | null = prefs.emoji || null;
  const preview = container.querySelector<HTMLElement>('#landing-emoji-preview');

  const updateGo = (): void => {
    goBtn.disabled = !(nameInput.value.trim().length > 0 && selectedEmoji !== null);
  };

  const syncPreview = (): void => {
    if (preview) preview.textContent = selectedEmoji ?? '❔';
  };

  for (const e of EMOJIS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'strip-emoji' + (e === selectedEmoji ? ' active' : '');
    b.textContent = e;
    b.title = e;
    b.addEventListener('click', () => {
      selectedEmoji = e;
      strip.querySelectorAll('.strip-emoji').forEach((x) => x.classList.toggle('active', x === b));
      syncPreview();
      updateGo();
    });
    strip.append(b);
  }

  nameInput.addEventListener('input', updateGo);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !goBtn.disabled) form.requestSubmit();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name || selectedEmoji === null) {
      updateGo();
      (name ? strip : nameInput).focus();
      return;
    }
    // Bloqueia nomes com termos ofensivos, independente do filtro por usuário.
    if (hasOffensive(name)) {
      toast('Este nome contém palavras inadequadas. Escolha outro.');
      nameInput.focus();
      return;
    }
    setName(name);
    patchPrefs({ emoji: selectedEmoji });
    location.hash = '#/user';
  });

  syncPreview();
  updateGo();
}