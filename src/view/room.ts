import { firebaseReady } from '../lib/firebase';
import { isValidRoomId } from '../lib/config';
import { countMembers, readRoomMeta, watchHubConnection, watchRoomMeta } from '../lib/presence';
import { addRoom, getPrefs, getRoomHistory, patchPrefs } from '../lib/storage';
import { appendMessages, loadBefore, loadRecent, nextSeq } from '../lib/idb';
import { Mesh } from '../web/mesh';
import { startCapture, stopStream } from '../web/media';
import { escapeHtml, toast, withTimeout } from '../util/dom';
import type { ChatMessage, MemberInfo, UserPrefs } from '../types';

type WatchTarget = { kind: 'none' } | { kind: 'self' } | { kind: 'peer'; peerId: string };

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
  mainVideo: HTMLVideoElement;
  placeholder: HTMLElement;
  selfPreview: HTMLElement;
  selfVideo: HTMLVideoElement;
  selfToggle: HTMLButtonElement;
  txOptions: HTMLElement;
  txMic: HTMLInputElement;
  txPc: HTMLInputElement;
  txRes: HTMLSelectElement;
  txApply: HTMLButtonElement;
  txStart: HTMLButtonElement;
  volGroup: HTMLElement;
  btnVol: HTMLButtonElement;
  volRange: HTMLInputElement;
  status: HTMLElement;
}

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
  let capturedMic = false;
  let capturedPcAudio = false;
  let watching: WatchTarget = { kind: 'none' };
  const watchers = new Map<string, boolean>();
  let cleanupDone = false;

  const seenChat = new Set<string>();
  let oldestShownSeq: number | null = null;
  let hideTimer: number | null = null;
  let members: MemberInfo[] = [];
  let offMeta: (() => void) | null = null;
  let offHub: (() => void) | null = null;
  let hubOnline = true;

  // ------------------------------------------------------------------ layout

  container.innerHTML = `
    <div class="rr" id="room-root">
      <header class="rr-topbar">
        <div class="rr-row1">
          <span class="rr-title">
            <strong id="room-name">Sala</strong>
            <code id="room-id">${roomId.toUpperCase()}</code>
          </span>
          <span class="rr-actions">
            <button id="btn-copy-id" class="ghost" title="Copiar ID da sala">📋 Copiar ID</button>
            <button id="btn-fs" class="ghost" title="Tela cheia">⛶</button>
            <button id="btn-dbg" class="ghost" title="Diagnóstico">🛠</button>
            <button id="btn-leave" class="danger">Sair</button>
          </span>
        </div>
        <div class="rr-roster" id="roster"></div>
        <pre id="dbg" class="dbg" hidden></pre>
      </header>

      <div class="rr-body">
        <aside class="rr-chat" id="chat-panel" data-side="${prefs.chatSide}">
          <div id="self-preview" class="self-preview" hidden>
            <video id="self-video" muted playsinline></video>
            <span class="self-tag">Seu 📡</span>
            <button id="self-toggle" class="self-toggle" title="Ver/pausar sua prévia">⏸</button>
          </div>
          <div class="chat-title">Chat da sala</div>
          <div class="chat-messages" id="chat-messages"></div>
          <button id="chat-more" class="ghost chat-more" hidden>Ver mensagens mais antigas</button>
          <form id="chat-form" class="chat-form">
            <input id="chat-input" type="text" placeholder="Mensagem..." autocomplete="off" maxlength="1000" />
            <button type="submit" class="primary">➤</button>
          </form>
        </aside>

        <main class="rr-stage">
          <div class="stage-view" id="stage-view">
            <video id="main-video" autoplay playsinline hidden></video>
            <div class="stage-placeholder" id="stage-placeholder">
              <p>👀 Ninguém na tela ainda.</p>
              <p class="hint">Clique em um participante no topo para assistir.</p>
            </div>
          </div>
          <div class="stage-tools">
            <div class="tools">
              <button id="btn-transmit" class="primary">📡 Transmitir</button>
              <div id="tx-options" class="tx-options" hidden>
                <label class="tx-toggle"><input type="checkbox" id="tx-mic" ${prefs.mic ? 'checked' : ''}> 🎤 Microfone</label>
                <label class="tx-toggle"><input type="checkbox" id="tx-pc" ${prefs.pcAudio ? 'checked' : ''}> 🔊 Áudio do PC</label>
                <label class="tx-res">Resolução
                  <select id="tx-res">
                    <option value="1080p" ${prefs.resolution === '1080p' ? 'selected' : ''}>1080p</option>
                    <option value="720p" ${prefs.resolution === '720p' ? 'selected' : ''}>720p</option>
                    <option value="480p" ${prefs.resolution === '480p' ? 'selected' : ''}>480p</option>
                  </select>
                </label>
                <button id="tx-apply" class="ghost" title="Aplica microfone/áudio/resolução na transmissão atual">Aplicar</button>
                <button id="tx-start" class="primary">Iniciar transmissão</button>
              </div>
            </div>
            <span class="vol" id="vol-group">
              <button id="btn-vol" class="ghost vol-btn" title="Silenciar">🔊</button>
              <input id="vol-range" type="range" min="0" max="100" value="100" title="Volume" />
            </span>
            <span id="room-status" class="status"></span>
          </div>
        </main>
      </div>
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
    mainVideo: $('main-video') as HTMLVideoElement,
    placeholder: $('stage-placeholder'),
    selfPreview: $('self-preview'),
    selfVideo: $('self-video') as HTMLVideoElement,
    selfToggle: $('self-toggle') as HTMLButtonElement,
    txOptions: $('tx-options'),
    txMic: $('tx-mic') as HTMLInputElement,
    txPc: $('tx-pc') as HTMLInputElement,
    txRes: $('tx-res') as HTMLSelectElement,
    txApply: $('tx-apply') as HTMLButtonElement,
    txStart: $('tx-start') as HTMLButtonElement,
    volGroup: $('vol-group'),
    btnVol: $('btn-vol') as HTMLButtonElement,
    volRange: $('vol-range') as HTMLInputElement,
    status: $('room-status'),
  };

  // ------------------------------------------------------------ helpers de tela

  const setStatus = (text: string): void => {
    ui.status.textContent = text;
  };

  const showStage = (kind: 'none' | 'video'): void => {
    ui.placeholder.classList.toggle('hidden', kind === 'video');
    ui.mainVideo.hidden = kind !== 'video';
    if (kind === 'video') {
      void ui.mainVideo.play().catch(() => undefined);
    }
  };

  const updateRoomName = (name: string): void => {
    if (!name) return;
    ui.roomName.textContent = name;
    document.title = `${name} — Discórdia`;
    addRoom(name, roomId);
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
      chip.innerHTML = `<span class="rc-emoji">${m.emoji}</span><span class="rc-name">${escapeHtml(m.name)}</span>`;
      if (m.sharing) {
        const live = document.createElement('span');
        live.className = 'live-dot';
        live.title = 'Transmitindo agora';
        live.textContent = '🔴';
        chip.append(live);
      }
      const isWatching =
        watching.kind === 'peer' && watching.peerId === m.peerId;
      const isSelfView = watching.kind === 'self' && m.peerId === mesh.peerId;
      if (isWatching || isSelfView) chip.classList.add('active');
      chip.addEventListener('click', () => void onChipClick(m));
      ui.roster.append(chip);
    }
    if (list.length <= 1) {
      setStatus('Aguardando outros participantes…');
    }
  };

  const onChipClick = async (m: MemberInfo): Promise<void> => {
    if (m.peerId === mesh.peerId) {
      toggleSelfView();
      return;
    }
    if (!m.sharing) {
      setStatus(`${m.name} não está transmitindo agora.`);
      return;
    }
    if (watching.kind === 'peer' && watching.peerId === m.peerId) {
      stopWatching();
      setStatus('Transmissão encerrada.');
      renderRoster(members);
      return;
    }
    if (watching.kind === 'peer') mesh.unwatch(watching.peerId);
    if (watching.kind === 'self') clearMainVideo();
    const ok = await mesh.watch(m.peerId);
    if (ok) {
      watching = { kind: 'peer', peerId: m.peerId };
      setStatus(`Assistindo ${m.name}…`);
      renderRoster(members);
    } else {
      setStatus(`Não foi possível iniciar a transmissão de ${m.name}.`);
    }
  };

  const stopWatching = (): void => {
    if (watching.kind === 'peer') mesh.unwatch(watching.peerId);
    watching = { kind: 'none' };
    clearMainVideo();
  };

  const clearMainVideo = (): void => {
    ui.mainVideo.srcObject = null;
    showStage('none');
  };

  // --------------------------------------------------------- prévia própria

  const syncSelfToggle = (): void => {
    ui.selfToggle.textContent = ui.selfVideo.paused ? '▶' : '⏸';
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

  const toggleSelfView = (): void => {
    if (!localStream) {
      setStatus('Você ainda não está transmitindo.');
      return;
    }
    if (watching.kind === 'self') {
      watching = { kind: 'none' };
      clearMainVideo();
    } else {
      if (watching.kind === 'peer') mesh.unwatch(watching.peerId);
      watching = { kind: 'self' };
      ui.mainVideo.muted = true;
      ui.mainVideo.srcObject = localStream;
      showStage('video');
    }
    renderRoster(members);
  };

  // --------------------------------------------------------- transmissão

  const startTx = async (): Promise<void> => {
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
    capturedMic = capture.mic;
    capturedPcAudio = capture.pcAudio;
    ui.txStart.textContent = 'Parar transmissão';
    ui.selfPreview.hidden = false;
    ui.selfVideo.srcObject = localStream;
    playPreviewOnce();
    ui.selfPreview.classList.add('on');
    setStatus('Transmitindo. Clique em você ou em outros para ver.');
    renderRoster(members);
  };

  /** Reaplica microfone/áudio/resolução na transmissão atual. */
  const applyTx = async (): Promise<void> => {
    const next = {
      mic: ui.txMic.checked,
      pcAudio: ui.txPc.checked,
      resolution: ui.txRes.value as UserPrefs['resolution'],
    };
    patchPrefs(next);
    mesh.setResolution(next.resolution);

    if (!transmitting) {
      toast('Configurações salvas. Elas valem ao iniciar a transmissão.');
      return;
    }

    const captureChanged = next.mic !== capturedMic || next.pcAudio !== capturedPcAudio;
    try {
      if (captureChanged) {
        setStatus('Selecione a tela novamente para aplicar o áudio…');
        const fresh = await startCapture({ ...next });
        const old = localStream;
        localStream = fresh;
        mesh.setLocalStream(fresh);
        if (old) stopStream(old);
        capturedMic = next.mic;
        capturedPcAudio = next.pcAudio;
        ui.selfVideo.srcObject = fresh;
        playPreviewOnce();
        if (watching.kind === 'self') {
          ui.mainVideo.srcObject = fresh;
        }
      }
      mesh.closeIncoming();
      mesh.requestMediaRefresh();
      setStatus('Alterações aplicadas. Reconectando espectadores…');
    } catch {
      setStatus('Captura cancelada — nada foi alterado.');
    }
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
    capturedMic = false;
    capturedPcAudio = false;
    ui.selfPreview.hidden = true;
    ui.selfVideo.srcObject = null;
    ui.txStart.textContent = 'Iniciar transmissão';
    if (watching.kind === 'self') {
      watching = { kind: 'none' };
      clearMainVideo();
    }
    renderRoster(members);
  };

  // -------------------------------------------------------------- chat

  const buildMsg = (m: ChatMessage): HTMLElement => {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    const who = document.createElement('span');
    who.className = 'who';
    who.style.color = m.color;
    who.textContent = `${m.emoji} ${m.name}`;
    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = m.text;
    div.append(who, document.createTextNode(' : '), text);
    return div;
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
      void appendMessages(roomId, [{ ...m, roomId, seq: nextSeq(roomId) }]);
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
      const current = watching;
      if (current.kind === 'peer') {
        const target = list.find((m) => m.peerId === current.peerId);
        if (!target || !target.sharing) stopWatching();
      }
    },
    onChat,
    onRoomInfo: (info) => updateRoomName(info.name),
    onRemoteWatch: (peerId, started) => {
      watchers.set(peerId, started);
      const count = [...watchers.values()].filter(Boolean).length;
      setStatus(count > 0 ? `🙋 ${count} assistindo sua transmissão` : 'Transmitindo. Clique em você ou em outros para ver.');
    },
    onReceiveStream: (peerId, stream) => {
      if (watching.kind !== 'peer' || watching.peerId !== peerId) return;
      ui.mainVideo.muted = false;
      ui.mainVideo.srcObject = stream;
      showStage('video');
    },
    onReceiveEnd: (peerId) => {
      if (watching.kind === 'peer' && watching.peerId === peerId) {
        watching = { kind: 'none' };
        clearMainVideo();
        renderRoster(members);
      }
    },
  });

  const mediaWatchers = new Set<string>();

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

  // ---- diagnóstico
  const dbgEl = $('dbg') as HTMLPreElement;
  let dbgOn = false;
  let dbgTimer: number | null = null;
  const updateDbg = (): void => {
    if (!dbgOn || cleanupDone) return;
    const s = mesh.stats();
    const names =
      members
        .map((m) => (m.peerId === s.peerId ? `${m.emoji}${m.name} (eu)` : `${m.emoji}${m.name}${m.sharing ? ' 🔴' : ''}`))
        .join(', ') || '(nenhum)';
    dbgEl.textContent = [
      `Hub: ${hubOnline ? 'online ✅' : 'offline ⛔'}`,
      `Sala: ${roomId}   |   Seu peer: ${s.peerId}`,
      `Participantes no banco: ${s.members} → ${names}`,
      `Canais de dados abertos: ${s.links}/${s.linksTotal}`,
      `Assistindo: ${s.watching}   |   Assistindo você: ${s.watchedBy}`,
    ].join('\n');
  };
  ui.root.querySelector('#btn-dbg')?.addEventListener('click', () => {
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

  ui.root.querySelector('#btn-leave')?.addEventListener('click', () => {
    void leave();
  });

  ui.root.querySelector('#btn-transmit')?.addEventListener('click', () => {
    ui.txOptions.hidden = !ui.txOptions.hidden;
  });

  ui.txStart.addEventListener('click', () => {
    if (transmitting) void stopTx();
    else void startTx();
  });

  ui.txApply.addEventListener('click', () => void applyTx());

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

  const updateVolIcon = (): void => {
    ui.btnVol.textContent =
      ui.mainVideo.muted || ui.mainVideo.volume === 0 ? '🔇' : ui.mainVideo.volume < 0.5 ? '🔉' : '🔊';
  };
  ui.btnVol.addEventListener('click', () => {
    ui.mainVideo.muted = !ui.mainVideo.muted;
    updateVolIcon();
  });
  ui.volRange.addEventListener('input', () => {
    const v = Number(ui.volRange.value) / 100;
    ui.mainVideo.volume = v;
    ui.mainVideo.muted = !(v > 0);
    updateVolIcon();
  });

  ui.txRes.addEventListener('change', () => {
    const r = ui.txRes.value;
    patchPrefs({ resolution: r as UserPrefs['resolution'] });
    mesh.setResolution(r as UserPrefs['resolution']);
    if (transmitting) setStatus(`Resolução ${r}. Será aplicada ao reiniciar a transmissão.`);
  });

  ui.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = ui.chatInput.value.trim();
    if (!text) return;
    mesh.sendChat(text);
    ui.chatInput.value = '';
    ui.chatInput.focus();
  });

  ui.chatMore.addEventListener('click', () => void loadMore());

  // ------------------------------------------------------------- join

  const leave = async (): Promise<void> => {
    if (cleanupDone) return;
    cleanupDone = true;
    if (dbgTimer != null) clearInterval(dbgTimer);
    await stopTx();
    offMeta?.();
    offHub?.();
    await mesh.destroy();
    document.removeEventListener('fullscreenchange', onFsChange);
    document.removeEventListener('mousemove', poke);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    location.hash = '#/user';
  };

  const doJoin = async (): Promise<void> => {
    try {
      const hist = getRoomHistory(roomId);
      const meta = await withTimeout(readRoomMeta(roomId), 5000, null);
      if (meta) {
        mesh.setRoomInfo(meta.name, meta.maxUsers);
        updateRoomName(meta.name);
      } else if (hist) {
        mesh.setRoomInfo(hist.name, 10);
        updateRoomName(hist.name);
      }

      const count = await withTimeout(countMembers(roomId), 4000, 0);
      if (meta && count >= meta.maxUsers) {
        toast(`Sala cheia (máximo ${meta.maxUsers}).`);
        location.hash = '#/user';
        return;
      }

      offMeta = watchRoomMeta(roomId, (m) => {
        if (m) updateRoomName(m.name);
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
      toast('Falha ao entrar na sala. Pressione F12 e veja o console.');
    }
  };

  void doJoin();

  return async () => {
    if (!cleanupDone) {
      cleanupDone = true;
      if (dbgTimer != null) clearInterval(dbgTimer);
      await stopTx();
      offMeta?.();
      offHub?.();
      await mesh.destroy();
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('mousemove', poke);
    }
  };
}