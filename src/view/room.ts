import { firebaseReady, ensureAuthed, getAuthUid } from '../lib/firebase';
import { isValidRoomId, APP_VERSION } from '../lib/config';
import {
  countMembers,
  deleteRoom,
  eligibleModerators,
  normalizeRoomMeta,
  readRoomMeta,
  updateRoomMeta,
  watchHubConnection,
  watchRoomMeta,
} from '../lib/presence';
import { addRoom, getPrefs, patchPrefs } from '../lib/storage';
import { appendMessages, loadBefore, loadRecent, nextSeq, deleteMessage } from '../lib/idb';
import { Mesh } from '../web/mesh';
import { startCapture, stopStream } from '../web/media';
import { censorText } from '../lib/words';
import { escapeHtml, toast, withTimeout } from '../util/dom';
import { icon, logoMark } from '../icons';
import type { BroadcastPolicy, ChatMessage, MemberInfo, Resolution, RoomMeta, UserPrefs } from '../types';

interface StageTile {
  key: string;
  isSelf: boolean;
  el: HTMLDivElement;
  video: HTMLVideoElement;
  labelEl: HTMLElement;
  muteBtn: HTMLButtonElement;
  muted: boolean;
}

interface RoomUi {
  container: HTMLElement;
  root: HTMLElement;
  roomName: HTMLElement;
  roomId: HTMLElement;
  roster: HTMLElement;
  chatMessages: HTMLElement;
  chatMore: HTMLButtonElement;
  chatForm: HTMLFormElement;
  chatInput: HTMLInputElement;
  chatSend: HTMLButtonElement;
  stageView: HTMLElement;
  placeholder: HTMLElement;
  selfPreview: HTMLElement;
  selfVideo: HTMLVideoElement;
  selfToggle: HTMLButtonElement;
  txOptions: HTMLElement;
  txMic: HTMLInputElement;
  txPc: HTMLInputElement;
  txRes: HTMLSelectElement;
  txStart: HTMLButtonElement;
  btnTransmit: HTMLButtonElement;
  volGroup: HTMLElement;
  btnVol: HTMLButtonElement;
  volRange: HTMLInputElement;
  status: HTMLElement;
}

const MAX_TILES = 4;

export function renderRoom(container: HTMLElement, rawRoomId: string): () => Promise<void> {
  const prefs = getPrefs();
  if (!prefs.name || !isValidRoomId(rawRoomId) || !firebaseReady()) {
    toast(prefs.name ? 'Sala inválida.' : 'Entre com seu nome primeiro.');
    location.hash = prefs.name ? '#/user' : '#/';
    return async () => undefined;
  }
  const roomId = rawRoomId.toLowerCase();

  let ui: RoomUi;
  let mesh: Mesh;
  let localStream: MediaStream | null = null;
  let transmitting = false;
  const watchers = new Map<string, boolean>();
  let cleanupDone = false;

  const seenChat = new Set<string>();
  let oldestShownSeq: number | null = null;
  let hideTimer: number | null = null;
  let members: MemberInfo[] = [];
  let offMeta: (() => void) | null = null;
  let offHub: (() => void) | null = null;
  let hubOnline = true;
  let lastChatAt = 0;
  let uid: string | null = getAuthUid();
  let roomMeta: RoomMeta | null = null;
  let awaitingApproval = false;
  let approvalTimer: number | null = null;
  const pendingRequests = new Set<string>();

  const isCreator = (): boolean => Boolean(uid && roomMeta && roomMeta.hostId === uid);
  const isModerator = (): boolean => isCreator() || Boolean(uid && roomMeta?.moderators?.includes(uid));
  const roomPolicy = (): BroadcastPolicy => roomMeta?.broadcastPolicy ?? 'everyone';
  const roomCensorship = (): boolean => roomMeta?.censorship !== false;
  const effectiveFilter = (): boolean => roomCensorship() || prefs.filterOffensive;
  /** True se houver ao menos um moderador ou o dono presente na sala. */
  const hasApproverPresent = (): boolean =>
    members.some((m) => roomMeta && (m.owner === roomMeta.hostId || roomMeta.moderators?.includes(m.owner as string)));

  // ------------------------------------------------------------------ layout

  container.innerHTML = `
    <div class="rr" id="room-root">
      <header class="rr-topbar">
        <div class="rr-row1">
          <span class="rr-brand">
            ${logoMark(28)}
            <span class="brand-name" id="room-name">Sala</span>
            <code class="rr-id" id="room-id">${roomId.toUpperCase()}</code>
          </span>
<span class="rr-actions">
            <button id="btn-copy-id" class="icon-btn" title="Copiar ID da sala">${icon('copy', 17)}</button>
            <button id="btn-room-settings" class="icon-btn" title="Configurações da sala" hidden>${icon('menu', 17)}</button>
            <button id="btn-chat-toggle" class="icon-btn" title="Mostrar/Ocultar chat">${icon('chat', 17)}</button>
            <button id="btn-fs" class="icon-btn" title="Tela cheia">${icon('fullscreen', 17)}</button>
            <button id="btn-dbg" class="icon-btn" title="Diagnóstico" hidden>${icon('diag', 17)}</button>
            <button id="btn-leave" class="danger">${icon('leave', 16)} Sair</button>
          </span>
        </div>
        <div class="rr-roster" id="roster"></div>
        <pre id="dbg" class="dbg" hidden></pre>
      </header>

      <div class="rr-body">
        <aside class="rr-chat" id="chat-panel" data-side="${prefs.chatSide}">
          <div id="self-preview" class="self-preview" hidden>
            <video id="self-video" muted playsinline></video>
            <span class="self-tag">${icon('broadcast', 12)} Você</span>
            <button id="self-toggle" class="self-toggle" title="Ver/pausar sua prévia"></button>
          </div>
          <div class="chat-title">${icon('chat', 15)} Chat da sala</div>
          <div class="chat-messages" id="chat-messages"></div>
          <button id="chat-more" class="ghost chat-more" hidden>Ver mensagens mais antigas</button>
          <form id="chat-form" class="chat-form">
            <input id="chat-input" type="text" placeholder="Mensagem..." autocomplete="off" maxlength="1000" />
            <button id="chat-send" type="submit" class="btn-primary" title="Enviar">${icon('send', 17)}</button>
          </form>
        </aside>

        <main class="rr-stage">
          <div class="stage-view" id="stage-view">
            <div class="stage-placeholder" id="stage-placeholder">
              <div class="ph-ic">${icon('monitor', 30)}</div>
              <p>Ninguém na tela ainda.</p>
              <p class="hint">Clique em um participante no topo para assistir.</p>
            </div>
          </div>
          <div class="stage-tools">
            <div class="tools">
              <button id="btn-chat-toggle-stage" class="icon-btn chat-toggle-btn" title="Chat">${icon('chat', 17)}</button>
              <button id="btn-transmit" class="btn-primary">${icon('broadcast', 17)} <span>Transmitir</span></button>
              <div id="tx-options" class="tx-panel" hidden>
                <label class="switch" title="Microfone">
                  <input type="checkbox" id="tx-mic" ${prefs.mic ? 'checked' : ''}>
                  ${icon('mic', 15)} Microfone
                </label>
                <label class="switch" title="Áudio do PC (sistema)">
                  <input type="checkbox" id="tx-pc" ${prefs.pcAudio ? 'checked' : ''}>
                  ${icon('audio', 15)} Áudio do PC
                </label>
                <label class="tx-res">Resolução
                  <select id="tx-res">
                    <option value="1080p" ${prefs.resolution === '1080p' ? 'selected' : ''}>1080p</option>
                    <option value="720p" ${prefs.resolution === '720p' ? 'selected' : ''}>720p</option>
                    <option value="480p" ${prefs.resolution === '480p' ? 'selected' : ''}>480p</option>
                  </select>
                </label>
                <button id="tx-start" class="btn-primary">Iniciar transmissão</button>
              </div>
            </div>
            <span class="vol" id="vol-group" title="Volume do que está assistindo">
              <button id="btn-vol" class="icon-btn vol-btn"></button>
              <input id="vol-range" type="range" min="0" max="100" value="100" title="Volume" />
            </span>
            <span id="room-status" class="status"></span>
          </div>
        </main>
      </div>

      <div id="room-settings-modal" class="modal-mask" hidden>
        <div class="modal-card">
          <header class="modal-head">
            <span class="sec-title">Configurações da sala</span>
            <button id="settings-close" class="icon-btn" title="Fechar">${icon('x', 17)}</button>
          </header>
          <div id="settings-body" class="modal-body"></div>
        </div>
      </div>

      <div id="pending-panel" class="pending-panel" hidden></div>
    </div>
  `;

  const $ = (id: string): HTMLElement => {
    const el = container.querySelector<HTMLElement>(`#${id}`);
    if (!el) throw new Error(`Elemento #${id} não encontrado`);
    return el;
  };

  ui = {
    container,
    root: $('room-root'),
    roomName: $('room-name'),
    roomId: $('room-id'),
    roster: $('roster'),
    chatMessages: $('chat-messages'),
    chatMore: $('chat-more') as HTMLButtonElement,
    chatForm: $('chat-form') as HTMLFormElement,
    chatInput: $('chat-input') as HTMLInputElement,
    chatSend: $('chat-send') as HTMLButtonElement,
    stageView: $('stage-view'),
    placeholder: $('stage-placeholder'),
    selfPreview: $('self-preview'),
    selfVideo: $('self-video') as HTMLVideoElement,
    selfToggle: $('self-toggle') as HTMLButtonElement,
    txOptions: $('tx-options'),
    txMic: $('tx-mic') as HTMLInputElement,
    txPc: $('tx-pc') as HTMLInputElement,
    txRes: $('tx-res') as HTMLSelectElement,
    txStart: $('tx-start') as HTMLButtonElement,
    btnTransmit: $('btn-transmit') as HTMLButtonElement,
    volGroup: $('vol-group'),
    btnVol: $('btn-vol') as HTMLButtonElement,
    volRange: $('vol-range') as HTMLInputElement,
    status: $('room-status'),
  };

  // ------------------------------------------------------------ helpers de tela

  const setStatus = (text: string): void => {
    ui.status.textContent = text;
  };

  const updateRoomName = (name: string): void => {
    if (!name) return;
    ui.roomName.textContent = name;
    document.title = `${name} — Discórdia`;
    addRoom(name, roomId);
  };

  // ------------------------------------------------------------ grade (tiles)

  const tiles = new Map<string, StageTile>();
  const suppressEnd = new Set<string>();
  let downscaled = false;

  const watchedPeers = (): string[] => [...tiles.keys()].filter((k) => k !== 'self');

  const updateStage = (): void => {
    const n = tiles.size;
    ui.placeholder.hidden = n > 0;
    if (n === 0) {
      ui.stageView.style.gridTemplateColumns = '';
      ui.stageView.style.gridTemplateRows = '';
      return;
    }
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    const rows = Math.ceil(n / cols);
    ui.stageView.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    ui.stageView.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  };

  let masterMuted = false;
  let masterVol = 1;

  const updateVolIcon = (): void => {
    const name = masterMuted || masterVol === 0 ? 'volMute' : masterVol < 0.5 ? 'volMid' : 'volHigh';
    ui.btnVol.innerHTML = icon(name, 16);
    ui.btnVol.title = masterMuted ? 'Ativar som' : 'Silenciar';
  };

  const applyVolume = (): void => {
    for (const t of tiles.values()) {
      t.video.muted = t.isSelf || masterMuted || t.muted;
      t.video.volume = masterVol;
      t.muteBtn.innerHTML = icon(t.muted ? 'volMute' : 'volHigh', 14);
    }
    updateVolIcon();
  };

  const makeTile = (key: string, isSelf: boolean, name: string, color: string): StageTile => {
    const el = document.createElement('div');
    el.className = 'stage-tile';
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = isSelf;

    const tools = document.createElement('div');
    tools.className = 'tile-tools';

    const muteBtn = document.createElement('button');
    muteBtn.type = 'button';
    muteBtn.className = 'tile-btn tile-mute';
    muteBtn.title = 'Silenciar';
    muteBtn.innerHTML = icon('volHigh', 14);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'tile-btn tile-close';
    closeBtn.title = 'Fechar';
    closeBtn.innerHTML = icon('x', 15);

    const labelEl = document.createElement('div');
    labelEl.className = 'tile-label';
    labelEl.style.setProperty('--tile-color', color);
    labelEl.textContent = name;

    if (!isSelf) tools.append(muteBtn);
    tools.append(closeBtn);
    el.append(video, tools, labelEl);
    ui.stageView.append(el);

    const tile: StageTile = { key, isSelf, el, video, labelEl, muteBtn, muted: false };
    tiles.set(key, tile);

    closeBtn.addEventListener('click', () => closeTile(key));
    muteBtn.addEventListener('click', () => {
      tile.muted = !tile.muted;
      applyVolume();
    });

    return tile;
  };

  /** Remove a tile da grade (e da conexão de mídia, se for de outro). */
  const closeTile = (key: string): void => {
    if (key !== 'self') mesh.unwatch(key);
    removeTileEl(key);
  };

  const removeTileEl = (key: string): void => {
    const tile = tiles.get(key);
    if (tile) {
      tile.video.srcObject = null;
      tile.el.remove();
      tiles.delete(key);
    }
    suppressEnd.delete(key);
    updateStage();
    applyVolume();
    renderRoster(members);
    reconcileDownscale();
  };

  /** Reconecta uma tile (para trocar de resolução) mantendo-a na grade. */
  const restartTile = (key: string, wanted?: Resolution): void => {
    if (key === 'self') return;
    suppressEnd.add(key);
    const tile = tiles.get(key);
    if (tile) tile.video.srcObject = null;
    mesh.unwatch(key);
    setTimeout(() => {
      if (!tiles.has(key)) return;
      void mesh.watch(key, wanted ? { wantedRes: wanted } : undefined).then((ok) => {
        if (!ok) {
          suppressEnd.delete(key);
          removeTileEl(key);
        }
      });
    }, 350);
  };

  const restartAll = (wanted?: Resolution): void => {
    watchedPeers().forEach((k, i) => {
      setTimeout(() => restartTile(k, wanted), i * 350);
    });
  };

  /** Aplica redução de banda (720p) a partir da 3ª tela assistida. */
  const reconcileDownscale = (): void => {
    const n = watchedPeers().length;
    if (!prefs.autoDownscale) {
      if (downscaled) {
        downscaled = false;
        restartAll(undefined);
      }
      return;
    }
    if (n >= 3 && !downscaled) {
      downscaled = true;
      restartAll('720p');
      setStatus(`${n} telas abertas — reduzindo banda para 720p.`);
    } else if (n < 3 && downscaled) {
      downscaled = false;
      restartAll(undefined);
    }
  };

  // ------------------------------------------------------------- roster

  const renderRoster = (list: MemberInfo[]): void => {
    members = list;
    ui.roster.innerHTML = '';
    for (const m of list) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'roster-chip';
      chip.style.setProperty('--chip-color', m.color);
      chip.dataset.peerId = m.peerId;
      chip.innerHTML = `<span class="rc-emoji">${escapeHtml(m.emoji)}</span><span class="rc-name">${escapeHtml(m.name)}</span>`;
      // badge de criador/moderador
      if (roomMeta && m.owner) {
        if (m.owner === roomMeta.hostId) {
          const b = document.createElement('span');
          b.className = 'rc-badge rc-badge-creator';
          b.title = 'Criador da sala';
          b.textContent = '👑';
          chip.append(b);
        } else if (roomMeta.moderators?.includes(m.owner)) {
          const b = document.createElement('span');
          b.className = 'rc-badge rc-badge-mod';
          b.title = 'Moderador';
          b.textContent = '🛡';
          chip.append(b);
        }
      }
      if (m.sharing && (isCreator() || isModerator()) && m.peerId !== mesh.peerId) {
        const stop = document.createElement('span');
        stop.className = 'rc-stop';
        stop.title = 'Encerrar transmissão';
        stop.innerHTML = icon('broadcastStop', 14);
        stop.addEventListener('click', (e) => {
          e.stopPropagation();
          mesh.cancelTransmit(m.peerId);
          toast(`Transmissão de ${m.name} encerrada.`);
        });
        chip.append(stop);
      }
      if (roomPolicy() === 'creator_approves' && isCreator() && m.peerId !== mesh.peerId) {
        const request = document.createElement('span');
        request.className = 'rc-approve';
        request.title = 'Aprovar/negar transmissão deste participante';
        request.innerHTML = icon('approve', 14);
        request.addEventListener('click', (e) => {
          e.stopPropagation();
          renderPendingPanel();
        });
        chip.append(request);
      }
      if (m.sharing) {
        const live = document.createElement('span');
        live.className = 'live-dot';
        live.title = 'Transmitindo agora';
        chip.append(live);
      }
      const isOpen = tiles.has(m.peerId) || (m.peerId === mesh.peerId && tiles.has('self'));
      if (isOpen) chip.classList.add('active');
      chip.addEventListener('click', () => void onChipClick(m));
      ui.roster.append(chip);
    }
    if (list.length <= 1) {
      setStatus('Aguardando outros participantes…');
    }
  };

  const openWatch = async (m: MemberInfo): Promise<void> => {
    if (tiles.size >= MAX_TILES) {
      toast(`Limite de ${MAX_TILES} telas simultâneas.`);
      return;
    }
    if (tiles.has(m.peerId)) {
      closeTile(m.peerId);
      renderRoster(members);
      return;
    }
    makeTile(m.peerId, false, `${m.emoji} ${m.name}`, m.color);
    updateStage();
    applyVolume();
    renderRoster(members);
    setStatus(`Conectando com ${m.name}…`);
    const ok = await mesh.watch(m.peerId, downscaled ? { wantedRes: '720p' } : undefined);
    if (!ok) {
      setStatus(`Não foi possível assistir ${m.name}.`);
      removeTileEl(m.peerId);
      return;
    }
    setStatus(`Assistindo ${m.name}…`);
    reconcileDownscale();
  };

  const onChipClick = async (m: MemberInfo): Promise<void> => {
    if (m.peerId === mesh.peerId) {
      toggleSelfTile();
      return;
    }
    if (!m.sharing) {
      setStatus(`${m.name} não está transmitindo agora.`);
      return;
    }
    await openWatch(m);
  };

  const toggleSelfTile = (): void => {
    if (!localStream) {
      setStatus('Você ainda não está transmitindo.');
      return;
    }
    if (tiles.has('self')) {
      removeTileEl('self');
      return;
    }
    if (tiles.size >= MAX_TILES) {
      toast(`Limite de ${MAX_TILES} telas simultâneas.`);
      return;
    }
    const tile = makeTile('self', true, 'Você', prefs.color);
    tile.video.srcObject = localStream;
    tile.video.muted = true;
    updateStage();
    applyVolume();
    renderRoster(members);
  };

  // --------------------------------------------------------- prévia própria

  const syncSelfToggle = (): void => {
    ui.selfToggle.innerHTML = icon(ui.selfVideo.paused ? 'play' : 'pause', 14);
    ui.selfToggle.title = ui.selfVideo.paused ? 'Ver sua transmissão' : 'Pausar prévia';
  };

  /** Mostra a prévia pausada (após capturar o 1º quadro) — sem impactar a transmissão. */
  const playPreviewOnce = (): void => {
    void ui.selfVideo.play().then(() => {
      const video = ui.selfVideo as unknown as { requestVideoFrameCallback?: (cb: () => void) => void };
      const pauseNow = (): void => {
        try {
          ui.selfVideo.pause();
        } catch {
          /* noop */
        }
        syncSelfToggle();
      };
      if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(pauseNow);
      } else {
        setTimeout(pauseNow, 350);
      }
    });
  };

  // --------------------------------------------------------- transmissão

  const setTransmitBtn = (on: boolean): void => {
    ui.btnTransmit.innerHTML =
      icon(on ? 'leave' : 'broadcast', 17) + ` <span>${on ? 'Encerrar transmissão' : 'Transmitir'}</span>`;
    ui.btnTransmit.classList.toggle('danger', on);
    ui.btnTransmit.classList.toggle('btn-primary', !on);
  };

  /** Aplica a política de transmissão à UI do botão (habilita/desabilita). */
  const applyPolicyUi = (): void => {
    const restricted = roomPolicy() === 'creator_only' && !isCreator();
    ui.btnTransmit.disabled = restricted;
    ui.btnTransmit.title = restricted
      ? 'Somente o criador pode iniciar transmissão nesta sala'
      : 'Iniciar transmissão';
  };

  const chatToggleEls = container.querySelectorAll<HTMLElement>('#btn-chat-toggle, #btn-chat-toggle-stage');
  const chatPanelEl = container.querySelector<HTMLElement>('#chat-panel');
  let chatCollapsed = false;
  const syncChatToggle = (): void => {
    chatToggleEls.forEach((b) => {
      b.title = chatCollapsed ? 'Exibir chat' : 'Ocultar chat';
    });
  };
  const toggleChat = (): void => {
    chatCollapsed = !chatCollapsed;
    chatPanelEl?.classList.toggle('collapsed', chatCollapsed);
    syncChatToggle();
  };
  chatToggleEls.forEach((b) => b.addEventListener('click', toggleChat));

  const resetAwaiting = (): void => {
    if (approvalTimer != null) {
      clearTimeout(approvalTimer);
      approvalTimer = null;
    }
    awaitingApproval = false;
    setTransmitBtn(false);
    ui.btnTransmit.disabled = false;
    applyPolicyUi();
  };

  /** Pede aprovação a um criador/moderador (políticas "criador aprova" ou "moderadores aprovam"). */
  const requestApproval = (): void => {
    if (awaitingApproval || isCreator()) return;
    const pol = roomPolicy();
    if (!['creator_approves', 'moderators_approves'].includes(pol)) return;
    if (!hasApproverPresent()) {
      setStatus('Sem criador/moderador presente — transmissão negada.');
      toast('Ninguém autorizado na sala para aprovar a transmissão.');
      return;
    }
    awaitingApproval = true;
    ui.btnTransmit.innerHTML = icon('broadcast', 17) + ' <span>Aguardando aprovação…</span>';
    ui.btnTransmit.disabled = true;
    ui.btnTransmit.classList.remove('danger');
    setStatus('Aguardando aprovação de um criador/moderador…');
    mesh.requestTransmit();
    approvalTimer = window.setTimeout(() => {
      resetAwaiting();
      toast('Pedido de transmissão não respondido a tempo. Tente de novo.');
    }, 30_000);
  };

  const beginCapture = async (): Promise<void> => {
    if (transmitting) return;
    const resolution = ui.txRes.value as UserPrefs['resolution'];
    const capture = {
      resolution,
      mic: ui.txMic.checked,
      pcAudio: ui.txPc.checked,
    };
    patchPrefs({ mic: capture.mic, pcAudio: capture.pcAudio, resolution });
    try {
      localStream = await startCapture(capture);
    } catch {
      setStatus('Captura cancelada ou indisponível.');
      return;
    }
    mesh.setLocalStream(localStream);
    mesh.setResolution(resolution);
    await mesh.setTransmitting(true);
    transmitting = true;
    ui.txOptions.hidden = true;
    setTransmitBtn(true);
    ui.selfPreview.hidden = false;
    ui.selfVideo.srcObject = localStream;
    playPreviewOnce();
    ui.selfPreview.classList.add('on');
    setStatus('Transmitindo. Clique em você ou em outros para ver.');
    renderRoster(members);
  };

const startTx = async (): Promise<void> => {
    if (transmitting) return;
    if (roomPolicy() === 'creator_only' && !isCreator()) {
      toast('Somente o criador pode iniciar transmissão nesta sala.');
      return;
    }
    if (roomPolicy() === 'creator_approves' && !isCreator()) {
      requestApproval();
      return;
    }
    if (roomPolicy() === 'moderators_approves') {
      if (isCreator() || isModerator()) {
        // Criador e moderadores iniciam automaticamente
        await beginCapture();
        return;
      }
      // Usuários comuns precisam de aprovação
      requestApproval();
      return;
    }
    await beginCapture();
  };

  const stopTx = async (): Promise<void> => {
    if (!transmitting) return;
    transmitting = false;
    await mesh.setTransmitting(false);
    mesh.setLocalStream(null);
    mesh.closeIncoming();
    if (localStream) {
      stopStream(localStream);
      localStream = null;
    }
    ui.selfPreview.hidden = true;
    ui.selfVideo.srcObject = null;
    ui.txOptions.hidden = true;
    setTransmitBtn(false);
    if (tiles.has('self')) removeTileEl('self');
    renderRoster(members);
  };

  // -------------------------------------------------------------- chat

  // Botão "enviar" mostra a contagem regressiva durante o intervalo anti-spam.
  const SEND_ICON = icon('send', 17);
  let sendCooldownTimer: number | null = null;
  let sendCooldownIvl: number | null = null;

  const clearSendCooldown = (): void => {
    if (sendCooldownTimer != null) {
      clearTimeout(sendCooldownTimer);
      sendCooldownTimer = null;
    }
    if (sendCooldownIvl != null) {
      clearInterval(sendCooldownIvl);
      sendCooldownIvl = null;
    }
    if (ui.chatSend.disabled) {
      ui.chatSend.disabled = false;
      ui.chatSend.title = 'Enviar';
      ui.chatSend.innerHTML = SEND_ICON;
    }
  };

  const armSendCooldown = (waitMs: number): void => {
    if (waitMs <= 0) {
      clearSendCooldown();
      return;
    }
    clearSendCooldown();
    ui.chatSend.disabled = true;
    ui.chatSend.title = 'Aguarde para enviar outra mensagem';
    const deadline = Date.now() + waitMs;
    const render = (): void => {
      const remaining = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
      ui.chatSend.innerHTML = `${remaining}s`;
    };
    render();
    sendCooldownIvl = window.setInterval(() => {
      if (Date.now() >= deadline) {
        clearSendCooldown();
      } else {
        render();
      }
    }, 250);
    sendCooldownTimer = window.setTimeout(() => clearSendCooldown(), waitMs);
  };

  /** Texto exibido para a mensagem (aplica o filtro se efetivo na sala/perfil). */
  const displayText = (m: ChatMessage): string =>
    effectiveFilter() ? censorText(m.text) : m.text;

  /** Insere texto com links http(s) clicáveis. */
  const appendLinked = (node: HTMLElement, text: string): void => {
    const re = /https?:\/\/[^\s<>"')\]]+/gi;
    let found = false;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      found = true;
      if (last < m.index) node.appendChild(document.createTextNode(text.slice(last, m.index)));
      let url = m[0];
      const trail = url.match(/[.,;:!?]+$/);
      if (trail) url = url.slice(0, -trail[0].length);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = url;
      node.appendChild(a);
      last = m.index + m[0].length;
    }
    if (!found) {
      node.textContent = text;
    } else if (last < text.length) {
      node.appendChild(document.createTextNode(text.slice(last)));
    }
  };

  const buildMsg = (m: ChatMessage): HTMLElement => {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.dataset.msgId = m.id;
    const who = document.createElement('span');
    who.className = 'who';
    who.style.color = m.color;
    who.textContent = `${m.emoji} ${m.name}`;
    const text = document.createElement('span');
    text.className = 'text';
    appendLinked(text, displayText(m));
    div.append(who, document.createTextNode(' : '), text);

    // Botão de deletar (apenas para criador/moderador, aparece ao clicar na msg)
    const canDelete = isCreator() || isModerator();
    if (canDelete) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'msg-del-btn';
      delBtn.title = 'Excluir mensagem';
      delBtn.innerHTML = icon('trash', 12);
      delBtn.hidden = true;
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        mesh.deleteMessage(m.id);
        // Remove localmente imediatamente
        removeChatMessage(m.id);
        // Remove do IndexedDB
        await deleteMessage(m.id);
      });
      div.append(delBtn);

      div.addEventListener('click', () => {
        const btn = div.querySelector<HTMLButtonElement>('.msg-del-btn');
        if (btn) btn.hidden = !btn.hidden;
      });
    }
    return div;
  };

  const removeChatMessage = (messageId: string): void => {
    // CSS.escape evita injeção de seletor caso o id venha de um peer malicioso.
    const msgEl = ui.chatMessages.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(messageId)}"]`);
    if (msgEl) msgEl.remove();
  };

  const appendChatNode = (m: ChatMessage, prepend = false): void => {
    const node = buildMsg(m);
    if (prepend) {
      ui.chatMessages.prepend(node);
      return;
    }
    ui.chatMessages.append(node);
    ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
  };

  const onChat = (m: ChatMessage): void => {
    if (seenChat.has(m.id)) return;
    seenChat.add(m.id);
    appendChatNode(m);
    if (prefs.historyLimit > 0) {
      const persisted = effectiveFilter() ? { ...m, text: censorText(m.text) } : m;
      void appendMessages(roomId, [{ ...persisted, roomId, seq: nextSeq(roomId) }]);
    }
  };

  const loadMore = async (): Promise<void> => {
    if (oldestShownSeq == null) {
      ui.chatMore.hidden = true;
      return;
    }
    const older = await loadBefore(roomId, oldestShownSeq, 50);
    if (!older.length) {
      ui.chatMore.hidden = true;
      toast('Sem mensagens mais antigas.');
      return;
    }
    const frag = document.createDocumentFragment();
    for (const m of older) {
      if (seenChat.has(m.id)) continue;
      seenChat.add(m.id);
      frag.append(buildMsg(m));
    }
    ui.chatMessages.prepend(frag);
    oldestShownSeq = older[0].seq;
    if (older.length < 50) ui.chatMore.hidden = true;
  };

  const initChat = async (): Promise<void> => {
    const recent = await loadRecent(roomId, 5);
    for (const m of recent) {
      seenChat.add(m.id);
      ui.chatMessages.append(buildMsg(m));
    }
    oldestShownSeq = recent.length ? recent[0].seq : null;
    if (oldestShownSeq != null) {
      const hasOlder = (await loadBefore(roomId, oldestShownSeq, 1)).length > 0;
      ui.chatMore.hidden = !hasOlder;
    } else {
      ui.chatMore.hidden = true;
    }
  };

  // ------------------------------------------------------------- mesh

  mesh = new Mesh(roomId, `p${Math.random().toString(36).slice(2, 10)}`, {
    name: prefs.name,
    emoji: prefs.emoji,
    color: prefs.color,
  }, {
    onRoster: (list) => {
      renderRoster(list);
      for (const m of list) {
        if (m.peerId !== mesh.peerId && !mediaWatchers.has(m.peerId)) {
          mediaWatchers.add(m.peerId);
          mesh.watchIncomingMedia(m.peerId);
        }
      }
      for (const k of watchedPeers()) {
        const m = list.find((x) => x.peerId === k);
        if (!m || !m.sharing) closeTile(k);
      }
      if (tiles.has('self') && !transmitting) removeTileEl('self');
    },
    onChat,
    onTxRequest: (peerId) => {
      const pol = roomPolicy();
      // "Criador aprova": só o criador avalia. "Moderadores aprovam": criador e moderadores.
      const canApprove =
        pol === 'creator_approves'
          ? isCreator()
          : pol === 'moderators_approves'
            ? isCreator() || isModerator()
            : false;
      if (!canApprove) return;
      const m = members.find((x) => x.peerId === peerId);
      if (!m || m.peerId === mesh.peerId) return;
      pendingRequests.add(peerId);
      renderPendingPanel();
      setStatus(`${m.name} pediu para transmitir.`);
      renderRoster(members);
    },
    onTxApproved: () => {
      if (!awaitingApproval) return;
      resetAwaiting();
      void beginCapture();
    },
    onTxDenied: () => {
      if (!awaitingApproval) return;
      resetAwaiting();
      toast('Pedido de transmissão negado por um moderador.');
    },
    onTxCancelled: () => {
      if (awaitingApproval) resetAwaiting();
      if (transmitting) {
        void stopTx().then(() => toast('Sua transmissão foi encerrada por um moderador.'));
      }
    },
    onMessageDeleted: (messageId) => {
      removeChatMessage(messageId);
    },
    onRoomInfo: (info) => updateRoomName(info.name),
    onRemoteWatch: (peerId, started) => {
      watchers.set(peerId, started);
      const count = [...watchers.values()].filter(Boolean).length;
      setStatus(count > 0 ? `🙋 ${count} assistindo sua transmissão` : 'Transmitindo. Clique em você ou em outros para ver.');
    },
    onReceiveStream: (peerId, stream) => {
      suppressEnd.delete(peerId);
      const tile = tiles.get(peerId);
      if (!tile) return;
      tile.video.srcObject = stream;
      if (!tile.isSelf) applyVolume();
      void tile.video.play().catch(() => undefined);
    },
    onReceiveEnd: (peerId) => {
      if (suppressEnd.has(peerId)) return;
      removeTileEl(peerId);
    },
  });

  mesh.setCodecPref(prefs.codec);

  const mediaWatchers = new Set<string>();

  // ----------------------------------------------- moderação (aprovações)

  const pendingEl = (): HTMLElement | null => container.querySelector<HTMLElement>('#pending-panel');

  const renderPendingPanel = (): void => {
    const panel = pendingEl();
    if (!panel) return;
    for (const peerId of [...pendingRequests]) {
      if (!members.some((m) => m.peerId === peerId)) pendingRequests.delete(peerId);
    }
    panel.innerHTML = '';
    if (pendingRequests.size === 0) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    const title = document.createElement('div');
    title.className = 'pending-title';
    title.textContent = 'Aprovar transmissão';
    panel.append(title);
    for (const peerId of pendingRequests) {
      const m = members.find((x) => x.peerId === peerId);
      if (!m) continue;
      const row = document.createElement('div');
      row.className = 'pending-row';
      row.innerHTML = `<span class="rc-emoji">${escapeHtml(m.emoji)}</span><span class="rc-name">${escapeHtml(m.name)}</span>`;
      const ok = document.createElement('button');
      ok.className = 'seg-btn pending-ok';
      ok.title = 'Aprovar';
      ok.innerHTML = icon('approve', 14);
      ok.addEventListener('click', () => {
        mesh.approveTransmit(peerId);
        pendingRequests.delete(peerId);
        toast(`Transmissão de ${m.name} aprovada.`);
        renderPendingPanel();
        renderRoster(members);
      });
      const no = document.createElement('button');
      no.className = 'seg-btn pending-no';
      no.title = 'Negar';
      no.innerHTML = icon('deny', 14);
      no.addEventListener('click', () => {
        mesh.denyTransmit(peerId);
        pendingRequests.delete(peerId);
        toast(`Pedido de ${m.name} negado.`);
        renderPendingPanel();
        renderRoster(members);
      });
      row.append(ok, no);
      panel.append(row);
    }
  };

  // ----------------------------------------------------- configurações da sala

  const settingsBtn = container.querySelector<HTMLButtonElement>('#btn-room-settings');
  const settingsModal = container.querySelector<HTMLElement>('#room-settings-modal');
  const settingsClose = container.querySelector<HTMLElement>('#settings-close');

  const applySettingsToggle = (): void => {
    if (settingsBtn) settingsBtn.hidden = !isCreator();
  };

  const renderSettingsBody = (): void => {
    const body = container.querySelector<HTMLElement>('#settings-body');
    const meta = roomMeta;
    if (!body || !meta) return;
    const isOn = roomCensorship();

    body.innerHTML = `
      <label class="field-label" for="set-max">Limite de participantes</label>
      <select id="set-max"></select>
      <p id="set-max-warn" class="warn hidden">Limite menor que o número atual de participantes (${members.length}).</p>
      <div class="setting room-create-setting">
        <span class="setting-label">Filtro de linguagem na sala</span>
        <label class="switch" for="set-censor">
          <input type="checkbox" id="set-censor" ${isOn ? 'checked' : ''}>
          <span>Censurar ofensas e racismo para todos</span>
        </label>
        <p class="hint">Se ativado, vale para todos. Se desativado, vale apenas para quem tem o filtro no perfil.</p>
      </div>
      <div class="setting room-create-setting">
        <span class="setting-label">Quem pode iniciar transmissão</span>
        <div class="seg" id="set-policy-seg">
          <button data-pol="everyone" class="seg-btn">Todos</button>
          <button data-pol="creator_only" class="seg-btn">Só o criador</button>
          <button data-pol="creator_approves" class="seg-btn">Criador aprova</button>
          <button data-pol="moderators_approves" class="seg-btn">Moderadores aprovam</button>
        </div>
      </div>
      <div class="setting room-create-setting">
        <span class="setting-label">Delay de envio de mensagens (segundos)</span>
        <select id="set-chat-delay">
          <option value="1">1s</option>
          <option value="5">5s</option>
          <option value="10">10s</option>
          <option value="30">30s</option>
          <option value="60">60s</option>
          <option value="90">90s</option>
        </select>
        <p class="hint">Mínimo 1s para evitar sobrecarga P2P e spam.</p>
      </div>
      <div class="setting room-create-setting">
        <span class="setting-label">Moderadores</span>
        <div id="set-mods" class="mod-list"></div>
      </div>
      <p class="hint">Moderadores ajudam: aprovam transmissões quando o criador está ausente e podem encerrar transmissões.</p>
      <div class="setting room-create-setting">
        <span class="setting-label">Zona de perigo</span>
        <button id="set-delete-room" class="danger" type="button">Deletar sala permanentemente</button>
        <p class="hint">Remove a sala do banco de dados e desconecta todos os participantes.</p>
      </div>
    `;

    const maxSel = body.querySelector<HTMLSelectElement>('#set-max');
    if (maxSel) {
      for (let n = 2; n <= 10; n++) {
        const opt = document.createElement('option');
        opt.value = String(n);
        opt.textContent = `${n} ${n === 1 ? 'pessoa' : 'pessoas'}`;
        maxSel.append(opt);
      }
      maxSel.value = String(meta.maxUsers);
      const warn = body.querySelector('#set-max-warn');
      const syncWarn = (): void => {
        if (warn) warn.classList.toggle('hidden', Number(maxSel.value) >= members.length);
      };
      syncWarn();
      maxSel.addEventListener('change', () => {
        const v = Number(maxSel.value);
        if (v < members.length) {
          syncWarn();
          return;
        }
        syncWarn();
        void updateRoomMeta(roomId, { maxUsers: v }).catch(() => toast('Falha ao salvar o limite.'));
        toast(`Limite: ${v} participantes`);
      });
    }

    const censor = body.querySelector<HTMLInputElement>('#set-censor');
    censor?.addEventListener('change', () => {
      void updateRoomMeta(roomId, { censorship: censor.checked }).catch(() => toast('Falha ao salvar.'));
      toast(censor.checked ? 'Censura na sala ativada' : 'Censura na sala desativada');
    });

    const seg = body.querySelector<HTMLElement>('#set-policy-seg');
    if (seg) {
      const mark = (p: string): void => {
        seg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.getAttribute('data-pol') === p));
      };
      mark(meta.broadcastPolicy ?? 'everyone');
      seg.querySelectorAll('.seg-btn').forEach((b) => {
        b.addEventListener('click', () => {
          const p = (b.getAttribute('data-pol') as BroadcastPolicy) || 'everyone';
          void updateRoomMeta(roomId, { broadcastPolicy: p }).catch(() => toast('Falha ao salvar.'));
          mark(p);
          const labels: Record<string, string> = {
            everyone: 'Transmissão: todos podem',
            creator_only: 'Transmissão: só o criador',
            creator_approves: 'Transmissão: criador aprova',
            moderators_approves: 'Transmissão: moderadores aprovam',
          };
          toast(labels[p] || 'Transmissão: política atualizada');
        });
      });
    }

    const delaySel = body.querySelector<HTMLSelectElement>('#set-chat-delay');
    if (delaySel) {
      delaySel.value = String(meta.chatDelay ?? 10);
      delaySel.addEventListener('change', () => {
        const v = Number(delaySel.value);
        if (v < 1 || v > 90) return;
        void updateRoomMeta(roomId, { chatDelay: v }).catch(() => toast('Falha ao salvar.'));
        toast(`Delay de chat: ${v}s`);
      });
    }

    const mods = body.querySelector<HTMLElement>('#set-mods');
    if (mods) {
      const named = [...(meta.moderators ?? [])];
      const hostId = meta.hostId;
      const presentMembers = members.filter((m) => m.owner && m.owner !== hostId);

      // Membros presentes (exceto criador)
      presentMembers.forEach((m) => {
        const isMod = named.includes(m.owner as string);
        const row = document.createElement('div');
        row.className = 'pending-row';
        row.innerHTML = `<span class="rc-emoji">${escapeHtml(m.emoji)}</span><span class="rc-name">${escapeHtml(m.name)}</span>`;
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'seg-btn' + (isMod ? ' pending-ok' : '');
        toggle.textContent = isMod ? 'Remover' : 'Moderar';
        toggle.title = isMod ? `Remover ${m.name} dos moderadores` : `Tornar ${m.name} moderador`;
        toggle.addEventListener('click', () => {
          const next = isMod ? named.filter((u) => u !== m.owner) : [...new Set([...named, m.owner as string])];
          void updateRoomMeta(roomId, { moderators: next }).catch(() => toast('Falha ao salvar moderadores.'));
        });
        row.append(toggle);
        mods.append(row);
      });

      // Moderadores nomeados que não estão presentes (apenas remover)
      const absentMods = named.filter((uid) => !members.some((m) => m.owner === uid));
      absentMods.forEach((uid) => {
        const row = document.createElement('div');
        row.className = 'pending-row';
        row.innerHTML = `<span class="rc-emoji">❔</span><span class="rc-name">Membro ausente</span>`;
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'seg-btn pending-no';
        toggle.textContent = 'Remover';
        toggle.title = `Remover moderador ausente`;
        toggle.addEventListener('click', () => {
          const next = named.filter((u) => u !== uid);
          void updateRoomMeta(roomId, { moderators: next }).catch(() => toast('Falha ao salvar moderadores.'));
        });
        row.append(toggle);
        mods.append(row);
      });
    }

    const delBtn = body.querySelector<HTMLButtonElement>('#set-delete-room');
    delBtn?.addEventListener('click', () => {
      if (!window.confirm('Deletar esta sala permanentemente? Todos os participantes serão desconectados.')) return;
      delBtn.disabled = true;
      void deleteRoom(roomId)
        .then(() => {
          toast('Sala deletada.');
          location.hash = '#/user';
        })
        .catch(() => {
          delBtn.disabled = false;
          toast('Falha ao deletar a sala.');
        });
    });
  };

  settingsBtn?.addEventListener('click', () => {
    if (!settingsModal) return;
    renderSettingsBody();
    settingsModal.hidden = false;
  });
  settingsClose?.addEventListener('click', () => {
    if (settingsModal) settingsModal.hidden = true;
  });
  settingsModal?.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.hidden = true;
  });

  // ----------------------------------------------------------------- events

  const copyId = (): void => {
    const text = roomId.toUpperCase();
    void navigator.clipboard
      .writeText(text)
      .then(() => toast(`ID copiado: ${text}`))
      .catch(() => toast(`Copie: ${text}`));
  };

  ui.root.querySelector('#btn-copy-id')?.addEventListener('click', copyId);

  const fullscreenRoot = ui.root;
  const onFsChange = (): void => {
    const isFs = document.fullscreenElement === fullscreenRoot;
    fullscreenRoot.classList.toggle('fs', isFs);
    if (isFs) poke();
    else fullscreenRoot.classList.remove('ui-hidden');
  };
  const poke = (): void => {
    fullscreenRoot.classList.remove('ui-hidden');
    if (hideTimer != null) clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (document.fullscreenElement === fullscreenRoot) fullscreenRoot.classList.add('ui-hidden');
    }, 3000);
  };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('mousemove', poke);

  ui.root.querySelector('#btn-fs')?.addEventListener('click', () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void fullscreenRoot.requestFullscreen().catch(() => toast('Tela cheia não disponível.'));
    }
  });

  // ---- diagnóstico (easter egg do Konami)
  const dbgEl = $('dbg') as HTMLPreElement;
  const dbgBtn = ui.root.querySelector('#btn-dbg') as HTMLButtonElement;
  let dbgOn = false;
  let dbgTimer: number | null = null;
  const updateDbg = (): void => {
    if (!dbgOn || cleanupDone) return;
    const s = mesh.stats();
    const names =
      members
        .map((m) => (m.peerId === s.peerId ? `${m.emoji}${m.name} (eu)` : `${m.emoji}${m.name}${m.sharing ? ' 🔴' : ''}`))
        .join(', ') || '(nenhum)';
    const codecLabel = prefs.codec === 'h264' ? 'H.264 (hardware)' : 'VP8 (universal)';
    const lines = [
      `Hub: ${hubOnline ? 'online ✅' : 'offline ⛔'}`,
      `Versão: ${APP_VERSION}`,
      `Sala: ${roomId}   |   Seu peer: ${s.peerId}`,
      `Participantes no banco: ${s.members} → ${names}`,
      `Canais de dados abertos: ${s.links}/${s.linksTotal}`,
      `Telas abertas: ${tiles.size}/${MAX_TILES}   |  Assistindo você: ${s.watchedBy}`,
      `Codec (envio): ${codecLabel}`,
    ];
    for (const m of mesh.mediaDiagnostics()) {
      const arrow = m.role === 'in' ? '← você transmite para' : '→ você assiste';
      lines.push(`Mídia ${arrow} ${m.peer}: ${m.codecs} [${m.state}]`);
    }
    dbgEl.textContent = lines.join('\n');
  };
  dbgBtn.addEventListener('click', () => {
    dbgOn = !dbgOn;
    dbgEl.hidden = !dbgOn;
    if (dbgOn) {
      updateDbg();
      if (dbgTimer != null) clearInterval(dbgTimer);
      dbgTimer = window.setInterval(updateDbg, 800);
    } else if (dbgTimer != null) {
      clearInterval(dbgTimer);
      dbgTimer = null;
    }
  });

  const triggerEasterEgg = (): void => {
    // som
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        const ctx = new AC();
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((f, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.connect(g);
          g.connect(ctx.destination);
          o.type = 'triangle';
          o.frequency.value = f;
          const t = ctx.currentTime + i * 0.09;
          g.gain.setValueAtTime(0.001, t);
          g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
          o.start(t);
          o.stop(t + 0.4);
        });
      }
    } catch {
      /* áudio indisponível */
    }
    // shake
    ui.root.classList.add('shake');
    setTimeout(() => ui.root.classList.remove('shake'), 650);
    // partículas no botão
    const r = dbgBtn.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    for (let i = 0; i < 24; i++) {
      const p = document.createElement('span');
      p.className = 'conf-pt';
      const a = Math.random() * Math.PI * 2;
      const dist = 50 + Math.random() * 130;
      p.style.left = `${cx}px`;
      p.style.top = `${cy}px`;
      p.style.setProperty('--dx', `${Math.cos(a) * dist}px`);
      p.style.setProperty('--dy', `${Math.sin(a) * dist - Math.random() * 40}px`);
      p.style.background = Math.random() < 0.5 ? 'var(--a-2)' : '#ffffff';
      document.body.append(p);
      setTimeout(() => p.remove(), 1300);
    }
    // revela e abre o painel
    dbgBtn.hidden = false;
    if (!dbgOn) dbgBtn.click();
    toast('It is dangerous to go alone take this 🛠️');
  };

  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let konamiPos = 0;
  const konamiHandler = (e: KeyboardEvent): void => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === KONAMI[konamiPos]) {
      konamiPos += 1;
      if (konamiPos === KONAMI.length) {
        konamiPos = 0;
        triggerEasterEgg();
      }
    } else {
      konamiPos = key === KONAMI[0] ? 1 : 0;
    }
  };
  document.addEventListener('keydown', konamiHandler);

  ui.root.querySelector('#btn-leave')?.addEventListener('click', () => {
    void leave();
  });

  ui.root.querySelector('#btn-transmit')?.addEventListener('click', () => {
    if (transmitting) {
      void stopTx();
    } else {
      ui.txOptions.hidden = !ui.txOptions.hidden;
    }
  });

  ui.txStart.addEventListener('click', () => {
    void startTx();
  });

  ui.selfToggle.addEventListener('click', () => {
    if (ui.selfVideo.paused) {
      void ui.selfVideo.play().catch(() => undefined);
    } else {
      ui.selfVideo.pause();
    }
    syncSelfToggle();
  });
  ui.selfVideo.addEventListener('pause', syncSelfToggle);
  ui.selfVideo.addEventListener('play', syncSelfToggle);

  updateVolIcon();
  ui.btnVol.addEventListener('click', () => {
    masterMuted = !masterMuted;
    applyVolume();
  });
  ui.volRange.addEventListener('input', () => {
    masterVol = Number(ui.volRange.value) / 100;
    masterMuted = !(masterVol > 0);
    applyVolume();
  });

  ui.txRes.addEventListener('change', () => {
    const r = ui.txRes.value;
    patchPrefs({ resolution: r as UserPrefs['resolution'] });
    mesh.setResolution(r as UserPrefs['resolution']);
  });

  ui.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    // Delay exato configurado para a sala (padrão 10s, mínimo 1s).
    const delaySec = Math.min(90, Math.max(1, roomMeta?.chatDelay ?? 10));
    const delayMs = delaySec * 1000;
    const now = Date.now();
    const wait = delayMs - (now - lastChatAt);
    if (wait > 0) {
      toast(`Aguarde ${Math.ceil(wait / 1000)}s para enviar outra mensagem.`);
      armSendCooldown(wait);
      return;
    }
    let text = ui.chatInput.value.trim();
    if (!text) return;
    if (effectiveFilter()) text = censorText(text);
    if (!text.trim()) return;
    mesh.sendChat(text);
    lastChatAt = Date.now();
    armSendCooldown(delayMs);
    ui.chatInput.value = '';
    ui.chatInput.focus();
  });

  ui.chatMore.addEventListener('click', () => void loadMore());

  // ------------------------------------------------------------- join

  const leave = async (): Promise<void> => {
    if (cleanupDone) return;
    cleanupDone = true;
    if (dbgTimer != null) clearInterval(dbgTimer);
    clearSendCooldown();
    await stopTx();
    offMeta?.();
    offHub?.();
    await mesh.destroy();
    document.removeEventListener('fullscreenchange', onFsChange);
    document.removeEventListener('mousemove', poke);
    document.removeEventListener('keydown', konamiHandler);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    location.hash = '#/user';
  };

  const doJoin = async (): Promise<void> => {
    try {
      const myUid = await ensureAuthed();
      uid = myUid;
      mesh.setAuthorizedModerators([]);
      const meta = await withTimeout(readRoomMeta(roomId), 5000, null);
      if (!meta) {
        toast('Esta ID não pertence a uma sala existente.');
        location.hash = '#/user';
        return;
      }
      const room = normalizeRoomMeta(meta);
      if (room) {
        roomMeta = room;
        mesh.setRoomInfo(room.name, room.maxUsers);
        updateRoomName(room.name);
        mesh.setAuthorizedModerators(eligibleModerators(room));
        applyPolicyUi();
        applySettingsToggle();
        renderRoster(members);
      }

      const count = await withTimeout(countMembers(roomId), 4000, 0);
      if (meta && count >= meta.maxUsers) {
        toast(`Sala cheia (máximo ${meta.maxUsers}).`);
        location.hash = '#/user';
        return;
      }

      offMeta = watchRoomMeta(roomId, (m) => {
        const next = normalizeRoomMeta(m);
        if (!next) {
          // Sala deletada pelo criador enquanto estávamos nela.
          if (roomMeta) {
            roomMeta = null;
            toast('Esta sala foi deletada pelo criador.');
            location.hash = '#/user';
          }
          return;
        }
        roomMeta = next;
        updateRoomName(next.name);
        mesh.setAuthorizedModerators(eligibleModerators(next));
        applyPolicyUi();
        applySettingsToggle();
        renderRoster(members);
        if (settingsModal && !settingsModal.hidden) renderSettingsBody();
      });
      offHub = watchHubConnection((online) => {
        hubOnline = online;
        if (!online) {
          setStatus('⚠️ Hub offline — tentando reconectar…');
          toast('Conexão com o hub caiu.');
        } else {
          setStatus('Conectado ao hub. Clique em um participante para assistir ou transmita sua tela.');
        }
      });

      await mesh.join();
      await initChat();
      setStatus('Conectado. Clique em um participante para assistir ou transmita sua tela.');
      void ui.chatInput.focus();
    } catch (err) {
      console.error('[sala] falha ao entrar:', err);
      const msg =
        err instanceof Error && /auth/i.test(err.message)
          ? 'Autenticação anônima indisponível. Ative "Anônimo" em Authentication → Sign-in method e recarregue.'
          : 'Falha ao entrar na sala. Pressione F12 e veja o console.';
      toast(msg);
    }
  };

  void doJoin();

  return async () => {
    if (!cleanupDone) {
      cleanupDone = true;
      if (dbgTimer != null) clearInterval(dbgTimer);
      clearSendCooldown();
      await stopTx();
      offMeta?.();
      offHub?.();
      await mesh.destroy();
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('mousemove', poke);
      document.removeEventListener('keydown', konamiHandler);
    }
  };
}
