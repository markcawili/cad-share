// Small DOM helpers shared by both roles.
export const $ = (id) => document.getElementById(id);

export function setStatus(text, kind = 'muted') {
  const el = $('status');
  el.textContent = text;
  el.className = `chip ${kind}`;
}

export function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

export function showBanner(text) {
  const el = $('banner');
  el.textContent = text ?? '';
  el.classList.toggle('hidden', !text);
}

// Position the hand cursor (0..1 viewport coords) and its dwell progress (0..1).
export function showCursor(cursor, progress = 0) {
  const el = $('cursor');
  if (!cursor) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  el.style.left = `${cursor.x * 100}%`;
  el.style.top = `${cursor.y * 100}%`;
  el.style.setProperty('--p', progress);
}

export function button(label, onClick, cls = '') {
  const b = document.createElement('button');
  b.textContent = label;
  b.className = cls;
  b.addEventListener('click', onClick);
  return b;
}
