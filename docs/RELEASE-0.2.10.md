## 0.2.10

修复 Host 启动阶段的依赖死锁，并修正 volatile 配置解包。

- 移除 `settings` 硬依赖。改为 `ctx.inject(['settings'], ...)` 动态获取，避免 settings 服务尚未就绪时插件 fiber 一直 pending。
- `apply` 不再调用 `settings.describe()`，只在 `/config` 请求时读取运行时配置。
- `plainConfig()` 改为递归栈 + `finally` 清理，修复共享对象被误判为循环引用而丢失的问题。
- 新增共享引用、真实循环、`settings.describe()` 不应在启动阶段调用的回归测试。

## 注意

当前环境如果仍无法启动，请先确认 `magpie-mcp-git` / `magpie-mcp-anysearch` 没有阻塞 Host 启动。这两个 MCP 客户端在连接不可用时会等待重试，可能把 Host 启动拖过 60 秒。

## 安装

```bash
dsh plugin --profile desktop add dsh-dafeiyu-emotion
```

升级后请完全退出并重新启动 the agent harness。
