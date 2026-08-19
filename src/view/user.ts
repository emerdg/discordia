import { firebaseMissing, firebaseReady } from '../lib/firebase';
import { isValidRoomId, newPeerId, normalizeRoomId, randomId } from '../lib/config';
import { countMembers, readRoomMeta, writeRoomMeta } from '../lib/presence';
import {
  PRESET_COLORS,
  addRoom,
  clearRooms,
  getPrefs,
  getRoomHistory,
  getRooms,
  patchPrefs,
  removeRoom,
} from '../lib/storage';
import { searchEmojis } from '../lib/emojiNames';
import { icon } from '../icons';
import { escapeHtml, input$, toast } from '../util/dom';
import { setTheme, THEMES } from '../lib/theme';
import type { ChatHistoryLimit, ChatSide, CodecPref } from '../types';

export function renderUser(container: HTMLElement): void {
  let prefs = getPrefs();
  if (!prefs.name) {
    location.hash = '#/';
    return;
  }

  const render = (): void => {
    prefs = getPrefs();
    container.innerHTML = `
      <div class="user-page">
        <header class="topbar">
          <a href="#/" class="back-btn icon-btn" title="Voltar">${icon('back', 18)}</a>
          <div class="user-chip" id="user-chip" style="--chip-color:${prefs.color}">
            <span class="chip-avatar"><span class="chip-emoji">${prefs.emoji}</span></span>
            <span class="chip-name">${escapeHtml(prefs.name)}</span>
          </div>
        </header>

        <div class="user-cols">
          <section class="card create-card">
            <h2 class="sec-title"><span class="sec-ic">${icon('broadcast', 18)}</span> Criar uma sala</h2>
            <label class="field-label" for="room-name">Nome da sala</label>
            <input id="room-name" type="text" placeholder="Ex.: Jogatina de sexta" maxlength="40" autocomplete="off" />
            <label class="field-label" for="room-max">Limite de participantes</label>
            <select id="room-max"></select>
            <p id="max-warning" class="warn hidden">Mais de 5 pessoas em malha P2P podem exigir uma banda de internet muito maior.</p>
            <button id="btn-create" class="btn-primary">${icon('plus', 16)} Criar sala</button>
            <p class="hint">O ID é gerado automaticamente. Você o compartilha com os amigos.</p>
          </section>

          <section class="card join-card">
            <h2 class="sec-title"><span class="sec-ic">${icon('users', 18)}</span> Entrar numa sala</h2>
            <label class="field-label" for="join-id">ID da sala</label>
            <div class="join-row">
              <input id="join-id" type="text" placeholder="Ex.: K7QWX2D" autocomplete="off" maxlength="16" />
              <button id="btn-join" class="btn-primary">Entrar</button>
            </div>
            <p class="hint">Se já entrou antes, o nome da sala é lembrado no seu navegador.</p>
          </section>
        </div>

        <section class="card history-card">
          <div class="history-head">
            <h2 class="sec-title"><span class="sec-ic">${icon('clock', 16)}</span> Salas recentes</h2>
            <button id="btn-clear-history" class="btn-ghost hidden">${icon('trash', 15)} Limpar</button>
          </div>
          <ul id="history-list" class="history-list"></ul>
          <p id="history-empty" class="hint">Nenhuma sala ainda. Crie uma ou entre por ID.</p>
        </section>

        <section class="card menu">
          <button id="btn-settings" class="menu-btn" type="button" aria-expanded="false">
            <span class="menu-ic">${icon('settings', 18)}</span>
            <span class="menu-label">Configurações</span>
            <span class="chev" aria-hidden="true"></span>
          </button>
          <div id="settings-wrap" class="settings-wrap">
            <div id="settings-panel" class="settings-panel">
              <div class="settings-grid">
                <div class="setting setting-theme">
                  <span class="setting-label">Tema</span>
                  <div class="themes" id="theme-picker"></div>
                </div>
                <div class="setting">
                  <span class="setting-label">Codec de vídeo (ao transmitir)</span>
                  <div class="seg" id="codec-seg">
                    <button data-codec="vp8" class="seg-btn">VP8 · Universal</button>
                    <button data-codec="h264" class="seg-btn">H.264 · Hardware</button>
                  </div>
                  <p class="hint">VP8 é o mais compatível entre navegadores e sistemas. H.264 usa aceleração de hardware (NVENC / Quick Sync / VCN) quando disponível.</p>
                </div>
                <div class="setting">
                  <span class="setting-label">Lado do chat na sala</span>
                  <div class="seg" id="chat-side-seg">
                    <button data-side="left" class="seg-btn">Esquerda</button>
                    <button data-side="right" class="seg-btn">Direita</button>
                  </div>
                </div>
                <div class="setting">
                  <span class="setting-label">Guardar histórico do chat</span>
                  <select id="history-limit">
                    <option value="0">Não salvar</option>
                    <option value="25">25 mensagens</option>
                    <option value="50">50 mensagens</option>
                    <option value="100">100 mensagens</option>
                  </select>
                </div>
                <div class="setting">
                  <span class="setting-label">Cor do seu nome</span>
                  <div class="colors" id="color-picker"></div>
                  <label class="custom-color">
                    Personalizar <input type="color" id="color-custom" value="${prefs.color}" />
                  </label>
                </div>
                <div class="setting setting-emoji">
                  <span class="setting-label">Seu emoji</span>
                  <input id="emoji-search" class="emoji-search" type="search" placeholder="Buscar emoji (ex.: coração, gato, fogo)…" autocomplete="off" />
                  <div class="emoji-wrap"><div class="emoji-grid" id="emoji-grid"></div></div>
                </div>
                <div class="setting">
                  <span class="setting-label">Filtro de linguagem</span>
                  <label class="switch" for="filter-offensive">
                    <input type="checkbox" id="filter-offensive" ${prefs.filterOffensive ? 'checked' : ''}>
                    Censurar ofensas e racismo
                  </label>
                  <p class="hint">Aplica no envio e na exibição das mensagens.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    `;

    wire();
  };

  const wire = (): void => {
    const maxSelect = container.querySelector<HTMLSelectElement>('#room-max');
    if (maxSelect) {
      for (let n = 2; n <= 10; n++) {
        const opt = document.createElement('option');
        opt.value = String(n);
        opt.textContent = `${n} ${n === 1 ? 'pessoa' : 'pessoas'}`;
        maxSelect.append(opt);
      }
      maxSelect.value = '5';
      maxSelect.addEventListener('change', () => {
        const warn = container.querySelector('#max-warning');
        if (warn) warn.classList.toggle('hidden', Number(maxSelect.value) <= 5);
      });
    }

    const createBtn = container.querySelector('#btn-create');
    createBtn?.addEventListener('click', () => {
      const nameInput = input$(container, 'room-name');
      const name = nameInput.value.trim();
      if (!name) {
        toast('Dê um nome para a sala.');
        nameInput.focus();
        return;
      }
      if (!firebaseReady()) {
        toast('Firebase não configurado: ' + firebaseMissing().join(', '));
        return;
      }
      const maxUsers = Number((maxSelect as HTMLSelectElement).value || 5);
      const id = normalizeRoomId(randomId());
      const meta = {
        name,
        maxUsers,
        hostId: newPeerId(),
        createdAt: Date.now(),
      };
      void writeRoomMeta(id, meta)
        .then(() => {
          addRoom(name, id);
          location.hash = `#/room/${id}`;
        })
        .catch(() => toast('Falha ao criar a sala no hub. Tente de novo.'));
    });

    const joinBtn = container.querySelector('#btn-join');
    const joinInput = input$(container, 'join-id');
    joinBtn?.addEventListener('click', () => joinRoom(joinInput.value));
    joinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinRoom(joinInput.value);
    });

    const joinRoom = (raw: string): void => {
      // Aceita "K7QWX2D", "k7qwx2d" ou URLs/links com #/room/K7QWX2D
      const linkMatch = raw.match(/room\/[A-Za-z0-9]{4,16}/i);
      const rawId = linkMatch ? (linkMatch[0].split('/').pop() as string) : raw;
      const id = normalizeRoomId(rawId);
      if (!isValidRoomId(id)) {
        toast('ID inválido. Use o ID exibido na sala.');
        return;
      }
      if (!firebaseReady()) {
        toast('Firebase não configurado: ' + firebaseMissing().join(', '));
        return;
      }
      void (async () => {
        const meta = await readRoomMeta(id);
        if (meta && (await countMembers(id)) >= meta.maxUsers) {
          toast(`Sala cheia (máximo ${meta.maxUsers}).`);
          return;
        }
        const hist = getRoomHistory(id);
        addRoom(hist?.name ?? 'Sala', id);
        location.hash = `#/room/${id}`;
      })();
    };

    // histórico
    container.querySelector('#btn-clear-history')?.addEventListener('click', () => {
      clearRooms();
      renderHistory();
      toast('Histórico de salas limpo.');
    });
    renderHistory();

    // configurações
    const settingsBtn = container.querySelector('#btn-settings');
    const wrap = container.querySelector('#settings-wrap');
    settingsBtn?.addEventListener('click', () => {
      const open = wrap?.classList.toggle('open') ?? false;
      settingsBtn.setAttribute('aria-expanded', String(open));
    });

    // tema (8 opções: Discórdia, NVIDIA, AMD, Intel — claro/escuro)
    const themePicker = container.querySelector('#theme-picker');
    if (themePicker) {
      for (const t of THEMES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'theme-opt' + (t.id === prefs.theme ? ' active' : '');
        b.title = t.label;
        b.innerHTML = `<span class="theme-swatch" style="background:linear-gradient(135deg, ${t.a}, ${t.b})"></span><span class="theme-label">${escapeHtml(t.label)}</span>`;
        b.addEventListener('click', () => {
          setTheme(t.id);
          prefs = getPrefs();
          themePicker.querySelectorAll('.theme-opt').forEach((x) => x.classList.toggle('active', x === b));
          toast(`Tema: ${t.label}`);
        });
        themePicker.append(b);
      }
    }

    // codec de vídeo
    const codecSeg = container.querySelector('#codec-seg');
    if (codecSeg) {
      const markCodec = (c: CodecPref): void => {
        codecSeg.querySelectorAll('.seg-btn').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-codec') === c);
        });
      };
      markCodec(prefs.codec);
      codecSeg.querySelectorAll('.seg-btn').forEach((b) => {
        b.addEventListener('click', () => {
          const c = (b.getAttribute('data-codec') as CodecPref) || 'vp8';
          prefs = patchPrefs({ codec: c });
          markCodec(c);
          toast(c === 'h264' ? 'Codec: H.264 (hardware)' : 'Codec: VP8 (universal)');
        });
      });
    }

    // lado do chat
    const seg = container.querySelector('#chat-side-seg');
    if (seg) {
      const mark = (side: ChatSide): void => {
        seg.querySelectorAll('.seg-btn').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-side') === side);
        });
      };
      mark(prefs.chatSide);
      seg.querySelectorAll('.seg-btn').forEach((b) => {
        b.addEventListener('click', () => {
          const side = (b.getAttribute('data-side') as ChatSide) || 'left';
          prefs = patchPrefs({ chatSide: side });
          mark(side);
          toast(side === 'left' ? 'Chat à esquerda' : 'Chat à direita');
        });
      });
    }

    // limite de histórico
    const limitSel = container.querySelector<HTMLSelectElement>('#history-limit');
    if (limitSel) {
      limitSel.value = String(prefs.historyLimit);
      limitSel.addEventListener('change', () => {
        const v = Number(limitSel.value) as ChatHistoryLimit;
        prefs = patchPrefs({ historyLimit: v });
        toast(v === 0 ? 'Histórico do chat: não salvar' : `Histórico do chat: ${v} mensagens`);
      });
    }

    // cores
    const picker = container.querySelector('#color-picker');
    if (picker) {
      PRESET_COLORS.forEach((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'color-swatch' + (c.hex === prefs.color ? ' active' : '');
        b.style.background = c.hex;
        b.title = c.label;
        b.addEventListener('click', () => {
          prefs = patchPrefs({ color: c.hex });
          refreshSwatches();
          refreshChip();
          toast(`Cor: ${c.label}`);
        });
        picker.append(b);
      });
      const custom = container.querySelector<HTMLInputElement>('#color-custom');
      custom?.addEventListener('input', () => {
        prefs = patchPrefs({ color: custom.value });
        refreshSwatches();
        refreshChip();
      });
    }

    // emojis (com busca)
    const grid = container.querySelector('#emoji-grid');
    const search = container.querySelector<HTMLInputElement>('#emoji-search');
    if (grid) {
      const renderEmojiGrid = (query: string): void => {
        grid.innerHTML = '';
        const results = searchEmojis(query);
        if (!results.length) {
          const empty = document.createElement('div');
          empty.className = 'emoji-empty';
          empty.textContent = 'Nenhum emoji encontrado.';
          grid.append(empty);
          return;
        }
        for (const cat of results) {
          const head = document.createElement('div');
          head.className = 'emoji-cat-head';
          head.textContent = cat.label;
          grid.append(head);
          cat.emojis.forEach((e) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'emoji-btn' + (e === prefs.emoji ? ' active' : '');
            b.textContent = e;
            b.title = `${cat.label} · ${e}`;
            b.addEventListener('click', () => {
              prefs = patchPrefs({ emoji: e });
              grid.querySelectorAll('.emoji-btn').forEach((x) => x.classList.toggle('active', x === b));
              refreshChip();
              toast(`Emoji: ${e}`);
            });
            grid.append(b);
          });
        }
      };
      renderEmojiGrid('');
      search?.addEventListener('input', () => renderEmojiGrid(search.value));
    }

    // filtro de linguagem
    const filterOff = container.querySelector<HTMLInputElement>('#filter-offensive');
    filterOff?.addEventListener('change', () => {
      prefs = patchPrefs({ filterOffensive: filterOff.checked });
      toast(filterOff.checked ? 'Filtro de linguagem ativado' : 'Filtro de linguagem desativado');
    });

    const refreshSwatches = (): void => {
      container.querySelectorAll('.color-swatch').forEach((s) => {
        s.classList.toggle('active', (s as HTMLButtonElement).style.background === prefs.color);
      });
    };

    const refreshChip = (): void => {
      const chip = container.querySelector<HTMLElement>('#user-chip');
      if (chip) {
        chip.style.setProperty('--chip-color', prefs.color);
        const e = chip.querySelector('.chip-emoji');
        const n = chip.querySelector('.chip-name');
        if (e) e.textContent = prefs.emoji;
        if (n) n.textContent = prefs.name;
      }
    };
  };

  const renderHistory = (): void => {
    const list = container.querySelector<HTMLUListElement>('#history-list');
    const empty = container.querySelector('#history-empty');
    const clearBtn = container.querySelector('#btn-clear-history');
    if (!list) return;
    const rooms = getRooms();
    list.innerHTML = '';
    if (clearBtn) clearBtn.classList.toggle('hidden', rooms.length === 0);
    if (empty) empty.classList.toggle('hidden', rooms.length > 0);
    for (const room of rooms) {
      const li = document.createElement('li');
      li.className = 'history-item';
      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'history-enter';
      main.innerHTML = `<span class="history-name">${escapeHtml(room.name)}</span><code>${escapeHtml(room.id.toUpperCase())}</code>`;
      main.addEventListener('click', () => {
        addRoom(room.name, room.id);
        location.hash = `#/room/${room.id}`;
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'history-del';
      del.title = 'Remover do histórico';
      del.innerHTML = icon('trash', 16);
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        removeRoom(room.id);
        renderHistory();
      });
      li.append(main, del);
      list.append(li);
    }
  };

  render();
}