const crypto = require('crypto');

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

function createAuthToken(username, householdId, opts = {}) {
  const user = String(username || '')
    .trim()
    .slice(0, 120) || 'member';
  const household = String(householdId || '')
    .trim()
    .slice(0, 64);
  const payload = { v: 2, exp: Date.now() + COOKIE_MAX_AGE_MS, user, household };
  if (opts.readOnly) payload.ro = true;
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
  if (payload.v !== 2 || typeof payload.household !== 'string' || !payload.household.trim()) {
    return null;
  }
  return payload;
}

function buildRequireApiAuth({ ensureRegistryLoaded, getRegistry, verifyAuthCookieFn = verifyAuthCookie }) {
  return function requireApiAuth(req, res, next) {
    if (!req.path.startsWith('/api')) return next();
    if (req.method === 'GET' && req.path === '/api/auth') return next();
    if (req.method === 'GET' && req.path === '/api/version') return next();
    if (req.method === 'GET' && req.path === '/api/register-info') return next();
    if (req.method === 'GET' && req.path === '/api/openapi.json') return next();
    if (req.method === 'GET' && req.path === '/api/push/vapid-public') return next();
    if (req.method === 'POST' && req.path === '/api/login') return next();
    if (req.method === 'POST' && req.path === '/api/login/members') return next();
    if (req.method === 'POST' && req.path === '/api/logout') return next();
    if (req.method === 'POST' && req.path === '/api/households') return next();
    const payload = verifyAuthCookieFn(req.headers.cookie);
    if (!payload) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    ensureRegistryLoaded();
    const hid = String(payload.household).trim();
    const registry = getRegistry();
    if (!registry.households[hid]) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.authPayload = payload;
    req.householdId = hid;
    next();
  };
}

function requireReadWrite(req, res, next) {
  if (!req.authPayload) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.authPayload.ro) {
    return res.status(403).json({ error: 'Read-only session', code: 'read_only' });
  }
  next();
}

module.exports = {
  AUTH_COOKIE,
  COOKIE_MAX_AGE_MS,
  buildRequireApiAuth,
  createAuthToken,
  requireReadWrite,
  verifyAuthCookie,
};
