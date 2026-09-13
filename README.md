# Surge-Node-AI-Detector v4

用于 Surge iOS / macOS 的节点 IP 与 AI 可达性检测模块。

## v4 核心改动

### 1. 彻底取消后台自动刷新

- 删除 cron 脚本。
- 不再每 5 分钟、每 10 分钟或其他周期后台运行。
- 不再后台访问 IPPure、Net.Coffee、ChatGPT、Claude。
- 这样可以避免 Surge 因脚本周期运行而反复提示耗电。

Surge 官方文档说明，cron 脚本属于定时执行机制，并且每小时运行超过 10 次会触发电量消耗提示；v4 直接移除 cron，从机制上消除这类后台轮询。 

### 2. 同一节点绝不重复检测

面板脚本每次运行首先读取当前策略组的选中节点：

- **节点没有变化**：直接读取缓存，不执行任何网络检测。
- **第一次使用**：检测一次并建立缓存。
- **节点从 A → B**：执行一次完整检测，保存结果并发送一次“节点已切换”通知。
- **B → B 再次刷新**：不检测、不通知。

因此 v4 的“刷新”不会导致重复检测。

> 注意：Surge 目前没有一个“select 策略组选中节点发生变化”的通用事件钩子。官方事件脚本提供 network-changed、notification、engine-started、profile-reloaded 等事件，但没有 policy-selected-changed。select 策略组本身也不会因为选择变化而产生自动通知。因此，在“完全禁止后台轮询”的前提下，Surge 无法在你切换节点的瞬间自动感知并推送通知。
>
> v4 采用的折中方案是：**节点变化后，你下一次打开/刷新本模块面板时，模块立即发现 A → B，才执行完整检测并通知；在此之前完全没有后台检测。**

### 3. AI 可达性检测重新设计

不再检测 OpenAI API / Anthropic API。

原因是：API 返回 401 / 403 并不能证明 ChatGPT / Claude 消费者网页不可用；它可能只是 API 需要认证或触发风控。v4 更直接地测试用户实际使用的网页入口：

- ChatGPT：`chatgpt.com`
- Claude：`claude.ai`
- 同时尝试读取 Net.Coffee 的 GPT / Claude 检测页；只有页面本身返回了明确结果时才采用其结果。

状态含义：

- 🟢 **可达**：网页入口 HTTP 成功到达。
- 🟡 **可达 · 需登录**：服务已到达，但要求登录。
- 🟠 **可达 · 风控/验证**：服务已到达，但被安全验证/风控拦截。
- 🟠 **可达 · 限流**：服务已到达，但被限流。
- 🔴 **不可达**：请求无法建立或服务不可访问。
- ⚪ **无法确认**：响应不足以做出可靠判断。

这比把 API 401/403 直接当成“AI 不可用”更符合“检测 AI 可达性”的目标。

### 4. 排版重新调整

所有项目统一采用：

`图标 → 标题 → 分隔线 → 内容`

例如：

```text
◉  代理策略  │ XunShanYun
⌁  IP 地址   │ 209.9.201.229
✦  纯净度    │ 🟡 一般 · 52/100
◌  IP 类型   │ 🟢 住宅 IP
⌖  位置      │ 🇭🇰 Hong Kong SAR China · Tung Chung
⌖  运营商    │ PCCW Global (HK) Limited

◎  GPT       │ 🟢 可达
✧  Claude    │ 🟢 可达

风险值      │ 48/100
检测时间    │ 2:53:01 PM
```

运营商已经移动到位置之后，并删除 OpenAI API、Anthropic 两行。

### 5. IP 显示策略

优先显示**数字 IPv4**：

1. IPPure 返回 IPv4 → 直接使用。
2. IPPure 不是 IPv4 → 通过 `api.ipify.org` 获取 IPv4。
3. IPv4 不可用 → 再退回 IPv6。

这样可以尽量避免显示域名或其他非数字地址。

## 数据源

- IPPure：IP、风险值、住宅/机房属性、地理信息。
- Net.Coffee GeoIP：位置/运营商备用信息。
- api.ipify.org：IPv4 备用出口检测。
- api6.ipify.org：IPv6 最终备用。
- ChatGPT / Claude：实际网页入口可达性。
- Net.Coffee GPT / Claude 页面：仅在能读取到明确结果时作为辅助判断。

Net.Coffee 的网络连通性页面说明，其 AI/全球连通性测试主要在浏览器本地直接向目标站点发起轻量请求，因此 v4 不把一个无法执行浏览器端 JavaScript 的服务器页面当成绝对可靠的“AI 解锁 API”。

## 安装

上传以下两个文件到 GitHub 仓库 `Anymoice/surge` 的 `main` 分支根目录：

- `Surge-Node-AI-Detector.sgmodule`
- `Surge-Node-AI-Detector.js`

然后在 Surge 中添加：

```text
https://raw.githubusercontent.com/Anymoice/surge/main/Surge-Node-AI-Detector.sgmodule
```

默认策略组参数为 `Proxy`。

如果你的实际策略组不是 Proxy，在模块参数里改成实际策略组名称。

## 使用方式

### 第一次使用

打开模块面板 → 自动检测当前节点 → 建立缓存。

### 切换节点后

切换到新节点 → 打开/刷新模块面板 → 模块发现节点发生变化 → 执行检测 → 推送一次“节点已切换”通知。

### 节点没有变化

无论你刷新多少次：

- 不访问 IPPure
- 不访问 Net.Coffee
- 不访问 ChatGPT
- 不访问 Claude
- 不发送通知

只显示上一次缓存结果。
