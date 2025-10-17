/* eslint-env browser */
/* global document, sessionStorage, getComputedStyle, AbortController, fetch, TextDecoder */
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
};

let controller = null; // AbortController
let streaming = false;

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
  li.appendChild(meta);
  li.appendChild(content);
  els.log?.appendChild(li);
  li.scrollIntoView({ block: 'end' });
  return { li, contentEl: content };
}

function renderHistory(saved) {
  els.log.innerHTML = '';
  for (const m of saved) renderItem(m.role, m.content);
}

function setUIBusy(busy) {
  streaming = busy;
  if (busy) {
    els.send?.setAttribute('disabled', '');
    els.stop?.removeAttribute('hidden');
  } else {
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

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;

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
          const line = evt.split('\n').find(l => l.startsWith('data:')) || '';
          const data = line.replace(/^data:\s?/, '').trim();
          if (!data) continue;
          if (data === '[DONE]') { done = true; break; }
          try {
            const json = JSON.parse(data);
            const token = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.text ?? '';
            if (token) el.textContent += token;
          } catch { /* noop */ }
        }
      }
    }

    onDone?.();
  } catch (err) {
    if (controller?.signal?.aborted) {
      els.alert.textContent = 'Generation stopped.';
    } else {
      els.alert.textContent = 'Error occurred. Please try again.';
      // append hint to assistant bubble
      el.textContent += ' (error)';
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

  els.input.value = '';
  growTextarea();

  // stream and finalize
  streamTo(contentEl, () => {
    const finalText = contentEl.textContent || '';
    messages.push({ role: 'assistant', content: finalText });
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
}

document.addEventListener('DOMContentLoaded', init);
