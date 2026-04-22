(function () {
  const tabs = document.querySelectorAll('.tab');
  const screens = document.querySelectorAll('.screen');
  const titleEl = document.getElementById('header-title');
  const chatActions = document.getElementById('chat-actions');
  const serversActions = document.getElementById('servers-actions');

  const titles = { chat: 'Chat', servers: 'Servers', settings: 'Settings' };

  function showTab(name) {
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    screens.forEach((s) => s.classList.toggle('active', s.dataset.screen === name));
    titleEl.textContent = titles[name];
    chatActions.hidden = name !== 'chat';
    serversActions.hidden = name !== 'servers';
  }

  tabs.forEach((t) => {
    t.addEventListener('click', () => showTab(t.dataset.tab));
  });

  // Theme
  const themeBtn = document.getElementById('theme-toggle');
  const root = document.documentElement;
  function applyTheme(dark) {
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    themeBtn.textContent = dark ? 'Light mode' : 'Dark mode';
    localStorage.setItem('demo-theme', dark ? 'dark' : 'light');
  }
  themeBtn.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') !== 'dark';
    applyTheme(next);
  });
  applyTheme(localStorage.getItem('demo-theme') === 'dark');

  // Chat demo
  const list = document.getElementById('chat-messages');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');

  function addBubble(role, text) {
    const hint = list.querySelector('.hint');
    if (hint) hint.remove();
    const div = document.createElement('div');
    div.className = `bubble ${role}`;
    div.innerHTML =
      `<div class="label">${role === 'user' ? 'You' : 'Assistant'}</div>` +
      `<div class="body"></div>`;
    div.querySelector('.body').textContent = text;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
  }

  function fakeReply(userText) {
    sendBtn.disabled = true;
    setTimeout(() => {
      addBubble(
        'assistant',
        `Demo only — no API call.\n\nYou said: “${userText.slice(0, 120)}${userText.length > 120 ? '…' : ''}”\n\nIn the real app this goes to OpenAI and optional MCP tools.`
      );
      sendBtn.disabled = false;
    }, 600);
  }

  function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addBubble('user', text);
    fakeReply(text);
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  function syncSend() {
    sendBtn.disabled = !input.value.trim();
  }
  input.addEventListener('input', syncSend);
  syncSend();

  // Conversations modal
  const modal = document.getElementById('modal');
  const openModal = document.getElementById('open-conv-modal');
  const closeModal = document.getElementById('close-modal');
  const newChatBtn = document.getElementById('new-chat');

  openModal.addEventListener('click', () => modal.classList.add('open'));
  closeModal.addEventListener('click', () => modal.classList.remove('open'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('open');
  });

  const convItems = document.querySelectorAll('.conv-item');
  convItems.forEach((el) => {
    el.addEventListener('click', () => {
      convItems.forEach((c) => c.classList.remove('active'));
      el.classList.add('active');
      modal.classList.remove('open');
    });
  });

  newChatBtn.addEventListener('click', () => {
    list.innerHTML =
      '<p class="hint">Message the assistant. Configure OpenAI in Settings; MCP tools use the starred server.</p>';
    modal.classList.remove('open');
  });

  // Servers: star toggle
  document.querySelectorAll('.star').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.star').forEach((s) => {
        s.classList.remove('active');
        s.textContent = '☆';
        s.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.textContent = '★';
      btn.setAttribute('aria-pressed', 'true');
    });
  });

  // Settings: model chips
  document.querySelectorAll('.model-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.model-chip').forEach((c) => c.classList.remove('selected'));
      chip.classList.add('selected');
    });
  });

  document.getElementById('test-notify').addEventListener('click', () => {
    alert('Demo: on device this schedules a local notification.');
  });
})();
