# Surge-Node-AI-Detector

Surge 节点 IP 纯净度 + IP 类型 + 地理位置 + ChatGPT / Claude 可用性检测面板。

## 安装

将 `Surge-Node-AI-Detector.sgmodule` 与 `Surge-Node-AI-Detector.js` 放入你的 GitHub 仓库 `Anymoice/surge` 的 `main` 分支根目录，然后在 Surge 中添加：

`https://raw.githubusercontent.com/Anymoice/surge/main/Surge-Node-AI-Detector.sgmodule`

模块默认策略组为 `Proxy`。如果你的实际策略组不同，在模块参数中修改「策略组」。

## 显示

◉ 代理策略 / ⌁ IP 地址 / ✦ 纯净度 / ◌ IP 类型 / ⌖ 位置 / ◎ GPT / ✧ Claude

每项独立一行；面板每 60 秒更新一次。

## 数据源

- IPPure `https://my.ippure.com/v1/info`
- Net.Coffee `https://ip.net.coffee/api/geoip/{IP}`
- ChatGPT `https://chatgpt.com/`
- OpenAI API `https://api.openai.com/`
- Claude `https://claude.ai/`
- Anthropic `https://anthropic.com/`

所有检测请求通过 Surge `$httpClient` 并显式指定当前选中策略，因此会跟随当前节点。

## 节点切换通知

模块每分钟检查一次策略组当前选中节点。节点从 A 切换到 B 后，Surge 会发送系统通知，并带上新节点、IP、位置、纯净度、GPT、Claude 状态。首次运行仅建立基线，不通知。

## 纯净度算法

IPPure 的 `fraudScore` 是风险值，越低越好。本模块用 `100 - fraudScore` 显示一个便于阅读的“纯净度”分数；它是派生显示值，不是 IPPure 官方独立字段。

## AI 状态

`2xx/3xx` 视为可用；`401/403/429` 表示网络可达但受限/需要验证；`5xx` 表示服务异常；超时或连接错误表示不可用。AI 状态属于网络可达性检测，不等于账号登录状态。
