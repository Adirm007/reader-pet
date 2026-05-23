import { useCallback, useEffect, useState, CSSProperties } from 'react';
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

  // 检测是否已配置 provider
  useEffect(() => {
    (async () => {
      const cfg = await window.api.getConfig();
      setHasProvider(!!cfg.activeProviderId);
    })();
  }, []);

  // 接收主进程推送的气泡 (Claude Code 完成汇报 / 主动行为)
  useEffect(() => {
    const off = window.api.onPetBubble((p) => {
      setBubble(p.text);
    });
    return () => {
      off();
    };
  }, []);

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
      setBubble(resp.text || '(空响应)');
      setInputText('');
    } catch (e: any) {
      setBubble(`抱歉, 出了点问题:\n${e?.message ?? String(e)}`);
    } finally {
      setPending(false);
    }
  }, [inputText, pending]);

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
          <button className="ghost" onClick={() => window.api.openSettings()}>设置</button>
        </div>
      )}
    </div>
  );
}
