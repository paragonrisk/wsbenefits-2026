/**
 * WS Benefits Hub — Chat Widget
 * Drop-in embeddable chatbot for any benefits site.
 *
 * USAGE — add these two lines before </body> on any page:
 *
 *   <script>
 *     window.WSBenefitsChat = {
 *       botId:       'wineshipping',           // matches key in bot-configs.json
 *       botName:     'Benefits Assistant',      // display name in chat header
 *       brandColor:  '#1f4e79',                // your brand color
 *       apiEndpoint: 'https://YOUR-SITE.netlify.app/.netlify/functions/chat'
 *     };
 *   </script>
 *   <script src="https://YOUR-GITHUB-PAGES-URL/chat-widget.js"></script>
 */
(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────
  const cfg = window.WSBenefitsChat || {};
  const BOT_ID       = cfg.botId       || 'default';
  const BOT_NAME     = cfg.botName     || 'Benefits Assistant';
  const BRAND_COLOR  = cfg.brandColor  || '#1f4e79';
  const API_ENDPOINT = cfg.apiEndpoint || '';
  const DISCLAIMER   = cfg.disclaimer  ||
    'Please do not share personal health information, Social Security numbers, or other sensitive personal data in this chat.';

  if (!API_ENDPOINT) {
    console.warn('[WSBenefitsChat] apiEndpoint is not configured — chat widget disabled.');
    return;
  }

  // Derive a darker shade for hover states
  function darken(hex, pct) {
    const n = parseInt(hex.replace('#',''), 16);
    const r = Math.max(0, (n >> 16) - Math.round(2.55 * pct));
    const g = Math.max(0, ((n >> 8) & 0xff) - Math.round(2.55 * pct));
    const b = Math.max(0, (n & 0xff) - Math.round(2.55 * pct));
    return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
  }
  const BRAND_DARK = darken(BRAND_COLOR, 12);

  // ── State ─────────────────────────────────────────────────────────────────
  let isOpen     = false;
  let isLoading  = false;
  let sessionId  = null;
  let history    = [];   // [{role, content}]
  let lang       = (document.documentElement.lang || 'en').toLowerCase().startsWith('es') ? 'es' : 'en';

  const i18n = {
    en: {
      open:        'Ask about your benefits',
      title:       BOT_NAME,
      subtitle:    'Benefits Support',
      placeholder: 'Ask a question about your benefits…',
      send:        'Send',
      disclaimer:  DISCLAIMER,
      thinking:    'Thinking…',
      error:       'Sorry, something went wrong. Please try again.',
      escalated:   '📋 A member of our team will follow up with you directly.',
      switchLang:  'Español',
      close:       'Close chat',
      newChat:     'New conversation',
    },
    es: {
      open:        'Pregunte sobre sus beneficios',
      title:       BOT_NAME,
      subtitle:    'Soporte de Beneficios',
      placeholder: 'Haga una pregunta sobre sus beneficios…',
      send:        'Enviar',
      disclaimer:  DISCLAIMER,
      thinking:    'Pensando…',
      error:       'Lo sentimos, algo salió mal. Por favor intente de nuevo.',
      escalated:   '📋 Un miembro de nuestro equipo se comunicará con usted directamente.',
      switchLang:  'English',
      close:       'Cerrar chat',
      newChat:     'Nueva conversación',
    },
  };
  const t = () => i18n[lang] || i18n.en;

  // ── Styles ────────────────────────────────────────────────────────────────
  const css = `
    #wsbc-root * { box-sizing: border-box; margin: 0; padding: 0; }
    #wsbc-root { font-family: 'Inter', system-ui, -apple-system, sans-serif; }

    /* Floating button */
    #wsbc-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 9998;
      width: 60px; height: 60px; border-radius: 50%;
      background: ${BRAND_COLOR}; color: #fff;
      border: none; cursor: pointer;
      box-shadow: 0 4px 16px rgba(0,0,0,.22);
      display: flex; align-items: center; justify-content: center;
      transition: background .15s, transform .15s;
    }
    #wsbc-btn:hover { background: ${BRAND_DARK}; transform: scale(1.06); }
    #wsbc-btn svg { width: 26px; height: 26px; }
    #wsbc-btn .wsbc-badge {
      position: absolute; top: 2px; right: 2px;
      width: 14px; height: 14px; border-radius: 50%;
      background: #ef4444; border: 2px solid #fff;
      display: none;
    }
    #wsbc-btn.wsbc-has-badge .wsbc-badge { display: block; }

    /* Panel */
    #wsbc-panel {
      position: fixed; bottom: 96px; right: 24px; z-index: 9999;
      width: 380px; max-width: calc(100vw - 32px);
      height: 540px; max-height: calc(100vh - 120px);
      background: #fff; border-radius: 18px;
      box-shadow: 0 8px 40px rgba(0,0,0,.18);
      display: flex; flex-direction: column;
      overflow: hidden;
      transform: scale(.92) translateY(16px);
      opacity: 0; pointer-events: none;
      transition: transform .2s cubic-bezier(.34,1.3,.64,1), opacity .18s;
    }
    #wsbc-panel.wsbc-open {
      transform: scale(1) translateY(0);
      opacity: 1; pointer-events: all;
    }

    /* Header */
    #wsbc-header {
      background: ${BRAND_COLOR}; color: #fff;
      padding: 14px 16px;
      display: flex; align-items: center; gap: 10px;
      flex-shrink: 0;
    }
    #wsbc-avatar {
      width: 36px; height: 36px; border-radius: 50%;
      background: rgba(255,255,255,.25);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    #wsbc-avatar svg { width: 20px; height: 20px; }
    #wsbc-header-text { flex: 1; min-width: 0; }
    #wsbc-header-title { font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #wsbc-header-sub { font-size: 12px; opacity: .8; margin-top: 1px; }
    .wsbc-icon-btn {
      background: rgba(255,255,255,.15); border: none; cursor: pointer; color: #fff;
      width: 30px; height: 30px; border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      transition: background .12s; flex-shrink: 0;
    }
    .wsbc-icon-btn:hover { background: rgba(255,255,255,.28); }
    .wsbc-icon-btn svg { width: 16px; height: 16px; }

    /* Disclaimer bar */
    #wsbc-disclaimer {
      background: #fefce8; border-bottom: 1px solid #fde68a;
      padding: 8px 14px; font-size: 11.5px; color: #92400e;
      line-height: 1.4; flex-shrink: 0;
    }

    /* Messages */
    #wsbc-messages {
      flex: 1; overflow-y: auto; padding: 16px 14px;
      display: flex; flex-direction: column; gap: 12px;
      scroll-behavior: smooth;
    }
    #wsbc-messages::-webkit-scrollbar { width: 4px; }
    #wsbc-messages::-webkit-scrollbar-thumb { background: #e4e7ec; border-radius: 4px; }

    .wsbc-msg { display: flex; flex-direction: column; max-width: 88%; }
    .wsbc-msg.wsbc-user { align-self: flex-end; align-items: flex-end; }
    .wsbc-msg.wsbc-bot  { align-self: flex-start; align-items: flex-start; }

    .wsbc-bubble {
      padding: 10px 13px; border-radius: 14px;
      font-size: 13.5px; line-height: 1.55;
      white-space: pre-wrap; word-break: break-word;
    }
    .wsbc-user .wsbc-bubble {
      background: ${BRAND_COLOR}; color: #fff;
      border-bottom-right-radius: 4px;
    }
    .wsbc-bot .wsbc-bubble {
      background: #f3f4f6; color: #111827;
      border-bottom-left-radius: 4px;
    }
    .wsbc-bot .wsbc-bubble a { color: ${BRAND_COLOR}; }
    .wsbc-bot .wsbc-bubble strong { font-weight: 600; }

    .wsbc-escalated {
      background: #eff6ff; border: 1px solid #bfdbfe;
      border-radius: 10px; padding: 10px 13px;
      font-size: 12.5px; color: #1e40af; margin-top: 4px;
    }

    /* Typing indicator */
    #wsbc-typing {
      display: flex; align-items: center; gap: 4px;
      padding: 10px 14px; align-self: flex-start;
    }
    #wsbc-typing span {
      width: 7px; height: 7px; border-radius: 50%;
      background: #9ca3af; display: inline-block;
      animation: wsbc-bounce .9s infinite ease-in-out;
    }
    #wsbc-typing span:nth-child(2) { animation-delay: .15s; }
    #wsbc-typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes wsbc-bounce {
      0%,80%,100% { transform: scale(.7); opacity:.5; }
      40%         { transform: scale(1);  opacity:1; }
    }

    /* Input area */
    #wsbc-input-area {
      border-top: 1px solid #e5e7eb;
      padding: 12px 14px;
      display: flex; gap: 8px; align-items: flex-end;
      flex-shrink: 0;
    }
    #wsbc-input {
      flex: 1; border: 1px solid #d1d5db; border-radius: 12px;
      padding: 9px 12px; font: inherit; font-size: 13.5px;
      resize: none; line-height: 1.4; max-height: 100px;
      outline: none; color: #111827;
      transition: border-color .15s;
    }
    #wsbc-input:focus { border-color: ${BRAND_COLOR}; }
    #wsbc-input::placeholder { color: #9ca3af; }
    #wsbc-send {
      background: ${BRAND_COLOR}; color: #fff;
      border: none; cursor: pointer;
      width: 38px; height: 38px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: background .15s;
    }
    #wsbc-send:hover:not(:disabled) { background: ${BRAND_DARK}; }
    #wsbc-send:disabled { background: #d1d5db; cursor: not-allowed; }
    #wsbc-send svg { width: 18px; height: 18px; }

    /* Lang toggle in footer */
    #wsbc-lang-row {
      padding: 6px 14px 10px; display: flex; justify-content: flex-end;
      flex-shrink: 0;
    }
    #wsbc-lang-btn {
      background: none; border: 1px solid #e5e7eb;
      border-radius: 999px; padding: 4px 11px;
      font: inherit; font-size: 11.5px; font-weight: 600;
      color: #6b7280; cursor: pointer; transition: border-color .12s, color .12s;
    }
    #wsbc-lang-btn:hover { border-color: ${BRAND_COLOR}; color: ${BRAND_COLOR}; }

    @media (max-width: 440px) {
      #wsbc-panel { right: 8px; left: 8px; width: auto; bottom: 84px; }
      #wsbc-btn   { right: 16px; bottom: 16px; }
    }
  `;

  // ── SVG icons ─────────────────────────────────────────────────────────────
  const ICON_CHAT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  const ICON_RESET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>`;
  const ICON_SEND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  const ICON_PERSON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

  // ── DOM helpers ───────────────────────────────────────────────────────────
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const child of children.flat()) {
      if (child) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  // Simple markdown-ish renderer (bold, links, line breaks)
  function renderText(text) {
    return text
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/https?:\/\/\S+/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`)
      .replace(/\n/g,'<br>');
  }

  // ── Build UI ──────────────────────────────────────────────────────────────
  let styleEl, root, btn, panel, messagesEl, typingEl, inputEl, sendBtn, langBtn, disclaimerEl;

  function buildUI() {
    // Inject styles
    styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    // Root wrapper
    root = el('div', { id: 'wsbc-root' });

    // Floating button
    btn = el('button', {
      id: 'wsbc-btn',
      title: t().open,
      'aria-label': t().open,
      onclick: togglePanel,
      html: ICON_CHAT + '<span class="wsbc-badge"></span>',
    });

    // Panel
    panel = el('div', { id: 'wsbc-panel', role: 'dialog', 'aria-label': t().title });

    // Header
    const header = el('div', { id: 'wsbc-header' },
      el('div', { id: 'wsbc-avatar', html: ICON_PERSON }),
      el('div', { id: 'wsbc-header-text' },
        el('div', { id: 'wsbc-header-title' }, BOT_NAME),
        el('div', { id: 'wsbc-header-sub' }, t().subtitle),
      ),
      el('button', { class: 'wsbc-icon-btn', title: t().newChat, 'aria-label': t().newChat, onclick: resetChat, html: ICON_RESET }),
      el('button', { class: 'wsbc-icon-btn', title: t().close, 'aria-label': t().close, onclick: togglePanel, html: ICON_CLOSE }),
    );

    // Disclaimer
    disclaimerEl = el('div', { id: 'wsbc-disclaimer' }, DISCLAIMER);

    // Messages container
    messagesEl = el('div', { id: 'wsbc-messages', role: 'log', 'aria-live': 'polite' });

    // Typing indicator (hidden by default)
    typingEl = el('div', { id: 'wsbc-typing', style: 'display:none' },
      el('span'), el('span'), el('span'),
    );

    // Language row
    const langRow = el('div', { id: 'wsbc-lang-row' });
    langBtn = el('button', { id: 'wsbc-lang-btn', onclick: switchLang });
    langRow.appendChild(langBtn);

    // Input area
    const inputArea = el('div', { id: 'wsbc-input-area' });
    inputEl = el('textarea', {
      id: 'wsbc-input',
      rows: '1',
      placeholder: t().placeholder,
      'aria-label': t().placeholder,
      onkeydown: onKeyDown,
      oninput: autoResize,
    });
    sendBtn = el('button', { id: 'wsbc-send', onclick: sendMessage, 'aria-label': t().send, html: ICON_SEND });
    inputArea.append(inputEl, sendBtn);

    panel.append(header, disclaimerEl, messagesEl, typingEl, langRow, inputArea);
    root.append(btn, panel);
    document.body.appendChild(root);

    updateLangUI();
    addWelcomeMessage();
  }

  // ── Message rendering ─────────────────────────────────────────────────────
  function addMessage(role, text, extra = {}) {
    const msgEl = el('div', { class: `wsbc-msg wsbc-${role}` });
    const bubble = el('div', { class: 'wsbc-bubble', html: renderText(text) });
    msgEl.appendChild(bubble);

    if (extra.escalated) {
      msgEl.appendChild(el('div', { class: 'wsbc-escalated' }, t().escalated));
    }

    messagesEl.appendChild(msgEl);
    scrollToBottom();
    return msgEl;
  }

  function addWelcomeMessage() {
    const welcome = lang === 'es'
      ? `¡Hola! Soy el asistente de beneficios para ${BOT_NAME}. ¿En qué puedo ayudarle hoy?\n\n_Puede preguntarme sobre planes médicos, dentales, visión, FSA/HSA, seguro de vida, beneficios voluntarios y más._`
      : `Hi! I'm the benefits assistant for ${BOT_NAME}. How can I help you today?\n\n_You can ask me about medical plans, dental, vision, FSA/HSA, life insurance, voluntary benefits, and more._`;
    addMessage('bot', welcome);
  }

  function showTyping() {
    typingEl.style.display = 'flex';
    scrollToBottom();
  }

  function hideTyping() {
    typingEl.style.display = 'none';
  }

  function scrollToBottom() {
    setTimeout(() => { messagesEl.scrollTop = messagesEl.scrollHeight; }, 30);
  }

  // ── Chat logic ────────────────────────────────────────────────────────────
  async function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || isLoading) return;

    inputEl.value = '';
    autoResize();
    setLoading(true);

    addMessage('user', text);
    history.push({ role: 'user', content: text });

    showTyping();

    try {
      const res = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: history.slice(0, -1), // exclude the message we just added
          botId: BOT_ID,
          sessionId,
        }),
      });

      hideTyping();

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.sessionId) sessionId = data.sessionId;

      const responseText = data.response || t().error;
      addMessage('bot', responseText, { escalated: data.escalated });
      history.push({ role: 'assistant', content: responseText });

      if (data.escalated) {
        btn.classList.add('wsbc-has-badge');
      }

    } catch (err) {
      hideTyping();
      console.error('[WSBenefitsChat]', err);
      addMessage('bot', t().error);
    }

    setLoading(false);
  }

  function setLoading(state) {
    isLoading = state;
    sendBtn.disabled = state;
    inputEl.disabled = state;
  }

  function resetChat() {
    history = [];
    sessionId = null;
    messagesEl.innerHTML = '';
    btn.classList.remove('wsbc-has-badge');
    addWelcomeMessage();
    inputEl.focus();
  }

  // ── Panel toggle ──────────────────────────────────────────────────────────
  function togglePanel() {
    isOpen = !isOpen;
    panel.classList.toggle('wsbc-open', isOpen);
    btn.setAttribute('aria-expanded', String(isOpen));
    btn.innerHTML = (isOpen ? ICON_CLOSE : ICON_CHAT) + '<span class="wsbc-badge"></span>';
    if (isOpen) {
      if (btn.classList.contains('wsbc-has-badge')) btn.classList.remove('wsbc-has-badge');
      setTimeout(() => inputEl.focus(), 220);
      scrollToBottom();
    }
  }

  // ── Language ──────────────────────────────────────────────────────────────
  function switchLang() {
    lang = lang === 'en' ? 'es' : 'en';
    updateLangUI();
  }

  function updateLangUI() {
    if (langBtn) langBtn.textContent = t().switchLang;
    if (inputEl) inputEl.placeholder = t().placeholder;
    if (disclaimerEl) disclaimerEl.textContent = t().disclaimer;
  }

  // ── Input helpers ─────────────────────────────────────────────────────────
  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function autoResize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildUI);
  } else {
    buildUI();
  }

})();
