/**
 * Node & AI Detector — Surge Panel script (bundled build)
 * ---------------------------------------------------------------------
 * Source of truth for the logic lives in nad-utils.js / nad-ip-check.js /
 * nad-ai-check.js / nad-node-check.js (readable, per-concern modules,
 * kept for maintainability/testing). This file is the flattened bundle
 * Surge actually executes, since Surge's script engine has no require()/
 * module resolution across local files. If you edit the source
 * modules, mirror the change here (or run your own bundler).
 *
 * Requires this module's accompanying [Script] / [Panel] sections
 * (see Node-AI-Detector.sgmodule) and a rule that routes the
 * check domains through the currently-selected outbound policy —
 * otherwise the checks measure Surge's *direct* connection, not your
 * proxy node. See NAD-README.md "Why the rule block matters".
 */

// ------------------------- constants -----------------------------------
const DASH = "—";
const IP_CACHE_KEY = "nad.ip.v1";
const AI_CACHE_KEY = "nad.ai.v1";
const FP_CACHE_KEY = "nad.fingerprint.v1";
const HIST_KEY = "nad.history.v1";
const IP_TTL = 5 * 60 * 1000;      // 5 min, per spec section 21
const AI_TTL = 3 * 60 * 1000;      // 2–5 min, using 3
const TOR_TTL = 6 * 60 * 60 * 1000; // 6h, exit list rarely worth refetching
const DEBUG = ($persistentStore.read("nad.debug") === "1");

const BLOCK_KEYWORDS = [
  "not available in your country", "is not available in your region",
  "unsupported_country", "country, region, or territory not supported",
  "access from your region", "vpn or proxy detected",
];

// ------------------------- tiny utils ------------------------------------
function safe(v) { return (v === undefined || v === null || v === "" || v === "N/A") ? DASH : v; }
function nowStr() { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; }
function scoreLabel(s) { if (s >= 90) return "Excellent"; if (s >= 75) return "Good"; if (s >= 60) return "Fair"; if (s >= 40) return "Risky"; return "High Risk"; }
function latencyLabel(ms) { if (ms < 80) return "Excellent"; if (ms < 150) return "Good"; if (ms < 250) return "Fair"; return "Poor"; }
function bodyBlocked(body) { const b = (body || "").toLowerCase(); return BLOCK_KEYWORDS.some((k) => b.includes(k)); }
function log(...args) { if (DEBUG) console.log("[NAD]", ...args); }

function cacheGet(key) {
  try {
    const raw = $persistentStore.read(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (Date.now() - obj.ts > obj.ttl) return null;
    return obj.data;
  } catch (e) { return null; }
}
function cacheSet(key, data, ttl) {
  try { $persistentStore.write(JSON.stringify({ ts: Date.now(), ttl, data }), key); } catch (e) { /* best-effort */ }
}

function httpGet(url, { headers = {}, timeout = 5000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return; settled = true;
      resolve({ ok: false, error: "timeout", status: 0, body: "", latencyMs: timeout });
    }, timeout);
    const start = Date.now();
    try {
      $httpClient.get({ url, headers }, (err, resp, body) => {
        if (settled) return; settled = true;
        clearTimeout(timer);
        const latencyMs = Date.now() - start;
        if (err) { resolve({ ok: false, error: String(err), status: 0, body: "", latencyMs }); return; }
        const status = (resp && resp.status) || 0;
        resolve({ ok: status > 0 && status < 500, error: null, status, body: body || "", latencyMs });
      });
    } catch (e) {
      settled = true; clearTimeout(timer);
      resolve({ ok: false, error: String(e), status: 0, body: "", latencyMs: 0 });
    }
  });
}
async function withFallback(fns) {
  for (const fn of fns) {
    try { const r = await fn(); if (r && r.ok !== false) return r; } catch (e) { log("fallback step failed", e); }
  }
  return null;
}

// ------------------------- IP / ASN / risk --------------------------------
async function fetchIpInfo() {
  return withFallback([
    async () => {
      const r = await httpGet("http://ip-api.com/json/?fields=status,message,country,countryCode,region,regionName,city,isp,org,as,asname,mobile,proxy,hosting,query,timezone", { timeout: 4000 });
      if (!r.ok) return { ok: false };
      const j = JSON.parse(r.body);
      if (j.status !== "success") return { ok: false };
      return { ok: true, source: "ip-api.com", ip: j.query, country: j.country, countryCode: j.countryCode,
        region: j.regionName, city: j.city, isp: j.isp, org: j.org, asn: j.as, asname: j.asname,
        timezone: j.timezone, mobile: !!j.mobile, proxyFlag: !!j.proxy, hostingFlag: !!j.hosting };
    },
    async () => {
      const r = await httpGet("https://ipwho.is/", { timeout: 4000 });
      if (!r.ok) return { ok: false };
      const j = JSON.parse(r.body);
      if (!j.success) return { ok: false };
      return { ok: true, source: "ipwho.is", ip: j.ip, country: j.country, countryCode: j.country_code,
        region: j.region, city: j.city, isp: j.connection && j.connection.isp, org: j.connection && j.connection.org,
        asn: j.connection && ("AS" + j.connection.asn), asname: DASH, timezone: j.timezone && j.timezone.id,
        mobile: false, proxyFlag: !!(j.security && j.security.proxy), hostingFlag: !!(j.security && j.security.hosting) };
    },
    async () => {
      const r = await httpGet("https://ipapi.co/json/", { timeout: 4000 });
      if (!r.ok) return { ok: false };
      const j = JSON.parse(r.body);
      if (!j.ip) return { ok: false };
      return { ok: true, source: "ipapi.co", ip: j.ip, country: j.country_name, countryCode: j.country_code,
        region: j.region, city: j.city, isp: j.org, org: j.org, asn: j.asn, asname: DASH, timezone: j.timezone,
        mobile: false, proxyFlag: false, hostingFlag: false };
    },
  ]);
}

function inferIpType(info) {
  if (!info) return { type: "Unknown", warn: false };
  if (info.mobile) return { type: "Mobile", warn: false };
  if (info.hostingFlag) return { type: "Datacenter", warn: true };
  if (info.proxyFlag) return { type: "Proxy/VPN", warn: true };
  const org = ((info.org || "") + " " + (info.isp || "")).toLowerCase();
  const dc = ["amazon", "aws", "google cloud", "microsoft", "azure", "oracle", "digitalocean", "vultr", "hetzner", "ovh", "cloudflare", "linode", "akamai", "leaseweb"];
  if (dc.some((h) => org.includes(h))) return { type: "Datacenter", warn: true };
  const isp = ["telecom", "communications", "broadband", "fiber", "cable", "residential"];
  if (isp.some((h) => org.includes(h))) return { type: "Residential/ISP", warn: false };
  return { type: "Unknown", warn: false };
}

async function checkTorExit(ip) {
  if (!ip) return "unknown";
  const cached = cacheGet("nad.torlist");
  let list = cached;
  if (!list) {
    const r = await httpGet("https://check.torproject.org/torbulkexitlist", { timeout: 4000 });
    if (!r.ok) return "unknown";
    list = r.body.split("\n").map((l) => l.trim());
    cacheSet("nad.torlist", list, TOR_TTL);
  }
  return list.includes(ip) ? "on" : "off";
}

async function checkExitConsistency(reportedIp) {
  const r = await httpGet("https://1.1.1.1/cdn-cgi/trace", { timeout: 4000 });
  if (!r.ok) return { status: "unknown", seenIp: DASH };
  const m = r.body.match(/ip=([^\n]+)/);
  const seenIp = m ? m[1].trim() : DASH;
  if (seenIp === DASH || !reportedIp) return { status: "unknown", seenIp };
  return { status: seenIp === reportedIp ? "consistent" : "mismatch", seenIp };
}

async function checkIpv6(v4CountryCode) {
  const r = await httpGet("https://api6.ipify.org?format=json", { timeout: 3500 });
  if (!r.ok) return { available: false };
  let ip6 = null;
  try { ip6 = JSON.parse(r.body).ip; } catch (e) { /* ignore */ }
  if (!ip6) return { available: false };
  const geo = await httpGet(`http://ip-api.com/json/${ip6}?fields=status,countryCode`, { timeout: 3500 });
  let cc = DASH;
  try { const j = JSON.parse(geo.body); if (j.status === "success") cc = j.countryCode; } catch (e) { /* ignore */ }
  return { available: true, ip: ip6, countryCode: cc, mismatch: cc !== DASH && v4CountryCode && cc !== v4CountryCode };
}

function computePurityScore({ ipType, tor, proxyFlag, hostingFlag, exitConsistency }) {
  let score = 100;
  if (ipType.type === "Datacenter") score -= 25;
  if (ipType.type === "Proxy/VPN") score -= 20;
  if (ipType.type === "Unknown") score -= 5;
  if (proxyFlag) score -= 15;
  if (hostingFlag) score -= 10;
  if (tor === "on") score -= 40;
  if (exitConsistency === "mismatch") score -= 15;
  return Math.max(0, Math.min(100, score));
}

// ------------------------- AI unlock checks -------------------------------
function classify({ network, status, blocked }) {
  if (!network) return { state: "unavailable", label: "✕ Unavailable" };
  if (blocked) return { state: "restricted", label: "⚠ Region Restricted" };
  if (status >= 200 && status < 400) return { state: "available", label: "✓ Available" };
  if (status === 403 || status === 451) return { state: "restricted", label: "⚠ Region Restricted" };
  return { state: "unknown", label: "— Unknown" };
}

async function checkGpt() {
  const r = await httpGet("https://api.openai.com/compliance/cookie_requirements", { timeout: 6000 });
  const network = r.status > 0;
  let blocked = bodyBlocked(r.body);
  let region = DASH;
  try {
    const j = JSON.parse(r.body);
    if (j && j.country_code) region = j.country_code;
    if (j && (j.error || j.unsupported_country)) blocked = true;
  } catch (e) { /* keyword scan already applied */ }
  const result = classify({ network, status: r.status, blocked });
  return { name: "GPT", ...result, region, latencyMs: r.latencyMs };
}

async function checkClaude() {
  const web = await httpGet("https://claude.ai/", { timeout: 6000 });
  const api = await httpGet("https://api.anthropic.com/", { timeout: 6000 });
  const webBlocked = bodyBlocked(web.body);
  const webOk = web.status > 0 && !webBlocked && web.status < 400;
  const apiOk = api.status > 0 && api.status < 500;
  let state, label;
  if (web.status === 0 && api.status === 0) { state = "unavailable"; label = "✕ Unavailable"; }
  else if (webBlocked) { state = "restricted"; label = "⚠ Region Restricted"; }
  else if (webOk && apiOk) { state = "available"; label = "✓ Available"; }
  else if (webOk || apiOk) { state = "partial"; label = "⚠ Partial"; }
  else { state = "unknown"; label = "— Unknown"; }
  return { name: "Claude", state, label, detail: { "claude.ai": webOk ? "✓" : "✕", "anthropic.com": apiOk ? "✓" : "✕" }, latencyMs: web.latencyMs };
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

// ------------------------- history / node-switch ---------------------------
function fingerprint(ipInfo) { return ipInfo && ipInfo.ip ? `${ipInfo.ip}|${ipInfo.asn || ""}` : null; }

function pushHistory(entry) {
  let hist = [];
  try { hist = JSON.parse($persistentStore.read(HIST_KEY) || "[]"); } catch (e) { hist = []; }
  hist = hist.filter((h) => h.ip !== entry.ip); // de-dup by ip, most-recent wins
  hist.unshift(entry);
  hist = hist.slice(0, 20); // spec section 31: keep 10–20
  $persistentStore.write(JSON.stringify(hist), HIST_KEY);
}

// ------------------------- render ------------------------------------------
function flag(cc) {
  if (!cc || cc === DASH || cc.length !== 2) return "";
  const A = 0x1f1e6;
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => A + c.charCodeAt(0) - 65)) + " ";
}

function render({ ip, security, ai, network, purity, exitInfo, switched, err }) {
  const lines = [];

  lines.push("NODE CHECK");
  if (err.ip) {
    lines.push(`IP Information   ⚠ ${err.ip}`);
  } else {
    lines.push(`${flag(ip.countryCode)}${safe(ip.city)}, ${safe(ip.country)}`);
    lines.push(`${safe(ip.ip)}`);
    lines.push(`ISP        ${safe(ip.isp)}`);
    lines.push(`ASN        ${safe(ip.asn)}`);
    lines.push(`Type       ${ip.ipType.type}${ip.ipType.warn ? " ⚠️" : ""}`);
    lines.push(`IP Purity  ${purity}  (${scoreLabel(purity)})`);
  }
  if (switched) lines.push(`⚠ IP changed since last check — data refreshed`);
  lines.push(`Latency    ${safe(network.latencyMs != null ? network.latencyMs + " ms" : DASH)}  (${network.label})`);
  lines.push("");

  lines.push("SECURITY");
  lines.push(`VPN/Proxy  ${security.proxy ? "ON ⚠️" : "OFF"}`);
  lines.push(`Tor        ${security.tor === "on" ? "ON ⚠️" : security.tor === "off" ? "OFF" : "Unknown"}`);
  lines.push(`Abuse/Blacklist   Unknown (no API key configured)`);
  lines.push(`Exit Consistency  ${security.exitConsistency === "mismatch" ? "⚠ Mismatch" : security.exitConsistency === "consistent" ? "Consistent" : "Unknown"}`);
  lines.push(`IPv6       ${security.ipv6.available ? (security.ipv6.mismatch ? `${flag(security.ipv6.countryCode)}Mismatch ⚠️` : "Consistent") : "Disabled/Unreachable"}`);
  lines.push(`WebRTC     Unsupported (requires browser)`);
  lines.push("");

  lines.push("AI UNLOCK");
  for (const a of ai) {
    if (a.name === "Claude" && a.detail) {
      lines.push(`Claude     ${a.label}   ${a.latencyMs}ms`);
      lines.push(`  claude.ai ${a.detail["claude.ai"]}   anthropic.com ${a.detail["anthropic.com"]}`);
    } else if (a.name === "Gemini") {
      lines.push(`Gemini     ${a.label}   ${a.latencyMs}ms`);
    } else {
      lines.push(`GPT        ${a.label}   Region ${safe(a.region)}   ${a.latencyMs}ms`);
    }
  }
  lines.push("");
  lines.push(`Last Check  ${nowStr()}`);

  return lines.join("\n");
}

// ------------------------- main ---------------------------------------------
async function main() {
  const err = {};
  let ip = cacheGet(IP_CACHE_KEY);
  if (!ip) {
    const raw = await fetchIpInfo();
    if (!raw) { err.ip = "All IP sources failed"; }
    else { ip = raw; ip.ipType = inferIpType(raw); cacheSet(IP_CACHE_KEY, ip, IP_TTL); }
  } else if (!ip.ipType) {
    ip.ipType = inferIpType(ip);
  }

  const prevFp = cacheGet(FP_CACHE_KEY);
  const fp = ip ? fingerprint(ip) : null;
  const switched = !!(prevFp && fp && prevFp !== fp);
  if (fp) cacheSet(FP_CACHE_KEY, fp, 24 * 60 * 60 * 1000);

  let aiData = switched ? null : cacheGet(AI_CACHE_KEY);
  if (!aiData) {
    const [gpt, claude, gemini] = await Promise.all([checkGpt(), checkClaude(), checkGemini()]);
    aiData = [gpt, claude, gemini];
    cacheSet(AI_CACHE_KEY, aiData, AI_TTL);
  }

  let purity = 0, security = { proxy: false, tor: "unknown", exitConsistency: "unknown", ipv6: { available: false } };
  let network = { latencyMs: null, label: "Unknown" };

  if (ip) {
    const [tor, exitInfo, ipv6] = await Promise.all([
      checkTorExit(ip.ip),
      checkExitConsistency(ip.ip),
      checkIpv6(ip.countryCode),
    ]);
    security = { proxy: ip.proxyFlag || ip.hostingFlag, tor, exitConsistency: exitInfo.status, ipv6 };
    purity = computePurityScore({ ipType: ip.ipType, tor, proxyFlag: ip.proxyFlag, hostingFlag: ip.hostingFlag, exitConsistency: exitInfo.status });
    // Use one of the already-issued requests as our network-quality sample.
    network = { latencyMs: exitInfo.seenIp !== DASH ? undefined : undefined, label: undefined };
    const sample = aiData.find((a) => typeof a.latencyMs === "number") || {};
    network = { latencyMs: sample.latencyMs || null, label: latencyLabel(sample.latencyMs || 999) };

    pushHistory({ ip: ip.ip, country: ip.country, countryCode: ip.countryCode, purity, ts: Date.now(),
      ai: aiData.map((a) => ({ name: a.name, state: a.state })) });
  }

  const content = render({ ip: ip || {}, security, ai: aiData, network, purity, switched, err });
  $done({
    title: "Node & AI Detector",
    content,
    icon: "network.badge.shield.half.filled",
    "icon-color": purity >= 75 ? "#34C759" : purity >= 40 ? "#FF9500" : "#FF3B30",
  });
}

main().catch((e) => {
  log("fatal", e);
  $done({
    title: "Node & AI Detector",
    content: `⚠ Unexpected error\n${DEBUG ? String(e) : "Enable Debug Mode for details."}`,
    icon: "exclamationmark.triangle",
    "icon-color": "#FF3B30",
  });
});
