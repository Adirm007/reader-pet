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
  profile: { preferredAddress: string; selfDescription?: string; customFacts: string[] }
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
  const segmentC = [
    `# 当前用户 Profile`,
    `- 你应当如此称呼用户: 「${profile.preferredAddress}」`,
    profile.selfDescription ? `- 用户自述: ${profile.selfDescription}` : '',
    ``,
    `## 用户告诉过你/你已记下的事实`,
    factsBlock,
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
