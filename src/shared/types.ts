// 跨进程共享类型 (main / preload / renderer 均可 import)

export type ProviderType = 'openai-compatible' | 'anthropic' | 'gemini';

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
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
  playwrightEnabled: boolean;       // 浏览器自动化
  memoryRWEnabled: boolean;          // 游戏内存读写 (Cheat Engine 风格)
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
  claudeCode: ClaudeCodeConfig;
  dailyLetter: DailyLetterConfig;
  chatter: ChatterConfig;
  tts: TTSConfig;
  panel: PanelConfig;
  petSprite: PetSpriteConfig;
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

export interface PersonaMeta {
  id: 'reader' | 'shoujo' | 'genki' | 'weirdo';
  display_name: string;
  description: string;
}

export interface CapabilityDescriptor {
  id: string;
  display_name: string;
  description: string;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  available_in_safe: boolean;
  available_in_danger: boolean;
  requires_extra_enable?: boolean;  // 即使危险模式也要专门勾选
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
export type FactStatus = 'active' | 'superseded' | 'retracted';
export interface FactRow {
  id: number;
  predicate: string;       // 例如 "favorite_color" / "current_project" / "preferred_name"
  subject: string;         // 通常是 "user" 或某实体
  object: string;          // 实际值
  confidence: number;      // 0~1
  status: FactStatus;
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
}

export interface MemoryStats {
  episodes: number;
  facts: number;
  activeFacts: number;
  tasks: number;
  dbPath: string;
}
