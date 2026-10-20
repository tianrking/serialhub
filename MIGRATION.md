# 迁移到 SerialHub

从 `v0.0.2` 开始，项目的正式名称是 **SerialHub**：它更直接地描述了
“一个真实串口、多个安全客户端”的产品边界。

| 项目 | 新值 | 旧值 / 兼容性 |
| --- | --- | --- |
| GitHub 仓库 | `tianrking/serialhub` | GitHub 会重定向旧的 `oh_myserial` 地址 |
| Rust 包和主命令 | `serialhub` | 发布包同时带有 `ohmyserial` 兼容可执行文件（0.x 期间） |
| 默认配置名 | `serialhub.toml` | 旧 TOML 文件仍可通过 `-c <path>` 直接运行 |
| 示例配置 | `serialhub.example.toml` | 旧文件格式未变 |
| 新示例令牌环境变量 | `SERIALHUB_API_TOKEN` | 已有配置中的 `OHMYSERIAL_API_TOKEN` 仍然有效 |

## 为什么不改所有协议字符串

为避免升级后让已有数据、仪表盘和浏览器设置失效，以下 **版本化或持久化
标识保持不变**：

- 账本 schema：`ohmyserial.event`、`ohmyserial.segment`、
  `ohmyserial.stream-gap`
- Prometheus 指标：`ohmyserial_*`
- 浏览器 LocalStorage 键：`ohmyserial.web.*`

这些是兼容性标识，不是产品显示名称。将来若要改动，必须伴随新的 schema /
metric 版本并提供迁移路径。

## 当前版本与历史下载

按当前版本策略，源码/本地候选统一为 **0.0.4**。历史公开标签（包括数值更大的 v0.2.3）保留原样，不按大小推断功能新旧，也不覆盖旧资产。按 [RELEASE_NOTES.md](RELEASE_NOTES.md) 核对实际包和提交。新增语言/字号偏好使用 `serialhub.ui.*`，不迁移或删除旧连接配置。桌面管理器的 `/manager/info.limit` 现在为 `null`，表示无固定会话数上限。

## 推荐用法

Windows 真实串口：

```powershell
serialhub list-ports
serialhub share COM3 --baud 115200 --tcp 1 --ui
```

启动后在浏览器打开 `http://127.0.0.1:8787/`；传统 Windows 上位机需要
COM 口时，可按 [WINDOWS_COM_BRIDGE.md](./WINDOWS_COM_BRIDGE.md) 使用
`bridge-com` 与 com0com。上述 share/run 的明文端点只监听 loopback；桌面模式可明确启用经配对的 IPv4 LAN HTTP/WS。高级远程访问请
使用 SSH 隧道或经过 TLS 和认证的反向代理。

TOML 方式先预检、再启动：

```powershell
serialhub check -c serialhub.toml
serialhub run -c serialhub.toml --ui
```

`check` 会验证 TOML、权限和本地监听安全约束，并列出最终端点；它**不会**打开
真实串口或抢占端口，因此不等同于硬件/HIL 验收。
