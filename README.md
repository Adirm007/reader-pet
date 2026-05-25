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
- 本机能力设置页
- MCP server 配置、tool allowlist、resources / prompts 诊断与 HTTP transport 配置
- MAA 任务配置 UI、脚本资产路径配置与试运行
- 桌面自动化动作队列 dry-run / run / stop
- 能力运行态可视化与可信 emergency stop 反馈
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
4. Semantic facts：谓词形式的稳定事实，支持 `single` / `set` 两种 cardinality
   - `single`：同 predicate+subject 只保留一个 active object，新值会 supersede 旧值（如 `current_project`）
   - `set`：同 predicate+subject 可保留多个 active object（如 `likes` / `dislikes` / `interests` / `boundaries` / `ongoing_projects` / `writing_themes`）
5. Task log：Claude Code 任务汇报记录，可标为 routine/candidate/promoted

额外包含：

- conversation summaries（带 `status` 与 `recall_policy`，聊天召回只取 active + always/on_topic）
- daily digest：按 episode range 覆盖情况补写日记式摘要，不用“今天是否写过”这种粗粒度 flag；可每日定点归纳，也可启动时按未覆盖 episode 数量自动补归纳
- important digest：每轮默认只写 episode；只有命中“记住 / 别忘 / 以后 / 不要再 / 你记错了 / 这很重要 / 称呼与边界变化”等本地触发时，才即时整理长期事实或重要摘要
- memory jobs（有限退避自动重试 30s/2m/10m，启动时回收 stale running，避免卡死；重试耗尽后会通过桌宠气泡提示失败的 job 类型与错误摘要）
- memory sources（每条长期记忆都可追溯到原始 episode/任务来源）
- graph sync state：记录 SQLite 记忆与 Neo4j 投影同步状态
- 可选 Neo4j 图记忆写入 / 召回；删除摘要、撤回/删除事实时会同步清理或标记图谱关系，设置页支持重建图谱投影
- 可选 digestion worker，用当前 Provider 做 daily / important 摘要与事实抽取；开启后也不会把每轮普通对话都送去 digest
- 可选 embedding 向量索引与向量召回：
  - 单独配置 embedding provider + model（默认复用激活 Provider）
  - SQLite BLOB 存归一化向量，JS 余弦扫描，不引入原生依赖
  - digest 完成后自动为新 fact/summary 生成 embedding
  - 设置页支持 "补齐向量索引" 一键回填
  - 默认召回更多候选，降低向量分数阈值，方便交给后续精排过滤
- 可选 Reranker 精排：
  - 对向量召回候选调用用户配置的 rerank HTTP endpoint
  - 支持自定义 URL、API Key、model、top K 与最低精排分数
  - 召回上下文会同时标出 rerank score 与 vector score，便于调试
- 聊天召回是 intent-aware：显式回忆 / 任务相关 / 个人事实 / 寒暄等不同意图走不同召回路径，避免无脑塞 30 条事实
- facts、summaries、vector recall 与 episode search 会按 global / persona / project scope 过滤，避免不同人格或项目的记忆串线
- Profile 设置页只维护用户手写的基础事实；自动沉淀的 semantic facts、conversation summaries 和任务记忆统一在记忆系统页管理

Neo4j、digestion、embedding、向量召回、Reranker 精排均默认关闭，需要时在设置页打开。每日定点归纳和启动补归纳开关属于 memory 配置，只有在 digestion 可用且已配置 Provider 时才会实际入队。记忆设置页支持手动“检查并补写日记摘要”，它只会为未覆盖的 episode range 入队 daily digest，不会删除原始历史。

### Claude Code 集成

Reader Pet 可以和 Claude Code 协作：

- 通过 `claude -p <task>` 把工程任务派发给 Claude Code CLI
- 运行本地 hook bridge，默认监听 `127.0.0.1:7711`
- 安装 / 卸载 Claude Code `Stop` hook
- 接收 Claude Code 任务完成事件
- 读取 transcript 尾部并用当前人设总结
- 通过桌宠气泡向用户汇报
- 将任务结果写入本地任务日志
- 在本机能力设置页编辑 Playwright MCP、通用 MCP、MAA、CLI-Anything 与桌面自动化配置，并进行试运行 / 诊断

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
- 浏览器访问 / 自动化：优先通过 Playwright MCP，已提供 goto / snapshot / click / type / press key / wait / screenshot，以及批量表单填写、select 选择、checkbox/radio 设定、文件上传、显式提交、下载委托和多标签操作等高级封装
- 进程列表 / 基础内存读写 / 有限扫描
- MCP stdio / HTTP server 工具调用、resources 读取、prompts 获取
- MAA / MaaFramework CLI Adapter、任务配置、资产路径配置与设置页试运行
- CLI-Anything 风格结构化外部工具 Adapter scaffold
- 桌面自动化 PowerShell provider MVP 与动作队列
- Claude Code 任务派发
- 对话记忆检索 / 写入 / 撤回
- emergency stop UI、运行态展示与 Adapter stop hook
- MCP server tool allowlist

浏览器自动化、MCP、MAA/MaaFramework、CLI-Anything、桌面自动化、进程内存读写等高风险能力默认关闭，需要危险模式 + 对应独立开关。当前 MAA、CLI-Anything、MCP 与桌面自动化已经具备自用 MVP 闭环，但不自动安装外部依赖，也不承诺陌生环境开箱即用。

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

emergency stop 已接入设置页按钮、运行态展示与 Adapter `stop()` 调用链。当前 MAA、CLI-Anything、MCP、浏览器 MCP、屏幕观察、内存扫描、桌面自动化动作队列等能力已提供停止逻辑。后续新增长期运行能力（例如视频观察）时必须实现真实 stop hook。

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

预览运行：

```bash
npm start
```

`npm start` 会清理父进程继承的 `ELECTRON_RUN_AS_NODE` 环境变量后再启动 `electron-vite preview`，避免 Electron 主进程被错误当成 Node 进程加载。

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
- Embedding Provider 与模型名
- Reranker URL、API Key、模型名、Top K 与最低分数
- 安全模式文件白名单
- Shell 白名单
- 桌宠精灵图包
- 立绘路径
- MAA 命令、工作目录、资产目录、任务配置、默认 task 与额外参数
- MCP server transport、stdio 命令、HTTP URL、headers、tool allowlist
- 桌面自动化 provider 与动作队列测试 JSON

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

- Playwright MCP：浏览器能力通过用户配置的本地 MCP 命令调用；不自动安装。高级封装依赖 MCP server 暴露 navigate / snapshot / click / type / press key / wait / screenshot / form / upload / download / tabs 等工具，缺失时会报告可用工具列表。下载、多标签、上传等能力不会自动模拟或安装外部依赖。
- `memoryjs`：进程内存读写相关，偏 Windows，可能触发杀软警报。
- MAA / MaaFramework：游戏自动化可选，需要用户自行配置本地命令、工作目录、资产目录、任务配置和默认 task；设置页提供试运行与运行态反馈。
- CLI-Anything：结构化外部工具可选，需要用户自行配置本地命令。当前固定 v1 one-shot JSON stdin/stdout 协议：应用向 stdin 写入 `{ version: 1, input, schema }`，外部 CLI 应在 stdout 返回 JSON object，推荐 `{ ok: true, result }` 或 `{ ok: false, error }`。需要工具发现、长期会话、流式输出或复杂 allowlist 时优先使用 MCP。
- MCP 插件：长期插件优先采用 MCP server。Reader Pet 负责配置、启动/连接、握手、列举 tools/resources/prompts、tool allowlist、调用与 emergency stop；插件作者负责提供本地 server 命令或 HTTP endpoint，不由 Reader Pet 自动安装第三方依赖。
- 桌面自动化 provider：当前已有 PowerShell provider MVP，支持 JSON 动作队列 dry-run / run / stop；真实 run 会操作当前桌面。`nutjs` 仍只是预留选项。
- Neo4j：图记忆可选，不配置则不启用；SQLite 是权威记忆库，Neo4j 只是可重建的图谱投影。
- GPT-SoVITS：TTS 可选，需要用户自行启动服务。
- Claude Code：工程任务派发与 Stop hook 需要本机安装 Claude Code CLI。

## MCP 长期插件标准

MCP 是本项目后续长期插件的主路径，适合需要工具发现、多工具组合、长期 server 状态或复杂权限控制的能力。CLI-Anything 只保留为轻量 one-shot 外部命令入口。

### 插件配置

每个 MCP 插件以一个 server 配置存在：

- `id`：稳定唯一标识，建议只用小写字母、数字、短横线或下划线
- `displayName`：设置页显示名
- `transport`：`stdio` 或 `http`；旧配置未填写时按 `stdio` 处理
- `command`：stdio server 可执行命令或脚本路径
- `args`：stdio 启动参数，每行一个
- `cwd`：stdio 可选工作目录
- `url`：HTTP MCP endpoint
- `headers`：HTTP 请求 headers JSON object
- `enabled`：是否启用该 server
- `riskLevel`：`medium` / `high` / `critical`
- `allowedTools`：允许调用的 tool 名称列表
- `allowAllTools`：允许调用全部 tools，仅用于完全信任的本地 server

配置只保存本机路径和参数，不内置公共插件市场，也不自动下载插件。插件需要环境变量、账号、浏览器 profile、模型 key 等敏感配置时，应由插件自己的本地配置或用户环境变量管理，不写入 Reader Pet 预置值。

### 运行协议

Reader Pet 当前支持两类 MCP 连接：

1. stdio：用 `command + args + cwd` 启动子进程，通过 MCP frame (`Content-Length: ...`) 发送 JSON-RPC 请求。
2. HTTP：向配置的 `url` 发送 JSON-RPC POST 请求，并附带用户填写的 headers。

初始化时使用 `protocolVersion: 2024-11-05`。当前已接入：

- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`
- `prompts/list`
- `prompts/get`

stdio 子进程 stderr 只作为诊断信息保留；emergency stop 会终止已启动的 stdio MCP server 子进程，并拒绝未完成请求。HTTP transport 当前是最小实现，不包含 OAuth、复杂 session 管理或完整 streaming 语义；sampling 也尚未纳入承诺范围。

### Tool 约定

插件暴露给 Reader Pet 的 tool 应满足：

- tool name 稳定，不随展示语言变化
- description 明确写出副作用、风险、是否会访问网络或修改本机状态
- inputSchema 使用普通 JSON Schema object，尽量避免过深嵌套
- 返回值应是可 JSON 序列化对象，推荐 `{ ok: true, result }` 或 `{ ok: false, error }`
- 长任务应支持插件自身取消或可被进程终止安全打断
- destructive / external-visible 动作应设计显式确认参数，例如 `confirmPhrase`

Reader Pet 会在调用前检查全局 MCP 开关、危险模式和 server tool allowlist；它不会理解插件内部所有业务风险。因此高风险 tool 必须在插件 schema 与 description 里自描述清楚。

### 安全边界

MCP 插件默认视为高风险本机能力：

- 安全模式下不可用
- 危险模式下仍需单独开启 MCP 插件开关
- 默认不允许调用未加入 allowlist 的 tool
- `allowAllTools` 只适合完全信任、自己写或自己审过的 server
- allowlist 只限制 tool 调用，不保证 server 启动本身无副作用
- 插件不得假设 Reader Pet 会替它做外部账号、文件路径、网页动作或付款/发送等业务确认

建议把 MCP 插件分成小而明确的 server：例如“浏览器读取”和“浏览器写操作”拆开，比一个全能 critical server 更容易审计和启停。

### 插件开发检查清单

接入一个新 MCP 插件前，至少确认：

- `tools/list` 能稳定返回工具列表
- 如使用 resources/prompts，`resources/list`、`resources/read`、`prompts/list`、`prompts/get` 能返回清晰结果或明确 unsupported
- 每个 tool 都有明确 schema、description 和风险说明
- 默认配置只启用必要 tools，不勾选 `allowAllTools`
- 启动失败、超时、stderr、tool error 都能给出可读错误
- 长任务可以被 emergency stop 打断，打断后不会留下危险半完成状态
- 不把 token、cookie、API key 写进 README、默认配置或日志
- 涉及文件写入、外部发送、支付、删除、账号操作的 tool 有二次确认参数

## 当前路线

短期路线：

- Playwright MCP 浏览器能力：已接入配置式 MCP 调用、设置页命令编辑、tools 诊断与 goto / snapshot / click / type / press key / wait / screenshot、表单填写、select、checked 状态、文件上传、显式提交、下载委托、多标签操作等高级封装；后续按真实 MCP server 差异继续打磨
- 屏幕观察能力：已支持屏幕源列表和有限帧观察；后续再评估视频观察
- 通用进程内存读写：已接入基础 read/write/scan 与扫描运行态；后续按真实 memoryjs 环境继续打磨
- MAA / MaaFramework：已接入 CLI Adapter、真实任务配置 UI、资产目录 / 任务配置路径、默认 task、extra args、设置页试运行与 stop；后续按真实 MAA 参数继续打磨任务模板和脚本资产管理体验
- CLI-Anything：已固定 v1 one-shot JSON stdin/stdout 协议，支持 command + args 配置，并提供 fixture 与设置页试运行验证；复杂长期工具仍建议使用 MCP
- MCP 长期插件标准：已支持 stdio / HTTP server 配置、tools、resources、prompts、tool allowlist、运行协议、安全边界与插件开发检查清单；后续再评估 OAuth、streaming、sampling 与更细的 server 管理
- 桌面自动化：已接入 PowerShell provider MVP 与 JSON 动作队列，支持 dry-run / run / stop；后续再评估 nutjs、窗口选择、图像识别和更安全的动作确认
- emergency stop：已接入设置页按钮、运行态可视化与 Adapter `stop()` 调用链；后续补全新增长任务的真实 stop hook
- 记忆写入工作流：已改为每轮只写 episode，重大内容走 important digest，本地未覆盖历史走 daily digest range 补写；后续再做隐藏候选、待复核视图和更严格的图谱召回隔离

## 许可证

MIT
