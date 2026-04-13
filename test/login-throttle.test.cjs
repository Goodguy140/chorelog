const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLoginThrottle } = require('../lib/login-throttle.cjs');

const saved = {};

afterEach(() => {
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
    delete saved[k];
  }
});

function setEnv(name, value) {
  if (!(name in saved)) saved[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('login throttle locks out after max failures within window', () => {
  setEnv('CHORELOG_LOGIN_MAX_FAILURES', '2');
  setEnv('CHORELOG_LOGIN_LOCKOUT_MS', '3600000');
  setEnv('CHORELOG_LOGIN_WINDOW_MS', '3600000');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chorelog-lt-'));
  const t = createLoginThrottle({ dataDir: dir });
  const ip = '10.0.0.1';
  assert.strictEqual(t.check(ip).allowed, true);
  t.recordFailure(ip);
  assert.strictEqual(t.check(ip).allowed, true);
  t.recordFailure(ip);
  const c = t.check(ip);
  assert.strictEqual(c.allowed, false);
  assert.ok(c.retryAfterSec >= 1);
});

test('successful login clears throttle state for IP', () => {
  setEnv('CHORELOG_LOGIN_MAX_FAILURES', '5');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chorelog-lt2-'));
  const t = createLoginThrottle({ dataDir: dir });
  const ip = '10.0.0.2';
  t.recordFailure(ip);
  assert.strictEqual(t.check(ip).allowed, true);
  t.recordSuccess(ip);
  assert.strictEqual(t.check(ip).allowed, true);
  const st = JSON.parse(fs.readFileSync(path.join(dir, 'login-throttle.json'), 'utf8'));
  assert.strictEqual(st.ips[ip], undefined);
});
