/**
 * utils.js
 * Shared helpers for Node & AI Detector.
 *
 * NOTE ON ARCHITECTURE:
 * Surge's script engine does not support `require()`-ing other local
 * files (there is no CommonJS/module resolution for user scripts). This
 * file — and nad-ip-check.js / nad-ai-check.js / nad-node-check.js —
 * exist as *readable source modules* so the logic is easy to maintain
 * and unit test with plain Node.js. The actual file Surge loads is the
 * bundled, single-file build nad-panel.js, which inlines all of this.
 * If you change logic here, re-apply the same change in nad-panel.js
 * (or run a bundler — see NAD-README.md "Development" section).
 */

const DASH = "—"; // used instead of undefined/null/N/A per spec

function safe(v) {
  if (v === undefined || v === null || v === "" || v === "N/A" || Number.isNaN(v)) return DASH;
  return v;
}

function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---- Cache (Surge $persistentStore) ----------------------------------
// Every cache entry is {ts, ttl, data}. Stored as JSON strings.
function cacheGet(key) {
  try {
    const raw = $persistentStore.read(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (Date.now() - obj.ts > obj.ttl) return null; // expired
    return obj.data;
  } catch (e) {
    return null;
  }
}

function cacheSet(key, data, ttlMs) {
  try {
    $persistentStore.write(JSON.stringify({ ts: Date.now(), ttl: ttlMs, data }), key);
  } catch (e) {
    // Non-fatal: caching is best-effort.
  }
}

// ---- Networking --------------------------------------------------------
// Promise wrapper around $httpClient with a hard timeout. Never rejects
// on network failure — callers get {ok:false, error} so one bad request
// can't crash the whole panel (spec section 24 / 33).
function httpGet(url, { headers = {}, timeout = 5000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: "timeout", status: 0, body: "", latencyMs: timeout });
    }, timeout);

    const start = Date.now();
    $httpClient.get({ url, headers }, (err, resp, body) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const latencyMs = Date.now() - start;
      if (err) {
        resolve({ ok: false, error: String(err), status: 0, body: "", latencyMs });
        return;
      }
      const status = (resp && resp.status) || 0;
      resolve({ ok: status > 0 && status < 500, error: null, status, body: body || "", latencyMs });
    });
  });
}

// Race a primary source against a fallback; returns whichever succeeds
// first in priority order, never throws (spec section 23: primary/fallback).
async function withFallback(fns) {
  for (const fn of fns) {
    try {
      const r = await fn();
      if (r && r.ok !== false) return r;
    } catch (e) {
      /* try next */
    }
  }
  return null;
}

// ---- Formatting ----------------------------------------------------------
function scoreLabel(score) {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 60) return "Fair";
  if (score >= 40) return "Risky";
  return "High Risk";
}

function latencyLabel(ms) {
  if (ms < 80) return "Excellent";
  if (ms < 150) return "Good";
  if (ms < 250) return "Fair";
  return "Poor";
}

function statusIcon(state) {
  // state: 'ok' | 'warn' | 'fail' | 'unknown' | 'testing'
  return { ok: "🟢", warn: "🟠", fail: "🔴", unknown: "⚪️", testing: "🔵" }[state] || "⚪️";
}

module.exports = {
  DASH, safe, nowStr, cacheGet, cacheSet, httpGet, withFallback, scoreLabel, latencyLabel, statusIcon,
};
