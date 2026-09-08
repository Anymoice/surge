/*
 * IP 纯净度检测面板脚本
 * 数据来源：https://ippure.com 公开接口 https://my.ippure.com/v1/info
 * 用于 Surge [Panel] script-name=ip-purity
 */

const API_URL = "https://my.ippure.com/v1/info";

$httpClient.get(
  { url: API_URL, headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" } },
  (error, response, data) => {
    if (error) {
      $done({
        title: "🛡️ IP 纯净度检测",
        content: `❌ 请求失败\n${error}`,
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

      const typeTag = info.isResidential ? "🏠 住宅 IP" : "🏢 机房 / 数据中心 IP";
      const location = [info.country, info.region, info.city].filter(Boolean).join(" ");

      const lines = [
        `${levelIcon} 纯净度：${level}（风险分 ${fraud >= 0 ? fraud : "-"}/100）`,
        `${typeTag}${info.isBroadcast ? "　📡 广播地址" : ""}`,
        "───────────────",
        `🌍 位置　${location || "-"}`,
        `🛰 ASN　　AS${info.asn ?? "-"} ${info.asOrganization || ""}`.trim(),
        `📍 坐标　${info.latitude ?? "-"}, ${info.longitude ?? "-"}`,
        `🕒 时区　${info.timezone || "-"}`,
        `🌐 IP　　${info.ip || "-"}`
      ];

      $done({
        title: "🛡️ IP 纯净度检测",
        content: lines.join("\n"),
        icon: "checkmark.shield.fill",
        "icon-color": color
      });
    } catch (e) {
      $done({
        title: "🛡️ IP 纯净度检测",
        content: "❌ 数据解析失败，请稍后重试",
        icon: "exclamationmark.triangle",
        "icon-color": "#FF3B30"
      });
    }
  }
);
