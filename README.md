# Reader Pet · 九十九夜梦

居住在作家设备中的读者

> 「请不要在意我，尽管按照您的心意去书写吧。无论是喜悦还是悲伤，是平淡还是激昂，只要是您亲手编织的未来，我都会认真地阅读下去。」

本项目不是面向大众的通用产品，而是完全个人化本地桌面助手。当前尚在开发阶段，设计目标也不是“低风险的聊天机器人”。不推荐除仓库所有者外任何人安装。

## 当前状态

当前具备：

- Electron + React 桌宠窗口
- 设置窗口与全屏面板
- 多 API Provider 聊天
- 四套人设
- 本地长期记忆
- Claude Code 任务桥接
- 安全模式 / 危险模式
- 本机能力层与能力注册表
- 可选 TTS
- 可选 Neo4j 图记忆
- 桌宠精灵图包
- 主动来信 / 主动搭话

版本仍是 `0.1.0`，很多能力属于自用 MVP：能用，但并不承诺对陌生环境开箱即用。

## 功能概览

### 桌宠与面板

- 透明、置顶、可拖拽的桌宠窗口
- 点击桌宠进行对话
- 全屏面板显示立绘、聊天记录、设置入口等
- 支持静态立绘资源：`.png` / `.jpg` / `.jpeg` / `.gif` / `.webp`
- 内置 `yomeko` 图包，但仅占位，待后续优化
- 支持 hatch-pet 风格 spritesheet atlas
- 桌宠状态：`idle` / `talk` / `think` / `happy` / `sleep` / `failed`

Live2D `.model3.json` 目前还没有接入，只预留了配置槽。

### 人设

当前内置四套人设：

- 读者
- 心爱的少女
- 开朗的少女
- 怪人

人设定义在 `src/shared/personas.yaml`。设置页可以切换当前人设。

### Provider

支持三类模型提供方：

- OpenAI-compatible API
- Anthropic Messages API
- Gemini API

### 记忆系统

当前记忆系统以本地 SQLite 为核心，包含：

1. Profile：用户资料与偏好
2. Recent window：进程内近期对话窗口
3. Episode log：对话片段日志，支持 FTS5 检索
4. Semantic facts：谓词形式的稳定事实
5. Task log：Claude Code 任务汇报记录

额外包含：

- conversation summaries
- memory jobs
- memory sources
- graph sync state
- 可选 Neo4j 图记忆写入 / 召回
- 可选 digestion worker，用当前 Provider 做摘要与事实抽取

Neo4j 默认关闭，需用户自行配置地址、账号和密码。

### Claude Code 集成

Reader Pet 可以和 Claude Code 协作：

- 通过 `claude -p <task>` 把工程任务派发给 Claude Code CLI
- 运行本地 hook bridge，默认监听 `127.0.0.1:7711`
- 安装 / 卸载 Claude Code `Stop` hook
- 接收 Claude Code 任务完成事件
- 读取 transcript 尾部并用当前人设总结
- 通过桌宠气泡向用户汇报
- 将任务结果写入本地任务日志

能力有限，故工程类能力原则上优先交给 Claude Code，而不是在桌宠本体里重复搓一个 IDE agent。

### 能力层

能力层已经改为注册表结构。每个能力 Adapter 可以提供：

- UI 展示用 descriptor
- LLM tool schema
- tool invoke 实现
- 安装 / 可用状态
- 调试用 direct action
- 可选 emergency stop hook

当前已接入能力包括：

- 文件读取
- 文件写入
- 目录列举
- 路径 stat
- Shell / PowerShell 命令执行
- 屏幕截图
- 屏幕源列表 / 有限帧屏幕观察
- 浏览器访问 / 自动化：优先通过 Playwright MCP
- 进程列表 / 基础内存读写 / 有限扫描
- MCP stdio server 工具调用
- MAA / MaaFramework CLI Adapter scaffold
- CLI-Anything 风格结构化外部工具 Adapter scaffold
- 桌面自动化 Adapter scaffold
- Claude Code 任务派发
- 对话记忆检索 / 写入 / 撤回
- emergency stop UI 与 Adapter stop hook

浏览器自动化、MCP、MAA/MaaFramework、CLI-Anything、桌面自动化、进程内存读写等高风险能力默认关闭，需要危险模式 + 对应独立开关。当前 MAA / CLI-Anything / 桌面自动化仍是可配置 Adapter scaffold：能进入能力清单、状态检测、按固定命令调用或明确失败，但不自动安装外部依赖。

### 安全模式与危险模式

默认安全模式。

安全模式下：

- 文件读写限制在白名单目录
- Shell 命令限制在白名单首词
- 截屏默认需要弹窗确认
- 浏览器自动化、MCP、MAA、CLI-Anything、桌面自动化不可用
- 进程内存读写不可用
- 连续屏幕观察默认不可用，除非单独开启且弹窗确认

危险模式下：

- 可读写任意当前用户可访问路径
- 可执行任意 shell / PowerShell 命令
- 浏览器自动化仍需单独勾选启用，并配置 Playwright MCP 命令
- MCP、MAA、CLI-Anything、桌面自动化仍需单独勾选启用
- 进程内存读写仍需单独勾选启用
- 切换危险模式需要 10 秒阅读倒计时 + 二次确认

危险模式是给个人自用场景准备的高权限模式。它可以造成文件损坏、配置覆盖、隐私泄漏、误执行命令、杀软警报等后果。除非完全理解自己在做什么否则不要开启。

当前 registry 已有 emergency stop skeleton，但只有实现了 `stop()` 的 Adapter 才能被真正中断。长期运行的 MAA、桌面自动化、视频观察等能力接入时必须实现 stop hook。

### TTS

支持可选 GPT-SoVITS HTTP TTS。

默认地址：

```text
http://127.0.0.1:9880
```

用户需自行运行 GPT-SoVITS 服务，并在设置里配置参考音频、参考文本、语言和语速。TTS 失败时不会阻塞主对话。

### 主动行为

支持：

- 每日来信
- 随机主动搭话

每日来信默认开启；主动搭话默认关闭。具体触发由本地定时器和当前配置决定。

## 开发环境

推荐环境：

- Windows 11
- Node.js / npm
- Electron 支持的桌面环境

安装依赖：

```bash
npm install
```

开发运行：

```bash
npm run dev
```

类型检查：

```bash
npm run typecheck
```

构建：

```bash
npm run build
```

预览构建产物：

```bash
npm run preview
# 或
npm start
```

打包 Windows x64 安装包：

```bash
npm run package
```

只生成 unpacked 目录：

```bash
npm run package:dir
```

## 配置

应用配置通过 `electron-store` 保存在本机，配置名为 `reader-pet-config`。

常见需要用户填写的配置：

- Provider 类型
- API Base URL
- API Key
- 模型名
- Claude Code CLI 路径
- Claude Code hook bridge 端口
- GPT-SoVITS 地址与参考音频
- Neo4j 地址、账号、密码
- 安全模式文件白名单
- Shell 白名单
- 桌宠精灵图包
- 立绘路径

默认安全工作目录是：

```text
~/reader-pet-workspace
```

## 目录结构

```text
src/main/                  Electron 主进程
src/main/capabilities/     本机能力 Adapter 与 registry
src/main/providers/        模型 Provider Adapter
src/main/memory/           SQLite / digestion / graph memory
src/main/claude-code-*     Claude Code hook 与 bridge
src/preload/               contextBridge API
src/renderer/src/pet/      桌宠窗口 UI
src/renderer/src/panel/    全屏面板
src/renderer/src/settings/ 设置窗口
src/shared/                跨进程共享类型与人设
resources/                 打包资源、精灵图、立绘等
```

## 可选依赖与限制

部分能力需要额外环境：

- Playwright MCP：浏览器能力通过用户配置的本地 MCP 命令调用；不自动安装。
- `memoryjs`：进程内存读写相关，偏 Windows，可能触发杀软警报。
- MAA / MaaFramework：游戏自动化可选，需要用户自行配置本地命令。
- CLI-Anything：结构化外部工具可选，需要用户自行配置本地命令。
- 桌面自动化 provider：当前只接入 Adapter scaffold，具体驱动需后续安装/实现。
- Neo4j：图记忆可选，不配置则不启用。
- GPT-SoVITS：TTS 可选，需要用户自行启动服务。
- Claude Code：工程任务派发与 Stop hook 需要本机安装 Claude Code CLI。

## 当前路线

短期路线：

- Playwright MCP 浏览器能力：已接入配置式 MCP 调用；后续补设置页命令编辑与更多高级工具封装
- 屏幕观察能力：已支持屏幕源列表和有限帧观察；后续再评估视频观察
- 通用进程内存读写：已接入基础 read/write/scan；后续按真实 memoryjs 环境继续打磨
- MAA / MaaFramework：已接入 CLI Adapter scaffold；后续补真实任务配置 UI 与脚本资产管理
- CLI-Anything：已接入结构化外部 CLI Adapter scaffold；后续验证真实工具协议是否稳定
- MCP 长期插件标准：已接入 stdio MCP server / tool 调用地基；后续补插件配置 UI 与低风险 allowlist
- 桌面自动化：已接入 Adapter scaffold；后续选择具体 provider 并实现动作队列
- emergency stop：已接入设置页按钮与 Adapter stop hook；后续补全所有长任务的运行态可视化

## 许可证

MIT
