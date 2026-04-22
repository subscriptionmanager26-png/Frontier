/**
 * Thread UI prototype — list + thread, flat messages, reply targets (text/card/table/image/video).
 */

const STORAGE_KEY = 'thread-demo-state-v4';

/** @typedef {'text'|'card'|'table'|'image'|'video'} ContentKind */

/**
 * @typedef {{
 *   id: string;
 *   role: 'user' | 'assistant';
 *   text: string;
 *   isReply?: boolean;
 *   replyToSnippet?: string;
 *   replyToKind?: ContentKind;
 *   replyToPartLabel?: string;
 *   replyTargets?: Array<{ kind: ContentKind; label: string }>;
 * }} DemoMessage
 */

/** @typedef {{ id: string; title: string; preview: string; updatedAt: string; messages: DemoMessage[] }} DemoThread */

/** @type {DemoThread[]} */
const SEED_THREADS = [
  {
    id: 'th-1',
    title: 'Market outlook',
    preview: 'What is your view on S&P for Q2?',
    updatedAt: 'Today · 2:30 PM',
    messages: [
      { id: 'm1', role: 'user', text: 'What is your view on S&P for Q2?' },
      {
        id: 'm2',
        role: 'assistant',
        text:
          'I can’t predict markets. Broadly, many analysts watch earnings, rates, and macro prints — you’ll want to verify any thesis with your own research.',
        replyTargets: [{ kind: 'text', label: 'Text' }],
      },
      {
        id: 'm3',
        role: 'user',
        text: 'Can you list three concrete risks to watch?',
        isReply: true,
        replyToKind: 'text',
        replyToSnippet: 'I can’t predict markets…',
      },
      {
        id: 'm4',
        role: 'assistant',
        text: '1) Rates / inflation surprises. 2) Credit stress in key sectors. 3) Geopolitical shocks affecting supply chains.',
        isReply: true,
        replyToKind: 'text',
        replyToSnippet: 'I can’t predict markets…',
        replyTargets: [{ kind: 'text', label: 'Text' }],
      },
      {
        id: 'm-rich',
        role: 'assistant',
        text: 'This message mixes several blocks. Long-press to reply to a specific part.',
        replyTargets: [
          { kind: 'text', label: 'Body text' },
          { kind: 'card', label: 'Q4 outlook card' },
          { kind: 'table', label: 'Risk matrix' },
          { kind: 'image', label: 'S&P chart' },
          { kind: 'video', label: 'Market walkthrough' },
        ],
      },
      {
        id: 'm-reply-img',
        role: 'user',
        text: 'Can you zoom to last week?',
        isReply: true,
        replyToKind: 'image',
        replyToPartLabel: 'S&P chart',
        replyToSnippet: '',
      },
      {
        id: 'm-reply-img-a',
        role: 'assistant',
        text: '(Demo) In the real app the chart viewer would zoom to last week here.',
        isReply: true,
        replyToKind: 'image',
        replyToPartLabel: 'S&P chart',
        replyToSnippet: '',
        replyTargets: [{ kind: 'text', label: 'Text' }],
      },
    ],
  },
  {
    id: 'th-2',
    title: 'Onboarding checklist',
    preview: 'Remind me what to enable in Settings.',
    updatedAt: 'Yesterday',
    messages: [
      { id: 'm5', role: 'user', text: 'Remind me what to enable in Settings for notifications.' },
      {
        id: 'm6',
        role: 'assistant',
        text: 'Enable notifications in Settings, grant OS permission, and confirm the Expo push token is present if you use remote tasks.',
        replyTargets: [{ kind: 'text', label: 'Text' }],
      },
      {
        id: 'm7',
        role: 'user',
        text: 'What about background fetch?',
        isReply: true,
        replyToKind: 'text',
        replyToSnippet: 'Enable notifications in Settings…',
      },
      {
        id: 'm8',
        role: 'assistant',
        text: 'Turn on background fetch only if you want periodic checks; iOS/Android throttle it (~15 min best-effort).',
        isReply: true,
        replyToKind: 'text',
        replyToSnippet: 'Enable notifications in Settings…',
        replyTargets: [{ kind: 'text', label: 'Text' }],
      },
    ],
  },
];

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.threads)) return parsed;
    }
  } catch (_) {}
  return { threads: JSON.parse(JSON.stringify(SEED_THREADS)) };
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) {}
}

let state = loadState();
let activeThreadId = null;

/** @type {{ messageId: string; kind: ContentKind; partLabel: string; snippet: string } | null} */
let replyDraft = null;

const el = {
  list: document.getElementById('view-list'),
  thread: document.getElementById('view-thread'),
  threadList: document.getElementById('thread-list'),
  messages: document.getElementById('messages'),
  threadTitle: document.getElementById('thread-title'),
  btnBack: document.getElementById('btn-back'),
  btnNew: document.getElementById('btn-new-thread'),
  composer: document.getElementById('composer-input'),
  btnSend: document.getElementById('btn-send'),
  replyContext: document.getElementById('reply-context'),
  replyContextInner: document.getElementById('reply-context-inner'),
  replyCancel: document.getElementById('reply-cancel'),
  theme: document.getElementById('theme-toggle'),
};

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function truncate(s, max) {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + '…';
}

/** Default: single text target for legacy / plain messages */
function getReplyTargets(m) {
  if (m.replyTargets && m.replyTargets.length) return m.replyTargets;
  return [{ kind: 'text', label: 'Text' }];
}

function kindLabel(kind) {
  const map = { text: 'Text', card: 'Card', table: 'Table', image: 'Image', video: 'Video' };
  return map[kind] || kind;
}

const REPLY_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>`;

function iconSvgForKind(kind) {
  switch (kind) {
    case 'image':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
    case 'video':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M17 10l6 2-6 2v-4z" fill="currentColor" stroke="none"/></svg>`;
    case 'card':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 4v16"/></svg>`;
    case 'table':
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M12 3v18"/></svg>`;
    case 'text':
    default:
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h14"/></svg>`;
  }
}

/** Lowercase noun for "attached …" (image, card, table, video, text). */
function kindWord(kind) {
  const map = { text: 'text', card: 'card', table: 'table', image: 'image', video: 'video' };
  return map[kind] || String(kind);
}

function shouldShowPartName(kind, partLabel) {
  const p = (partLabel || '').trim();
  if (!p) return false;
  if (p.toLowerCase() === kindLabel(kind).toLowerCase()) return false;
  return true;
}

/**
 * @param {ContentKind} kind
 * @param {string} partLabel
 * @param {string} snippet
 * @returns {HTMLElement}
 */
function buildReplyRow(kind, partLabel, snippet) {
  const row = document.createElement('div');
  row.className = 'msg-reply-line';

  const glyph = document.createElement('span');
  glyph.className = 'msg-reply-glyph';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.innerHTML = REPLY_ICON_SVG;
  row.appendChild(glyph);

  if (kind === 'text') {
    const preview = document.createElement('span');
    preview.className = 'msg-reply-text-preview';
    preview.textContent = truncate(snippet || '', 120);
    row.appendChild(preview);
    row.setAttribute('aria-label', `Reply to text: ${truncate(snippet || '', 80)}`);
  } else {
    const att = document.createElement('span');
    att.className = 'msg-reply-attached';
    att.textContent = `attached ${kindWord(kind)}`;
    row.appendChild(att);
    const typeIco = document.createElement('span');
    typeIco.className = 'msg-reply-type-icon';
    typeIco.innerHTML = iconSvgForKind(kind);
    typeIco.setAttribute('aria-hidden', 'true');
    row.appendChild(typeIco);
    if (shouldShowPartName(kind, partLabel)) {
      const name = document.createElement('span');
      name.className = 'msg-reply-part-name';
      name.textContent = partLabel;
      row.appendChild(name);
    }
    const nameBit = shouldShowPartName(kind, partLabel) ? ` ${partLabel.trim()}` : '';
    row.setAttribute('aria-label', `Reply to attached ${kindWord(kind)}${nameBit}`);
  }

  return row;
}

function buildReplyRowFromMessage(m) {
  const kind = m.replyToKind || 'text';
  return buildReplyRow(kind, m.replyToPartLabel || '', m.replyToSnippet || '');
}

function renderThreadList() {
  el.threadList.innerHTML = '';
  for (const t of state.threads) {
    const li = document.createElement('li');
    const last = t.messages[t.messages.length - 1];
    const preview = last ? last.text : t.preview;
    li.innerHTML = `
      <button type="button" class="thread-item" data-thread-id="${escapeHtml(t.id)}">
        <div class="thread-item-title">${escapeHtml(t.title)}</div>
        <div class="thread-item-preview">${escapeHtml(truncate(preview, 120))}</div>
        <div class="thread-item-meta">${escapeHtml(t.updatedAt)} · ${t.messages.length} messages</div>
      </button>
    `;
    el.threadList.appendChild(li);
  }
  el.threadList.querySelectorAll('.thread-item').forEach((btn) => {
    btn.addEventListener('click', () => openThread(btn.getAttribute('data-thread-id')));
  });
}

function messageById(thread, id) {
  return thread.messages.find((m) => m.id === id);
}

const LONG_PRESS_MS = 600;
const MOVE_THRESHOLD_PX = 14;

/** @type {ReturnType<typeof setTimeout> | null} */
let longPressTimer = null;
/** @type {HTMLElement | null} */
let messageMenuEl = null;

function closeMessageMenu() {
  if (messageMenuEl) {
    messageMenuEl.remove();
    messageMenuEl = null;
  }
}

/**
 * Sheet: per–content-type Reply actions, Copy, Cancel.
 * @param {DemoMessage} m
 */
function showMessageMenu(threadId, m) {
  closeMessageMenu();
  const targets = getReplyTargets(m);

  const backdrop = document.createElement('div');
  backdrop.className = 'msg-menu-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'Message options');

  const sheet = document.createElement('div');
  sheet.className = 'msg-menu-sheet';
  sheet.setAttribute('role', 'menu');

  const hint = document.createElement('p');
  hint.className = 'msg-menu-hint';
  hint.textContent = 'Choose what you’re replying to';
  sheet.appendChild(hint);

  for (const t of targets) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'msg-menu-reply';
    btn.setAttribute('role', 'menuitem');
    btn.textContent = `Reply to ${kindLabel(t.kind)} · ${t.label}`;
    btn.addEventListener('click', () => {
      closeMessageMenu();
      startReplyTo(threadId, m.id, t.kind, t.label, m.text);
    });
    sheet.appendChild(btn);
  }

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.setAttribute('role', 'menuitem');
  copyBtn.textContent = 'Copy message text';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(m.text);
    } catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = m.text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (_) {}
    }
    closeMessageMenu();
  });
  sheet.appendChild(copyBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'msg-menu-cancel';
  cancelBtn.setAttribute('role', 'menuitem');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', closeMessageMenu);
  sheet.appendChild(cancelBtn);

  backdrop.appendChild(sheet);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeMessageMenu();
  });
  document.body.appendChild(backdrop);
  messageMenuEl = backdrop;
}

/**
 * Pointer-based long press (works with touch + mouse) + movement threshold so scroll doesn’t always cancel.
 */
function bindMessageGestures(wrap, threadId, m) {
  let startX = 0;
  let startY = 0;
  let activePointer = null;

  const clearLongPress = () => {
    if (longPressTimer != null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    activePointer = null;
  };

  const onPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    startX = e.clientX;
    startY = e.clientY;
    activePointer = e.pointerId;
    clearLongPress();
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      if (typeof navigator.vibrate === 'function') navigator.vibrate(12);
      showMessageMenu(threadId, m);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e) => {
    if (longPressTimer == null) return;
    if (e.pointerId !== activePointer && activePointer != null) return;
    const dx = Math.abs(e.clientX - startX);
    const dy = Math.abs(e.clientY - startY);
    if (dx > MOVE_THRESHOLD_PX || dy > MOVE_THRESHOLD_PX) clearLongPress();
  };

  const onPointerEnd = () => {
    clearLongPress();
  };

  wrap.addEventListener('pointerdown', onPointerDown);
  wrap.addEventListener('pointermove', onPointerMove);
  wrap.addEventListener('pointerup', onPointerEnd);
  wrap.addEventListener('pointercancel', onPointerEnd);
  wrap.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') onPointerEnd();
  });

  wrap.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    clearLongPress();
    showMessageMenu(threadId, m);
  });
}

/**
 * Reply row above a bubble: reply icon + (text excerpt | "attached …" + type icon + optional part name).
 */
function renderReplyHeader(wrap, m) {
  const block = document.createElement('div');
  block.className = 'msg-reply-header';
  block.appendChild(buildReplyRowFromMessage(m));
  wrap.appendChild(block);
}

function renderMessages(thread) {
  el.messages.innerHTML = '';
  for (const m of thread.messages) {
    const wrap = document.createElement('div');
    wrap.className = `msg ${m.role}`;
    wrap.dataset.messageId = m.id;

    if (m.isReply) {
      renderReplyHeader(wrap, m);
    }

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = m.text;
    wrap.appendChild(bubble);

    bindMessageGestures(wrap, thread.id, m);

    el.messages.appendChild(wrap);
  }
  el.messages.scrollTop = el.messages.scrollHeight;
}

/**
 * @param {ContentKind} kind
 * @param {string} partLabel
 * @param {string} snippetSource
 */
function startReplyTo(threadId, messageId, kind, partLabel, snippetSource) {
  const thread = state.threads.find((t) => t.id === threadId);
  if (!thread) return;
  const m = messageById(thread, messageId);
  if (!m) return;
  activeThreadId = threadId;
  replyDraft = {
    messageId,
    kind,
    partLabel,
    snippet: truncate(snippetSource, 120),
  };
  el.replyContext.classList.remove('hidden');
  el.replyContextInner.innerHTML = '';
  el.replyContextInner.appendChild(buildReplyRow(kind, partLabel, truncate(snippetSource, 120)));
  el.composer.focus();
}

function clearReply() {
  replyDraft = null;
  el.replyContext.classList.add('hidden');
  el.replyContextInner.innerHTML = '';
}

function openThread(id) {
  const thread = state.threads.find((t) => t.id === id);
  if (!thread) return;
  closeMessageMenu();
  activeThreadId = id;
  clearReply();
  el.threadTitle.textContent = thread.title;
  renderMessages(thread);
  el.list.classList.add('hidden');
  el.thread.classList.remove('hidden');
}

function closeThread() {
  closeMessageMenu();
  activeThreadId = null;
  clearReply();
  el.thread.classList.add('hidden');
  el.list.classList.remove('hidden');
  renderThreadList();
}

function sendMessage() {
  const text = el.composer.value.trim();
  if (!text || !activeThreadId) return;
  const thread = state.threads.find((t) => t.id === activeThreadId);
  if (!thread) return;

  const id = 'm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  /** @type {DemoMessage} */
  const msg = {
    id,
    role: 'user',
    text,
  };

  if (replyDraft) {
    const parent = messageById(thread, replyDraft.messageId);
    if (parent) {
      msg.isReply = true;
      msg.replyToKind = replyDraft.kind;
      msg.replyToPartLabel = replyDraft.partLabel;
      msg.replyToSnippet = replyDraft.snippet;
    }
  }

  thread.messages.push(msg);
  thread.preview = text;
  thread.updatedAt = 'Just now';
  el.composer.value = '';
  clearReply();
  saveState(state);
  renderMessages(thread);

  setTimeout(() => {
    const t2 = state.threads.find((t) => t.id === activeThreadId);
    if (!t2) return;
    /** @type {DemoMessage} */
    const assistantMsg = {
      id: 'm-' + Date.now() + '-a',
      role: 'assistant',
      text: '(Demo) Got it. In the real app this would call your agent.',
      replyTargets: [{ kind: 'text', label: 'Text' }],
    };
    if (msg.isReply) {
      assistantMsg.isReply = true;
      assistantMsg.replyToKind = msg.replyToKind;
      assistantMsg.replyToPartLabel = msg.replyToPartLabel;
      assistantMsg.replyToSnippet = msg.replyToSnippet;
    }
    t2.messages.push(assistantMsg);
    t2.updatedAt = 'Just now';
    saveState(state);
    if (activeThreadId === t2.id) renderMessages(t2);
  }, 400);
}

function newThread() {
  const id = 'th-' + Date.now();
  const title = 'New thread';
  state.threads.unshift({
    id,
    title,
    preview: 'Start the conversation…',
    updatedAt: 'Just now',
    messages: [],
  });
  saveState(state);
  renderThreadList();
  openThread(id);
}

function initTheme() {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  el.theme.textContent = dark ? 'Light' : 'Dark';
}

el.theme.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  el.theme.textContent = next === 'dark' ? 'Light' : 'Dark';
});

el.btnBack.addEventListener('click', closeThread);
el.btnNew.addEventListener('click', newThread);
el.btnSend.addEventListener('click', sendMessage);
el.replyCancel.addEventListener('click', clearReply);
el.composer.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMessageMenu();
});

initTheme();
renderThreadList();
