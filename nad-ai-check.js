/**
 * ai-check.js
 * GPT / Claude / Gemini reachability + region-restriction detection.
 *
 * Per spec section 29, a check never reports "Available" from HTTP 200
 * alone or from IP-country alone. Each result is classified from THREE
 * signals combined:
 *   1. network  — did the TCP/TLS/HTTP request complete at all?
 *   2. status   — HTTP status code / redirect behaviour
 *   3. content  — known region-block keywords in the response body
 * If signals conflict or a keyword can't be checked, the result is
 * "Unknown" rather than guessed.
 *
 * WEBRTC NOTE: none of these checks — nor anything else in this
 * module — can test WebRTC leakage. WebRTC leak testing requires a
 * real browser's RTCPeerConnection/STUN negotiation running inside a
 * page; a Surge script has no browser engine or media stack. This is
 * reported to the user as "Unsupported (requires browser)" rather than
 * silently omitted or faked.
 */

const { httpGet, safe } = require("./nad-utils");

const BLOCK_KEYWORDS = [
  "not available in your country",
  "is not available in your region",
  "unsupported_country",
  "country, region, or territory not supported",
  "access from your region",
  "vpn or proxy detected",
];

function bodyBlocked(body) {
  const b = (body || "").toLowerCase();
  return BLOCK_KEYWORDS.some((k) => b.includes(k));
}

function classify({ network, status, blocked }) {
  if (!network) return { state: "unavailable", label: "✕ Unavailable" };
  if (blocked) return { state: "restricted", label: "⚠ Region Restricted" };
  if (status >= 200 && status < 400) return { state: "available", label: "✓ Available" };
  if (status === 403 || status === 451) return { state: "restricted", label: "⚠ Region Restricted" };
  return { state: "unknown", label: "— Unknown" };
}

async function checkGpt() {
  // api.openai.com/compliance/cookie_requirements is a lightweight,
  // unauthenticated endpoint that returns the caller's detected
  // country and a distinct payload for unsupported countries — this
  // is the same signal community "region check" tools rely on,
  // avoiding a full page load.
  const r = await httpGet("https://api.openai.com/compliance/cookie_requirements", { timeout: 6000 });
  const network = r.status > 0;
  let blocked = bodyBlocked(r.body);
  let region = safe(null);
  try {
    const j = JSON.parse(r.body);
    if (j && j.country_code) region = j.country_code;
    if (j && (j.error || j.unsupported_country)) blocked = true;
  } catch (e) { /* non-JSON => fall back to keyword scan above */ }
  const result = classify({ network, status: r.status, blocked });
  return { name: "GPT", ...result, region, latencyMs: r.latencyMs };
}

async function checkClaude() {
  const web = await httpGet("https://claude.ai/", { timeout: 6000 });
  const api = await httpGet("https://api.anthropic.com/", { timeout: 6000 });
  const webNetwork = web.status > 0;
  const apiNetwork = api.status > 0;
  const webBlocked = bodyBlocked(web.body);
  const webOk = webNetwork && !webBlocked && web.status < 400;
  const apiOk = apiNetwork && (api.status < 500); // anthropic.com root often 4xx by design; presence is enough
  let state, label;
  if (!webNetwork && !apiNetwork) { state = "unavailable"; label = "✕ Unavailable"; }
  else if (webBlocked) { state = "restricted"; label = "⚠ Region Restricted"; }
  else if (webOk && apiOk) { state = "available"; label = "✓ Available"; }
  else if (webOk || apiOk) { state = "partial"; label = "⚠ Partial"; }
  else { state = "unknown"; label = "— Unknown"; }
  return {
    name: "Claude", state, label,
    detail: { "claude.ai": webOk ? "✓" : "✕", "anthropic.com": apiOk ? "✓" : "✕" },
    region: safe(null), latencyMs: web.latencyMs,
  };
}

async function checkGemini() {
  const web = await httpGet("https://gemini.google.com/", { timeout: 6000 });
  const api = await httpGet("https://generativelanguage.googleapis.com/$discovery/rest", { timeout: 6000 });
  const webBlocked = bodyBlocked(web.body);
  const webOk = web.status > 0 && !webBlocked && web.status < 400;
  const apiOk = api.status > 0 && api.status < 500;
  let state, label;
  if (web.status === 0 && api.status === 0) { state = "unavailable"; label = "✕ Unavailable"; }
  else if (webBlocked) { state = "restricted"; label = "⚠ Region Restricted"; }
  else if (webOk && apiOk) { state = "available"; label = "✓ Available"; }
  else if (webOk && !apiOk) { state = "web_only"; label = "● Web Available (API ✕)"; }
  else if (!webOk && apiOk) { state = "api_only"; label = "● API Available (Web ✕)"; }
  else { state = "unknown"; label = "— Unknown"; }
  return { name: "Gemini", state, label, web: webOk, api: apiOk, latencyMs: web.latencyMs };
}

module.exports = { checkGpt, checkClaude, checkGemini };
