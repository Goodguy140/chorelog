'use strict';

const fs = require('fs');
const path = require('path');

function envInt(name, def) {
  const v = process.env[name];
  if (v == null || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
}

/**
 * Persistent per-IP login throttling (failed attempts + lockout).
 * State file survives process restarts.
 */
function createLoginThrottle({ dataDir }) {
  const maxFailures = Math.max(1, envInt('CHORELOG_LOGIN_MAX_FAILURES', 8));
  const lockoutMs = Math.max(1000, envInt('CHORELOG_LOGIN_LOCKOUT_MS', 15 * 60 * 1000));
  const windowMs = Math.max(1000, envInt('CHORELOG_LOGIN_WINDOW_MS', 15 * 60 * 1000));
  const stateFile = path.join(dataDir, 'login-throttle.json');

  function load() {
    try {
      const buf = fs.readFileSync(stateFile, 'utf8');
      const j = JSON.parse(buf);
      if (!j || typeof j !== 'object' || !j.ips || typeof j.ips !== 'object') return { ips: {} };
      return { ips: j.ips };
    } catch (e) {
      if (e.code === 'ENOENT') return { ips: {} };
      return { ips: {} };
    }
  }

  let state = load();

  function persist() {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, ips: state.ips }), 'utf8');
    fs.renameSync(tmp, stateFile);
  }

  function prune() {
    const t = Date.now();
    const { ips } = state;
    for (const key of Object.keys(ips)) {
      const rec = ips[key];
      if (!rec) {
        delete ips[key];
        continue;
      }
      const lockedUntil = Number(rec.lockedUntil) || 0;
      const windowStart = Number(rec.windowStart) || 0;
      if (lockedUntil > t) continue;
      if (t - windowStart > windowMs && lockedUntil <= t) delete ips[key];
    }
  }

  /**
   * @returns {{ allowed: boolean, retryAfterSec?: number }}
   */
  function check(ip) {
    prune();
    const key = String(ip || 'unknown').slice(0, 128);
    const rec = state.ips[key];
    if (!rec) return { allowed: true };
    const t = Date.now();
    const lockedUntil = Number(rec.lockedUntil) || 0;
    if (lockedUntil > t) {
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((lockedUntil - t) / 1000)) };
    }
    return { allowed: true };
  }

  function recordFailure(ip) {
    prune();
    const key = String(ip || 'unknown').slice(0, 128);
    const t = Date.now();
    let rec = state.ips[key];
    if (!rec) {
      rec = { failures: 0, windowStart: t, lockedUntil: 0 };
    } else {
      if (Number(rec.lockedUntil) > t) return;
      if (t - Number(rec.windowStart || 0) > windowMs) {
        rec = { failures: 0, windowStart: t, lockedUntil: 0 };
      } else {
        rec = { ...rec, lockedUntil: 0 };
      }
    }
    rec.failures = (Number(rec.failures) || 0) + 1;
    rec.windowStart = Number(rec.windowStart) || t;
    if (rec.failures >= maxFailures) {
      rec.lockedUntil = t + lockoutMs;
      rec.failures = 0;
      rec.windowStart = t;
    }
    state.ips[key] = rec;
    persist();
  }

  function recordSuccess(ip) {
    const key = String(ip || 'unknown').slice(0, 128);
    if (state.ips[key]) {
      delete state.ips[key];
      persist();
    }
  }

  return { check, recordFailure, recordSuccess };
}

module.exports = { createLoginThrottle };
