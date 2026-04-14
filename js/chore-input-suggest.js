import { app } from './state.js';
import { activeChorePresets } from './presets.js';
import { escapeAttr, escapeHtml } from './utils/html.js';

/**
 * Custom preset picker for #inChore (native <datalist> matches the whole value, so it is not used).
 * Filters by the segment after the last ';', or the full field when there is no ';'.
 */
export function initChoreInputSuggest() {
  const input = document.getElementById('inChore');
  const listEl = document.getElementById('choreSuggestList');
  if (!input || !listEl) return;

  let filtered = [];
  let activeIndex = -1;

  function segmentQuery(v) {
    const semi = v.lastIndexOf(';');
    if (semi === -1) return v.trimStart().toLowerCase();
    return v.slice(semi + 1).trimStart().toLowerCase();
  }

  function renderActive() {
    [...listEl.querySelectorAll('.chore-suggest-item')].forEach((el, i) => {
      el.classList.toggle('is-active', i === activeIndex);
      el.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
    });
    if (activeIndex >= 0) {
      input.setAttribute('aria-activedescendant', `chore-sug-${activeIndex}`);
      listEl.querySelector(`#chore-sug-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function hide() {
    listEl.hidden = true;
    listEl.innerHTML = '';
    filtered = [];
    activeIndex = -1;
    input.removeAttribute('aria-activedescendant');
    input.setAttribute('aria-expanded', 'false');
  }

  function showSuggestions() {
    const v = input.value;
    const query = segmentQuery(v);
    filtered = activeChorePresets().filter((p) => p.title.toLowerCase().startsWith(query));
    if (!filtered.length) {
      listEl.hidden = true;
      listEl.innerHTML = '';
      activeIndex = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      return;
    }
    activeIndex = -1;
    listEl.innerHTML = filtered
      .map(
        (p, i) =>
          `<li role="option" id="chore-sug-${i}" class="chore-suggest-item" data-title="${escapeAttr(p.title)}" aria-selected="false" style="border-left:3px solid ${escapeAttr(p.color)}">${escapeHtml(p.title)}</li>`,
      )
      .join('');
    listEl.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function applySelection(title) {
    const v = input.value;
    const semi = v.lastIndexOf(';');
    if (semi === -1) {
      input.value = title;
    } else {
      input.value = `${v.slice(0, semi + 1)} ${title}`;
    }
    hide();
    input.focus();
    const len = input.value.length;
    input.setSelectionRange(len, len);
  }

  input.addEventListener('input', () => {
    showSuggestions();
  });

  input.addEventListener('focus', () => {
    showSuggestions();
  });

  input.addEventListener('keydown', (e) => {
    if (listEl.hidden || !filtered.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, filtered.length - 1);
      renderActive();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, -1);
      renderActive();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const idx = activeIndex >= 0 ? activeIndex : 0;
      applySelection(filtered[idx].title);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hide();
    }
  });

  listEl.addEventListener('mousedown', (e) => {
    const li = e.target.closest('.chore-suggest-item[data-title]');
    if (!li) return;
    e.preventDefault();
    applySelection(li.getAttribute('data-title'));
  });

  document.addEventListener('click', (e) => {
    if (e.target === input || input.contains(e.target) || listEl.contains(e.target)) return;
    if (!listEl.hidden) hide();
  });
}
