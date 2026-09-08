/*
 * AI 服务解锁检测面板脚本
 * 基于各服务在受限地区的公开响应特征（HTTP 状态码 / 跳转 / 返回体关键字）进行判断
 * 结果为启发式判断，仅供参考，不代表官方数据
 * 用于 Surge [Panel] script-name=ai-unlock
 */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";

function httpGet(options) {
  return new Promise((resolve) => {
    $httpClient.get(options, (error, response, data) => {
      resolve({ error, response: response || {}, data: data || "" });
    });
  });
}

async function checkOpenAI() {
  const { error, response, data } = await httpGet({
    url: "https://api.openai.com/compliance/cookie_requirements",
    headers: { "User-Agent": UA }
  });
  if (error) return { name: "ChatGPT / OpenAI", icon: "💬", state: "unknown", note: "请求超时" };

  const status = Number(response.status || response["status-code"] || 0);
  if (status === 200) return { name: "ChatGPT / OpenAI", icon: "💬", state: "yes" };
  if (status === 403 && /unsupported_country/i.test(data)) {
    return { name: "ChatGPT / OpenAI", icon: "💬", state: "no", note: "地区受限" };
  }
  return { name: "ChatGPT / OpenAI", icon: "💬", state: "unknown", note: `HTTP ${status || "-"}` };
}

async function checkClaude() {
  const { error, response } = await httpGet({
    url: "https://claude.ai/api/organizations",
    headers: { "User-Agent": UA }
  });
  if (error) return { name: "Claude", icon: "✳️", state: "unknown", note: "请求超时" };

  const status = Number(response.status || response["status-code"] || 0);
  // 未登录访问该接口：地区可用时返回 401 未授权；地区受限时被拦截为 403
  if (status === 401) return { name: "Claude", icon: "✳️", state: "yes" };
  if (status === 403) return { name: "Claude", icon: "✳️", state: "no", note: "地区受限" };
  return { name: "Claude", icon: "✳️", state: "unknown", note: `HTTP ${status || "-"}` };
}

async function checkGemini() {
  const { error, response } = await httpGet({
    url: "https://gemini.google.com/",
    headers: { "User-Agent": UA }
  });
  if (error) return { name: "Gemini", icon: "✨", state: "unknown", note: "请求超时" };

  const status = Number(response.status || response["status-code"] || 0);
  const headers = response.headers || {};
  const location = headers["Location"] || headers["location"] || "";

  if (status >= 300 && status < 400 && /accounts\.google\.com/i.test(location)) {
    return { name: "Gemini", icon: "✨", state: "yes" };
  }
  if (status === 200) {
    return { name: "Gemini", icon: "✨", state: "no", note: "地区可能受限" };
  }
  return { name: "Gemini", icon: "✨", state: "unknown", note: `HTTP ${status || "-"}` };
}

(async () => {
  const results = await Promise.all([checkOpenAI(), checkClaude(), checkGemini()]);

  const lines = results.map((r) => {
    const badge = r.state === "yes" ? "✅ 可用" : r.state === "no" ? "🚫 不可用" : "⚠️ 未知";
    const note = r.note ? `　(${r.note})` : "";
    return `${r.icon} ${r.name}\n　${badge}${note}`;
  });

  const allYes = results.every((r) => r.state === "yes");
  const anyNo = results.some((r) => r.state === "no");
  const color = allYes ? "#34C759" : anyNo ? "#FF9500" : "#8E8E93";

  $done({
    title: "🤖 AI 服务解锁检测",
    content: lines.join("\n───────────────\n"),
    icon: "sparkles",
    "icon-color": color
  });
})();
