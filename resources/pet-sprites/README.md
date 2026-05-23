# 桌宠精灵图包目录

把每一只桌宠放在这个目录下的一个子文件夹里, 例如:

```
resources/pet-sprites/
  yomeko/
    pet.json
    spritesheet.webp
  some-other-pet/
    pet.json
    spritesheet.webp
```

应用启动时会扫描两个根:

1. `resources/pet-sprites/`  — 仓库自带, 会被 electron-builder 打包进发行版
2. `<userData>/pet-sprites/` — 用户在本地丢的, 不需要重打包 (设置面板里有"打开本机精灵图目录"按钮)

## pet.json 最小格式

完全兼容 Codex 的 [hatch-pet](https://github.com/openai/skills) skill 输出, 也可手填:

```json
{
  "id": "yomeko",
  "displayName": "九十九夜梦",
  "description": "银发紫眸的桌宠读者",
  "spritesheetPath": "spritesheet.webp",
  "cellWidth": 192,
  "cellHeight": 208,
  "cols": 8,
  "rows": 9,
  "clips": {
    "idle":   { "row": 0, "frames": 6, "fps": 6,  "loop": true  },
    "talk":   { "row": 3, "frames": 6, "fps": 8,  "loop": true  },
    "think":  { "row": 7, "frames": 6, "fps": 6,  "loop": true  },
    "happy":  { "row": 4, "frames": 6, "fps": 10, "loop": true  },
    "sleep":  { "row": 6, "frames": 4, "fps": 4,  "loop": true  },
    "failed": { "row": 5, "frames": 4, "fps": 6,  "loop": false }
  }
}
```

`cellWidth/cellHeight/cols/rows/clips` 缺省时全部按 hatch-pet 的 192×208 / 8 列 / 9 行规格补齐.

## 怎么用 hatch-pet 生成

在 Codex 里跑 hatch-pet skill, 把头像作为参考图. 它会在
`${CODEX_HOME:-$HOME/.codex}/pets/<pet-name>/` 下产出:

```
pet.json
spritesheet.webp
```

把整个 `<pet-name>` 目录拷到这里 (或拷到 `<userData>/pet-sprites/`) 即可.
hatch-pet 自己的 `pet.json` 只有最简字段, 但因为本应用的 loader 会用 hatch-pet 默认
几何 (192×208 / 8×9) 和默认 clips 补齐, 所以**不改 pet.json 也能直接跑**.

## 状态映射 (默认值, 可在 pet.json 里覆盖)

| 我们的状态 | hatch-pet 行 | 触发时机 |
|----------|------------|---------|
| `idle`   | 0 idle             | 默认待机 |
| `talk`   | 3 waving           | TTS 播放中 / 桌宠在说话 |
| `think`  | 7 running          | Claude Code 工作中 |
| `happy`  | 4 jumping          | 收到信 / 对话有回复时 |
| `sleep`  | 6 waiting          | 长时间无交互 (>5 分钟) |
| `failed` | 5 failed           | 出错气泡 |
