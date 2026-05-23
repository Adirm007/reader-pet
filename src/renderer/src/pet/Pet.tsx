import { useCallback, useEffect, useRef, useState, CSSProperties } from 'react';
import PetSprite from '../components/PetSprite';
import ChatBubble from '../components/ChatBubble';

/**
 * 桌宠主视图
 * - 点击立绘 → 展开输入框
 * - 回车或点击发送 → 调 chat:send → 气泡显示回复
 * - 右键 → 系统托盘菜单(已由 main 进程承担), 这里再加个本地菜单备用
 */
export default function Pet() {
  const [bubble, setBubble] = useState<string | null>(null);
  const [inputOpen, setInputOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [pending, setPending] = useState(false);
  const [hasProvider, setHasProvider] = useState<boolean | null>(null);
  const ttsCfgRef = useRef<{ enabled: boolean; autoSpeakOnBubble: boolean } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 加载 TTS 配置一次 (改变后下次桌宠重启生效, 没必要实时同步)
  useEffect(() => {
    (async () => {
      const cfg = await window.api.getConfig();
      setHasProvider(!!cfg.activeProviderId);
      ttsCfgRef.current = {
        enabled: !!cfg.tts?.enabled,
        autoSpeakOnBubble: !!cfg.tts?.autoSpeakOnBubble
      };
    })();
  }, []);

  const speak = useCallback(async (text: string) => {
    const t = ttsCfgRef.current;
    if (!t || !t.enabled) return;
    try {
      const r = await window.api.ttsSynthesize(text);
      if (!r.ok || !r.base64) return;
      // 停掉前一段
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      const audio = new Audio(`data:${r.mime ?? 'audio/wav'};base64,${r.base64}`);
      audioRef.current = audio;
      audio.play().catch(() => {});
    } catch {
      /* 静默 */
    }
  }, []);

  // 接收主进程推送的气泡 (Claude Code 完成汇报 / 主动行为)
  useEffect(() => {
    const off = window.api.onPetBubble((p) => {
      setBubble(p.text);
      const t = ttsCfgRef.current;
      if (t?.enabled && t.autoSpeakOnBubble) {
        void speak(p.text);
      }
    });
    return () => {
      off();
    };
  }, [speak]);

  // 初次启动 / 未配置时, 引导去设置
  useEffect(() => {
    if (hasProvider === null) return;
    if (!hasProvider) {
      setBubble('初次见面。还请先到设置面板填一份 API, 之后我们才能正式对话。');
    } else {
      setBubble('我在这里, 随时可以聊。');
    }
  }, [hasProvider]);

  const send = useCallback(async () => {
    const text = inputText.trim();
    if (!text || pending) return;
    setPending(true);
    setBubble('…');
    try {
      const resp = await window.api.sendChat(text);
      const replyText = resp.text || '(空响应)';
      setBubble(replyText);
      setInputText('');
      const t = ttsCfgRef.current;
      if (t?.enabled && t.autoSpeakOnBubble && resp.text) {
        void speak(replyText);
      }
    } catch (e: any) {
      setBubble(`抱歉, 出了点问题:\n${e?.message ?? String(e)}`);
    } finally {
      setPending(false);
    }
  }, [inputText, pending, speak]);

  return (
    <div className="pet-root" onContextMenu={(e) => e.preventDefault()}>
      {bubble && (
        <ChatBubble
          text={bubble}
          autoHideMs={inputOpen ? 0 : 8000}
          onClose={() => setBubble(null)}
        />
      )}

      <PetSprite onClick={() => setInputOpen((v) => !v)} />

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
