## 0.2.7

修复设置页显示“设置暂时不可用 / 读取设置失败（404）”的 Host 激活问题。

- 0.2.5/0.2.6 在 `apply` 中读取了 `ctx.settings`，但插件只声明了 `webServer` 依赖。Cordis 会抛 `cannot get property "settings" without inject`，导致整个 Host 插件没有挂载，`/plugins/dsh-dafeiyu-emotion/config` 返回 404。
- 0.2.7 把 `settings` 加入声明依赖，Host 现在可以正常注册 health、analyze 和 config 路由。
- 新增回归断言：`webServer` 和 `settings` 必须同时出现在 `inject` 中。

## 安装

```bash
dsh plugin --profile desktop add dsh-dafeiyu-emotion
```

升级后请完全退出并重新启动 the agent harness，让 Host 重新加载插件。
