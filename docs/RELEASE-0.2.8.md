## 0.2.8

修复设置页把增强后端目录显示成 `[object Object]` 的问题。

- DSH 的 settings 服务会把 `Config` 的 volatile 字段投影成 `{ get() }` 引用。
- 0.2.7 直接对引用做 `String()`，得到 `[object Object]`，再被 `resolve()` 拼成 `C:\...\profiles\desktop\[object Object]`，于是状态卡显示“后端目录不存在”。
- 0.2.8 在 `readSettings()` 和 `resolveOptions()` 中统一用 `plainConfig()` 递归解包，再处理路径、语言和数字。
- 新增回归测试，确保 volatile ref 不会被字符串化成假路径。

## 安装

```bash
dsh plugin --profile desktop add dsh-dafeiyu-emotion
```

升级后请完全退出并重新启动 the agent harness，让 Host 重新读取 0.2.8。
