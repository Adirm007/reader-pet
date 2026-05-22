import { useState } from 'react';
import PetSprite from './components/PetSprite';
import ChatBubble from './components/ChatBubble';

export default function App() {
  const [bubble, setBubble] = useState<string | null>(
    '初次见面，亲爱的作家先生(或小姐)。'
  );

  return (
    <div className="pet-root">
      {bubble && (
        <ChatBubble text={bubble} onClose={() => setBubble(null)} />
      )}
      <PetSprite onClick={() => setBubble(getRandomGreeting())} />
    </div>
  );
}

function getRandomGreeting(): string {
  const lines = [
    '今天的剧情真是精彩呢，作家先生。',
    '需要休息吗？',
    '我一直在这里。',
    '这本书今天读到这一页，已经足够了。'
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}
