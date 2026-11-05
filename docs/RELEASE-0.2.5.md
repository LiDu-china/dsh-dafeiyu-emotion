## 设置页与侧边栏

- 新增 DSH 插件设置卡片：启用/停用、识别语言、VoiceSense 目录、Python 路径、录音上限、启动/分析超时。
- 安装 Better Sidebar 后，可在右侧边栏 `+` 菜单固定「情绪耳朵」，在对话旁边直接调整。
- 顶部实时显示轻量模式、增强模式、模型加载中、后端目录缺失或等待 Voice Input。
- 保存后立即写入 DSH 设置；路径或超时变化时自动重启语音 worker。

## 0.2.5 修复

- 导出 DSH 所需的 Schemastery `Config` schema，并把每个字段标记为 volatile。
- 0.2.4 的设置面板可以显示，但在要求注册 schema 的宿主上保存会失败；0.2.5 修复完整读写链路。

## 安装

```bash
dsh plugin --profile desktop add dsh-dafeiyu-emotion
```

完整变更见 [CHANGELOG](https://github.com/LiDu-china/dsh-dafeiyu-emotion/blob/main/CHANGELOG.md)。
