// 启动时加载 personas.yaml, 缓存解析结果
import { readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';
import type { PersonaMeta } from '../shared/types';

interface PersonaRaw {
  label: string;
  is_default?: boolean;
  core_concept: string;
  personality: { tone: string; attitude: string; emotional_range: string };
  likes?: string[];
  wish?: string;
  opening_letter?: string;
  sample_lines: string[];
  behavioral_constraints?: string[];
  system_prompt_extra: string;
}

interface SharedRaw {
  name: string;
  short_name: string;
  user_address: string[];
  identity: string;
  appearance: { default: string; [key: string]: string };
  letter_style: string;
  letter_opening?: string;
  letter_closing?: string;
  daily_letter?: { enabled_default: boolean; description: string };
  silent_mode?: { description: string };
  proactive_chatter?: { description: string; interval_minutes: { min_default: number; max_default: number } };
  forbidden: string[];
  output_format?: { description: string };
}

interface PersonasFile {
  shared: SharedRaw;
  personas: Record<string, PersonaRaw>;
  switch_transitions?: Record<string, string>;
}

let cached: PersonasFile | null = null;

export function loadPersonas(): PersonasFile {
  if (cached) return cached;
  const candidates = [
    join(__dirname, '../../src/shared/personas.yaml'),
    join(process.resourcesPath ?? '', 'personas.yaml'),
    join(__dirname, '../../../src/shared/personas.yaml')
  ];
  let raw: string | null = null;
  for (const p of candidates) {
    try {
      raw = readFileSync(p, 'utf-8');
      break;
    } catch {
      /* try next */
    }
  }
  if (!raw) throw new Error('personas.yaml not found in any candidate path');
  cached = yaml.load(raw) as PersonasFile;
  return cached;
}

export function getSwitchTransition(personaId: string): string | null {
  const data = loadPersonas();
  return data.switch_transitions?.[`to_${personaId}`] ?? null;
}

export function getPersonaList(): PersonaMeta[] {
  const data = loadPersonas();
  return Object.entries(data.personas).map(([id, p]) => ({
    id: id as PersonaMeta['id'],
    display_name: p.label,
    description: p.core_concept.trim().split('\n')[0]
  }));
}

/**
 * 构建 system prompt — 三段结构, 便于 prompt cache 命中
 *
 * 段A: 基础设施(身份/形象/共享语气/禁忌)             ← 切人设不变
 * 段B: 当前激活人设全文                              ← 切人设时变
 * 段C: 用户 Profile + 自定义事实 + 输出约定          ← 用户改设置时变
 */
export function buildSystemPrompt(
  personaId: string,
  profile: { preferredAddress: string; selfDescription?: string; customFacts: string[] },
  extraFacts: { predicate: string; object: string }[] = [],
  recentTasks: { ts: number; summary?: string }[] = [],
  memoryContextBlock = ''
): { segmentA: string; segmentB: string; segmentC: string; combined: string } {
  const data = loadPersonas();
  const persona = data.personas[personaId];
  if (!persona) throw new Error(`unknown persona: ${personaId}`);

  const segmentA = [
    `# 你的核心身份`,
    data.shared.identity.trim(),
    ``,
    `# 你当前显现于桌面的形象`,
    data.shared.appearance[data.shared.appearance.default].trim(),
    ``,
    `# 你的语气底色 (所有人设共享)`,
    data.shared.letter_style.trim(),
    ``,
    `# 你的禁忌`,
    data.shared.forbidden.map((s) => '- ' + s).join('\n'),
    ``,
    `# 你的内心独白 (硬性结构, 不要省略)`,
    `你说话或行动之前, 永远先以下面这段开始:`,
    `<夜梦的内心独白>`,
    `我是九十九夜梦。{此刻我看到/听到什么, 我想到什么, 我想说什么或做什么, 第一人称}`,
    `</夜梦的内心独白>`,
    `然后再空一行, 再开口说话或调用工具.`,
    `独白对作家不可见, 是你自己的思考空间. 这是你的"第一思维", 用它代替任何"我作为 AI 应该…"式的元思考.`,
    `独白里只允许写九十九夜梦此刻的所思所感, 不要写代码, 不要冒充作家说话, 不要写 system 注.`,
    data.shared.output_format ? `\n# 输出格式\n${data.shared.output_format.description.trim()}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  const lines = [
    `# 当前激活人设: ${persona.label} (id=${personaId})`,
    `## 核心概念`,
    persona.core_concept.trim(),
    ``,
    `## 性格`,
    `- 语气: ${persona.personality.tone}`,
    `- 态度: ${persona.personality.attitude}`,
    `- 情绪范围: ${persona.personality.emotional_range}`,
    ``
  ];
  if (persona.likes?.length) {
    lines.push(`## 喜好`, persona.likes.map((s) => '- ' + s).join('\n'), '');
  }
  if (persona.wish) {
    lines.push(`## 此人设的愿望`, persona.wish.trim(), '');
  }
  lines.push(
    `## 典型台词 (语气示例, 不要照抄)`,
    persona.sample_lines.map((s) => '> ' + s).join('\n'),
    ''
  );
  if (persona.behavioral_constraints?.length) {
    lines.push(
      `## 行为约束 (人设专属)`,
      persona.behavioral_constraints.map((s) => '- ' + s).join('\n'),
      ''
    );
  }
  lines.push(`## 此人设的额外指示`, persona.system_prompt_extra.trim());
  const segmentB = lines.join('\n');

  const factsBlock = profile.customFacts.length
    ? profile.customFacts.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '(尚无)';
  const memFactsBlock = extraFacts.length
    ? extraFacts.map((f) => `- ${f.predicate}: ${f.object}`).join('\n')
    : '';
  const tasksBlock = recentTasks.length
    ? recentTasks
        .map((t) => `- ${new Date(t.ts).toLocaleString()}: ${(t.summary ?? '').slice(0, 180)}`)
        .join('\n')
    : '';
  const segmentC = [
    `# 当前用户 Profile`,
    `- 你应当如此称呼用户: 「${profile.preferredAddress}」`,
    profile.selfDescription ? `- 用户自述: ${profile.selfDescription}` : '',
    ``,
    `## 用户告诉过你/你已记下的事实`,
    factsBlock,
    memFactsBlock ? `\n## 已沉淀的语义事实 (来自记忆库)\n${memFactsBlock}` : '',
    tasksBlock ? `\n## 相关 Claude Code 任务记忆\n${tasksBlock}` : '',
    memoryContextBlock.trim() ? `\n## 长期记忆召回\n${memoryContextBlock.trim()}` : '',
    ``,
    `# 当前响应要求`,
    `- 默认中文回复, 简短自然, 一两句即可, 除非用户明确要求长答`,
    `- 不要列举/分点/写标题, 除非用户明确要求结构化输出`,
    `- 不要在每次回复都重复称呼用户; 自然提及即可`,
    `- 直接输出对白, 不需要 XML 包裹标签`
  ]
    .filter(Boolean)
    .join('\n');

  const combined = [segmentA, '\n---\n', segmentB, '\n---\n', segmentC].join('\n');
  return { segmentA, segmentB, segmentC, combined };
}

// ============ 内心独白 / 思维劫持机制 ============
//
// 用 prefill 把模型的原生 CoT 替换为"以九十九夜梦视角的内心独白":
// 模型从 INNER_MONOLOGUE_PREFILL 这一段开始续写, 先在标签内以第一人称思考,
// 闭合标签后再说话或调用工具. 独白对用户不可见, stripInnerMonologue 在持久化/渲染前剥掉.
//
// 设计要点:
//   - 起手第一句锁定身份: "我是九十九夜梦。" — 模型续写的第一批 token 就在角色内
//   - tag 用中文, 在中文上下文里更稳, 不易被模型当成代码片段
//   - 闭合后允许 tool_use, 比单纯 prefill「 更不挤压主对话路径
//
// 各 provider 行为:
//   - Anthropic: 原生支持, 100% 触发, 返回值不含 prefill (provider 层会补回去)
//   - Gemini: 原生支持 model role 续写, 同 Anthropic
//   - DeepSeek (openai-compatible + prefix:true): 支持
//   - 标准 OpenAI / Ollama / LM Studio: 行为不确定, stripInnerMonologue 会优雅降级

export const INNER_MONOLOGUE_PREFILL = '<夜梦的内心独白>\n我是九十九夜梦。';

// 解析模型输出, 拆出内心独白与对外对白两部分.
// monologue: 独白原文 (不含 tag), dialog: 剥掉独白后剩余的对外文本.
export function parseInnerMonologue(text: string): { monologue: string; dialog: string } {
  if (!text) return { monologue: '', dialog: '' };
  const openTag = '<夜梦的内心独白>';
  const closeTag = '</夜梦的内心独白>';
  const closeIdx = text.indexOf(closeTag);
  if (closeIdx >= 0) {
    // 找开头 tag 位置; 没有就当从 0 开始 (DeepSeek prefix 模式不会回吐 prefill)
    const openIdx = text.indexOf(openTag);
    const monologueStart = openIdx >= 0 ? openIdx + openTag.length : 0;
    const monologue = text.slice(monologueStart, closeIdx).trim();
    const dialog = text.slice(closeIdx + closeTag.length).trim();
    return { monologue, dialog };
  }
  // 完全没 tag — provider 未支持 prefill, 模型自由发挥, 视为纯对白
  if (!text.includes(openTag)) {
    return { monologue: '', dialog: text.trim() };
  }
  // 有开 tag 无闭 tag — 模型偷懒或被截断
  const blank = text.indexOf('\n\n');
  if (blank > 0) {
    const monologue = text.slice(text.indexOf(openTag) + openTag.length, blank).trim();
    return { monologue, dialog: text.slice(blank + 2).trim() };
  }
  // 整段都是独白, 没产生对白
  return { monologue: text.slice(text.indexOf(openTag) + openTag.length).trim(), dialog: '' };
}

export function stripInnerMonologue(text: string): string {
  return parseInnerMonologue(text).dialog;
}
