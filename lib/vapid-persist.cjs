'use strict';

const fs = require('fs');
const path = require('path');

const VAPID_ENV_BASENAME = 'vapid-keys.env';

function vapidEnvPath(dataDir) {
  return path.join(dataDir, VAPID_ENV_BASENAME);
}

/** Values from generate-vapid-env.cjs are wrapped in single quotes; keys are base64url without embedded quotes. */
function unshSingleQuoted(raw) {
  const s = String(raw || '').trim();
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Parse CHORELOG_VAPID_* assignments from a shell-sourcable file.
 * @returns {{ publicKey: string, privateKey: string, subject: string } | null}
 */
function parseVapidEnvFileContent(content) {
  const text = String(content || '');
  let publicKey = '';
  let privateKey = '';
  let subject = '';
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(
      /^(CHORELOG_VAPID_PUBLIC_KEY|CHORELOG_VAPID_PRIVATE_KEY|CHORELOG_VAPID_SUBJECT)=(.*)$/,
    );
    if (!m) continue;
    const val = unshSingleQuoted(m[2].trim());
    if (m[1] === 'CHORELOG_VAPID_PUBLIC_KEY') publicKey = val;
    else if (m[1] === 'CHORELOG_VAPID_PRIVATE_KEY') privateKey = val;
    else if (m[1] === 'CHORELOG_VAPID_SUBJECT') subject = val;
  }
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: subject || 'mailto:noreply@localhost',
  };
}

function readVapidEnvFile(dataDir) {
  const p = vapidEnvPath(dataDir);
  if (!fs.existsSync(p)) return null;
  try {
    const content = fs.readFileSync(p, 'utf8');
    return parseVapidEnvFileContent(content);
  } catch {
    return null;
  }
}

function shSingleQuoted(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Write the same format as docker/generate-vapid-env.cjs (600 perms).
 */
function writeVapidEnvFile(dataDir, { publicKey, privateKey, subject }) {
  const outPath = vapidEnvPath(dataDir);
  const lines = [
    `CHORELOG_VAPID_PUBLIC_KEY=${shSingleQuoted(publicKey)}`,
    `CHORELOG_VAPID_PRIVATE_KEY=${shSingleQuoted(privateKey)}`,
    `CHORELOG_VAPID_SUBJECT=${shSingleQuoted(subject)}`,
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, lines, { mode: 0o600 });
  return outPath;
}

/**
 * If process.env does not define both keys, load from `data/vapid-keys.env` into process.env.
 * @returns {boolean} true if keys were loaded from disk
 */
function loadVapidFromDiskIfUnset(dataDir) {
  if (
    process.env.CHORELOG_VAPID_PUBLIC_KEY &&
    String(process.env.CHORELOG_VAPID_PUBLIC_KEY).trim() &&
    process.env.CHORELOG_VAPID_PRIVATE_KEY &&
    String(process.env.CHORELOG_VAPID_PRIVATE_KEY).trim()
  ) {
    return false;
  }
  const parsed = readVapidEnvFile(dataDir);
  if (!parsed) return false;
  process.env.CHORELOG_VAPID_PUBLIC_KEY = parsed.publicKey;
  process.env.CHORELOG_VAPID_PRIVATE_KEY = parsed.privateKey;
  process.env.CHORELOG_VAPID_SUBJECT = parsed.subject;
  return true;
}

module.exports = {
  VAPID_ENV_BASENAME,
  vapidEnvPath,
  parseVapidEnvFileContent,
  readVapidEnvFile,
  writeVapidEnvFile,
  loadVapidFromDiskIfUnset,
};
