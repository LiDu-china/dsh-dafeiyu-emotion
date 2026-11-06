## 0.3.2

语音回复的体验收口。

- 新增 `ttsOnlyAfterVoice`，默认开启：只在录音后两分钟内的助手回复朗读。
- 普通代码对话、没有录音触发的回复不再自动朗读。
- 设置页新增「只朗读语音触发的回复」开关。

## 安装

```bash
dsh plugin --profile desktop add dsh-dafeiyu-emotion
```

升级后请完全退出并重新启动 the agent harness。
