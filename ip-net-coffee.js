// IP.net.coffee launcher
// Triggered by the Surge Information Panel.

$notification.post(
  "IP.net.coffee",
  "打开 IP 地址检测",
  "点击此通知即可跳转到 IP.net.coffee",
  {
    action: "open-url",
    url: "https://ip.net.coffee",
    auto-dismiss: true
  }
);

$done({
  title: "IP.net.coffee",
  content: "通知已发送，点击通知即可打开网站",
  icon: "checkmark.circle.fill",
  "icon-color": "#34C759"
});
