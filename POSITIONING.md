# SerialHub 产品定义与架构（v0.0.2）

> **当前发布基线：** [SerialHub v0.0.2](https://github.com/tianrking/serialhub/releases/tag/v0.0.2)<br>
> **产品名 / 主命令 / Rust 包：** `SerialHub` / `serialhub` / `serialhub`<br>
> **许可证：** MIT<br>
> **适用范围：** 本文定义已发布产品的定位、能力边界、平台承诺和运维原则；不保留预研阶段、待决策事项或过时的 MVP 规划。

---

## 1. 产品定义

**SerialHub 是一个本地优先、跨平台的串口共享中枢。** 它由一个进程独占打开真实 UART / COM / tty，把设备的 RX 安全分发给多个客户端，并以明确的策略仲裁所有 TX。

它面向两类同时存在的使用者：

- 人类工程师：终端、传统上位机、Web 控制台；
- 自动化与 Agent：HTTP、WebSocket、TCP、RFC2217 和有界工作流。

产品承诺不是“让多个程序同时直接打开一个串口”，而是：

```text
一条真实串口
  └─ 一个 SerialHub owner
       ├─ RX：按权限、有界地 fan-out 给多个消费者
       └─ TX：按策略、租约和连接世代仲裁后才写入设备
```

这避免了操作系统的独占打开冲突，也避免多个 writer 静默交错字节。

---

## 2. 适用场景与非目标

| 场景 | SerialHub 提供的价值 |
| --- | --- |
| 嵌入式调试 | 人类终端查看日志时，脚本或 Agent 仍可观察、受控发送命令 |
| 自动化 / CI | 用 HTTP 确认主机侧写入、用事件账本留存证据、用有界工作流执行有限步骤 |
| 多个上位机观察同一设备 | Unix PTY、TCP、WebSocket 并联接入，RX 不必抢占真口 |
| Windows 传统 COM 软件 | Hub 持有真实 `COMx`；需要虚拟 COM 时，用现有驱动提供的 COM 对配合 `bridge-com` |
| 远程协作 | 本机仍保持回环监听；通过 SSH 隧道或带 TLS / 认证的反向代理访问 |

以下能力**不是 v0.0.2 的承诺**，不应据此采购、部署或宣传：

- 自研、内核级 Windows 虚拟 COM 驱动；
- UDP 传输、完整终端仿真器或通用可编程脚本引擎；
- 云账号、多租户 SaaS 或把明文串口接口直接暴露到 LAN / Internet；
- 对每一种 USB-UART 芯片、驱动、接线或设备协议的通用硬件认证。

---

## 3. v0.0.2 已交付能力

| 能力域 | 已交付内容 | 关键约束 |
| --- | --- | --- |
| 真实串口所有权 | 串口参数、自动重连、精确 USB VID/PID/序列号选择 | 每个真实端口只由一个 Hub owner 打开；模糊 USB 匹配会 fail-closed |
| 多端接入 | Unix PTY、原始 TCP、HTTP、WebSocket、可选 RFC2217 | 所有明文监听保持 loopback；每个读客户端都有有界队列 |
| TX 安全 | `queue_by_line`、`queue_by_frame`、`exclusive`、`primary_wins` | 不允许静默字节交错；原子 HTTP / WS 二进制写受大小和超时限制 |
| 写租约 | 随机、不透明 `lease_token` 的获取、续租、释放和失效 | `owner` 只是显示/审计信息，不是凭证；token 不进入状态或事件账本 |
| 控制与维护 | DTR / RTS / BREAK、有界 handoff、单进程多 profile `supervise` | 控制线默认关闭；需要显式 capability 和有效租约 |
| 可观测性 | 状态、端点、客户端、Prometheus 指标、事件查询 / 导出 / 流 | 主机侧 `write_all` + `flush` 不等同于设备协议 ACK |
| 证据与回放 | 有界内存事件环、可选 SHA-256 链式 NDJSON、只读离线回放 | 哈希发现损坏或断链，但不是来源签名；回放绝不触碰真实设备 |
| Web 控制台 | 会话配置、文字 / Hex、校验和、定时发送、解析器、日志与证据工具 | Bearer 只保存在页面内存；页面不直接打开真实串口 |
| 兼容接入 | RFC2217 Telnet 串口服务、Windows `bridge-com` | RFC2217 和 raw TCP 没有 Bearer 握手，因此也只能绑定 loopback |

---

## 4. 平台支持与实际边界

| 平台 / 发布资产 | 真串口 owner | PTY | TCP / HTTP / WS | Windows 旧 COM 软件 |
| --- | --- | --- | --- | --- |
| Linux x64 / ARM64 | 已实现 | 已实现 | 已实现 | 不适用 |
| macOS x64 / Apple Silicon | 已实现 | 已实现 | 已实现 | 不适用 |
| Windows x64 / ARM64 | 已实现（`COMx`） | 不支持 | 已实现 | `bridge-com` + 已安装的虚拟 COM 提供方 |

v0.0.2 Release 提供上述六个目标的二进制资产。CI、单元 / 集成测试、mock 传输和跨平台编译证明的是可重复的代码与协议行为；它们**不等同于**对某一 USB 转串口适配器、OS 驱动、RS-232/RS-485 电气层或业务设备命令的实机认证。

在面向生产的设备 / 适配器组合上线前，必须按 [`RELIABILITY_TEST_MATRIX.md`](./RELIABILITY_TEST_MATRIX.md) 做硬件在环验证：端口枚举、串口参数、拔插重连、控制线、真实上位机和实际协议命令都应留存证据。

---

## 5. 架构与不可变契约

```text
真实 UART / COM / tty
        │  仅一个 owner 打开、读写、重连和控制线操作
        ▼
┌─────────────────────────────────────────────────────────────┐
│ SerialHub                                                     │
│  Serial owner → Broker → RX fan-out / TX policy / lease      │
│                   │                                           │
│                   ├─ PTY（仅 macOS / Linux）                  │
│                   ├─ TCP raw / RFC2217（仅 loopback）         │
│                   ├─ HTTP API / WebSocket（Agent / Web）      │
│                   └─ 事件账本、指标、回放与监督               │
└─────────────────────────────────────────────────────────────┘
```

### 数据面

- **RX：** Hub 实际从系统驱动读到的字节按读取权限 fan-out；慢客户端采用可配置、有限的丢弃或断开策略，不能无限阻塞真口读循环。
- **TX：** 所有来源先进入策略层；流式写入按行或帧组装，HTTP 与 WebSocket 二进制写入为受限的原子请求。
- **连接世代：** 每次真口重连都产生新的 epoch；旧连接时期排队的写入在真正触发 OS 写入前重新校验，不会被重放给新会话。

### 控制面

- `GET /v1/status`、`/v1/endpoints`、`/v1/clients` 提供运行状态；
- `POST /v1/lock` / `DELETE /v1/lock` 管理写租约；
- `POST /v1/write` 在成功时确认的是 Hub 的主机侧写入和 flush；
- `POST /v1/control`、`/v1/handoff`、`/v1/handoff/resume` 是显式授权的物理控制与维护操作；
- `POST /v1/workflows/run` 只执行受边界保护的线性工作流，不是脚本执行器。

### 安全与部署

1. HTTP、WebSocket、原始 TCP 和 RFC2217 的明文监听只允许回环地址。
2. `api.token_env` 从环境变量读取 Bearer；不得放进 TOML、URL、提交记录或日志。
3. HTTP Host、WebSocket Origin 与 CORS 使用精确匹配；拒绝通配 CORS 与查询串 token。
4. 写租约、读写 capability、控制 capability 和大小 / 超时上限共同形成最小权限边界。
5. 远程访问通过 SSH 隧道，或让 TLS / 认证反向代理只连接回环 listener；Bearer 本身不能保护网络上的明文流量。

完整的请求、响应和错误语义见 [`README.md`](./README.md) 与 [`web/PROTOCOL.zh-TW.md`](./web/PROTOCOL.zh-TW.md)。

---

## 6. 命名与兼容性

`SerialHub` 与 `serialhub` 是唯一的产品显示名、仓库名、主命令和包名。

为了不破坏现有自动化，0.x 期间仍保留以下**兼容性标识**：`ohmyserial` 兼容可执行文件、版本化事件 schema、Prometheus 指标和浏览器存储键。它们不是对外品牌名称，也不应出现在新的部署、教程、截图或命令示例中。具体迁移规则见 [`MIGRATION.md`](./MIGRATION.md)。

---

## 7. 文档体系与权威顺序

| 需要回答的问题 | 当前权威文档 |
| --- | --- |
| 安装、启动、配置、API 和安全默认值 | [`README.md`](./README.md) / [`README.zh-CN.md`](./README.zh-CN.md) / [`README.es.md`](./README.es.md) |
| 产品范围、平台承诺和非目标 | 本文档 |
| 生成可校验的示例配置 | [`serialhub.example.toml`](./serialhub.example.toml)；再运行 `serialhub check -c ...` |
| 改名与兼容性 | [`MIGRATION.md`](./MIGRATION.md) |
| 事件账本、持久化、查询与回放 | [`EVENTS.md`](./EVENTS.md) |
| Agent 的有界工作流 | [`WORKFLOWS.md`](./WORKFLOWS.md) |
| 外部工具直连真口的安全交接 | [`HANDOFF.md`](./HANDOFF.md) |
| 单进程多 profile | [`SUPERVISOR.md`](./SUPERVISOR.md) |
| Windows COM-only 软件 | [`WINDOWS_COM_BRIDGE.md`](./WINDOWS_COM_BRIDGE.md) |
| 自动化覆盖与 HIL 边界 | [`RELIABILITY_TEST_MATRIX.md`](./RELIABILITY_TEST_MATRIX.md) |
| Web 控制台和 HTTP / WS 协议 | [`web/README.md`](./web/README.md)、[`web/README.zh-TW.md`](./web/README.zh-TW.md)、[`web/PROTOCOL.zh-TW.md`](./web/PROTOCOL.zh-TW.md) |

CLI 的 `--help`、配置校验结果和已发布的端点行为优先于示例文本；发现不一致时，应修正文档而不是依赖旧文章或猜测。

---

## 8. 发布与文档维护规则

每次发布前必须同步完成以下事项：

1. 版本号、CHANGELOG、主 README 的 Release 状态和本文档的发布基线一致；
2. 新能力同时更新主 README、对应专题文档、示例配置与 Web 协议（如适用）；
3. 旧名称仅在兼容性 / 迁移说明中保留；
4. 文档必须区分“自动化验证通过”和“已在特定硬件组合 HIL 验收”；
5. 删除或改写已失效的规划、临时决策和不再存在的命令，而不是把它们当作历史教程保留。

这份文档随当前发布维护；没有独立的草案规划或待拍板清单。
