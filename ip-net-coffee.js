// IP.net.coffee Surge launcher
// Triggered from the Surge panel.

$notification.post(
  "IP.net.coffee",
  "打开 IP.net.coffee",
  "点击此通知打开网站",
  {
    "action": "open-url",
    "url": "https://ip.net.coffee",
    "auto-dismiss": true
  }
);

$done();
