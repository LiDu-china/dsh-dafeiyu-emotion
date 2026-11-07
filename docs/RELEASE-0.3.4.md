## 0.3.4

修复 the agent harness 的包元信息校验错误。

### 修复

- `package.json` 声明的 `assets/icon-512.png` 原来为 308,711 字节，超过 the agent harness 的 256 KiB 上限。
- 图标已压缩到 38,338 字节，保留 512×512 尺寸和透明通道。
- 新增 `scripts/test-package-metadata.mjs`，发布前检查图标存在且不超过 256 KiB。

### 安装 / 升级

```bash
dsh plugin --profile desktop add dsh-dafeiyu-emotion
```

升级后请完全退出并重新启动 the agent harness。
