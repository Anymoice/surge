/*
 * IP 纯净度检测面板脚本
 * 数据来源：https://ippure.com 公开接口 https://my.ippure.com/v1/info
 * 用于 Surge [Panel] script-name=ip-purity
 */

const API_URL = "https://my.ippure.com/v1/info";

function flagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return "🌐";
  return countryCode
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(127397 + c.charCodeAt(0)))
    .join("");
}

$httpClient.get(
  { url: API_URL, headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" } },
  (error, response, data) => {
    if (error) {
      $done({
        title: "🛡️ IP 纯净度检测",
        content: "───────────────\n\n❌ 请求失败\n" + error,
        icon: "wifi.exclamationmark",
        "icon-color": "#FF3B30"
      });
      return;
    }

    try {
      const info = JSON.parse(data);
      const fraud = typeof info.fraudScore === "number" ? info.fraudScore : -1;

      // 纯净度分级
      let level, levelIcon, color;
      if (fraud < 0) {
        level = "未知"; levelIcon = "❓"; color = "#8E8E93";
      } else if (fraud <= 20) {
        level = "纯净"; levelIcon = "🟢"; color = "#34C759";
      } else if (fraud <= 50) {
        level = "一般"; levelIcon = "🟡"; color = "#FFCC00";
      } else if (fraud <= 75) {
        level = "较差"; levelIcon = "🟠"; color = "#FF9500";
      } else {
        level = "高风险"; levelIcon = "🔴"; color = "#FF3B30";
      }

      const ipTypeTag = info.isResidential ? "🏠 住宅 IP" : "🏢 机房 / 数据中心 IP";
      const flag = flagEmoji(info.countryCode);
      const location = [info.country, info.city].filter(Boolean).join(" · ");
      const asnText = `AS${info.asn ?? "-"}${info.asOrganization ? " " + info.asOrganization : ""}`;

      const lines = [
        `${levelIcon} 纯净度：${level}（风险分 ${fraud >= 0 ? fraud : "-"}/100）`,
        `🌐 IP 地址：${info.ip || "-"}`,
        `${ipTypeTag}`,
        `🛰 ASN：${asnText}`,
        `${flag} 国家/城市：${location || "-"}`
      ];

      $done({
        title: "🛡️ IP 纯净度检测",
        content: "───────────────\n\n" + lines.join("\n\n"),
        icon: "checkmark.shield.fill",
        "icon-color": color
      });
    } catch (e) {
      $done({
        title: "🛡️ IP 纯净度检测",
        content: "───────────────\n\n❌ 数据解析失败，请稍后重试",
        icon: "exclamationmark.triangle",
        "icon-color": "#FF3B30"
      });
    }
  }
);
