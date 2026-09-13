/*
 * Surge-Node-AI-Detector v4
 * IPPure + Net.Coffee + direct AI reachability probes
 * Author: Anymoice
 *
 * Design goal:
 * - No cron / no background polling.
 * - Full detection only when the selected policy changes, or when the panel
 *   is opened for the first time and no cached result exists.
 * - Re-opening/refreshing the panel on the same node returns cached data and
 *   performs NO network detection.
 */

const CFG = {
  group: getArg("group") || "Proxy",
  mode: getArg("mode") || "panel",
  timeout: 8,
  stateKey: "SNAID.v4.state"
};

const URL = {
  ipPure: "https://my.ippure.com/v1/info",
  ipify4: "https://api.ipify.org?format=json",
  ipify6: "https://api6.ipify.org?format=json",
  geo: "https://ip.net.coffee/api/geoip/",
  gptPage: "https://ip.net.coffee/gpt/",
  claudePage: "https://ip.net.coffee/claude/",
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/"
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
      "auto-redirect": true,
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

function validIPv4(ip) {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) return false;
  return ip.split(".").every(n => Number(n) >= 0 && Number(n) <= 255);
}

function validIPv6(ip) {
  return /^[0-9a-fA-F:]+$/.test(ip) && ip.indexOf(":") >= 0;
}

function validIP(ip) {
  return validIPv4(ip) || validIPv6(ip);
}

async function getPublicIP(policy) {
  // Prefer a numeric IPv4 address. If IPv4 is unavailable, fall back to IPv6.
  // IPPure remains the source of the risk/location metadata.
  const primary = await request(URL.ipPure, policy);
  const info = json(primary.data) || {};
  const pureIP = ipFrom(info);

  let r4 = null;
  let r6 = null;
  if (!validIPv4(pureIP)) r4 = await request(URL.ipify4, policy);
  const ipv4 = validIPv4(pureIP) ? pureIP : ipFrom(json(r4 && r4.data));
  if (ipv4) return { primary, info, ip: ipv4, ipVersion: "IPv4" };

  if (validIPv6(pureIP)) return { primary, info, ip: pureIP, ipVersion: "IPv6" };

  r6 = await request(URL.ipify6, policy);
  const ipv6 = ipFrom(json(r6.data));
  return { primary, info, ip: validIPv6(ipv6) ? ipv6 : "", ipVersion: validIPv6(ipv6) ? "IPv6" : "" };
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

function reachability(r, service) {
  if (!r || (!r.status && r.error)) return { icon: "🔴", text: "不可达", detail: service };
  const s = Number(r.status || 0);
  if (s >= 200 && s < 400) return { icon: "🟢", text: "可达", detail: service };
  if (s === 401) return { icon: "🟡", text: "可达 · 需登录", detail: service };
  if (s === 403) return { icon: "🟠", text: "可达 · 风控/验证", detail: service };
  if (s === 429) return { icon: "🟠", text: "可达 · 限流", detail: service };
  if (s >= 400 && s < 500) return { icon: "🟠", text: "可达 · HTTP " + s, detail: service };
  if (s >= 500) return { icon: "🔴", text: "服务异常 · " + s, detail: service };
  return { icon: "⚪", text: "无法确认", detail: service };
}

function netCoffeePageResult(page, service) {
  if (!page || page.error || !page.data) return null;
  const h = String(page.data).replace(/\s+/g, " ");
  const lower = h.toLowerCase();
  const words = service === "claude"
    ? ["claude.ai正常", "anthropic.com正常", "claude服务状态全部服务正常"]
    : ["chatgpt.com正常", "api.openai.com正常", "chatgpt服务状态全部服务正常"];
  if (words.some(x => lower.indexOf(x.toLowerCase()) >= 0)) return { icon: "🟢", text: "可达", detail: "Net.Coffee" };
  if (/access denied|forbidden|cloudflare|风控|身份验证|地区限制|not available|unsupported country|不可用|无法访问/i.test(h)) {
    return { icon: "🟠", text: "可达 · 网站限制", detail: "Net.Coffee" };
  }
  return null;
}

function combineAI(site, direct, service) {
  // Net.Coffee is preferred only when it provides a concrete server-rendered result.
  if (site) return site;
  return reachability(direct, service);
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

  // AI reachability: use both Net.Coffee's own detector page (when it exposes
  // a concrete result) and the actual product homepage. No OpenAI/Anthropic API
  // probe is used because an API auth failure does not prove consumer AI unlock.
  const probes = await Promise.all([
    request(URL.gptPage, node),
    request(URL.claudePage, node),
    request(URL.chatgpt, node),
    request(URL.claude, node)
  ]);

  const p = purity(info.fraudScore);
  const t = ipType(info, geo);
  const loc = countryLocation(info, geo);
  const gpt = combineAI(netCoffeePageResult(probes[0], "gpt"), probes[2], "ChatGPT");
  const claude = combineAI(netCoffeePageResult(probes[1], "claude"), probes[3], "Claude");

  return {
    node: node,
    ip: pub.ip || "获取失败",
    purity: p,
    type: t,
    location: loc,
    operator: text(info.asOrganization || info.isp || geo.isp || geo.organization || geo.org, "未知"),
    gpt: gpt,
    claude: claude,
    fraudScore: info.fraudScore,
    ipVersion: pub.ipVersion,
    time: new Date().toLocaleTimeString()
  };
}

function panelContent(d, note) {
  const lines = [
    "◉  代理策略  │ " + text(d.node, "未知"),
    "⌁  IP 地址   │ " + text(d.ip, "获取失败"),
    "✦  纯净度    │ " + d.purity.icon + " " + d.purity.text,
    "◌  IP 类型   │ " + d.type.icon + " " + d.type.text,
    "⌖  位置      │ " + d.location.text,
    "⌖  运营商    │ " + text(d.operator, "未知"),
    "",
    "◎  GPT       │ " + d.gpt.icon + " " + d.gpt.text,
    "✧  Claude    │ " + d.claude.icon + " " + d.claude.text,
    "",
    "风险值      │ " + (d.fraudScore === undefined ? "暂无" : d.fraudScore + "/100"),
    "检测时间    │ " + text(d.time, "未知")
  ];
  if (note) lines.push("", "ⓘ " + note);
  return lines.join("\n");
}

function notifySwitch(current, d) {
  const body = [
    "IP：" + d.ip,
    "纯净度：" + d.purity.icon + " " + d.purity.text,
    "IP 类型：" + d.type.icon + " " + d.type.text,
    "位置：" + d.location.text,
    "GPT：" + d.gpt.icon + " " + d.gpt.text,
    "Claude：" + d.claude.icon + " " + d.claude.text
  ].join("\n");
  $notification.post("节点已切换", current, body, {"auto-dismiss": false, "sound": true});
}

function cachedPanel(node) {
  const old = stateRead();
  if (old.group !== CFG.group || old.node !== node || !old.data) return null;
  return old.data;
}

async function runPanel() {
  const node = getSelectedNode(CFG.group);
  if (!node) {
    return finishPanel("节点 AI 检测", "⚠️ 找不到策略组\n\n策略组：" + CFG.group + "\n\n请在模块参数中填写实际的 Surge 策略组名称。", "error", "exclamationmark.triangle");
  }

  const old = stateRead();
  const cached = cachedPanel(node);

  // Same node: never re-run any network detector. Return the cached result.
  if (cached) {
    return finishPanel("节点 AI 检测", panelContent(cached, "当前节点未变化 · 未执行网络检测"), cached.purity.style, "network.badge.shield.half.filled");
  }

  try {
    const d = await fullDetect(node);
    const changed = !!old.node && (old.group === CFG.group) && old.node !== node;
    stateWrite({group: CFG.group, node: node, data: d, updated: Date.now()});

    // With cron removed, this notification is emitted when the panel discovers
    // that the selected policy has changed. There is no background polling.
    if (changed) notifySwitch(node, d);

    const note = changed ? "检测到节点已变化 · 已执行检测并提醒" : "首次检测 · 已建立缓存";
    return finishPanel("节点 AI 检测", panelContent(d, note), d.purity.style, "network.badge.shield.half.filled");
  } catch (e) {
    return finishPanel("节点 AI 检测", "⚠️ 检测异常\n\n" + text(e && e.message, String(e)), "error", "exclamationmark.triangle");
  }
}

(async function () {
  try {
    // v4 deliberately has no watch/cron mode. This avoids background polling
    // and the repeated battery warning caused by periodic scripts.
    return await runPanel();
  } catch (e) {
    return finishPanel("节点 AI 检测", "⚠️ 检测异常\n\n" + text(e && e.message, String(e)), "error", "exclamationmark.triangle");
  }
})();
