'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseVapidEnvFileContent } = require('../lib/vapid-persist.cjs');

test('parseVapidEnvFileContent reads shell-quoted keys', () => {
  const content = [
    "CHORELOG_VAPID_PUBLIC_KEY='pubX'",
    "CHORELOG_VAPID_PRIVATE_KEY='privY'",
    "CHORELOG_VAPID_SUBJECT='mailto:a@b.co'",
    '',
  ].join('\n');
  const out = parseVapidEnvFileContent(content);
  assert.ok(out);
  assert.strictEqual(out.publicKey, 'pubX');
  assert.strictEqual(out.privateKey, 'privY');
  assert.strictEqual(out.subject, 'mailto:a@b.co');
});
