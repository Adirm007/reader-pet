// 跨进程共享类型 (main / preload / renderer 均可 import)

export type ProviderType = 'openai-compatible' | 'anthropic' | 'gemini';

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
  embeddingModel?: string;
  extraHeaders?: Record<string, string>;
}

export interface UserProfile {
  preferredAddress: string;
  selfDescription?: string;
  customFacts: string[];
}

export type SafetyMode = 'safe' | 'danger';

export interface CapabilityFlags {
  // 安全模式下的限制 (危险模式全部忽略)
  fileReadAllowDirs: string[];
  fileWriteAllowDirs: string[];
  shellAllowList: string[];
  screenCaptureRequireConfirm: boolean;
  // 危险模式专属能力 (即便在危险模式下也要求各自单独开启)
  playwrightEnabled: boolean;       // 浏览器自动化 / Playwright MCP
  memoryRWEnabled: boolean;          // 游戏内存读写 (Cheat Engine 风格)
  mcpEnabled: boolean;               // 通用 MCP 插件
  maaEnabled: boolean;               // MAA / MaaFramework
  cliAnythingEnabled: boolean;       // CLI-Anything 风格结构化外部工具
  desktopAutomationEnabled: boolean; // 鼠标/键盘桌面自动化
  screenObservationEnabled: boolean; // 连续屏幕观察
}

export interface McpServerConfig {
  id: string;
  displayName: string;
  transport?: 'stdio' | 'http';
  command: string;
  args: string[];
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  riskLevel: 'medium' | 'high' | 'critical';
  allowedTools?: string[];
  allowAllTools?: boolean;
}

export type DesktopAutomationAction =
  | { type: 'click'; x: number; y: number; button?: 'left' | 'right' | 'middle' }
  | { type: 'typeText'; text: string }
  | { type: 'hotkey'; hotkey: string }
  | { type: 'wait'; ms: number };

export interface DesktopAutomationQueueRequest {
  actions: DesktopAutomationAction[];
  dryRun?: boolean;
  description?: string;
}

export interface AutomationConfig {
  playwrightMcpCommand: string;
  playwrightMcpArgs: string[];
  playwrightMcpCwd?: string;
  maaCommand: string;
  maaWorkingDir: string;
  maaAssetsDir: string;
  maaTaskConfigPath: string;
  maaDefaultTask: string;
  maaExtraArgs: string[];
  cliAnythingCommand: string;
  cliAnythingArgs: string[];
  cliAnythingWorkingDir: string;
  desktopAutomationProvider: 'none' | 'nutjs' | 'powershell';
}

export interface ClaudeCodeConfig {
  hookServerEnabled: boolean;
  hookServerPort: number;          // 127.0.0.1 绑定
  cliPath: string;                 // 留空 = 走 PATH
  reportInPersonaVoice: boolean;   // Stop hook 收到时是否用当前人设语气复述
}

export interface DailyLetterConfig {
  enabled: boolean;
  hour: number;                    // 0-23 大致时段(避免整点)
}

export interface ChatterConfig {
  enabled: boolean;
  minMinutes: number;
  maxMinutes: number;
}

export interface TTSConfig {
  enabled: boolean;
  baseUrl: string;            // 例如 http://127.0.0.1:9880
  // 透传 GPT-SoVITS /tts 的字段; 留空则用服务端默认
  refAudioPath: string;       // 参考音频本地绝对路径
  promptText: string;         // 参考音频文字
  promptLang: string;         // zh / en / ja / auto
  textLang: string;           // zh / en / ja / auto
  speedFactor: number;        // 0.6~1.4 比较常见
  // 是否对每条桌宠气泡都自动 TTS (false 时, 只对你点击的气泡播放)
  autoSpeakOnBubble: boolean;
}

export interface PanelConfig {
  // 全屏面板里的立绘槽 — 留绝对路径, 留空则只显示占位
  // 支持 .png / .jpg / .jpeg / .gif / .webp; .model3.json 暂不解析 (留作后续 Live2D Web SDK 接入)
  live2dModelPath: string;
}

// ============ 桌宠精灵图 (兼容 hatch-pet atlas 格式) ============
// hatch-pet 默认 9 行 x 8 列, 每格 192x208, 整图 1536x1872
// 行顺序 (Codex contract): 0 idle / 1 running-right / 2 running-left / 3 waving /
//                         4 jumping / 5 failed / 6 waiting / 7 running / 8 review
export type PetState =
  | 'idle'
  | 'talk'        // 默认映射: row=waving
  | 'think'       // 默认映射: row=running (非定向)
  | 'happy'       // 默认映射: row=jumping
  | 'sleep'       // 默认映射: row=waiting
  | 'failed';

export interface PetStateClip {
  row: number;          // 第几行 (0..rows-1)
  frames: number;       // 该行有效帧数 (1..cols), 透明 cell 不算
  fps: number;          // 播放帧率
  loop?: boolean;       // 默认 true
}

export interface PetSpritePackage {
  id: string;                       // 目录名
  displayName: string;
  description?: string;
  spritesheetPath: string;          // 相对包内, 通常 spritesheet.webp
  spritesheetDataUrl?: string;      // 主进程读完后填这里, 渲染端直接用
  cellWidth: number;                // hatch-pet = 192
  cellHeight: number;               // hatch-pet = 208
  cols: number;                     // hatch-pet = 8
  rows: number;                     // hatch-pet = 9
  clips: Record<PetState, PetStateClip>;
}

export interface PetSpriteConfig {
  // 当前选用的精灵图包 id; 空 = 用内置 SVG 占位
  activePackageId: string;
  // 默认 idle 时帧率回退 (clip.fps 优先)
  defaultFps: number;
  // 全局播放速度倍率, 0.3 ~ 1.5; 默认 0.6 (即放慢到 60%, 避免鬼畜)
  fpsMultiplier?: number;
}

export interface MemoryConfig {
  graphEnabled: boolean;
  neo4jUri: string;
  neo4jUser: string;
  neo4jPassword: string;
  graphWriteEnabled: boolean;
  graphRecallEnabled: boolean;
  digestionEnabled: boolean;
  graphRecallTimeoutMs: number;
  embeddingEnabled: boolean;
  embeddingProviderId?: string;
  embeddingModel: string;
  vectorRecallEnabled: boolean;
  vectorRecallLimit: number;
  vectorMinScore: number;
  embeddingBackfillBatchSize: number;
  rerankEnabled: boolean;
  rerankUrl: string;
  rerankApiKey: string;
  rerankModel: string;
  rerankTopK: number;
  rerankMinScore: number;
}

export interface AppConfig {
  providers: ProviderConfig[];
  activeProviderId: string | null;
  activePersonaId: 'reader' | 'shoujo' | 'genki' | 'weirdo';
  profile: UserProfile;
  window: {
    alwaysOnTop: boolean;
    petSize: number;
  };
  autoLaunch: boolean;            // 开机自启
  safetyMode: SafetyMode;
  safetyModeLastChangedAt: number;
  capabilities: CapabilityFlags;
  mcp: {
    servers: McpServerConfig[];
  };
  automation: AutomationConfig;
  claudeCode: ClaudeCodeConfig;
  dailyLetter: DailyLetterConfig;
  chatter: ChatterConfig;
  tts: TTSConfig;
  panel: PanelConfig;
  petSprite: PetSpriteConfig;
  memory: MemoryConfig;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;            // role=tool 时用
  tool_calls?: ToolCall[];          // role=assistant 时用
  name?: string;                    // role=tool 时的工具名
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string }; // arguments 是 JSON 字符串
}

export interface ChatRequest {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  // 强制模型从这段文本开始续写 (Anthropic 原生支持; DeepSeek 走 prefix:true; 其它 OAI 端尽力)
  // 用于把模型直接锁进"九十九夜梦的第一个字"
  prefill?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: any;                // JSON Schema
  };
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export interface ChatResponse {
  text: string;
  tool_calls?: ToolCall[];
  finish_reason?: string;
  usage?: ChatUsage;
}

export interface EmbeddingRequest {
  texts: string[];
  model?: string;
}

export interface EmbeddingResponse {
  model: string;
  dimensions: number;
  vectors: Array<{ textIndex: number; vector: number[] }>;
  usage?: { inputTokens?: number };
}

export interface PersonaMeta {
  id: 'reader' | 'shoujo' | 'genki' | 'weirdo';
  display_name: string;
  description: string;
}

export type CapabilityStatusKind = 'available' | 'disabled' | 'not_installed' | 'unavailable' | 'blocked';

export interface CapabilityStatus {
  id: string;
  status: CapabilityStatusKind;
  message?: string;
}

export interface CapabilityRuntimeStatus {
  id: string;
  running: boolean;
  detail?: string;
  pid?: number;
  startedAt?: number;
  lastError?: string;
}

export interface CapabilityDescriptor {
  id: string;
  display_name: string;
  description: string;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  available_in_safe: boolean;
  available_in_danger: boolean;
  requires_extra_enable?: boolean;  // 即使危险模式也要专门勾选
  enable_flag?: keyof CapabilityFlags;
}

export interface PermissionDecision {
  ok: boolean;
  reason?: string;
}

export interface TaskReport {
  receivedAt: number;
  session_id?: string;
  transcript_path?: string;
  summary?: string;                 // 主进程从 transcript 提取
  raw: any;
}

// ============ 记忆系统 ============
// Layer 3: Episode log
export interface EpisodeRow {
  id: number;
  ts: number;
  role: 'user' | 'assistant';
  content: string;
  persona_id: string;
  session_id?: string;
}

// Layer 4: Semantic facts
export type RecallPolicy = 'always' | 'on_topic' | 'manual_only' | 'never';
export type TaskMemoryStatus = 'routine' | 'candidate' | 'promoted' | 'unimportant' | 'disabled';
export type FactStatus = 'active' | 'superseded' | 'retracted';
export type FactCardinality = 'single' | 'set';
export type EmbeddableMemoryType = 'conversation_summary' | 'fact';
export interface FactRow {
  id: number;
  predicate: string;       // 例如 "favorite_color" / "current_project" / "preferred_name"
  subject: string;         // 通常是 "user" 或某实体
  object: string;          // 实际值
  confidence: number;      // 0~1
  status: FactStatus;
  cardinality: FactCardinality;
  created_at: number;
  superseded_by?: number;
  source_episode_id?: number;
}

// Layer 5: Task log
export interface TaskRow {
  id: number;
  ts: number;
  session_id?: string;
  transcript_path?: string;
  summary?: string;
  raw_json: string;
  memory_status: TaskMemoryStatus;
  recall_policy: RecallPolicy;
  promoted_summary_id?: number;
  promoted_at?: number;
  user_note?: string;
}

export interface ConversationSummaryRow {
  id: number;
  ts: number;
  episode_start_id?: number;
  episode_end_id?: number;
  persona_id?: string;
  title: string;
  summary: string;
  importance: number;
  kind: string;
  keywords_json: string;
  entities_json: string;
  created_at: number;
  status?: string;
  recall_policy?: RecallPolicy;
}

export type MemoryJobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface MemoryJobRow {
  id: number;
  type: string;
  status: MemoryJobStatus;
  dedupe_key?: string;
  created_at: number;
  started_at?: number;
  finished_at?: number;
  attempts: number;
  next_run_at?: number;
  max_attempts: number;
  last_heartbeat_at?: number;
  payload_json: string;
  result_json?: string;
  error?: string;
}

export interface MemoryEmbeddingRow {
  id: number;
  memory_type: EmbeddableMemoryType;
  memory_id: number;
  provider_id?: string;
  model: string;
  dimensions: number;
  vector: Buffer;
  text_hash: string;
  source_text?: string;
  created_at: number;
  updated_at: number;
}

export interface MemorySourceRow {
  id: number;
  memory_type: string;
  memory_id: number;
  source_type: string;
  source_id: number;
  excerpt?: string;
  created_at: number;
}

export interface GraphSyncStateRow {
  id: number;
  source_type: string;
  source_id: number;
  neo4j_element_id?: string;
  synced_at?: number;
  status: string;
  error?: string;
}

export interface MemoryStats {
  episodes: number;
  facts: number;
  activeFacts: number;
  tasks: number;
  summaries: number;
  pendingMemoryJobs: number;
  runningMemoryJobs: number;
  failedMemoryJobs: number;
  graphSynced: number;
  graphFailed: number;
  dbPath: string;
}
