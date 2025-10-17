/* eslint-env browser */
/* global document, sessionStorage, getComputedStyle, AbortController, fetch, TextDecoder, navigator */
// Chat client for Psyber Nexus
// Streams SSE from /api/chat via Cloudflare Pages Function

const SYS_PROMPT = "You are the Psyber Nexus assistant. Concise, security-forward, transparent about limits. Emphasize psychology × cybersecurity, defensible methods, Zero Trust mindset, and ethical provenance. Default to brief answers; expand on request.";
const STORAGE_KEY = "psyber_chat_v1";
const MAX_SAVE = 10; // last 10 non-system messages

const $ = (sel, ctx = document) => ctx.querySelector(sel);

const els = {
  log: $("#chat-log"),
  form: $("#chat-form"),
  input: $("#chat-input"),
  send: $("#send-btn"),
  stop: $("#stop-btn"),
  alert: $("#chat-alert"),
  copyThread: $("#copy-thread"),
  shareThread: $("#share-thread"),
  // replaced legacy to-bottom with jump-latest button
};

let controller = null; // AbortController
let streaming = false;
let shouldStick = true; // whether we should keep view pinned to bottom during streaming

// Messages that go to the API
let messages = [{ role: "system", content: SYS_PROMPT }];

function loadSaved() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return [];
    const filtered = saved.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
    return filtered.slice(-MAX_SAVE);
  } catch {
    return [];
  }
}

function saveMessages() {
  const nonSystem = messages.slice(1); // drop system
  const trimmed = nonSystem.slice(-MAX_SAVE);
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed)); } catch (e) { void e }
}

function ts() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderItem(role, text, timeStr = ts()) {
  const li = document.createElement('li');
  li.className = `msg ${role}`;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${role === 'user' ? 'You' : 'Assistant'} · ${timeStr}`;
  const content = document.createElement('div');
  content.className = 'content';
  content.textContent = text;
  const actionsRow = document.createElement('div');
  actionsRow.className = 'msg-actions-row';
  actionsRow.setAttribute('role', 'group');
  actionsRow.setAttribute('aria-label', 'Message actions');
  actionsRow.innerHTML = `
    <button class="icon-btn copy-md" aria-label="Copy as Markdown" title="Copy as Markdown">
      <img class="icon-img" src="/assets/icons/copy.svg" alt="" loading="lazy" decoding="async">
    </button>
  `;
  li.appendChild(meta);
  li.appendChild(content);
  li.appendChild(actionsRow);
  els.log?.appendChild(li);
  if (shouldStick) li.scrollIntoView({ block: 'end' });
  return { li, contentEl: content };
}

function renderHistory(saved) {
  els.log.innerHTML = '';
  for (const m of saved) {
    if (m.role === 'assistant') {
      const { contentEl } = renderItem(m.role, '');
      const html = (typeof m.html === 'string' && m.html) ? m.html : renderMarkdownSafe(m.md || m.content || '');
      contentEl.innerHTML = html;
      mdProbe('restore');
    } else {
      renderItem(m.role, m.content);
    }
  }
}

function setUIBusy(busy) {
  streaming = busy;
  if (busy) {
    if (els.send && !els.send.dataset.label) els.send.dataset.label = els.send.textContent || 'Send';
    els.send?.classList.add('btn--spin');
    if (els.send) els.send.textContent = '';
    els.send?.setAttribute('disabled', '');
    els.stop?.removeAttribute('hidden');
  } else {
    if (els.send && els.send.dataset.label != null) els.send.textContent = els.send.dataset.label;
    els.send?.classList.remove('btn--spin');
    els.send?.removeAttribute('disabled');
    els.stop?.setAttribute('hidden', '');
  }
}

function growTextarea() {
  const t = els.input;
  if (!t) return;
  t.style.height = 'auto';
  const maxPx = parseFloat(getComputedStyle(t).lineHeight || '20') * 6; // visual cap ~6 rows
  t.style.height = Math.min(t.scrollHeight, maxPx) + 'px';
}

function attachChips() {
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const fill = chip.getAttribute('data-fill') || '';
    els.input.value = fill;
    growTextarea();
    els.input.focus();
  });
}

async function streamTo(el, onDone) {
  if (!el) return;
  controller = new AbortController();
  try {
    setUIBusy(true);
    els.alert.textContent = '';
    // initialize shouldStick from current scroll state of the log
    const logEl = document.getElementById('chat-log');
    if (logEl) shouldStick = isNearBottom(logEl);

    // mode selection for speed vs quality
    const modeSel = document.getElementById('mode-select');
    const fast = modeSel ? (modeSel.value === 'speed') : false;

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, ...(fast ? { fast: true } : {}) }),
      signal: controller.signal,
    });

    // surface actual model used
    try {
      const modelPill = document.getElementById('model-pill');
      const used = res?.headers?.get('x-psyber-model');
      if (modelPill && used) modelPill.textContent = used;
    } catch { /* noop */ }

    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;
    let assistantMd = '';
    let assistantPlain = '';

    while (!done) {
      const { value, done: d } = await reader.read();
      done = d;
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const evt = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 2);
          if (!evt) continue;
          const lines = evt.split('\n');
          const evLine = lines.find(l => l.startsWith('event:')) || '';
          const dataLine = lines.find(l => l.startsWith('data:')) || '';
          const payload = dataLine.replace(/^data:\s?/, '').trim();
          if (!payload) continue;
          if (payload === '[DONE]') { done = true; break; }
          try {
            const json = JSON.parse(payload);
            // Responses API event delta
            if (evLine.startsWith('event:')) {
              const name = evLine.slice(6).trim();
              if (name === 'response.output_text.delta') {
                const delta = typeof json?.delta === 'string' ? json.delta : (json?.delta?.text ?? '');
                if (delta) {
                  assistantMd += delta;
                  assistantPlain = stripMarkdown(assistantMd);
                  const html = renderMarkdownSafe(assistantMd);
                  el.innerHTML = html;
                  mdProbe('chunk');
                  if (shouldStick && logEl) scrollToBottom(logEl);
                }
              }
              continue;
            }
            // Chat Completions style
            const token = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.text ?? '';
            if (token) {
              assistantMd += token;
              assistantPlain = stripMarkdown(assistantMd);
              const html = renderMarkdownSafe(assistantMd);
              el.innerHTML = html;
              mdProbe('chunk');
              if (shouldStick && logEl) scrollToBottom(logEl);
            }
          } catch { /* noop */ }
        }
      }
    }

    onDone?.(assistantPlain, assistantMd);
  } catch (err) {
    if (controller?.signal?.aborted) {
      els.alert.textContent = 'Generation stopped.';
    } else {
      els.alert.textContent = 'Error occurred. Please try again.';
      const appended = (assistantMd || '') + ' (error)';
      el.innerHTML = renderMarkdownSafe(appended);
    }
  } finally {
    setUIBusy(false);
    controller = null;
  }
}

function onSubmit(e) {
  e.preventDefault();
  const text = (els.input.value || '').trim();
  if (!text) return;

  // push user message
  messages.push({ role: 'user', content: text });
  renderItem('user', text);

  // assistant placeholder
  const { contentEl } = renderItem('assistant', '');
  mdProbe('start');

  els.input.value = '';
  growTextarea();

  // stream and finalize
  shouldStick = true; // stick to bottom when sending a new message
  streamTo(contentEl, (finalPlain, finalMd) => {
    const finalText = finalPlain || contentEl.textContent || '';
    const finalHtml = renderMarkdownSafe(finalMd || contentEl.textContent || '');
    messages.push({ role: 'assistant', content: finalText, md: finalMd, html: finalHtml });
    saveMessages();
  });
}

function keyHandler(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!streaming) els.form?.requestSubmit();
  }
}

function stopStreaming() {
  if (controller) controller.abort();
}

// Markdown helpers
function msgToMarkdown(m){ return `**${m.role==='user'?'You':'Psyber Nexus'}:** ${m.md ?? m.content}`; }
function threadToMarkdown(list){ return list.filter(x=>x.role!=='system').map(msgToMarkdown).join('\n\n'); }

// Plain text helpers (for share)
function msgToPlain(m){ return `${m.role==='user'?'You':'Psyber Nexus'}: ${m.content}`; }
function threadToPlain(list){ return list.filter(x=>x.role!=='system').map(msgToPlain).join('\n\n'); }

// Markdown → Plain-text (safe). Remove tokens and HTML; keep readable text.
function stripMarkdown(md){
  if (!md) return '';
  let s = String(md);
  // code fences: drop backticks
  s = s.replace(/```[\s\S]*?```/g, m => m.replace(/```/g, ''));
  // inline code
  s = s.replace(/`([^`]+)`/g, '$1');
  // headings
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  // bold/italic
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1')
       .replace(/\*([^*]+)\*/g, '$1')
       .replace(/__([^_]+)__/g, '$1')
       .replace(/_([^_]+)_/g, '$1');
  // blockquote
  s = s.replace(/^\s{0,3}>\s?/gm, '');
  // lists
  s = s.replace(/^\s*[-*+]\s+/gm, '• ')
       .replace(/^\s*\d+\.\s+/gm, (m)=> m.replace(/\d+\.\s+/, (m.match(/\d+/)||['1'])[0] + '. '));
  // links/images
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1 ($2)')
       .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  // HTML tags
  s = s.replace(/<\/?[^>]+>/g, '');
  // escaped punctuation (unescape common markdown/HTML punctuation)
  s = s.replace(/\\(\]|\[|\(|\)|>|#|\+|\.|!|-|\*|_|`|~)/g, '$1');
  return s;
}

// Markdown → safe HTML using Marked + DOMPurify loaded from CDN
function renderMarkdownSafe(mdText){
  try{
    const src = String(mdText || '');
    const ok = !!globalThis.__md_ok__ || (globalThis.marked && globalThis.DOMPurify);
    const markedLib = globalThis.marked;
    const purifier = globalThis.DOMPurify;
    if (!ok || !purifier) return src;
    if (markedLib && typeof markedLib.setOptions === 'function') {
      try { markedLib.setOptions({ breaks: true, smartypants: true }); } catch { /* noop */ }
    }
    const dirty = (markedLib && typeof markedLib.parse === 'function') ? markedLib.parse(src) : src;
    return purifier.sanitize(dirty, { USE_PROFILES: { html: true } });
  }catch(e){
    try{ const purifier = globalThis.DOMPurify; return purifier ? purifier.sanitize(String(mdText ?? '')) : String(mdText ?? ''); }
    catch{ return String(mdText ?? ''); }
  }
}

function mdProbe(label){
  if (!globalThis.__md_probe__) { globalThis.__md_probe__ = true; console.info('[MD] Markdown pipeline active'); }
  if (label) console.debug('[MD]', label);
}

// Toast-like inline status
function toast(msg, timeout=1500){
  if (!els.alert) return;
  els.alert.textContent = msg;
  globalThis.setTimeout(() => { if (els.alert.textContent === msg) els.alert.textContent = ''; }, timeout);
}

// Clipboard helper with fallback
async function copyText(text){
  try{ await navigator.clipboard.writeText(text); toast('Copied'); }
  catch(e){
    try{ const t=globalThis.document.createElement('textarea'); t.value=text; globalThis.document.body.appendChild(t); t.select(); globalThis.document.execCommand('copy'); t.remove(); toast('Copied'); }
    catch(err){ void err; }
  }
}

// Web Share helper with fallback to copy
async function shareText(text){
  if (navigator.share){ try{ await navigator.share({ text, url: globalThis.location.href, title:'Psyber Nexus Chat' }); return; }catch(e){ void e; } }
  await copyText(text);
}

// --- Helpers for scroll management ---
const panelEl = document.getElementById('chat-panel');
const headerEl = document.getElementById('chat-header');
const railEl = document.getElementById('chat-rail');
const logEl = document.getElementById('chat-log');
const jumpBtn = document.getElementById('jump-latest');
const inputElDom = document.getElementById('chat-input');
const tipsToggle = document.getElementById('tips-toggle');
const tipsDrawer = document.getElementById('tips-drawer');
const tipsClose = document.getElementById('tips-close');

function isNearBottom(el, thresh = 48){
  return el.scrollHeight - el.scrollTop - el.clientHeight <= thresh;
}
function scrollToBottom(el){ el.scrollTop = el.scrollHeight; }

// Dynamic viewport height for iOS keyboard safety
(function initVisualViewport(){
  const vv = globalThis.visualViewport;
  function setVVH(){
    const h = vv ? Math.min(vv.height, globalThis.innerHeight) : globalThis.innerHeight;
    document.documentElement.style.setProperty('--vvh', `${h}px`);
  }
  setVVH();
  vv && vv.addEventListener('resize', setVVH);
  globalThis.addEventListener('orientationchange', setVVH);
})();

// Ensure header is placed immediately above rail, and avoid duplicates
(function fixHeader(){
  try{
    if (headerEl && panelEl && railEl && headerEl.nextElementSibling !== railEl) {
      panelEl.insertBefore(headerEl, railEl);
    }
    const headers = document.querySelectorAll('.chat-header');
    if (headers.length > 1){ headers.forEach((h,i)=>{ if(i>0) h.remove(); }); }
  }catch{ /* noop */ }
})();

// Tips drawer for mobile; toggle visibility based on viewport width
(function initTips(){
  if (!tipsToggle || !tipsDrawer) return;
  const body = tipsDrawer.querySelector('.tips-body');
  const source = document.getElementById('chat-help');
  if (source && body && !body.childElementCount) body.innerHTML = source.innerHTML;

  function open(){
    tipsDrawer.hidden = false;
    tipsToggle.setAttribute('aria-expanded','true');
    document.documentElement.style.overflow = 'hidden';
  }
  function close(){
    tipsDrawer.hidden = true;
    tipsToggle.setAttribute('aria-expanded','false');
    document.documentElement.style.overflow = '';
  }
  tipsToggle.addEventListener('click', open);
  tipsClose?.addEventListener('click', close);
  tipsDrawer.addEventListener('click', (e)=>{ if (!e.target.closest('.tips-sheet')) close(); });

  function updateToggle(){
    const isMobile = globalThis.innerWidth <= 1024;
    tipsToggle.hidden = !isMobile;
    if (!isMobile) close();
  }
  updateToggle();
  globalThis.addEventListener('resize', updateToggle, { passive: true });
})();

if (logEl){
  shouldStick = isNearBottom(logEl);
  if (jumpBtn) jumpBtn.hidden = shouldStick;
  logEl.addEventListener('scroll', () => {
    const near = isNearBottom(logEl);
    shouldStick = near;
    if (jumpBtn) jumpBtn.hidden = near;
  });
  jumpBtn?.addEventListener('click', () => {
    scrollToBottom(logEl);
    shouldStick = true;
    jumpBtn.hidden = true;
    // keep composer visible and focused
    inputElDom?.focus();
  });
}

// On input focus/click, ensure the composer remains visible above the keyboard
['focus','click'].forEach(evt => {
  inputElDom?.addEventListener(evt, () => {
    globalThis.setTimeout(() => { if (logEl) scrollToBottom(logEl); }, 60);
  });
});

// Fallback: if new nodes are added to the log, pin to bottom when shouldStick
(function observeNewNodes(){
  if (!logEl) return;
  const MO = globalThis.MutationObserver;
  if (!MO) return;
  const mo = new MO(() => { if (shouldStick) scrollToBottom(logEl); });
  mo.observe(logEl, { childList: true });
})();

function init() {
  const saved = loadSaved();
  messages = [{ role: 'system', content: SYS_PROMPT }, ...saved];
  renderHistory(saved);

  els.form?.addEventListener('submit', onSubmit);
  els.input?.addEventListener('input', growTextarea);
  els.input?.addEventListener('keydown', keyHandler);
  els.stop?.addEventListener('click', stopStreaming);

  attachChips();
  growTextarea();

  // Per-message delegated actions (copy only)
  els.log?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.copy-md');
    if (!btn) return;
    const li = e.target.closest('.msg');
    if (!li) return;
    const index = Array.prototype.indexOf.call(els.log.children, li);
    const list = messages.filter(m => m.role !== 'system');
    const role = li.classList.contains('user') ? 'user' : 'assistant';
    const text = li.querySelector('.content')?.textContent || '';
    const msg = list[index] || { role, content: text };
    await copyText(msgToMarkdown(msg));
  });

  // Thread actions
  els.copyThread?.addEventListener('click', async () => { await copyText(threadToMarkdown(messages)); });
  els.shareThread?.addEventListener('click', async () => { await shareText(threadToPlain(messages)); });
}

document.addEventListener('DOMContentLoaded', init);
