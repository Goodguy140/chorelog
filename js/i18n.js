/**
 * Lightweight i18n: JSON locale bundles under /locales/{lang}.json (nested keys, flattened).
 * Missing keys in non-English locales fall back to English.
 */
const STORAGE_KEY = 'chorelog-locale';
export const SUPPORTED_LOCALES = ['en', 'de', 'es'];
const FALLBACK = 'en';

let flatEn = {};
let bundle = {};
let currentLocale = FALLBACK;

const listeners = new Set();

function flatten(obj, prefix = '') {
  const out = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, key));
    else out[key] = v;
  }
  return out;
}

export function getLocale() {
  return currentLocale;
}

/** BCP 47 tag for Date/toLocaleString. */
export function getLocaleBcp47() {
  if (currentLocale === 'de') return 'de-DE';
  if (currentLocale === 'es') return 'es-ES';
  return 'en-US';
}

export function t(key, vars = {}) {
  let s = bundle[key];
  if (typeof s !== 'string') s = flatEn[key];
  if (typeof s !== 'string') return key;
  return s.replace(/\{\{(\w+)\}\}/g, (_, name) => (vars[name] != null ? String(vars[name]) : ''));
}

function applyDom(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    const val = t(key);
    if (el.hasAttribute('data-i18n-html')) {
      el.innerHTML = val;
    } else {
      el.textContent = val;
    }
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.setAttribute('placeholder', t(key));
  });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria');
    if (key) el.setAttribute('aria-label', t(key));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.setAttribute('title', t(key));
  });
  root.querySelectorAll('option[data-i18n]').forEach((opt) => {
    const key = opt.getAttribute('data-i18n');
    if (key) opt.textContent = t(key);
  });
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc && metaDesc.hasAttribute('data-i18n')) {
    metaDesc.setAttribute('content', t(metaDesc.getAttribute('data-i18n')));
  }
}

function notify() {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch {
      /* ignore */
    }
  });
}

export function subscribeLocale(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function initI18n() {
  const rEn = await fetch(`/locales/${FALLBACK}.json`, { credentials: 'same-origin' });
  if (!rEn.ok) throw new Error('Missing locales/en.json');
  flatEn = flatten(await rEn.json());

  let lang = localStorage.getItem(STORAGE_KEY);
  if (!lang || !SUPPORTED_LOCALES.includes(lang)) {
    const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
    lang = SUPPORTED_LOCALES.includes(nav) ? nav : FALLBACK;
    localStorage.setItem(STORAGE_KEY, lang);
  }

  currentLocale = lang;
  if (lang === FALLBACK) {
    bundle = { ...flatEn };
  } else {
    const r = await fetch(`/locales/${lang}.json`, { credentials: 'same-origin' });
    if (r.ok) bundle = { ...flatEn, ...flatten(await r.json()) };
    else bundle = { ...flatEn };
  }

  document.documentElement.lang = lang === 'de' ? 'de' : lang === 'es' ? 'es' : 'en';
  applyDom(document);
  notify();
}

export async function setLocale(lang) {
  if (!SUPPORTED_LOCALES.includes(lang)) return;
  localStorage.setItem(STORAGE_KEY, lang);
  currentLocale = lang;
  if (lang === FALLBACK) {
    bundle = { ...flatEn };
  } else {
    const r = await fetch(`/locales/${lang}.json`, { credentials: 'same-origin' });
    if (r.ok) bundle = { ...flatEn, ...flatten(await r.json()) };
    else bundle = { ...flatEn };
  }
  document.documentElement.lang = lang === 'de' ? 'de' : lang === 'es' ? 'es' : 'en';
  applyDom(document);
  notify();
}

export function applyStaticDom() {
  applyDom(document);
}
