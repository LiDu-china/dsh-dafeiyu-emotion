## 0.3.3

大肥鱼互动与情绪上下文修复版。

### 大肥鱼气泡互动

- 新增 `petSayEnabled`，默认开启：助手语音回复播放时，本地大肥鱼气泡会逐字显示 `正在说：<回复文本>`。
- 通过 `dsh-dafeiyu` 的 HelperProcess bridge 直接发送 `state` / `task` / `pulse` 协议消息，不再伪造会话，也不会在真实会话里留下多任务卡。
- 回复开始时大肥鱼进入思考动画，结束时播放成功庆祝和音效。
- 新增 `petReactionEnabled`，默认开启；可在设置里单独关闭动画或气泡文本。
- `/health` 新增 `petBridgeReady`，用于确认 HelperProcess bridge 是否已挂上。
- 情绪插件现在排在 `dsh-dafeiyu` 之前挂载，确保能捕获桌宠启动时创建的 bridge。

> 从旧版本升级后必须完全退出并重启 the agent harness，再确认 `/health` 里 `petBridgeReady: true`。当前是思考动画、逐字气泡和结束庆祝，不是嘴型同步；真正的口型动画仍需要新的桌宠帧或协议。

### 情绪上下文与稳定性

- 修复 `/context?session=` 在未知会话时错误返回其他会话 `lastAnalysis` 的问题。
- 情绪趋势改为至少 4 个样本才计算，避免 3 个样本拿 0 当基线。
- 个人基线保存原始 `calibration` 特征，避免下一轮重复归一化。
- 情绪自适应 TTS 不再在发送后重置为 neutral，会保留最近 120 秒的情绪。
- `ttsOnlyAfterVoice` 改为按会话独立计时。
- 裸 `ttsReady` 命令改用 `where` / `which` 探测并缓存，避免 PATH 命令误判。
- 隐私清理只匹配插件自己的 `dsh-dafeiyu-emotion-*` 和 `dsh-dafeiyu-tts-*` 临时目录。
- 修复音频 blob URL 在卸载或失败时未释放的问题。
- 证据卡不再把缺失值显示成 `0`。
- 修复 TTS 失败回退可能提前结束新回复互动的问题。
- 桌宠互动 `end` 幂等；关闭功能、切换会话、客户端卸载和宿主 teardown 都会正确收尾。

### 验证

- `npm test`：11 个测试文件全部通过。
- `npm run check`：通过。
- `python -m py_compile backend/voice_worker.py`：通过。
- `npm pack --dry-run`：发布包不包含测试与演示素材。

### 安装 / 升级

```bash
dsh plugin --profile desktop add dsh-dafeiyu-emotion
```

升级后请完全退出并重新启动 the agent harness。
