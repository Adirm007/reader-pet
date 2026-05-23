// 跨进程共享类型 (main / preload / renderer 均可 import)

export type ProviderType = 'openai-compatible' | 'anthropic' | 'gemini';

export interface ProviderConfig {
  id: string;
  name: string;                    // 用户起的显示名
  type: ProviderType;
  baseUrl: string;                 // 可填官方或反代,要带 /v1 等路径前缀
  apiKey: string;
  model: string;
  extraHeaders?: Record<string, string>;
}

export interface UserProfile {
  preferredAddress: string;        // '作家先生' / '作家小姐' / 自填
  selfDescription?: string;        // 用户对自己的简介(注入 system prompt)
  customFacts: string[];           // 手动添加的事实(注入 system prompt)
}

export interface AppConfig {
  providers: ProviderConfig[];
  activeProviderId: string | null;
  activePersonaId: 'reader' | 'shoujo' | 'genki' | 'weirdo';
  profile: UserProfile;
  window: {
    alwaysOnTop: boolean;
    petSize: number;             // 缩放百分比 50-150
  };
  // 后续阶段会扩展
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export interface ChatResponse {
  text: string;
  usage?: ChatUsage;
}

export interface PersonaMeta {
  id: 'reader' | 'shoujo' | 'genki' | 'weirdo';
  display_name: string;
  description: string;
}
