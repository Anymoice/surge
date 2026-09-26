# surge

个人 Surge 模块合集。

## 📦 IP 纯净度 & AI 解锁检测

一个 Surge 面板模块，检测当前出口 IP 的纯净度 / 风险评分，以及 ChatGPT、Claude、Gemini 的区域解锁情况。

### 效果

- **IP 纯净度检测**：纯净度分级、IP 地址、IP 类型（住宅 / 机房）、ASN、国家与城市（带国旗）
- **AI 解锁检测**：出口 IP 地址、国家与城市（带国旗），以及 ChatGPT / Claude / Gemini 三家服务的可用状态

### 订阅方式

在 Surge 中添加模块，URL 填入：

```
https://raw.githubusercontent.com/Anymoice/surge/main/IP-AI-Detect.sgmodule
```

添加后，在 Surge 首页「面板」中即可看到「IP 纯净度」与「AI 解锁」两块面板，下拉可手动刷新。

### 目录结构

```
surge/
├── IP-AI-Detect.sgmodule      # 模块主文件
└── Scripts/
    ├── ip-purity.js            # IP 纯净度检测脚本
    └── ai-unlock.js            # AI 解锁检测脚本
```

### 数据来源与说明

- IP 信息来自 [ippure.com](https://ippure.com) 公开接口 `https://my.ippure.com/v1/info`（该接口目前处于测试阶段，字段可能变动）
- AI 解锁状态基于各服务在受限地区的公开响应特征（HTTP 状态码、返回体关键字）进行启发式判断，**仅供参考**，不代表官方数据；遇到风控 / 机器人拦截时会标注「未知」而非武断判定为「不可用」，以降低误判概率
- 若判断结果与实际不符，欢迎提 Issue 并附上你的节点信息，便于校准判定条件

### License

MIT
