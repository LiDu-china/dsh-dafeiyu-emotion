## 0.3.0

这是情绪耳朵的功能版本，新增共情策略、情绪时间线、隐私状态和可订阅的情绪上下文。

### 新增

- **共情策略**：温柔 / 直接 / 幽默 / 简洁，保存后会影响情绪化 prompt。
- **情绪时间线**：多段分析时在输入框内显示一条可悬停的情绪条，标出每段文本、情绪和置信度。
- **隐私与运行状态**：设置页显示最近情绪、最近音频大小、模型加载耗时、worker PID 和最近临时文件清理时间。
- **`/context` 接口**：本机 `GET /plugins/dsh-dafeiyu-emotion/context` 返回最近一次情绪上下文，供其他插件读取。

### 修复

- settings 从 `describe()` 解析真实 `entry.ns`，不再硬编码包名。
- 保存设置时携带 revision，两个窗口同时修改会返回 409。
- `settings` 改为动态注入，避免 Host 启动阶段硬依赖。
- Python 查找延迟到首次启动 worker，`apply` 不再同步 stat 文件系统。
- 显式清空 `backendRoot` 可以覆盖环境变量。
- 快捷键优先使用最近操作过的鱼耳，而不是最后挂载的实例。
- 窄侧边栏字段自动换行。
- 发布包不再包含测试脚本。

### 安装

```bash
dsh plugin --profile desktop add dsh-dafeiyu-emotion
```

升级后请完全退出并重新启动 the agent harness。
