const $ = (sel, ctx = globalThis.document) => ctx.querySelector(sel);

const state = { aborter: null };

function setYear() {
  const y = $("#year");
  if (y) y.textContent = String(new Date().getFullYear());
}

function toast(msg, kind = "info", timeout = 4000) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.setAttribute("data-kind", kind);
  el.classList.add("show");
  globalThis.clearTimeout(el._t);
  el._t = globalThis.setTimeout(() => el.classList.remove("show"), timeout);
}

// (focus trapping helper removed; overlay menu does not require it)

function navSetup() {
  const root = globalThis.document.documentElement;
  const btn = globalThis.document.getElementById('nav-toggle');
  const overlay = globalThis.document.getElementById('nav-overlay');
  const panel = overlay?.querySelector('.nav-panel');
  const desktopNav = globalThis.document.getElementById('site-nav');
  if (!btn || !overlay || !panel || !desktopNav) return;

  function setOpen(open) {
    root.classList.toggle('nav-open', !!open);
    btn.setAttribute('aria-expanded', String(!!open));
    overlay.hidden = !open;
    root.style.overflow = open ? 'hidden' : '';
    if (open) { btn.focus(); }
  }

  btn.addEventListener('click', () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    setOpen(open);
  });

  // Close when clicking outside the panel or on any link inside overlay
  overlay.addEventListener('click', (e) => {
    const within = e.target.closest('.nav-panel');
    const link = e.target.closest('a');
    if (!within || link) setOpen(false);
  });

  // Close on Escape
  globalThis.document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
}

function setActiveNav() {
  const nav = globalThis.document.getElementById('site-nav');
  const overlay = globalThis.document.getElementById('nav-overlay');
  const panel = overlay?.querySelector('.nav-panel');
  if (!nav || !panel) return;
  const norm = (p) => (p || '/').replace(/\/+$/, '/');
  const here = norm(globalThis.location?.pathname || '/');
  const all = [...nav.querySelectorAll('a[href]'), ...panel.querySelectorAll('a[href]')];
  all.forEach((a) => {
    try {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:')) return;
      let ap = a.pathname || new globalThis.URL(href, globalThis.location.origin).pathname;
      ap = norm(ap);
      if (ap === here) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    } catch (_) { /* ignore */ }
  });
}

function scrollSetup() {
  const reduce = !!globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
  globalThis.document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = decodeURIComponent(a.getAttribute('href').slice(1));
    const target = globalThis.document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    if (!reduce) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else target.scrollIntoView();
  });
}

async function streamChat(text) {
  const output = $("#ai-output");
  const status = $("#ai-status");
  const send = $("#ai-send");
  const stop = $("#ai-stop");
  try {
    if (!output) return;
    output.textContent = "";
    status?.removeAttribute('hidden');
    send?.setAttribute('disabled', 'true');
    stop?.removeAttribute('disabled');

    state.aborter = new globalThis.AbortController();
    const res = await globalThis.fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: text }] }),
      signal: state.aborter.signal
    });

    if (!res.ok || !res.body) {
      throw new Error(`Request failed: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new globalThis.TextDecoder();
    let buffer = '';
    let done = false;

    while (!done) {
      const { value, done: doneChunk } = await reader.read();
      done = doneChunk;
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
            if (token) output.textContent += token;
          } catch (_) { /* ignore parse errors */ }
        }
      }
    }
  } catch (err) {
    toast(`Error: ${err.message || err}` , 'error');
  } finally {
    status?.setAttribute('hidden', '');
    send?.removeAttribute('disabled');
    stop?.setAttribute('disabled', '');
    state.aborter = null;
  }
}

function consoleSetup() {
  const form = $("#ai-form");
  const input = $("#ai-input");
  const stop = $("#ai-stop");
  if (!form || !input) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) { toast('Please enter a prompt', 'warn'); return; }
    streamChat(text);
  });
  stop?.addEventListener('click', () => {
    if (state.aborter) state.aborter.abort();
  });
}

function contactSetup() {
  const form = globalThis.document.getElementById('contact-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const fd = new globalThis.FormData(form);
      const res = await globalThis.fetch('/api/contact', { method: 'POST', body: fd });
      if (res.ok) {
        toast('Message sent. Thank you!');
        form.reset();
      } else {
        toast('Contact endpoint is not available yet.', 'warn');
      }
    } catch (err) {
      toast('Network error while sending message.', 'error');
    }
  });
}

function init() {
  setYear();
  navSetup();
  setActiveNav();
  scrollSetup();
  consoleSetup();
  contactSetup();
}

globalThis.document.addEventListener('DOMContentLoaded', init);
