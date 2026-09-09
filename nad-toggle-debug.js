// Node & AI Detector — Debug Mode toggle.
// Run manually from Surge's Scripts panel (or bind to a shortcut).
// Debug mode only affects console.log output (visible in Surge's script
// console); it never adds internals to the panel UI itself, per spec
// section 34 ("normal UI must not show these").
const key = "nad.debug";
const cur = $persistentStore.read(key) === "1";
const next = cur ? "0" : "1";
$persistentStore.write(next, key);
$notification.post("Node & AI Detector", "Debug Mode", next === "1" ? "Enabled" : "Disabled");
$done();
