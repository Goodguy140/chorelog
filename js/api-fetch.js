const ENTRIES_CACHE_KEY = 'chorelog-offline-api-entries-v1';

function cacheEntriesSnapshot(data) {
  try {
    localStorage.setItem(ENTRIES_CACHE_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

function readEntriesSnapshot() {
  try {
    const raw = localStorage.getItem(ENTRIES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function isEntriesEndpoint(url) {
  const asString = typeof url === 'string' ? url : String(url || '');
  return asString.startsWith('/api/entries');
}

export async function apiFetch(url, opts = {}) {
  const { skipSessionRedirect, ...fetchOpts } = opts;
  let r;
  try {
    r = await fetch(url, { credentials: 'include', ...fetchOpts });
  } catch (err) {
    const method = String(fetchOpts.method || 'GET').toUpperCase();
    if (method === 'GET' && isEntriesEndpoint(url)) {
      const cached = readEntriesSnapshot();
      if (cached) {
        return new Response(JSON.stringify(cached), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Chorelog-Offlined': '1',
          },
        });
      }
    }
    throw err;
  }
  if (r.ok && String(fetchOpts.method || 'GET').toUpperCase() === 'GET' && isEntriesEndpoint(url)) {
    try {
      const clone = r.clone();
      const data = await clone.json();
      if (data && typeof data === 'object') cacheEntriesSnapshot(data);
    } catch {
      /* ignore */
    }
  }
  if (r.headers.get('X-Chorelog-Queued') === '1') {
    try {
      window.dispatchEvent(new CustomEvent('chorelog:offline-write-queued'));
    } catch {
      /* ignore */
    }
  }
  const shell = document.getElementById('appShell');
  if (
    !skipSessionRedirect &&
    r.status === 401 &&
    shell &&
    !shell.hidden
  ) {
    document.getElementById('loginScreen').hidden = false;
    shell.hidden = true;
  }
  return r;
}
