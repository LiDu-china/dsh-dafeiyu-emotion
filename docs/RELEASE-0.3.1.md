## 0.3.1

大肥鱼现在会说话了。

### 语音回复

- Host 监听 `assistant/message`，把回复文本通过 `/plugins/dsh-dafeiyu-emotion/events` 推给客户端。
- 客户端收到后朗读回复，默认使用 **Piper 本地模型** `zh_CN-huayan-medium`。
- 可选 **Edge TTS**（`zh-CN-XiaoyiNeural`，更自然，但需要网络），以及 **浏览器 speechSynthesis** 兜底。
- Piper/Edge 失败时自动回退浏览器语音，不会让回复静默丢失。

### 设置

- 朗读开关、合成引擎、Edge 音色、语速、音调、Piper 模型路径。
- 默认 `ttsEnabled: true`，Piper 模型不存在时自动使用浏览器语音。

### 本地模型

```bash
python -m pip install piper-tts
```

默认模型目录：

```text
~/.dsh/dafeiyu-emotion/tts/piper/zh_CN-huayan-medium.onnx
~/.dsh/dafeiyu-emotion/tts/piper/zh_CN-huayan-medium.onnx.json
```

可以在设置页填写自定义路径。

### 接口

```text
POST /plugins/dsh-dafeiyu-emotion/tts
GET  /plugins/dsh-dafeiyu-emotion/events
```

`/tts` 返回 WAV（Piper）或 MP3（Edge），只允许本机访问。
