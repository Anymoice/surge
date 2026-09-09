# Node & AI Detector (Surge Module)

A Surge Info Panel that shows, for whichever node you're currently
using: exit IP / ASN / IP-type, a composite purity score, basic
security flags, and GPT / Claude / Gemini reachability — without
opening IPPure or ip.net.coffee separately.

All files live flat at the repo root, `nad-`-prefixed to avoid
clashing with anything else you keep in this repo:

```
Node-AI-Detector.sgmodule   ← install this in Surge
nad-panel.js                ← the actual script Surge runs (bundled)
nad-toggle-debug.js         ← optional manual debug-mode switch
nad-utils.js                ← readable source (see note below)
nad-ip-check.js             ← readable source
nad-ai-check.js             ← readable source
nad-node-check.js           ← readable source
NAD-README.md               ← this file
```

**Why `nad-panel.js` duplicates `nad-utils.js` / `nad-ip-check.js` /
`nad-ai-check.js` / `nad-node-check.js`:** Surge's JS runtime has no
`require()`/module resolution across local files — a Panel script has
to be one self-contained file. The `nad-utils.js` etc. files exist
purely so the logic is easy to read, review, and unit-test with plain
Node.js; `nad-panel.js` is the flattened version Surge actually loads.
If you change the logic, update both (or wire up a bundler — the
source files use CommonJS `module.exports`/`require` on purpose so a
tool like esbuild can concatenate them for you).

## Install

1. Files are already at
   `https://raw.githubusercontent.com/Anymoice/surge/main/nad-panel.js`
   and `.../nad-toggle-debug.js` — `Node-AI-Detector.sgmodule` already
   points at those URLs, nothing to edit there.
2. In `[Rule]`, replace `PROXY` with the actual policy or policy-group
   name you want measured (e.g. your "Proxy" select group). **This
   step matters** — without it, the check domains route through
   Surge's default/direct policy and the panel reports your direct
   connection, not your node.
3. In Surge: **Profile → Add Module from URL**, and paste:
   `https://raw.githubusercontent.com/Anymoice/surge/main/Node-AI-Detector.sgmodule`
   (or use `surge:///install-module?url=` + that address).
4. Enable the module, then add the **"Node & AI Detector"** panel to
   your home screen (long-press the panel area → Edit → add it) on
   iOS, or enable it under the Panel tab on macOS.
5. Tap/click the panel to refresh on demand; it also auto-refreshes on
   the panel's own interval.

## Refreshing / caching

- IP info: cached 5 minutes.
- AI availability: cached 3 minutes (or immediately invalidated if the
  exit IP fingerprint changes — see below).
- Tor exit list: cached 6 hours (it's a several-MB text file; no
  reason to refetch it per panel refresh).
- Network latency: sampled fresh every refresh (piggybacks on one of
  the AI-check requests rather than issuing an extra one).

## Node-switch detection

Surge does **not** expose the currently-selected proxy node's name to
scripts — there's no API for it. What this module does instead:
fingerprint the exit as `(IP, ASN)` and diff it against the last seen
fingerprint. If it changed, the panel shows "⚠ IP changed" and forces
an immediate AI re-check instead of serving stale cached results. This
is a reliable *switch detector*; it is not a literal node-name reader.

## History

The last 20 distinct exit IPs are kept in Surge's persistent store
(`nad.history.v1`, JSON array — read it via Surge's Persistent Store
viewer if you want to build your own comparison view). Nothing is sent
anywhere; it's local only.

## Debug Mode

Off by default. Run the **"NAD-Toggle-Debug"** script manually from
Surge's Scripts panel to flip it. When on, internal errors/timings are
written to Surge's script console via `console.log`; the panel's own
display never changes — no stack traces or `undefined`/`null` ever
reach the visible UI.

## Privacy

The module only ever talks to: public IP-info APIs, the Tor Project's
public exit list, Cloudflare's trace endpoint, and the official
GPT/Claude/Gemini domains — all unauthenticated GET requests. It never
reads or transmits your OpenAI/Anthropic/Google account, cookies,
tokens, or chat content, and it doesn't collect anything beyond what's
described above. All caching/history is local to your device via
Surge's persistent store.

## Capability checklist (honest status, per the original spec)

| Item | Status |
|---|---|
| Exit IP / ASN / ISP / geo | ✅ via ip-api.com, with ipwho.is / ipapi.co fallback |
| IP type (Residential/Datacenter/Mobile/Proxy) | ✅ heuristic — flagged fields (proxy/hosting) plus an org-name keyword list; **best-effort**, not a certified classifier |
| IP purity/risk score | ✅ composite, explicitly labelled as this module's own score, not a third-party rating |
| VPN/Proxy flag | ✅ from ip-api.com's `proxy`/`hosting` fields |
| Tor exit check | ✅ against the Tor Project's public bulk exit list (keyless, authoritative) |
| Abuse score / blacklist | ⚠️ **Unknown by design.** Real abuse-scoring (AbuseIPDB, IPQualityScore, etc.) requires a paid API key. Rather than fabricate a number, the panel shows "Unknown (no API key configured)". If you have a key, it's straightforward to add a source in `fetchIpInfo`. |
| DNS leak | ⚠️ **Partial.** True DNS-leak testing needs to see what resolver *other apps* use, which isn't observable from a Surge script. What's implemented is an "Exit Consistency" check — does a third-party edge (Cloudflare) see the same IP the info API reported — which is a real, if narrower, signal. Labelled accordingly rather than claiming full DNS-leak coverage. |
| WebRTC leak | ❌ **Not implementable from Surge.** WebRTC leak testing requires a browser's RTCPeerConnection/STUN stack; Surge scripts have no browser engine. Shown as "Unsupported (requires browser)" rather than faked. |
| IPv6 leak/mismatch | ✅ resolves via an IPv6-only echo endpoint and compares country to the IPv4 exit |
| Network quality/latency | ✅ measured from live request round-trips, classified per the thresholds in the spec |
| GPT check | ✅ network + status + region signals combined (via `api.openai.com/compliance/cookie_requirements` plus keyword scan) |
| Claude check | ✅ `claude.ai` + `api.anthropic.com` checked separately, "Partial" state when they disagree |
| Gemini check | ✅ Web vs API checked separately |
| Current node **name** | ❌ **Not exposed by Surge's scripting API.** Only IP/ASN fingerprinting is possible; see "Node-switch detection" above. |
| Node switch detection | ✅ via fingerprint diff (see above) |
| Caching (5min IP / 2–5min AI) | ✅ |
| Fallback data sources | ✅ ip-api.com → ipwho.is → ipapi.co |
| Graceful partial failure | ✅ each section renders independently; a failed source shows a short message, never `undefined`/`null`/`NaN` |
| History (10–20 nodes) | ✅ local persistent store, de-duped by IP |
| Debug mode | ✅ console-only, gated behind a manual toggle script |
| No account/cookie/token collection | ✅ by construction — only unauthenticated public endpoints are called |
| iPhone / macOS layout | ✅ plain-text panel content (Surge Panels already render as native list cards — there's no custom-HTML panel type to skin further) |

## A note on scope

This checks **public reachability signals** for your own currently
selected proxy exit — the same category of thing IPPure/ip.net.coffee
and similar sites already do in a browser. It doesn't touch anyone's
account, doesn't automate logins, and doesn't attempt to defeat any
authentication or bot-detection system; it just reads status codes and
public geo/IP metadata for domains you're already allowed to request.
