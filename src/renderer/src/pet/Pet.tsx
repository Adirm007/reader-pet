import { useCallback, useEffect, useRef, useState, CSSProperties } from 'react';
import PetSprite from '../components/PetSprite';
import ChatBubble from '../components/ChatBubble';
import type { PetSpritePackage, PetState } from '../../../shared/types';

/**
 * 桌宠主视图
 * - 点击立绘 → 展开输入框
 * - 回车或点击发送 → 调 chat:send → 气泡显示回复
 * - 右键 → 系统托盘菜单(已由 main 进程承担), 这里再加个本地菜单备用
 *
 * 精灵图状态机:
 *   - talk: TTS 播放中 / sendChat pending 时
 *   - happy: 收到桌宠气泡(task-report/daily-letter/chatter)后 ~3s
 *   - failed: 气泡含"错误/出错/失败"时
 *   - sleep: >5 分钟无任何交互
 *   - idle: 其它默认
 */
export default function Pet() {
  const [bubble, setBubble] = useState<string | null>(null);
  const [inputOpen, setInputOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [pending, setPending] = useState(false);
  const [hasProvider, setHasProvider] = useState<boolean | null>(null);
  const [spritePkg, setSpritePkg] = useState<PetSpritePackage | null>(null);
  const [petState, setPetState] = useState<PetState>('idle');
  const ttsCfgRef = useRef<{ enabled: boolean; autoSpeakOnBubble: boolean } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastInteractRef = useRef<number>(Date.now());
  const transientTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 加载 TTS 配置 + 精灵图包 (改变后下次桌宠重启生效)
  useEffect(() => {
    (async () => {
      const cfg = await window.api.getConfig();
      setHasProvider(!!cfg.activeProviderId);
      ttsCfgRef.current = {
        enabled: !!cfg.tts?.enabled,
        autoSpeakOnBubble: !!cfg.tts?.autoSpeakOnBubble
      };
      if (cfg.petSprite?.activePackageId) {
        const pkg = await window.api.petSpriteLoad(cfg.petSprite.activePackageId);
        if (pkg) setSpritePkg(pkg);
      }
    })();
  }, []);

  const noteInteract = useCallback(() => {
    lastInteractRef.current = Date.now();
    setPetState((cur) => (cur === 'sleep' ? 'idle' : cur));
  }, []);

  // 短暂表情 (happy / failed) 自动回 idle
  const flashState = useCallback((s: PetState, durationMs = 3000) => {
    if (transientTimerRef.current) clearTimeout(transientTimerRef.current);
    setPetState(s);
    transientTimerRef.current = setTimeout(() => {
      setPetState('idle');
      transientTimerRef.current = null;
    }, durationMs);
  }, []);

  const speak = useCallback(async (text: string) => {
    const t = ttsCfgRef.current;
    if (!t || !t.enabled) return;
    try {
      const r = await window.api.ttsSynthesize(text);
      if (!r.ok || !r.base64) return;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      const audio = new Audio(`data:${r.mime ?? 'audio/wav'};base64,${r.base64}`);
      audioRef.current = audio;
      // talk 状态贯穿整段音频
      if (transientTimerRef.current) {
        clearTimeout(transientTimerRef.current);
        transientTimerRef.current = null;
      }
      setPetState('talk');
      audio.addEventListener('ended', () => setPetState('idle'));
      audio.addEventListener('error', () => setPetState('idle'));
      audio.play().catch(() => setPetState('idle'));
    } catch {
      /* 静默 */
    }
  }, []);

  // 接收主进程推送的气泡 (Claude Code 完成汇报 / 主动行为)
  useEffect(() => {
    const off = window.api.onPetBubble((p) => {
      setBubble(p.text);
      noteInteract();
      const looksLikeFailure = /(失败|错误|出错|fail|error)/i.test(p.text);
      flashState(looksLikeFailure ? 'failed' : 'happy', 3000);
      const t = ttsCfgRef.current;
      if (t?.enabled && t.autoSpeakOnBubble) {
        void speak(p.text);
      }
    });
    return () => {
      off();
    };
  }, [speak, flashState, noteInteract]);

  // 初次启动 / 未配置时, 引导去设置
  useEffect(() => {
    if (hasProvider === null) return;
    if (!hasProvider) {
      setBubble('初次见面。还请先到设置面板填一份 API, 之后我们才能正式对话。');
    } else {
      setBubble('我在这里, 随时可以聊。');
    }
  }, [hasProvider]);

  // sleep 自动转换 (5 分钟无交互 → sleep)
  useEffect(() => {
    const id = setInterval(() => {
      if (petState !== 'idle') return;
      if (Date.now() - lastInteractRef.current > 5 * 60 * 1000) {
        setPetState('sleep');
      }
    }, 30 * 1000);
    return () => clearInterval(id);
  }, [petState]);

  const send = useCallback(async () => {
    const text = inputText.trim();
    if (!text || pending) return;
    noteInteract();
    setPending(true);
    setBubble('…');
    setPetState('talk'); // 等待回复期间是 talk (有口型预热的感觉)
    try {
      const resp = await window.api.sendChat(text);
      const replyText = resp.text || '(空响应)';
      setBubble(replyText);
      setInputText('');
      const t = ttsCfgRef.current;
      if (t?.enabled && t.autoSpeakOnBubble && resp.text) {
        void speak(replyText); // speak 内部会持有 talk 状态直到音频结束
      } else {
        flashState('happy', 2500);
      }
    } catch (e: any) {
      setBubble(`抱歉, 出了点问题:\n${e?.message ?? String(e)}`);
      flashState('failed', 3000);
    } finally {
      setPending(false);
    }
  }, [inputText, pending, speak, flashState, noteInteract]);

  // 桌宠尺寸: 容器是 260*scale 宽; 立绘画到容器宽度的 ~62% (留气泡和输入位)
  const displayWidth = Math.round(160);

  return (
    <div className="pet-root" onContextMenu={(e) => e.preventDefault()}>
      {bubble && (
        <ChatBubble
          text={bubble}
          autoHideMs={inputOpen ? 0 : 8000}
          onClose={() => setBubble(null)}
        />
      )}

      <PetSprite
        pkg={spritePkg}
        state={petState}
        displayWidth={displayWidth}
        onClick={() => {
          noteInteract();
          setInputOpen((v) => !v);
        }}
      />

      {inputOpen && (
        <div className="pet-input" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
          <input
            type="text"
            placeholder={hasProvider ? '说点什么…' : '请先到设置中配置 API'}
            value={inputText}
            disabled={!hasProvider || pending}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
              if (e.key === 'Escape') setInputOpen(false);
            }}
            autoFocus
          />
          <button onClick={send} disabled={!hasProvider || pending || !inputText.trim()}>
            {pending ? '…' : '发送'}
          </button>
          <button className="ghost" onClick={() => window.api.openPanel()}>面板</button>
          <button className="ghost" onClick={() => window.api.openSettings()}>设置</button>
        </div>
      )}
    </div>
  );
}
