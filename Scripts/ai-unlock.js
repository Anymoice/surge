/*
 * AI 服务解锁检测面板脚本
 * 基于各服务在受限地区的公开响应特征（HTTP 状态码 / 跳转 / 返回体关键字）进行判断
 * 结果为启发式判断，仅供参考，不代表官方数据；
 * 遇到风控/机器人拦截（如 403）时不会武断判定为"不可用"，而是标注"未知"，避免误报
 * 用于 Surge [Panel] script-name=ai-unlock
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const IP_API_URL = "https://my.ippure.com/v1/info";

const BLOCK_KEYWORDS = [
  "not available in your country",
  "isn't available in your country",
  "is not available in your region",
  "not available in your area",
  "unsupported_country",
  "your country is not supported",
  "無法在您所在的地區使用",
  "此服务在您所在的地区不可用"
];

function flagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return "🌐";
  return countryCode
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(127397 + c.charCodeAt(0)))
    .join("");
}

function httpGet(options) {
  return new Promise((resolve) => {
    $httpClient.get(options, (error, response, data) => {
      resolve({ error, response: response || {}, data: data || "" });
    });
  });
}

// 通用地区可用性判定：优先匹配返回体中的地区限制关键字；
// 命中 403/451 但没有关键字时，判定为"未知"而不是"不可用"，避免把机器人拦截误判为地区限制
function evaluateRegion(status, body) {
  const text = (body || "").toLowerCase();
  const blocked = BLOCK_KEYWORDS.some((k) => text.includes(k.toLowerCase()));
  if (blocked) return { state: "no", note: "地区受限" };
  if (status >= 200 && status < 400) return { state: "yes" };
  if (status === 403 || status === 451) return { state: "unknown", note: "被拦截，未能确认" };
  return { state: "unknown", note: `HTTP ${status || "-"}` };
}

async function fetchIpInfo() {
  const { error, data } = await httpGet({
    url: IP_API_URL,
    headers: { "User-Agent": UA }
  });
  if (error) return null;
  try {
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

async function checkOpenAI() {
  const { error, response, data } = await httpGet({
    url: "https://api.openai.com/compliance/cookie_requirements",
    headers: { "User-Agent": UA }
  });
  if (error) return { name: "ChatGPT", icon: "💬", state: "unknown", note: "请求超时" };

  const status = Number(response.status || response["status-code"] || 0);
  if (status === 200) return { name: "ChatGPT", icon: "💬", state: "yes" };
  if (status === 403 && /unsupported_country/i.test(data)) {
    return { name: "ChatGPT", icon: "💬", state: "no", note: "地区受限" };
  }
  const result = evaluateRegion(status, data);
  return { name: "ChatGPT", icon: "💬", ...result };
}

async function checkClaude() {
  const { error, response, data } = await httpGet({
    url: "https://claude.ai/",
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }
  });
  if (error) return { name: "Claude", icon: "✳️", state: "unknown", note: "请求超时" };

  const status = Number(response.status || response["status-code"] || 0);
  const result = evaluateRegion(status, data);
  return { name: "Claude", icon: "✳️", ...result };
}

async function checkGemini() {
  const { error, response, data } = await httpGet({
    url: "https://gemini.google.com/",
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" }
  });
  if (error) return { name: "Gemini", icon: "✨", state: "unknown", note: "请求超时" };

  const status = Number(response.status || response["status-code"] || 0);
  const result = evaluateRegion(status, data);
  return { name: "Gemini", icon: "✨", ...result };
}

(async () => {
  const [ipInfo, openai, claude, gemini] = await Promise.all([
    fetchIpInfo(),
    checkOpenAI(),
    checkClaude(),
    checkGemini()
  ]);

  const results = [openai, claude, gemini];

  const aiLines = results.map((r) => {
    const badge = r.state === "yes" ? "✅ 可用" : r.state === "no" ? "🚫 不可用" : "⚠️ 未知";
    const note = r.note ? `（${r.note}）` : "";
    return `${r.icon} ${r.name}　${badge}${note}`;
  });

  const ipLine = ipInfo
    ? `🌐 IP 地址：${ipInfo.ip || "-"}`
    : "🌐 IP 地址：获取失败";
  const locationLine = ipInfo
    ? `${flagEmoji(ipInfo.countryCode)} 国家/城市：${[ipInfo.country, ipInfo.city].filter(Boolean).join(" · ") || "-"}`
    : "🌐 国家/城市：获取失败";

  const lines = [ipLine, locationLine, ...aiLines];

  const allYes = results.every((r) => r.state === "yes");
  const anyNo = results.some((r) => r.state === "no");
  const color = allYes ? "#34C759" : anyNo ? "#FF9500" : "#8E8E93";

  $done({
    title: "🤖 AI 服务解锁检测",
    content: "───────────────\n\n" + lines.join("\n\n"),
    icon: "sparkles",
    "icon-color": color
  });
})();
