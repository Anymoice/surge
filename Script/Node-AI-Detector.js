/*
 * Node & AI Detector
 * Surge iOS / macOS
 * Repository: https://github.com/Anymoice/Surge
 *
 * Detection philosophy:
 * - IP/location/ASN: ipapi.co + ip-api.com
 * - AI: direct HTTPS availability checks for ChatGPT/OpenAI, Claude/Anthropic, Gemini/Google
 * - Never claims DNS/WebRTC support when Surge generic JS cannot perform a browser/WebRTC or UDP leak test.
 *
 * No account, cookie, token, or chat content is collected.
 */

const VERSION = "1.0.0";
const TIMEOUT = 8000;
const CACHE_TTL = 5 * 60 * 1000;

const AI = {
  gpt: {
    name: "GPT",
    urls: [
      { label: "chatgpt.com", url: "https://chatgpt.com/", kind: "web" },
      { label: "api.openai.com", url: "https://api.openai.com/", kind: "api" }
    ]
  },
  claude: {
    name: "Claude",
    urls: [
      { label: "claude.ai", url: "https://claude.ai/", kind: "web" },
      { label: "anthropic.com", url: "https://www.anthropic.com/", kind: "service" }
    ]
  },
  gemini: {
    name: "Gemini",
    urls: [
      { label: "gemini.google.com", url: "https://gemini.google.com/", kind: "web" },
      { label: "ai.google.dev", url: "https://ai.google.dev/", kind: "developer" },
      { label: "generativelanguage.googleapis.com", url: "https://generativelanguage.googleapis.com/", kind: "api" }
    ]
  }
};

// Broadly recognized service-availability countries.
// This is deliberately used as a hint, not as the final unlock decision.
const KNOWN_AI_COUNTRIES = new Set([
  "US","CA","GB","IE","AU","NZ","JP","KR","SG","TW","HK","MO","MY","TH","PH","ID","VN",
  "IN","AE","IL","SA","QA","KW","BH","OM","JO","TR","CH","NO","SE","DK","FI","NL","BE",
  "DE","FR","ES","PT","IT","AT","PL","CZ","HU","RO","BG","GR","HR","SI","SK","EE","LV",
  "LT","IS","LU","MT","CY","ZA","BR","AR","CL","CO","PE","MX","CR","PA","UY","EC"
]);

function getJSON(url, timeout = TIMEOUT) {
  return new Promise(resolve => {
    $httpClient.get({
      url,
      timeout,
      headers: {
        "User-Agent": "Mozilla/5.0 Surge-Node-AI-Detector/" + VERSION,
        "Accept": "application/json,text/plain,*/*"
      }
    }, (error, response, body) => {
      if (error || !response) return resolve({ ok:false, error:String(error || "No response") });
      let data = null;
      try { data = JSON.parse(body); } catch (_) {}
      resolve({ ok: true, status: Number(response.status) || 0, headers: response.headers || {}, body: body || "", data });
    });
  });
}

function getText(url, timeout = TIMEOUT, maxBody = 120000) {
  return new Promise(resolve => {
    $httpClient.get({
      url,
      timeout,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/json,text/plain,*/*"
      }
    }, (error, response, body) => {
      if (error || !response) return resolve({ ok:false, status:0, body:"", error:String(error || "No response") });
      body = String(body || "");
      resolve({ ok:true, status:Number(response.status)||0, body:body.length > maxBody ? body.slice(0,maxBody) : body, headers:response.headers||{} });
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cacheGet(key) {
  try {
    const raw = $persistentStore.read("NAID:" + key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj.ts || Date.now() - obj.ts > CACHE_TTL) return null;
    return obj.data;
  } catch (_) { return null; }
}

function cacheSet(key, data) {
  try {
    $persistentStore.write(JSON.stringify({ts:Date.now(), data}), "NAID:" + key);
  } catch (_) {}
}

function esc(s) {
  return String(s ?? "").replace(/[\r\n]+/g, " ").trim();
}

function fmtMs(ms) {
  if (!Number.isFinite(ms)) return "—";
  return Math.max(0, Math.round(ms)) + "ms";
}

function countryFlag(code) {
  if (!code || code.length !== 2) return "🌐";
  return code.toUpperCase().replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

function scoreLabel(score) {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 60) return "Fair";
  if (score >= 40) return "Risky";
  return "High Risk";
}

function riskScore(info) {
  // 100 = cleaner. This is our heuristic, not an official third-party score.
  let score = 100;
  if (!info) return null;
  if (info.proxy === true) score -= 28;
  if (info.hosting === true) score -= 18;
  if (info.tor === true) score -= 30;
  if (info.crawler === true) score -= 10;
  if (info.mobile === true) score += 2;
  if (info.blacklisted === true) score -= 25;
  return Math.max(0, Math.min(100, score));
}

function ipType(info) {
  if (!info) return "Unknown";
  if (info.mobile) return "Mobile";
  if (info.hosting) return "Datacenter";
  if (info.proxy) return "Proxy/VPN";
  if (info.org && /residential|broadband|telecom|communications|isp|internet/i.test(info.org)) return "ISP";
  return "Unknown";
}

async function fetchIPInfo() {
  const cached = cacheGet("ipinfo");
  if (cached) return cached;

  const [a, b] = await Promise.all([
    getJSON("https://ipapi.co/json/"),
    getJSON("http://ip-api.com/json/?fields=status,message,country,countryCode,regionName,city,isp,org,as,asname,mobile,proxy,hosting,query")
  ]);

  const d = a.data || {};
  const r = b.data || {};

  if (!a.ok && !b.ok) return null;

  const info = {
    ip: d.ip || r.query || "",
    country: d.country_name || r.country || "",
    countryCode: (d.country_code || r.countryCode || "").toUpperCase(),
    region: d.region || r.regionName || "",
    city: d.city || r.city || "",
    org: d.org || r.org || r.asname || "",
    asn: d.asn || (r.as ? String(r.as).split(" ")[0] : ""),
    isp: d.org || r.isp || "",
    timezone: d.timezone || "",
    latitude: d.latitude || "",
    longitude: d.longitude || "",
    proxy: r.proxy === true,
    hosting: r.hosting === true,
    mobile: r.mobile === true,
    tor: false,
    crawler: false,
    blacklisted: false
  };

  info.type = ipType(info);
  info.score = riskScore(info);
  info.scoreLabel = scoreLabel(info.score);
  info.supportHint = KNOWN_AI_COUNTRIES.has(info.countryCode);

  cacheSet("ipinfo", info);
  return info;
}

async function checkEndpoint(item) {
  const start = Date.now();
  const r = await getText(item.url);
  const latency = Date.now() - start;
  let status = r.status || 0;
  let body = (r.body || "").toLowerCase();

  let state = "unknown";
  let reason = "";

  // HTTP connectivity is only one signal. Avoid treating every 2xx as a guarantee of account-level access.
  if (r.ok && status >= 200 && status < 400) {
    state = "available";
    reason = "HTTPS reachable";
  } else if (r.ok && [401,403,429].includes(status)) {
    state = "partial";
    reason = "Service reachable (" + status + ")";
  } else if (r.ok && status >= 400) {
    state = "unavailable";
    reason = "HTTP " + status;
  } else {
    state = "unavailable";
    reason = r.error || "Connection failed";
  }

  // Strong restriction/challenge hints. These do not override a successful endpoint unless explicit.
  if (/unsupported country|not available in your country|unsupported region|country.?not.?supported|region.?not.?supported/i.test(body)) {
    state = "restricted";
    reason = "Region restricted";
  }

  // Some services return generic Google/OpenAI auth pages. That is still network reachability,
  // not proof that a logged-in account can use the product.
  return {label:item.label, kind:item.kind, state, status, latency, reason};
}

function combineAI(name, results) {
  const web = results.find(x => x.kind === "web");
  const allReachable = results.some(x => ["available","partial"].includes(x.state));
  const restricted = results.some(x => x.state === "restricted");
  const failed = results.filter(x => x.state === "unavailable").length;

  let state = "unknown";
  if (restricted) state = "restricted";
  else if (web && web.state === "available") state = "available";
  else if (allReachable) state = "partial";
  else if (failed === results.length) state = "unavailable";

  const best = results.find(x => x.kind === "web") || results[0];
  return {
    name,
    state,
    latency: best ? best.latency : null,
    results
  };
}

async function checkAI() {
  const cached = cacheGet("ai");
  if (cached) return cached;

  const out = {};
  for (const key of Object.keys(AI)) {
    const def = AI[key];
    const results = [];
    // Sequential within each provider keeps request pressure low.
    for (const item of def.urls) {
      results.push(await checkEndpoint(item));
    }
    out[key] = combineAI(def.name, results);
  }
  cacheSet("ai", out);
  return out;
}

function aiIcon(state) {
  return {
    available:"✓",
    partial:"△",
    restricted:"!",
    unavailable:"✕",
    unknown:"—"
  }[state] || "—";
}

function aiText(state) {
  return {
    available:"Available",
    partial:"Partial",
    restricted:"Region Restricted",
    unavailable:"Unavailable",
    unknown:"Unknown"
  }[state] || "Unknown";
}

function securityLine(info) {
  const vpn = info && info.proxy ? "ON ⚠" : "OFF";
  const hosting = info && info.hosting ? "Datacenter" : (info && info.mobile ? "Mobile" : "ISP/Other");
  return [
    "VPN / Proxy    " + vpn,
    "Tor            —",
    "Abuse          —",
    "IP Type        " + hosting,
    "DNS Leak       — (Surge JS)",
    "WebRTC / UDP   — (Surge JS)"
  ].join("\n");
}

function buildContent(info, ai) {
  const lines = [];
  lines.push("NODE CHECK");
  if (info) {
    lines.push((countryFlag(info.countryCode) + " " + (info.country || "Unknown")).trim());
    lines.push((info.ip || "IP unavailable") + (info.city ? " · " + esc(info.city) : ""));
    lines.push("IP Purity     " + (info.score == null ? "—" : info.score + " · " + info.scoreLabel));
    lines.push("IP Type       " + esc(info.type || "Unknown"));
    lines.push("ASN           " + esc(info.asn || "—"));
    lines.push("ISP / Org     " + esc(info.isp || info.org || "—"));
  } else {
    lines.push("IP information unavailable");
  }

  lines.push("");
  lines.push("SECURITY");
  lines.push(securityLine(info));

  lines.push("");
  lines.push("AI UNLOCK");
  for (const key of ["gpt","claude","gemini"]) {
    const x = ai[key];
    lines.push(
      aiIcon(x.state) + " " + x.name.padEnd(7) + " " +
      aiText(x.state) + (x.latency != null ? " · " + fmtMs(x.latency) : "")
    );
    // Keep endpoint detail compact.
    const details = x.results.map(r => {
      return "  " + r.label + ": " + aiIcon(r.state) + (r.latency != null ? " " + fmtMs(r.latency) : "");
    });
    lines.push(details.join("\n"));
  }

  lines.push("");
  lines.push("ℹ IP score is a local heuristic. DNS/WebRTC/UDP browser leak tests require capabilities unavailable to a generic Surge JS panel.");
  lines.push("v" + VERSION + " · " + new Date().toLocaleTimeString());
  return lines.join("\n");
}

async function main() {
  const [info, ai] = await Promise.all([fetchIPInfo(), checkAI()]);
  const content = buildContent(info, ai);

  let style = "info";
  if (ai && Object.values(ai).some(x => x.state === "restricted" || x.state === "unavailable")) style = "alert";
  if (!info) style = "error";

  $done({
    title: "Node & AI Detector",
    content,
    style,
    icon: "network",
    "icon-color": style === "error" ? "#FF3B30" : (style === "alert" ? "#FF9500" : "#007AFF")
  });
}

main().catch(err => {
  console.log("[Node-AI-Detector] " + String(err));
  $done({
    title: "Node & AI Detector",
    content: "Detection failed\n" + esc(err && err.message ? err.message : err),
    style: "error",
    icon: "exclamationmark.triangle.fill",
    "icon-color": "#FF3B30"
  });
});
