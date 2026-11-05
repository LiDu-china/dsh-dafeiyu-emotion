## 设置页与侧边栏

- 新增 DSH 插件设置卡片：启用/停用、识别语言、VoiceSense 目录、Python 路径、录音上限、启动/分析超时。
- 安装 Better Sidebar 后，可在右侧边栏 `+` 菜单固定「情绪耳朵」，在对话旁边直接调整。
- 顶部实时显示轻量模式、增强模式、模型加载中、后端目录缺失或等待 Voice Input。
- 保存后立即写入 DSH 设置；路径或超时变化时自动重启语音 worker。

## 安装

```bash
dsh plugin --profile desktop add dsh-dafeiyu-emotion
```

完整变更见 [CHANGELOG](https://github.com/LiDu-china/dsh-dafeiyu-emotion/blob/main/CHANGELOG.md)。
