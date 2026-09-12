# Surge-Node-AI-Detector

Surge 节点 IP / AI 可用性检测模块。

## 本版更新

1. **Panel 排版重做**：不再在内容区重复显示大标题，正文改为统一的 `项目 │ 内容` 对齐布局。
2. **代理策略显示完整节点名**：读取 `$surge.selectGroupDetails().decisions`，显示当前策略组实际选中的节点，而不是策略组名。Surge 官方脚本 API 提供该字段。 
3. **IP 增强容错**：优先 IPPure；如果 IPPure 没有返回 IP，则通过 `api.ipify.org` / `api6.ipify.org` 进行备用获取。
4. **纯净度增加状态图标**：🟢 / 🟡 / 🟠 / 🔴。
5. **IP 类型增加状态图标**：🟢 住宅、🔵 机房、🟠 广播、⚪ 未知。
6. **Claude 检测改为双探针**：同时检查 `claude.ai` 与 `api.anthropic.com`，不再把单纯的 HTTP 403 直接判定成“不可达”。403 会显示为“网络可达 · 风控/验证”，401 为“需登录”，429 为“限流”。
7. **省电逻辑重做**：不再每分钟做 6 个网络请求。后台每 5 分钟只读取一次 Surge 当前策略组选择；只有发现节点从 A 切换到 B，才执行一次完整检测并推送 App 通知。面板则只在你主动打开时检测。

## 为什么 Claude 会显示“网络可达 · 风控/验证”

`claude.ai` 的网页入口可能经过登录、Cloudflare/安全验证或其他保护层，因此脚本拿到 HTTP 403 并不等于“Claude 网络不可达”。本版同时探测 `api.anthropic.com`，并区分：

- 🟢 可用 / API 可用
- 🟡 网络可达 · 需登录
- 🟠 网络可达 · 风控/验证
- 🟠 网络可达 · 限流
- 🔴 不可达

如果网页端和 API 端都被 403，模块只能准确告诉你“线路已经到达 Anthropic，但被服务端拒绝/要求验证”；这类限制通常与出口 IP 信誉、地区、DNS/IPv6、代理分流、登录状态或风控有关，模块本身不能绕过 Anthropic 的服务端限制。

## 省电说明

Surge 当前脚本 API 可以读取策略组当前选中的策略，但没有一个专门的“策略组选中节点发生变化”事件钩子。因此本模块采用**低频轻量轮询**：每 5 分钟只读取本地策略选择，不访问 IPPure、Net.Coffee、Claude 或 OpenAI。

只有检测到节点发生变化时，才进行完整网络检测并发送一次通知。Surge 官方文档也说明 cron 每小时运行超过 10 次会触发电量消耗提示，因此本版默认使用每 5 分钟一次，而不是每分钟一次。

## 安装

将下面两个文件上传到你的 GitHub 仓库 `Anymoice/surge` 的 `main` 分支根目录：

- `Surge-Node-AI-Detector.sgmodule`
- `Surge-Node-AI-Detector.js`

然后在 Surge 中添加模块：

```text
https://raw.githubusercontent.com/Anymoice/surge/main/Surge-Node-AI-Detector.sgmodule
```

默认策略组参数为 `Proxy`。

如果你实际使用的策略组不是 `Proxy`，在模块参数里把“策略组”改成实际名称，例如 `🚀 节点选择`。

## 显示内容

```text
代理策略  │ 美国｜洛杉矶｜XXX
IP 地址   │ 1.2.3.4
纯净度    │ 🟢 极佳 · 98/100
IP 类型   │ 🔵 机房 IP
位置      │ 🇺🇸 United States · California · Los Angeles
GPT       │ 🟢 可用
Claude    │ 🟢 可用
```

## 数据源

- IPPure：IP、风险值、住宅/机房属性、地理信息
- Net.Coffee GeoIP：IP 地理信息备用来源
- api.ipify.org / api6.ipify.org：IPPure 无法返回 IP 时的备用 IP 获取
- ChatGPT / OpenAI API：GPT 网络可达性
- Claude / Anthropic API：Claude 网络可达性

> 纯净度显示为 `100 - IPPure fraudScore` 的派生分数，不是 IPPure 单独提供的另一项官方评分。


## v3 更新说明

- 恢复 `◉ / ⌁ / ✦ / ◌ / ⌖ / ◎ / ✧` 七项主指标图标，并使用全角空格对齐标题与内容。
- GPT / Claude 检测改为**优先请求 Net.Coffee 官方检测页面**并尝试读取页面返回的检测结果；如果页面没有返回动态结果，再回退到 ChatGPT/OpenAI 与 Claude/Anthropic 直接连通性检测。
- 这比单纯把 HTTP 403/429 等状态码直接当成“不可用”更合理；但 Net.Coffee 页面部分结果是浏览器 JavaScript 动态生成的，Surge 的 HTTP 脚本无法保证拿到浏览器执行后的 DOM，因此 v3 不会伪造结果：拿不到官方页面的具体结果时会明确显示“无法确认/网页可达”，而不是误报。
- Surge 脚本声明使用 `engine=webview`，因为 WebView 支持 WebAPI；官方文档也说明 WebView 适合复杂脚本。
- 节点监听仍然只比较策略组当前选中的节点，只有节点发生变化才执行完整网络检测并推送通知；没有变化时不访问 IPPure、Net.Coffee、OpenAI 或 Anthropic。
