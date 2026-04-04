const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'chores.json');

const DEFAULT_PEOPLE = ['Dylan', 'Rachel', 'Vic', 'Christian'];

/** Same shape as the original HTML SEED: one row per log line, chores can contain `;` */
const RAW_SEED = [
  { d: '2026-03-03', c: 'Dishes; Wiped Table; Cleaned Fridge', p: 'Vic' },
  { d: '2026-03-03', c: 'Wiped common surfaces', p: 'Dylan' },
  { d: '2026-03-05', c: 'Dishes', p: 'Dylan' },
  { d: '2026-03-05', c: 'Dishes', p: 'Vic' },
  { d: '2026-03-06', c: 'Garbage out', p: 'Vic' },
  { d: '2026-03-06', c: 'Dishes', p: 'Dylan' },
  { d: '2026-03-08', c: 'Dishwasher, Cleaned bathroom', p: 'Rachel' },
  { d: '2026-03-09', c: 'Cleaned bathtub/grout', p: 'Rachel' },
  { d: '2026-03-09', c: 'Swept upstairs, stairs, hallway, kitchen; Tidied sussy room', p: 'Christian' },
  { d: '2026-03-10', c: 'Dishes', p: 'Dylan' },
  { d: '2026-03-11', c: 'Dishes', p: 'Dylan' },
  { d: '2026-03-13', c: 'Dishes; Wiped counter, shelf, stove and table; Swept kitchen twice', p: 'Dylan' },
  { d: '2026-03-14', c: 'Dishwasher', p: 'Rachel' },
  { d: '2026-03-14', c: 'Dishes + put away', p: 'Vic' },
  { d: '2026-03-15', c: 'Dishes', p: 'Dylan' },
  { d: '2026-03-17', c: 'Many dishes', p: 'Vic' },
  { d: '2026-03-19', c: 'Dishes; Swept hallways, kitchen & stairs; Changed cans & garbage', p: 'Dylan' },
  { d: '2026-03-19', c: 'Change Cardboard', p: 'Christian' },
  { d: '2026-03-20', c: 'Dishes + put away', p: 'Dylan' },
  { d: '2026-03-21', c: 'Swept stairs, hallway, back porch and kitchen; Dishwasher', p: 'Rachel' },
  { d: '2026-03-23', c: 'Shoveled Front & Back', p: 'Rachel' },
  { d: '2026-03-23', c: 'Dishes; Put away dishes x2', p: 'Dylan' },
  { d: '2026-03-27', c: 'Dishes', p: 'Dylan' },
  { d: '2026-03-27', c: 'Mail to Fred', p: 'Vic' },
  { d: '2026-03-29', c: 'Bathroom clean; Dishwasher', p: 'Rachel' },
  { d: '2026-02-01', c: 'Mopped floor, Dishes', p: 'Dylan' },
  { d: '2026-02-02', c: 'Dishes and Dishwasher in/out', p: 'Dylan' },
  { d: '2026-02-02', c: 'Clean Bathroom and Dishwasher', p: 'Rachel' },
  { d: '2026-02-02', c: 'Dishes', p: 'Vic' },
  { d: '2026-02-03', c: 'Dishes', p: 'Christian' },
  { d: '2026-02-04', c: 'Dishes', p: 'Vic' },
  { d: '2026-02-04', c: 'Dishes', p: 'Dylan' },
  { d: '2026-02-04', c: 'Swept Kitchen & Hallway', p: 'Christian' },
  { d: '2026-02-05', c: 'Dishes', p: 'Vic' },
  { d: '2026-02-05', c: 'Garbage out', p: 'Christian' },
  { d: '2026-02-06', c: 'Dishes', p: 'Dylan' },
  { d: '2026-02-07', c: 'Swept backdoor porch', p: 'Rachel' },
  { d: '2026-02-08', c: 'Swept upstairs, stairs, hallway, and Kitchen', p: 'Dylan' },
  { d: '2026-02-08', c: 'Wiped table, Took garbage down & Dishes', p: 'Dylan' },
  { d: '2026-02-09', c: 'Dishes & Dishwasher', p: 'Dylan' },
  { d: '2026-02-10', c: 'Dishes & Dishwasher away', p: 'Vic' },
  { d: '2026-02-11', c: 'Swept Upstairs, Hallway and Kitchen; Dishes; Dishwasher; Stove Deep-cleaned', p: 'Dylan' },
  { d: '2026-02-11', c: 'Swept Back Porch & Kitchen', p: 'Rachel' },
  { d: '2026-02-12', c: 'Shoveled to Clear a Path, Salted', p: 'Christian' },
  { d: '2026-02-12', c: 'Dishes', p: 'Vic' },
  { d: '2026-02-15', c: 'Swept Upstairs, Stairs, Hallway and Kitchen; Lysoled floor; Dishwasher', p: 'Christian' },
  { d: '2026-02-15', c: 'Dishes and Trash to Basement', p: 'Dylan' },
  { d: '2026-02-16', c: 'Put away Dishes and did Dishes', p: 'Christian' },
  { d: '2026-02-17', c: 'Wiped common surfaces', p: 'Dylan' },
  { d: '2026-02-17', c: 'Swept and Mopped Entry Way; Dishes', p: 'Vic' },
  { d: '2026-02-17', c: 'Bathroom', p: 'Rachel' },
  { d: '2026-02-18', c: 'Dishes', p: 'Dylan' },
  { d: '2026-02-18', c: 'Dishwasher', p: 'Rachel' },
  { d: '2026-02-18', c: 'Dishes', p: 'Christian' },
  { d: '2026-02-19', c: 'Dishes, Wiped down table, stove; Changed bathroom trash; Swept', p: 'Dylan' },
  { d: '2026-02-19', c: 'Garbage out', p: 'Christian' },
  { d: '2026-02-21', c: 'Swept stairs, hallway, living room and back porch', p: 'Rachel' },
  { d: '2026-02-21', c: 'Wiped Under recyclables bag; Dishes', p: 'Vic' },
  { d: '2026-02-22', c: 'Dishes', p: 'Dylan' },
  { d: '2026-02-23', c: 'Dishes away', p: 'Dylan' },
  { d: '2026-02-23', c: 'Dishes', p: 'Christian' },
  { d: '2026-02-24', c: 'Dishes', p: 'Dylan' },
  { d: '2026-02-24', c: 'Shoveled Front and back steps; Dishwasher and put away dishes', p: 'Rachel' },
  { d: '2026-02-27', c: 'Dishes', p: 'Christian' },
  { d: '2026-02-27', c: 'Garbage down + bag replaced', p: 'Vic' },
  { d: '2026-02-28', c: 'Changed bathroom trash; Swept house; Mopped hallways; Dishes; Cleaned table', p: 'Dylan' },
];

function expandRaw(raw) {
  const out = [];
  raw.forEach((e) => {
    e.c.split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((task) => {
        out.push({ d: e.d, c: task, p: e.p });
      });
  });
  return out;
}

function newId() {
  return crypto.randomUUID();
}

/** Calendar YYYY-MM-DD in the Node process timezone (not UTC). */
function localCalendarDateISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Validates YYYY-MM-DD; rejects invalid calendar dates. */
function parseCalendarDateParam(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return s;
}

function normalizePeople(arr) {
  if (!Array.isArray(arr)) return [...DEFAULT_PEOPLE];
  const seen = new Set();
  const out = [];
  for (const p of arr) {
    const s = String(p).trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out.length ? out : [...DEFAULT_PEOPLE];
}

function normalizeScheduledChores(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const row of arr) {
    if (!row || typeof row.title !== 'string') continue;
    const title = row.title.trim();
    if (!title) continue;
    let intervalDays = Number(row.intervalDays);
    if (!Number.isFinite(intervalDays) || intervalDays < 1) intervalDays = 7;
    if (intervalDays > 3650) intervalDays = 3650;
    const id = typeof row.id === 'string' && row.id ? row.id : newId();
    let createdAtRaw = typeof row.createdAt === 'string' ? row.createdAt.slice(0, 10) : localCalendarDateISO();
    let createdAt = parseCalendarDateParam(createdAtRaw) ?? localCalendarDateISO();
    let lastCompletedAt = row.lastCompletedAt;
    if (lastCompletedAt != null && typeof lastCompletedAt === 'string') lastCompletedAt = lastCompletedAt.slice(0, 10);
    else lastCompletedAt = null;
    out.push({ id, title, intervalDays, createdAt, lastCompletedAt });
  }
  return out;
}

function normalizeStore(raw) {
  const entries = Array.isArray(raw.entries) ? raw.entries : [];
  const people = normalizePeople(raw.people);
  const scheduledChores = normalizeScheduledChores(raw.scheduledChores);
  return { entries, people, scheduledChores };
}

async function readStore() {
  try {
    const buf = await fs.promises.readFile(DATA_FILE, 'utf8');
    const data = JSON.parse(buf);
    return normalizeStore(data);
  } catch (err) {
    if (err.code === 'ENOENT') return { entries: [], people: [...DEFAULT_PEOPLE], scheduledChores: [] };
    throw err;
  }
}

async function writeStore(data) {
  const normalized = normalizeStore(data);
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(normalized, null, 2), 'utf8');
  await fs.promises.rename(tmp, DATA_FILE);
}

async function ensureSeed() {
  const store = await readStore();
  if (store.entries.length > 0) return;
  const expanded = expandRaw(RAW_SEED);
  store.entries = expanded.map((e) => ({ id: newId(), d: e.d, c: e.c, p: e.p }));
  if (!store.people || store.people.length === 0) store.people = [...DEFAULT_PEOPLE];
  await writeStore(store);
}

const app = express();
app.use(express.json({ limit: '5mb' }));

const AUTH_COOKIE = 'chorelog_auth';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function getSessionSecret() {
  return process.env.CHORELOG_SECRET || 'chorelog-dev-secret-change-me';
}

function parseCookieHeader(cookieHeader, name) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k !== name) continue;
    return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function createAuthToken() {
  const payload = { v: 1, exp: Date.now() + COOKIE_MAX_AGE_MS };
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyAuthCookie(cookieHeader) {
  const token = parseCookieHeader(cookieHeader, AUTH_COOKIE);
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', getSessionSecret()).update(data).digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
  return payload;
}

function requireApiAuth(req, res, next) {
  if (!req.path.startsWith('/api')) return next();
  if (req.method === 'GET' && req.path === '/api/auth') return next();
  if (req.method === 'POST' && req.path === '/api/login') return next();
  if (req.method === 'POST' && req.path === '/api/logout') return next();
  if (!verifyAuthCookie(req.headers.cookie)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.use(requireApiAuth);

app.get('/api/auth', (req, res) => {
  if (!verifyAuthCookie(req.headers.cookie)) {
    return res.status(401).json({ authenticated: false });
  }
  res.json({ authenticated: true });
});

app.post('/api/login', (req, res) => {
  const u = String(req.body && req.body.username != null ? req.body.username : '').trim();
  const p = String(req.body && req.body.password != null ? req.body.password : '');
  const okUser = process.env.CHORELOG_USER || 'house';
  const okPass = process.env.CHORELOG_PASSWORD || 'monkey';
  if (u !== okUser || p !== okPass) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = createAuthToken();
  const maxAgeSec = Math.floor(COOKIE_MAX_AGE_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax`,
  );
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  res.status(204).end();
});

app.get('/api/entries', async (req, res) => {
  try {
    await ensureSeed();
    const store = await readStore();
    res.json({
      entries: store.entries,
      people: store.people,
      scheduledChores: store.scheduledChores || [],
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load entries' });
  }
});

app.post('/api/scheduled-chores', async (req, res) => {
  try {
    const title = String(req.body && req.body.title ? req.body.title : '').trim();
    let intervalDays = Number(req.body && req.body.intervalDays);
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (!Number.isFinite(intervalDays) || intervalDays < 1) intervalDays = 7;
    if (intervalDays > 3650) intervalDays = 3650;
    const store = await readStore();
    if (!store.scheduledChores) store.scheduledChores = [];
    const createdAt =
      parseCalendarDateParam(req.body && req.body.createdAt) ?? localCalendarDateISO();
    const row = {
      id: newId(),
      title,
      intervalDays,
      createdAt,
      lastCompletedAt: null,
    };
    store.scheduledChores.push(row);
    await writeStore(store);
    res.status(201).json({ scheduledChores: store.scheduledChores });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create scheduled chore' });
  }
});

app.put('/api/scheduled-chores/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const store = await readStore();
    const list = store.scheduledChores || [];
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    if (req.body.title != null) {
      const t = String(req.body.title).trim();
      if (t) list[idx].title = t;
    }
    if (req.body.intervalDays != null) {
      let n = Number(req.body.intervalDays);
      if (Number.isFinite(n) && n >= 1 && n <= 3650) list[idx].intervalDays = n;
    }
    store.scheduledChores = list;
    await writeStore(store);
    res.json({ scheduledChores: store.scheduledChores });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update scheduled chore' });
  }
});

app.delete('/api/scheduled-chores/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const store = await readStore();
    const list = store.scheduledChores || [];
    const next = list.filter((s) => s.id !== id);
    if (next.length === list.length) return res.status(404).json({ error: 'Not found' });
    store.scheduledChores = next;
    await writeStore(store);
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete scheduled chore' });
  }
});

app.post('/api/scheduled-chores/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const person = String(req.body && req.body.person ? req.body.person : '').trim();
    if (!person) return res.status(400).json({ error: 'person is required' });
    const store = await readStore();
    if (!store.people.includes(person)) {
      return res.status(400).json({ error: 'Person must be in your household list' });
    }
    const list = store.scheduledChores || [];
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const chore = list[idx];
    const completedDate = parseCalendarDateParam(req.body && req.body.completedDate);
    if (!completedDate) {
      return res.status(400).json({ error: 'completedDate is required (YYYY-MM-DD calendar date)' });
    }
    chore.lastCompletedAt = completedDate;
    store.entries.push({
      id: newId(),
      d: completedDate,
      c: chore.title,
      p: person,
    });
    await writeStore(store);
    res.json({
      scheduledChores: store.scheduledChores,
      entries: store.entries,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to complete scheduled chore' });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const people = normalizePeople(req.body && req.body.people);
    if (people.length < 1) {
      return res.status(400).json({ error: 'At least one person is required' });
    }
    const store = await readStore();
    store.people = people;
    await writeStore(store);
    res.json({ people: store.people });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

app.get('/api/export', async (req, res) => {
  try {
    await ensureSeed();
    const store = await readStore();
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      people: store.people,
      entries: store.entries,
      scheduledChores: store.scheduledChores || [],
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="chorelog-backup.json"');
    res.send(JSON.stringify(payload, null, 2));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to export' });
  }
});

app.post('/api/import', async (req, res) => {
  try {
    const body = req.body || {};
    const mode = body.mode === 'merge' ? 'merge' : 'replace';
    const incomingPeople = normalizePeople(body.people);
    const incomingEntries = Array.isArray(body.entries) ? body.entries : [];
    const incomingScheduled = normalizeScheduledChores(Array.isArray(body.scheduledChores) ? body.scheduledChores : []);

    if (incomingPeople.length < 1) {
      return res.status(400).json({ error: 'Import must include at least one person' });
    }

    const store = await readStore();

    if (mode === 'replace') {
      const nextEntries = [];
      for (const row of incomingEntries) {
        if (!row || typeof row.d !== 'string' || typeof row.c !== 'string' || typeof row.p !== 'string') continue;
        const d = row.d.trim();
        const c = row.c.trim();
        const p = row.p.trim();
        if (!d || !c || !p) continue;
        nextEntries.push({ id: newId(), d, c, p });
      }
      store.entries = nextEntries;
      store.people = incomingPeople;
      store.scheduledChores = incomingScheduled.map((s) => ({
        ...s,
        id: newId(),
      }));
    } else {
      const peopleSet = new Set(store.people);
      incomingPeople.forEach((p) => peopleSet.add(p));
      store.people = normalizePeople([...peopleSet]);
      for (const row of incomingEntries) {
        if (!row || typeof row.d !== 'string' || typeof row.c !== 'string' || typeof row.p !== 'string') continue;
        const d = row.d.trim();
        const c = row.c.trim();
        const p = row.p.trim();
        if (!d || !c || !p) continue;
        store.entries.push({ id: newId(), d, c, p });
      }
      if (!store.scheduledChores) store.scheduledChores = [];
      for (const s of incomingScheduled) {
        store.scheduledChores.push({
          id: newId(),
          title: s.title,
          intervalDays: s.intervalDays,
          createdAt: s.createdAt,
          lastCompletedAt: s.lastCompletedAt,
        });
      }
    }

    await writeStore(store);
    res.json({
      entries: store.entries,
      people: store.people,
      scheduledChores: store.scheduledChores || [],
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to import' });
  }
});

app.post('/api/entries', async (req, res) => {
  try {
    const body = req.body;
    const items = Array.isArray(body.entries) ? body.entries : null;
    if (!items || !items.length) {
      return res.status(400).json({ error: 'Expected { entries: [{ d, c, p }, ...] }' });
    }
    const store = await readStore();
    const added = [];
    for (const row of items) {
      if (!row || typeof row.d !== 'string' || typeof row.c !== 'string' || typeof row.p !== 'string') {
        return res.status(400).json({ error: 'Each entry needs string fields d, c, p' });
      }
      const entry = { id: newId(), d: row.d.trim(), c: row.c.trim(), p: row.p.trim() };
      if (!entry.d || !entry.c || !entry.p) continue;
      store.entries.push(entry);
      added.push(entry);
    }
    await writeStore(store);
    res.status(201).json({ entries: added });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to save entries' });
  }
});

app.put('/api/entries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const d = parseCalendarDateParam(req.body && req.body.d);
    const c = String(req.body && req.body.c != null ? req.body.c : '').trim();
    const p = String(req.body && req.body.p != null ? req.body.p : '').trim();
    if (!d || !c || !p) {
      return res.status(400).json({ error: 'Valid d (YYYY-MM-DD), c, and p are required' });
    }
    const store = await readStore();
    if (!store.people.includes(p)) {
      return res.status(400).json({ error: 'Person must be in your household list' });
    }
    const idx = store.entries.findIndex((e) => e.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    store.entries[idx] = { id, d, c, p };
    await writeStore(store);
    res.json({ entry: store.entries[idx] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update entry' });
  }
});

app.delete('/api/entries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const store = await readStore();
    const idx = store.entries.findIndex((e) => e.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    store.entries.splice(idx, 1);
    await writeStore(store);
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/site.webmanifest', (req, res) => {
  res.type('application/manifest+json');
  res.sendFile(path.join(__dirname, 'site.webmanifest'));
});

app.get('/favicon.ico', (req, res) => {
  res.redirect(301, '/icons/app-icon.svg');
});

app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`Chore tracker: http://127.0.0.1:${PORT}/`);
});
