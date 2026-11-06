## 0.2.6

这是一个恢复可安装性并收紧设置链路的修复版本。

- 修复 `Config` 的 `maxAudioBytes` 默认值与旧 1 MiB step 冲突的问题；0.2.5 在部分宿主上会因为 schema 校验失败而无法激活。
- 设置页保存 `enabled` / `language` 后立即通知已挂载的鱼耳：关闭时隐藏按钮并禁用 `Alt+V`，切换语言时使用新值。
- 取消一个排队中的分析请求不再杀掉正在服务另一个会话的 worker。
- 三个数字输入框补上可见键盘焦点。
- 插件停用后状态卡显示“已停用”，不再显示“已就绪”。
- 数字配置只接受真实整数，拒绝布尔值、`null` 和数字字符串。
- 删除当前宿主未声明的 `settings.plugin.item` slot 注册。
- 新增 `Config` schema 解析测试，避免默认值再次违反自身约束。

## 安装

```bash
dsh plugin --profile desktop add dsh-dafeiyu-emotion
```

完整变更见 [CHANGELOG](https://github.com/LiDu-china/dsh-dafeiyu-emotion/blob/main/CHANGELOG.md)。
