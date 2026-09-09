/**
 * node-check.js
 * "Which node am I on" support.
 *
 * HONESTY NOTE (important — read before wiring this into a panel):
 * Surge's scripting API does NOT expose the currently-selected proxy
 * node's name to a Panel/generic script. There is no `$surge.node`,
 * no `$environment.policy`, nothing that reliably returns "US
 * Premium 01" as a string. (Surge exposes the request itself with
 * MitM, and exposes select things to `Panel` scripts via
 * `$environment`, but not the active outbound node.)
 *
 * The closest *reliable* proxy for "did the user switch nodes" is:
 * fingerprint the exit by (IP, ASN) and diff it against the previous
 * cached fingerprint. This module implements exactly that — it does
 * NOT claim to show the literal node name unless the user's Surge
 * config happens to pass one in as a script argument (some setups do
 * this via `argument=` in the module and reading `$argument`, if the
 * proxy group name is static — this is optional and best-effort, and
 * is treated as untrusted display text, not a detection signal).
 */

function fingerprint(ipInfo) {
  if (!ipInfo || !ipInfo.ip) return null;
  return `${ipInfo.ip}|${ipInfo.asn || ""}`;
}

function detectSwitch(prevFingerprint, currentIpInfo) {
  const fp = fingerprint(currentIpInfo);
  if (!fp) return { switched: false, fingerprint: prevFingerprint || null };
  if (!prevFingerprint) return { switched: false, fingerprint: fp }; // first run
  return { switched: fp !== prevFingerprint, fingerprint: fp };
}

// Optional: Surge lets a module pass `argument=` text that scripts read
// via `$argument`. If the user hardcodes their group name there it can
// be shown as a *label*, e.g. argument=US-Group. Never used to drive
// detection logic — only cosmetic, and marked as user-supplied.
function readNodeLabelArgument($argument) {
  if (!$argument) return null;
  const m = /(^|&)label=([^&]+)/.exec($argument);
  return m ? decodeURIComponent(m[2]) : null;
}

module.exports = { fingerprint, detectSwitch, readNodeLabelArgument };
