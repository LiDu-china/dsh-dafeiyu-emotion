# Marketplace submission copy

## Name

大肥鱼 · 情绪耳朵

## Package

`dsh-dafeiyu-emotion`

## Repository

https://github.com/LiDu-china/dsh-dafeiyu-emotion

## 1024Store

https://deepseek1024.com/plugins/LiDu-china/dsh-dafeiyu-emotion

## Icon

https://raw.githubusercontent.com/LiDu-china/dsh-dafeiyu-emotion/main/assets/icon-512.png

## One-line description

让 DSH 里的大肥鱼听得见、听得懂，并按对方的语气和情绪自然回复。

## Demo video

https://github.com/LiDu-china/dsh-dafeiyu-emotion/releases/download/v0.2.3/dsh-dafeiyu-emotion-demo.mp4

## Short description

在 DSH 输入框旁边加一个 🐋 鱼耳：本地转写语音，分析语速/停顿/音高/能量和文字线索，生成克制的情绪上下文，再自动发送给大肥鱼回复。默认不把音频上传到云端。

## Long description

大肥鱼 · 情绪耳朵是一个 DeepSeek Harness 语音 companion 插件。它把一次说话变成一条有情绪上下文的对话：

1. 点击 composer 旁的鱼耳，录一句话；
2. 可使用 DSH 原生快捷键开始/停止录音，并在快捷键设置中自由改键；
3. 优先复用 DSH 自带 Voice Input/SenseVoice 做本地转写；
4. 浏览器提取语速、停顿、基频、音高变化、能量等声学特征；
5. 可选中英文情绪词表与声学原型融合，输出情绪、置信度、愉悦度、唤醒度；
6. 生成“先承接情绪、再回答问题”的受控 prompt；可展开情绪证据卡，置信度低时先追问确认；
7. 自动填入并发送到当前会话；
8. 可用一次平静说话设置个人基线，轻量模式按个人音高/能量归一化；
9. 连续几次语音后生成会话趋势，并通过 `/context` 与 `kind:"context"` SSE 提供给其他插件；
10. 朗读回复时通过本地 HelperProcess 协议驱动 `dsh-dafeiyu`：思考 → 逐字气泡 → 庆祝；音频从不发送；
11. 如果本机部署了 VoiceSense，可切换到 SenseVoice + emotion2vec 增强模式。

插件不常驻监听、不读屏幕、不声称读心。音频只进入本机临时目录，分析结束后删除。

## Categories

- Voice
- AI Companion
- Accessibility
- Productivity
- Emotion / Sentiment

## Keywords

`dsh`, `dsh-plugin`, `deepseek-harness`, `dsh-dafeiyu`, `voice`, `emotion`, `sensevoice`, `emotion2vec`, `speech-emotion-recognition`, `voice-assistant`

## Requirements

- DSH Desktop 0.2.x / DSH 0.2.1-rc.2+
- Microphone permission
- Lightweight mode: enable DSH Voice Input and prepare its local model
- Enhanced mode: a local VoiceSense checkout with `.venv-ser` and cached models
- Optional pet reaction: `dsh-dafeiyu` 0.1.23+ and the emotion plugin mounted first (the bundled patch does this; reinstall/restart old installs)

## Install

```bash
dsh plugin --profile desktop add dsh-dafeiyu-emotion
```

Published as `dsh-dafeiyu-emotion@0.3.2` on npm. The 1024Store entry refreshes its one-click install automatically. GitHub-source and Release-tarball installs remain available as fallbacks.

## Privacy

No audio upload. No screen capture. No persistent microphone. Temporary WAV is deleted after analysis.

The optional pet reaction sends `start` / `end`, a session id, and (on `start`) the reply text to the local host so the pet can type it into its bubble. Audio is never sent to the pet, and the text is never uploaded to a cloud service.

## Maintainer

[@LiDu-china](https://github.com/LiDu-china)

## License

MIT
