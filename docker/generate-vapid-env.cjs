#!/usr/bin/env node
'use strict';

/**
 * Writes CHORELOG_VAPID_* lines to a shell-sourcable file (first run in Docker).
 * Usage: node docker/generate-vapid-env.cjs /path/to/vapid-keys.env
 */
const fs = require('fs');
const path = require('path');

const outPath = process.argv[2] || path.join(__dirname, '..', 'data', 'vapid-keys.env');
const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();
const subject = String(process.env.CHORELOG_VAPID_SUBJECT || 'mailto:noreply@localhost').trim();

function shSingleQuoted(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

const lines = [
  `CHORELOG_VAPID_PUBLIC_KEY=${shSingleQuoted(keys.publicKey)}`,
  `CHORELOG_VAPID_PRIVATE_KEY=${shSingleQuoted(keys.privateKey)}`,
  `CHORELOG_VAPID_SUBJECT=${shSingleQuoted(subject)}`,
  '',
].join('\n');

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, lines, { mode: 0o600 });
console.error('chorelog: wrote', outPath);
