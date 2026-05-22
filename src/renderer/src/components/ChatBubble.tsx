import { useEffect, useState, CSSProperties } from 'react';

interface Props {
  text: string;
  onClose?: () => void;
  autoHideMs?: number;
}

export default function ChatBubble({ text, onClose, autoHideMs = 6000 }: Props) {
  const [displayed, setDisplayed] = useState('');
  const [visible, setVisible] = useState(true);

  // 打字机
  useEffect(() => {
    setDisplayed('');
    let i = 0;
    const timer = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) clearInterval(timer);
    }, 35);
    return () => clearInterval(timer);
  }, [text]);

  // 自动消失
  useEffect(() => {
    if (!autoHideMs) return;
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onClose?.(), 300);
    }, autoHideMs);
    return () => clearTimeout(t);
  }, [autoHideMs, text, onClose]);

  return (
    <div
      className={`bubble ${visible ? 'bubble-show' : 'bubble-hide'}`}
      style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
      onClick={() => {
        setVisible(false);
        setTimeout(() => onClose?.(), 200);
      }}
    >
      <div className="bubble-text">{displayed}</div>
      <div className="bubble-arrow" />
    </div>
  );
}
