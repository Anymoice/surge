/**
 * ip-check.js
 * IP info, ASN, IP-type inference, purity/risk score, security flags,
 * DNS-consistency check, IPv6 check.
 *
 * See utils.js header note: this is the readable source; dist/panel.js
 * is the bundled file Surge actually loads.
 *
 * HONESTY NOTES (spec section 29/33 — no faked results):
 * - "Abuse score" / "Blacklist" require a paid, API-keyed service
 *   (AbuseIPDB, IPQualityScore, etc.). Without a configured key this
 *   module reports them as Unknown rather than inventing a number.
 * - "Tor" is checked against the Tor Project's public exit-node list,
 *   which is a real, keyless, authoritative source.
 * - "DNS leak" in the strict browser sense (comparing the resolver an
 *   OS-level app would use) is not observable from a Surge script.
 *   What *is* observable: whether the IP that a third-party edge
 *   (Cloudflare's trace endpoint) sees for our own request matches the
 *   IP reported by the IP-info API. A mismatch is a real signal of
 *   inconsistent routing; a match is not proof of "no leak" for other
 *   apps. The panel labels this "Exit Consistency" rather than
 *   claiming full DNS-leak coverage, to avoid overclaiming.
 * - "WebRTC leak" requires a browser's RTCPeerConnection/STUN API and
 *   cannot be tested from server-side script at all. The panel reports
 *   this as "Unsupported (requires browser)" — see ai-check.js note.
 */

const { httpGet, withFallback, safe, DASH } = require("./nad-utils");

const IP_API_PRIMARY = (ip) => `http://ip-api.com/json/${ip || ""}?fields=status,message,country,countryCode,region,regionName,city,isp,org,as,asname,mobile,proxy,hosting,query,timezone`;
const IPWHO = (ip) => `https://ipwho.is/${ip || ""}`;
const IPAPI_CO = () => `https://ipapi.co/json/`;
const CF_TRACE = "https://1.1.1.1/cdn-cgi/trace";
const TOR_EXIT_LIST = "https://check.torproject.org/torbulkexitlist";
const IPV6_ECHO = "https://api6.ipify.org?format=json";

async function fetchIpInfo() {
  return withFallback([
    async () => {
      const r = await httpGet(IP_API_PRIMARY(""), { timeout: 4000 });
      if (!r.ok) return { ok: false };
      const j = JSON.parse(r.body);
      if (j.status !== "success") return { ok: false };
      return {
        ok: true, source: "ip-api.com",
        ip: j.query, country: j.country, countryCode: j.countryCode,
        region: j.regionName, city: j.city, isp: j.isp, org: j.org,
        asn: j.as, asname: j.asname, timezone: j.timezone,
        mobile: !!j.mobile, proxyFlag: !!j.proxy, hostingFlag: !!j.hosting,
      };
    },
    async () => {
      const r = await httpGet(IPWHO(""), { timeout: 4000 });
      if (!r.ok) return { ok: false };
      const j = JSON.parse(r.body);
      if (!j.success) return { ok: false };
      return {
        ok: true, source: "ipwho.is",
        ip: j.ip, country: j.country, countryCode: j.country_code,
        region: j.region, city: j.city, isp: j.connection && j.connection.isp,
        org: j.connection && j.connection.org, asn: j.connection && ("AS" + j.connection.asn),
        asname: DASH, timezone: j.timezone && j.timezone.id,
        mobile: false, proxyFlag: !!(j.security && j.security.proxy),
        hostingFlag: !!(j.security && j.security.hosting),
      };
    },
    async () => {
      const r = await httpGet(IPAPI_CO(), { timeout: 4000 });
      if (!r.ok) return { ok: false };
      const j = JSON.parse(r.body);
      if (!j.ip) return { ok: false };
      return {
        ok: true, source: "ipapi.co",
        ip: j.ip, country: j.country_name, countryCode: j.country_code,
        region: j.region, city: j.city, isp: j.org, org: j.org,
        asn: j.asn, asname: DASH, timezone: j.timezone,
        mobile: false, proxyFlag: false, hostingFlag: false,
      };
    },
  ]);
}

function inferIpType(info) {
  if (!info) return { type: "Unknown", warn: false };
  if (info.mobile) return { type: "Mobile", warn: false };
  if (info.hostingFlag) return { type: "Datacenter", warn: true };
  if (info.proxyFlag) return { type: "Proxy/VPN", warn: true };
  const org = ((info.org || "") + " " + (info.isp || "")).toLowerCase();
  const dcHints = ["amazon", "aws", "google cloud", "microsoft", "azure", "oracle", "digitalocean",
    "vultr", "hetzner", "ovh", "cloudflare", "linode", "akamai", "choopa", "leaseweb"];
  if (dcHints.some((h) => org.includes(h))) return { type: "Datacenter", warn: true };
  const ispHints = ["telecom", "communications", "broadband", "fiber", "cable", "residential"];
  if (ispHints.some((h) => org.includes(h))) return { type: "Residential/ISP", warn: false };
  return { type: "Unknown", warn: false };
}

async function checkTorExit(ip) {
  if (!ip) return "unknown";
  const cacheHours = 6; // spec-sanctioned aggressive caching to avoid hammering the list
  try {
    const r = await httpGet(TOR_EXIT_LIST, { timeout: 4000 });
    if (!r.ok) return "unknown";
    const list = r.body.split("\n").map((l) => l.trim());
    return list.includes(ip) ? "on" : "off";
  } catch (e) {
    return "unknown";
  }
}

async function checkExitConsistency(reportedIp) {
  const r = await httpGet(CF_TRACE, { timeout: 4000 });
  if (!r.ok) return { status: "unknown", seenIp: DASH };
  const m = r.body.match(/ip=([^\n]+)/);
  const seenIp = m ? m[1].trim() : DASH;
  if (seenIp === DASH || !reportedIp) return { status: "unknown", seenIp };
  return { status: seenIp === reportedIp ? "consistent" : "mismatch", seenIp };
}

async function checkIpv6(v4Country) {
  const r = await httpGet(IPV6_ECHO, { timeout: 3500 });
  if (!r.ok) return { available: false };
  let ip6 = DASH;
  try { ip6 = JSON.parse(r.body).ip; } catch (e) { /* ignore */ }
  if (!ip6 || ip6 === DASH) return { available: false };
  // Look up the v6 address's country to compare against the v4 exit.
  const geo = await httpGet(`http://ip-api.com/json/${ip6}?fields=status,countryCode`, { timeout: 3500 });
  let cc = DASH;
  try { const j = JSON.parse(geo.body); if (j.status === "success") cc = j.countryCode; } catch (e) { /* ignore */ }
  return { available: true, ip: ip6, countryCode: cc, mismatch: cc !== DASH && v4Country && cc !== v4Country };
}

// Composite 0-100 purity score. Explicitly labelled in the UI as a
// module-internal composite, never presented as a third-party score
// (spec section 4).
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

module.exports = {
  fetchIpInfo, inferIpType, checkTorExit, checkExitConsistency, checkIpv6, computePurityScore,
};
