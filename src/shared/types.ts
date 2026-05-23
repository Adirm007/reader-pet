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

export interface AppConfig {
  providers: ProviderConfig[];
  activeProviderId: string | null;
  activePersonaId: 'reader' | 'shoujo' | 'genki' | 'weirdo';
  profile: UserProfile;
  window: {
    alwaysOnTop: boolean;
    petSize: number;
  };
  safetyMode: SafetyMode;
  safetyModeLastChangedAt: number;
  capabilities: CapabilityFlags;
  claudeCode: ClaudeCodeConfig;
  dailyLetter: DailyLetterConfig;
  chatter: ChatterConfig;
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
