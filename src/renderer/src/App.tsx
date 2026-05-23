import { useEffect, useState } from 'react';
import Pet from './pet/Pet';
import Settings from './settings/Settings';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const win = params.get('win') ?? 'pet';

  // 给 body 加 class 用于按窗口切换样式
  useEffect(() => {
    document.body.classList.add(`win-${win}`);
    return () => document.body.classList.remove(`win-${win}`);
  }, [win]);

  // 加载完成后渲染对应视图
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (window.api) setReady(true);
  }, []);

  if (!ready) return <div style={{ padding: 20 }}>加载中…</div>;

  return win === 'settings' ? <Settings /> : <Pet />;
}
