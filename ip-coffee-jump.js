/*
 * 点击面板刷新按钮 → 弹出系统通知 → 点击通知跳转到 https://ip.net.coffee
 * 用于 Surge [Panel] script-name=ip-coffee-jump
 */

const TARGET_URL = "https://ip.net.coffee";

// $trigger 为 "button" 表示用户手动点了面板的刷新按钮
// 为 "auto-interval" 表示是自动定时刷新，此时不弹通知，避免打扰
if ($trigger === "button") {
  $notification.post(
    "🌐 IP.NET.COFFEE",
    "",
    "点击本通知跳转到 ip.net.coffee",
    { action: "open-url", url: TARGET_URL }
  );
}

$done({
  title: "🌐 IP.NET.COFFEE",
  content: "点击右上角刷新按钮\n会弹出通知，点通知即可跳转",
  icon: "safari",
  "icon-color": "#007AFF"
});
