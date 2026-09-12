/*
 * Surge-Node-AI-Detector v2
 * IPPure + Net.Coffee + direct service probes
 * Author: Anymoice
 */

const CFG = {
  group: getArg("group") || "Proxy",
  mode: getArg("mode") || "panel",
  timeout: 8,
  stateKey: "SNAID.v2.state"
};

const URL = {
  ipPure: "https://my.ippure.com/v1/info",
  ipify4: "https://api.ipify.org?format=json",
  ipify6: "https://api6.ipify.org?format=json",
  geo: "https://ip.net.coffee/api/geoip/",
  chatgpt: "https://chatgpt.com/",
  openai: "https://api.openai.com/",
  claude: "https://claude.ai/",
  anthropic: "https://api.anthropic.com/"
};

function getArg(name) {
  const s = typeof $argument === "string" ? $argument : "";
  const m = s.match(new RegExp("(?:^|&)" + name + "=([^&]*)"));
  return m ? decodeURIComponent(m[1]) : "";
}

function text(v, fallback) {
  if (v === null || v === undefined || String(v).trim() === "") return fallback || "未知";
  return String(v).replace(/\s+/g, " ").trim();
}

function json(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

function request(url, policy, extra) {
  return new Promise(resolve => {
    const options = {
      url: url,
      policy: policy,
      timeout: CFG.timeout,
      autoRedirect: true,
      headers: Object.assign({
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"
      }, extra || {})
    };
    $httpClient.get(options, (error, response, data) => {
      resolve({
        error: error || null,
        status: response ? Number(response.status || 0) : 0,
        headers: response && response.headers ? response.headers : {},
        data: data || ""
      });
    });
  });
}

function finishPanel(title, content, style, icon) {
  $done({
    title: title,
    content: content,
    style: style || "info",
    icon: icon || "network"
  });
}

function flag(code) {
  code = text(code, "");
  if (!/^[A-Za-z]{2}$/.test(code)) return "🌐";
  return code.toUpperCase().replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

function getSelectedNode(group) {
  try {
    const details = $surge.selectGroupDetails();
    const decisions = details && details.decisions ? details.decisions : {};
    const selected = decisions[group];
    return selected ? text(selected, "") : "";
  } catch (_) {
    return "";
  }
}

function stateRead() {
  try { return json($persistentStore.read(CFG.stateKey) || "") || {}; } catch (_) { return {}; }
}

function stateWrite(obj) {
  try { $persistentStore.write(JSON.stringify(obj), CFG.stateKey); } catch (_) {}
}

function ipFrom(obj) {
  if (!obj || typeof obj !== "object") return "";
  return text(obj.ip || obj.query || obj.address || obj.clientIp || obj.client_ip || obj.origin, "");
}

function validIP(ip) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) || /^[0-9a-fA-F:]+:[0-9a-fA-F:]+$/.test(ip);
}

async function getPublicIP(policy) {
  // IPPure is preferred because it also returns risk and attributes.
  const primary = await request(URL.ipPure, policy);
  const info = json(primary.data);
  let ip = ipFrom(info);

  // Fallbacks solve the occasional empty IPPure response.
  if (!validIP(ip)) {
    const r4 = await request(URL.ipify4, policy);
    ip = ipFrom(json(r4.data));
  }
  if (!validIP(ip)) {
    const r6 = await request(URL.ipify6, policy);
    ip = ipFrom(json(r6.data));
  }

  return { primary, info: info || {}, ip: validIP(ip) ? ip : "" };
}

function ipType(info, geo) {
  if (info && info.isResidential === true) return { icon: "🟢", text: "住宅 IP", style: "good" };
  if (info && (info.isDataCenter === true || info.isDatacenter === true)) return { icon: "🔵", text: "机房 IP", style: "info" };
  if (info && info.isBroadcast === true) return { icon: "🟠", text: "广播 IP", style: "alert" };

  const org = text((info && (info.asOrganization || info.isp)) || (geo && (geo.isp || geo.organization || geo.org)), "").toLowerCase();
  if (/amazon|aws|microsoft|azure|google|gcp|oracle|digitalocean|vultr|linode|alibaba|aliyun|tencent cloud|cloudflare/.test(org)) {
    return { icon: "🔵", text: "机房 IP", style: "info" };
  }
  return { icon: "⚪", text: "未知类型", style: "info" };
}

function purity(fraudScore) {
  const risk = Number(fraudScore);
  if (!isFinite(risk)) return { icon: "⚪", text: "暂无评分", style: "info" };
  const score = Math.max(0, Math.min(100, 100 - risk));
  if (risk <= 15) return { icon: "🟢", text: "极佳 · " + score + "/100", style: "good" };
  if (risk <= 30) return { icon: "🟢", text: "良好 · " + score + "/100", style: "good" };
  if (risk <= 50) return { icon: "🟡", text: "一般 · " + score + "/100", style: "info" };
  if (risk <= 70) return { icon: "🟠", text: "偏高风险 · " + score + "/100", style: "alert" };
  return { icon: "🔴", text: "高风险 · " + score + "/100", style: "error" };
}

function probeResult(r) {
  if (!r) return { icon: "⚪", text: "未检测" };
  if (r.error || !r.status) return { icon: "🔴", text: "不可达" };
  const s = r.status;
  if (s >= 200 && s < 400) return { icon: "🟢", text: "可用" };
  if (s === 401) return { icon: "🟡", text: "可达 · 需认证" };
  if (s === 403) return { icon: "🟠", text: "可达 · 被拒绝" };
  if (s === 429) return { icon: "🟠", text: "可达 · 限流" };
  if (s >= 400 && s < 500) return { icon: "🟠", text: "可达 · HTTP " + s };
  if (s >= 500) return { icon: "🔴", text: "服务异常 · " + s };
  return { icon: "⚪", text: "HTTP " + s };
}

function claudeResult(page, api) {
  // Claude homepage can legitimately return a protection/login response.
  // API endpoint is a better second signal. We deliberately do not call 403 "不可达".
  if (page && page.status >= 200 && page.status < 400) return { icon: "🟢", text: "可用" };
  if (api && api.status >= 200 && api.status < 400) return { icon: "🟢", text: "API 可用" };
  if ((page && page.status === 403) || (api && api.status === 403)) return { icon: "🟠", text: "网络可达 · 风控/验证" };
  if ((page && page.status === 429) || (api && api.status === 429)) return { icon: "🟠", text: "网络可达 · 限流" };
  if ((page && page.status === 401) || (api && api.status === 401)) return { icon: "🟡", text: "网络可达 · 需登录" };
  if ((page && page.error) && (api && api.error)) return { icon: "🔴", text: "不可达" };
  if (page && page.status) return { icon: "🟡", text: "网络可达 · HTTP " + page.status };
  if (api && api.status) return { icon: "🟡", text: "API 可达 · HTTP " + api.status };
  return { icon: "🔴", text: "不可达" };
}

function countryLocation(info, geo) {
  const code = text((info && info.countryCode) || (geo && (geo.countryCode || geo.country_code)), "");
  const country = text((info && info.country) || (geo && (geo.country || geo.countryName || geo.country_name)), "未知");
  const region = text((info && info.region) || (geo && (geo.region || geo.state || geo.province)), "");
  const city = text((info && info.city) || (geo && geo.city), "");
  return {
    code: code,
    text: flag(code) + " " + [country, region, city].filter(Boolean).join(" · ")
  };
}

async function fullDetect(node) {
  const pub = await getPublicIP(node);
  const info = pub.info || {};
  let geo = {};

  if (pub.ip) {
    const gr = await request(URL.geo + encodeURIComponent(pub.ip), node);
    geo = json(gr.data) || {};
  }

  const probes = await Promise.all([
    request(URL.chatgpt, node),
    request(URL.openai, node),
    request(URL.claude, node),
    request(URL.anthropic, node)
  ]);

  const p = purity(info.fraudScore);
  const t = ipType(info, geo);
  const loc = countryLocation(info, geo);
  const gpt = probeResult(probes[0]);
  const claude = claudeResult(probes[2], probes[3]);

  return {
    node: node,
    ip: pub.ip || text(info.ip, "获取失败"),
    purity: p,
    type: t,
    location: loc,
    gpt: gpt,
    claude: claude,
    openai: probeResult(probes[1]),
    anthropic: probeResult(probes[3]),
    operator: text(info.asOrganization || info.isp || geo.isp || geo.organization || geo.org, "未知"),
    fraudScore: info.fraudScore,
    time: new Date().toLocaleTimeString()
  };
}

function panelContent(d) {
  // Keep the panel body clean: no duplicate title, no fake heading inside the content area.
  return [
    "代理策略  │ " + d.node,
    "IP 地址   │ " + d.ip,
    "纯净度    │ " + d.purity.icon + " " + d.purity.text,
    "IP 类型   │ " + d.type.icon + " " + d.type.text,
    "位置      │ " + d.location.text,
    "GPT       │ " + d.gpt.icon + " " + d.gpt.text,
    "Claude    │ " + d.claude.icon + " " + d.claude.text,
    "",
    "运营商    │ " + d.operator,
    "风险值    │ " + (d.fraudScore === undefined ? "暂无" : d.fraudScore + "/100"),
    "OpenAI    │ " + d.openai.icon + " " + d.openai.text,
    "Anthropic │ " + d.anthropic.icon + " " + d.anthropic.text,
    "",
    "数据源    │ IPPure · Net.Coffee",
    "检测时间  │ " + d.time
  ].join("\n");
}

function notifySwitch(previous, current, d) {
  const title = "节点已切换";
  const subtitle = current;
  const body = [
    "IP：" + d.ip,
    "纯净度：" + d.purity.icon + " " + d.purity.text,
    "IP 类型：" + d.type.icon + " " + d.type.text,
    "位置：" + d.location.text,
    "GPT：" + d.gpt.icon + " " + d.gpt.text,
    "Claude：" + d.claude.icon + " " + d.claude.text
  ].join("\n");
  $notification.post(title, subtitle, body, {"auto-dismiss": false, "sound": true});
}

async function runWatch() {
  const node = getSelectedNode(CFG.group);
  if (!node) return $done();

  const old = stateRead();
  // Only compare the selected node. No IP/API request happens unless it actually changed.
  if (old.group === CFG.group && old.node === node) return $done();

  // First run only establishes a baseline to avoid an unwanted notification after installation.
  if (!old.node) {
    stateWrite({group: CFG.group, node: node});
    return $done();
  }

  const d = await fullDetect(node);
  notifySwitch(old.node, node, d);
  stateWrite({group: CFG.group, node: node, ip: d.ip, updated: Date.now()});
  $done();
}

async function runPanel() {
  const node = getSelectedNode(CFG.group);
  if (!node) {
    return finishPanel("节点 AI 检测", "⚠️ 找不到策略组\n\n策略组：" + CFG.group + "\n\n请在模块参数中填写实际的 Surge 策略组名称。", "error", "exclamationmark.triangle");
  }

  try {
    const d = await fullDetect(node);
    finishPanel("节点 AI 检测", panelContent(d), d.purity.style, "network.badge.shield.half.filled");
  } catch (e) {
    finishPanel("节点 AI 检测", "⚠️ 检测异常\n\n" + text(e && e.message, String(e)), "error", "exclamationmark.triangle");
  }
}

(async function () {
  try {
    if (CFG.mode === "watch") return await runWatch();
    return await runPanel();
  } catch (e) {
    if (CFG.mode === "watch") return $done();
    return finishPanel("节点 AI 检测", "⚠️ 检测异常\n\n" + text(e && e.message, String(e)), "error", "exclamationmark.triangle");
  }
})();
