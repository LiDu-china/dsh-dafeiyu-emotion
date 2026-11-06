## 0.2.9

修复“the agent harness 打不开 / Host startup exceeded 60 seconds”。

- 根因：0.2.8 在 `apply` 期间同步调用 `settings.describe()`。此时 Host 还在挂载插件，遍历所有插件配置可能造成启动死锁，最终 60 秒超时。
- 0.2.9 的 `apply` 只读取 `cordis.patch.yml` 的 patch 配置，不再在启动事务里调用 `settings.describe()`。
- 设置页的读取/写入仍通过 `/plugins/dsh-dafeiyu-emotion/config`；`PATCH` 会更新共享运行时配置并调用 `settings.update()` 持久化。
- `plainConfig()` 增加循环引用和深度保护，避免异常 volatile ref 卡死启动或设置请求。
- 新增回归测试：`settings.describe()` 在 `apply` 期间如果被调用会直接抛错。

## 安装

```bash
dsh plugin --profile desktop add dsh-dafeiyu-emotion
```

升级后请完全退出并重新启动 the agent harness。若之前因 0.2.8 无法启动，可先进入安全模式或临时移除插件，再安装 0.2.9。
