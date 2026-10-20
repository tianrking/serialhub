<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/serialhub-lockup-dark.svg" />
  <source media="(prefers-color-scheme: light)" srcset="assets/brand/serialhub-lockup-light.svg" />
  <img alt="SerialHub — One port. Shared access." src="assets/brand/serialhub-lockup-dark.svg" width="1200" />
</picture>

<p align="center">
  <a href="README.md"><img alt="English" src="https://img.shields.io/badge/lang-English-3b82f6?style=flat-square" /></a>
  <a href="README.zh-CN.md"><img alt="简体中文" src="https://img.shields.io/badge/lang-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-e11d48?style=flat-square" /></a>
  <a href="README.es.md"><img alt="Español" src="https://img.shields.io/badge/lang-Espa%C3%B1ol-22c55e?style=flat-square" /></a>
  &nbsp; / &nbsp;
  <a href="GETTING_STARTED.zh-CN.md">快速上手</a> · <a href="DOCS.md">完整文档</a> · <a href="https://github.com/tianrking/serialhub/releases">下载</a>
</p>

<p align="center">
  <a href="Cargo.toml"><img alt="Source version: 0.0.4" src="https://img.shields.io/badge/source-v0.0.4-0ea5e9?style=flat-square" /></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-3b82f6?style=flat-square" /></a>
  <a href="DESKTOP.md"><img alt="Platforms: Windows, macOS, Linux" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-64748b?style=flat-square" /></a>
  <a href="https://www.rust-lang.org/"><img alt="Rust" src="https://img.shields.io/badge/Rust-2021-e57324?style=flat-square&amp;logo=rust&amp;logoColor=white" /></a>
  <a href="web/package.json"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&amp;logo=typescript&amp;logoColor=white" /></a>
  <a href="web/package.json"><img alt="React" src="https://img.shields.io/badge/React-149eca?style=flat-square&amp;logo=react&amp;logoColor=white" /></a>
</p>

<p align="center">
  <a href="Cargo.toml"><img alt="Async: Tokio" src="https://img.shields.io/badge/async-Tokio-c026d3?style=flat-square" /></a>
  <a href="Cargo.toml"><img alt="Web: Axum" src="https://img.shields.io/badge/web-Axum-7c3aed?style=flat-square" /></a>
  <a href="DOCS.md"><img alt="Serial: UART, COM, tty" src="https://img.shields.io/badge/serial-UART%20%2F%20COM%20%2F%20tty-0ea5e9?style=flat-square" /></a>
  <a href="web/PROTOCOL.zh-TW.md"><img alt="API: HTTP and WebSocket" src="https://img.shields.io/badge/API-HTTP%20%2B%20WebSocket-06b6d4?style=flat-square" /></a>
  <a href="DOCS.md"><img alt="Stream: TCP" src="https://img.shields.io/badge/stream-TCP-3b82f6?style=flat-square" /></a>
  <a href="DOCS.md"><img alt="Unix: PTY" src="https://img.shields.io/badge/Unix-PTY-14b8a6?style=flat-square" /></a>
  <a href="serialhub.example.toml"><img alt="Config: TOML" src="https://img.shields.io/badge/config-TOML-e11d48?style=flat-square" /></a>
</p>

本地优先的串口调试工作台。每个真实串口由一个 owner 持有，浏览器、测试脚本与传统上位机共享接收数据，并统一仲裁发送；多个设备可以同时平铺调试。

**当前源码 / 本地候选：0.0.4。** 历史公开 v0.2.3 下载不含最新托盘、平铺及字号更新；参见[发布状态](RELEASE_NOTES.md)。

**安装与无界面运行：**参见[包管理器、固定端口服务与登录自启动](INSTALLATION.md)。桌面用户仍可下载便携包，双击打开网页。

### 下载与安装状态 · 0.0.4

| 分发形式 | 当前状态 |
| --- | --- |
| 便携包、Python `.whl`、原生 npm `.tgz` | Windows x64、Linux x64 已实际编译并完成本地冒烟测试；**TODO**：macOS Intel / Apple Silicon、Linux ARM64、Windows ARM64 的实际产物与原生验证 |
| Debian `.deb` | Linux amd64 已生成并完成本地测试；**TODO**：arm64 实际产物 |
| GitHub Release 下载 | **TODO：上传并发布 0.0.4**；本地文件还不是公开下载 |
| PyPI `serialhub-cli` / npm `@tianrking/serialhub` | **TODO：注册、上架**；暂不能从公开源执行一行安装 |
| Homebrew / WinGet / 签名 APT 源 | 已实现定义生成与校验；**TODO：发布 tap、提交并通过目录审核、托管签名仓库** |

软件源尚未上架时，GitHub Release 仍可附带 wheel、npm 压缩包和 Debian 包，供用户本地安装。参见[平台与格式矩阵、离线安装、未完成事项](INSTALLATION.md#platform-and-format-status)。PyPI 上的 `serialhub` 属于其他项目，本项目使用 `serialhub-cli`。

## 工作台一览

![SerialHub 在一个工作区内平铺四个独立 Mock 串口](docs/screenshots/multi-port.png)

*当前源码 0.0.4 · 四路 Mock 回环设备 · 真实 HTTP/WS 收发 · 1440 × 900。点击图片可查看原始尺寸。*

<details>
<summary>展开查看实时终端、信号仪表和设备管理</summary>

### 实时终端

同时查看接收、发送和协议工具，支持文字/HEX、日志复制、过滤与导出。

![SerialHub — 实时终端](docs/screenshots/console.png)

### 信号仪表

多通道示波、游标、频谱和数值仪表协同显示。图中为合成的 64 Hz FireWater 演示信号，不代表硬件测量。

![SerialHub — 信号仪表](docs/screenshots/signal-studio.png)

### 设备管理

在浏览器中打开多个独立设备、设置串口参数，并分别管理每个 owner 的生命周期。

![SerialHub — 设备管理](docs/screenshots/devices.png)

</details>

界面默认英文，支持繁体/简体中文、西班牙语、法语和阿拉伯语 RTL。点击 **Aa** 可调整界面文字和串口日志/发送框字号。参见[多语言](I18N.md)、[显示设置](DISPLAY.md)和[品牌规范](BRAND.md)。

[MIT](LICENSE) · Rust · Windows / macOS / Linux · [CI](https://github.com/tianrking/serialhub/actions/workflows/ci.yml)

---

## 目录

- [项目是什么？](#项目是什么)
- [要解决什么问题？](#要解决什么问题)
- [功能一览](#功能一览)
- [工作原理](#工作原理)
- [平台支持](#平台支持)
- [安装与编译](#安装与编译)
- [快速开始](#快速开始)
- [Web 串口控制台](#web-串口控制台)
- [怎么用（场景）](#怎么用场景)
- [配置说明](#配置说明)
- [命令行](#命令行)
- [HTTP / WebSocket API](#http--websocket-api)
- [事件账本与安全回放](#事件账本与安全回放)
- [发送策略（TX）](#发送策略tx)
- [Unix 虚拟串口（PTY）](#unix-虚拟串口pty)
- [Windows 说明](#windows-说明)
- [安全](#安全)
- [名称与兼容迁移](./MIGRATION.md)
- [目录结构](#目录结构)
- [开发](#开发)
- [当前发布范围](#当前发布范围)
- [常见问题](#常见问题)
- [贡献](#贡献)
- [许可证](#许可证)
- [技术标签](#技术标签)

---

## 不输入命令即可使用

当前源码/候选包为 **0.0.4**；GitHub 历史 **v0.2.3** 包不含本次托盘与多串口平铺更新。使用经过验证的 0.0.4 候选包或按本文编译源码。解压对应平台包后：Windows 双击 `serialhub-desktop.exe`，macOS 打开 `SerialHub.app`，Linux 将 `serialhub-desktop` 作为程序运行。
浏览器会自动打开设备管理首页；扫描、选择串口、设置参数并打开工作区。可同时运行多个独立串口会话，并在首页启用带配对链接的 IPv4 局域网访问。
无需安装 Node.js 或 Rust。下载包未签名，系统可能要求确认；串口驱动和权限仍需配置。完整说明见 [使用与验收](./GETTING_STARTED.zh-CN.md) 和 [桌面架构](./DESKTOP.md)。

## 项目是什么？

**SerialHub** 是用 Rust 编写的轻量、开源 **串口共享中枢（Serial Hub）**。

它会：

1. **独占打开**真实串口  
2. 把设备 **RX 广播**给多个客户端  
3. 对 **TX 做仲裁**，避免两路写入静默交错、协议乱掉  
4. 提供 **TCP、HTTP/WebSocket（给 Agent）、PTY（给传统上位机，macOS/Linux）**

典型场景：嵌入式调试时，**人要看串口，AI Agent / 脚本也要同时读写**。

| 项 | 内容 |
|----|------|
| 二进制名 | `serialhub` |
| 仓库 | [github.com/tianrking/serialhub](https://github.com/tianrking/serialhub) |
| 语言 | Rust（edition 2021） |
| 许可证 | MIT |
| 文档 | [English](./README.md)（默认）· **简体中文** · [Español](./README.es.md) |
| 产品/架构详述 | [`POSITIONING.md`](./POSITIONING.md) |
| 当前源码 / 本地候选 | 0.0.4，公开发布 **TODO** |
| 历史公开版本 | [v0.2.3](https://github.com/tianrking/serialhub/releases/tag/v0.2.3) |

> **项目已由 ohmyserial 更名为 SerialHub。** `serialhub` 是正式命令和包名；
> 0.x 发布包仍提供兼容可执行文件，版本化账本 schema、Prometheus 指标和浏览器
> 已保存设置不会被改名破坏。升级自动化前请先看 [MIGRATION.md](./MIGRATION.md)。

---

## 要解决什么问题？

| 你想… | 现实 |
|------|------|
| 上位机一直开着 | 串口已被占用 |
| Agent/脚本同时读日志 | 第二个程序打不开口 |
| 两边都能发命令 | 字节交错 → 指令/协议损坏 |

### 解法

```text
设备 (UART/COM)
        │
        ▼
   ┌──────────┐
   │ serialhub│  ← 唯一打开真串口的进程
   └────┬─────┘
        │
   ┌────┴─────────────────────────────┐
   ▼                ▼                 ▼
  PTY            TCP 流           HTTP + WebSocket
 (上位机)         (脚本)              (Agent)
```

---

## 功能一览

### 功能特性

| 功能 | 说明 | 状态 |
|------|------|------|
| 独占真串口 | 系统层只由 hub 打开硬件 | ✅ |
| 串口参数 | 波特率、数据位、校验、停止位、流控 | ✅ |
| RX 广播 | 所有可读客户端收到设备数据 | ✅ |
| TX 仲裁 | 按行/帧排队、独占、主客户端优先 | ✅ |
| 写锁租约 | 限时独占发送权 | ✅ |
| 断线重连 | 可选自动重新打开 | ✅ |
| TCP 客户端 | 原始双向字节流 | ✅ |
| HTTP API | health / status / endpoints / events / workflows / write / control / handoff / lock | ✅ |
| WebSocket | 实时 RX（可带历史） | ✅ |
| Unix PTY | 符号链接虚拟串口 | ✅（macOS/Linux） |
| 会话日志 | 控制台 + 文件；text/hex | ✅ |
| Web 串口控制台 | 会话配置、行尾、快捷指令、定时发送、校验和、协议分析、波形、证据筛选/导出、指标、DTR/RTS/BREAK | ✅ |
| 事件账本 | 版本化 RX/TX/连接/控制/gap 证据；有界内存 + 可选哈希 NDJSON | ✅ |
| 安全回放 | 校验后只读的 `immediate` / `original` / `manual` 回放 | ✅ |
| 配置预检 | `serialhub check -c profile.toml` 验证 TOML 与安全端点策略，不会打开真实串口 | ✅ |
| Mock 口 | `mock:demo` 无硬件回环 | ✅ |
| TOML + CLI | `share` / `run` / `check` / `init` / `list-ports` / `status` / `supervise` | ✅ |
| 单进程多真口 | `supervise` 多 profile | ✅ |
| RFC2217 | 网络串口控制 | ✅ |
| Windows COM 桥接 | `bridge-com` + 已安装的 com0com/虚拟 COM 对 | ✅ |
| Windows 原生虚拟 COM | 驱动级 | 外部签名驱动 |

快速启动时也可以直接指定完整串口参数：

```bash
serialhub share COM3 --baud 115200 --data-bits 8 --parity none --stop-bits 1 --flow-control none
```

`--parity` 支持 `none/odd/even`，`--flow-control` 支持
`none/software/hardware`。TOML 的 `[real]` 配置仍支持相同字段；`run` 命令
可用同名选项临时覆盖，不会改写配置文件。

### 技术特性

| 方面 | 技术 |
|------|------|
| 运行时 | Tokio |
| HTTP/WS | Axum |
| 串口 | `serialport` + 独立读线程 |
| 配置 | Serde + TOML |
| 日志 | `tracing` + 会话 blog |
| 证据 | 规范 v1 账本 + SHA-256 链式 NDJSON 分段 |
| 回放 | 只输出校验后的事件；与实时 Broker、串口写入隔离 |
| Unix PTY | `nix` openpty |
| 测试 | 单元 + 集成（mock） |
| CI | Ubuntu · macOS · Windows |

---

## 工作原理

### 数据面

```text
设备 ──RX──► Serial Core ──► Broker 广播 ──► 各客户端
客户端 ──TX──► Broker 准入(策略/锁) ──► Serial Core ──► 设备
```

### 控制面

- `GET /v1/status`：连接状态、波特率、客户端、锁、计数  
- `POST/DELETE /v1/lock`：写锁  
- `POST /v1/write`：以命名客户端注入发送  

### 模块结构

```text
CLI / 配置
    └── Hub
            ├── Serial 核心（打开、重连、mock）
            ├── Broker（注册、广播、TX 队列）
            ├── Policy（发送策略）
            ├── Clients：PTY · TCP · HTTP/WS
            ├── Ledger（有序证据、有界 ring、可选持久化）
            ├── Replay（校验后只读、离线）
            └── Observe（人类可读日志）
```

---

## 平台支持

| 能力 | macOS | Linux / Ubuntu | Windows |
|------|:-----:|:--------------:|:-------:|
| 真串口 | ✅ | ✅ | ✅ |
| TCP | ✅ | ✅ | ✅ |
| HTTP + WebSocket | ✅ | ✅ | ✅ |
| PTY 虚拟串口 | ✅ | ✅ | — |
| Mock 回环 | ✅ | ✅ | ✅ |

**Ubuntu：** 编译前安装 `build-essential pkg-config libudev-dev`。  
**Windows：** 仅认 COM 的老上位机需 TCP/WS 或外部虚拟 COM 桥；不支持 `type = "pty"`。

COM-only 老软件可以使用内置用户态桥接命令（先用 com0com 等已安装驱动创建
成对 COM 端点）：

```powershell
serialhub.exe share COM3 --tcp 1 --tcp-raw --tcp-base 8788
serialhub.exe bridge-com COM13 --tcp 127.0.0.1:8788 --baud 115200
```

完整创建、验证与安全边界见 [`WINDOWS_COM_BRIDGE.md`](./WINDOWS_COM_BRIDGE.md)。
该命令只转发字节，不安装或冒充 Windows 内核虚拟串口驱动。

---

## 安装与编译

### 依赖

- [Rust](https://rustup.rs/) stable  
- **Ubuntu/Debian：**

  ```bash
  sudo apt update
  sudo apt install -y build-essential pkg-config libudev-dev
  ```

### 源码编译

```bash
git clone https://github.com/tianrking/serialhub.git
cd serialhub
cargo build --release
```

| 系统 | 二进制 |
|------|--------|
| Unix | `./target/release/serialhub` |
| Windows | `.\target\release\serialhub.exe` |

```bash
cargo test
./target/release/serialhub --help
```

完整的发布前测试矩阵、跨平台检查命令以及真实串口硬件在环边界见
[`RELIABILITY_TEST_MATRIX.md`](./RELIABILITY_TEST_MATRIX.md)。

---

## 快速开始（最省事）

**不用写配置文件**，一条命令：

```bash
# 1) 看本机有哪些串口
./target/release/serialhub list-ports

# 2) 共享（macOS/Linux 默认并联 2 个虚拟串口 + TCP + WebSocket）
./target/release/serialhub share /dev/cu.usbmodem14101 --baud 115200

# 要 3 个虚拟串口给 3 个上位机
./target/release/serialhub share /dev/ttyUSB0 --pty 3

# Windows：没有 PTY，用多 TCP + 多 WS
./target/release/serialhub share COM3 --tcp 2

# 无硬件演示
./target/release/serialhub share mock:demo
```

启动后终端会打印 **连接卡片**（SERIAL / TCP / WS 地址）。

| 参数 | 含义 | 默认 |
|------|------|------|
| `--baud N` | 波特率 | `115200` |
| `--data-bits N` | 数据位（5/6/7/8） | `8` |
| `--parity VALUE` | 校验（none/odd/even） | `none` |
| `--stop-bits N` | 停止位（1/2） | `1` |
| `--flow-control VALUE` | 流控（none/software/hardware） | `none` |
| `--pty N` | N 个虚拟串口（Unix） | macOS/Linux=`2`，Windows=`0` |
| `--tcp N` | N 个 TCP 端口 | `1` |
| `--tcp-raw` | 二进制桥接/协议客户端的 TCP 原子读取 | 关闭 |
| `--tcp-base N` | TCP 起始端口 | `8788` |
| `--api HOST:PORT` | HTTP/WS 地址 | `127.0.0.1:8787` |
| `--quiet` | 不镜像会话日志到终端 | 关闭 |
| `--ui` | 启动后打开嵌入式 Web 控制台 | 关闭 |

高级：`init` 生成 TOML，或 `run -c file.toml -d 设备 --pty 3`。

---

## Web 串口控制台

`share --ui` / `run --ui` 会打开嵌入式控制台；也可以直接访问 API 根地址：

```text
http://127.0.0.1:8787/
```

控制台当前包含：

- host/port 会话配置（保存在当前浏览器，不保存 Bearer Token）；
- 文本/Hex 发送、无结尾/LF/CR/CRLF、Ctrl/⌘+Enter；
- 快捷指令、50 ms 起定时发送、SUM8/XOR8/CRC16 校验和预览；
- 文本/Hex/双栏日志、暂停/自动滚动、时间戳和日志导出；
- RawData、FireWater CSV、JustFloat LE 分片解析与基础 SVG 波形；
- 写锁以及受 `api.can_control` + 写锁保护的 DTR/RTS/BREAK 控制。

所有网页写入仍通过 `POST /v1/write`，不会绕过 Hub 的 TX 仲裁、大小限制或
主机写入确认。串口 baud、data bits、parity、stop bits、flow control 在设备
打开前由 CLI/TOML 设置；网页不会在运行中隐式改变硬件参数。详细 UI 与 API
说明见 [`web/README.zh-TW.md`](./web/README.zh-TW.md) 和
[`web/PROTOCOL.zh-TW.md`](./web/PROTOCOL.zh-TW.md)。

---

## 怎么用（场景）

### 核心：一个真串口 → 并联多个监控/交互端

```text
                 ┌─ PTY /tmp/serialhub-v0  → 串口上位机 #1
                 ├─ PTY /tmp/serialhub-v1  → 串口上位机 #2 / Agent 读虚拟串口
 真串口 ──► hub ─┼─ TCP :8788            → 多个脚本同时连
                 ├─ TCP :8789            → 更多工具
                 └─ WS  /v1/stream        → 多个 Agent 同时连
```

所有端看到**同一份实时 RX**；TX 由策略/写锁仲裁，避免静默交错。

用 **`[fanout]`** 一键批量生成，或用 `[[clients]]` 逐个声明。

```bash
curl -s http://127.0.0.1:8787/v1/endpoints
```

### A. 多上位机 + Agent

```toml
[fanout]
pty_count = 2
pty_link_prefix = "/tmp/serialhub-v"
tcp_count = 1
tcp_base_port = 8788
```

- 两个串口软件分别打开 `v0` / `v1`  
- Agent：`ws://127.0.0.1:8787/v1/stream`（可多连）  
- 脚本：`nc 127.0.0.1 8788`（可多连）

### B. 仅脚本 / CI

`tcp_count = 2` + API，不配 PTY。

### C. 无硬件演示

`path = "mock:demo"` 回环。

### D. 写锁独占窗口

```bash
LEASE_TOKEN="$(curl -s -X POST http://127.0.0.1:8787/v1/lock \
  -H 'content-type: application/json' \
  -d '{"as_client":"agent"}' | jq -r '.lock.lease_token')"

curl -s -X POST http://127.0.0.1:8787/v1/write \
  -H 'content-type: application/json' \
  -d "{\"text\":\"AT\",\"newline\":true,\"as_client\":\"agent\",\"lease_token\":\"$LEASE_TOKEN\"}"

# 在租约到期前续租
curl -s -X POST http://127.0.0.1:8787/v1/lock \
  -H 'content-type: application/json' \
  -d "{\"lease_token\":\"$LEASE_TOKEN\"}"

curl -s -X DELETE http://127.0.0.1:8787/v1/lock \
  -H 'content-type: application/json' \
  -d "{\"lease_token\":\"$LEASE_TOKEN\"}"
```

`as_client` 只是显示和审计名称，不是凭证；同名客户端不能冒充持锁者。请把不透明的 `lease_token` 当作秘密，仅保存在内存中。

---

## 配置说明

完整示例：[`serialhub.example.toml`](./serialhub.example.toml)

```powershell
serialhub check -c serialhub.toml  # 只做配置与安全预检，不打开串口
serialhub run -c serialhub.toml --ui
```

```toml
[real]
path = "mock:demo"
# 可选：按 USB 身份选择，避免 COM/tty 重编号后连错设备
# usb = { vid = 0x10c4, pid = 0xea60, serial_number = "board-01" }
baud = 115200
databits = 8
parity = "none"
stopbits = 1
flow = "none"
reconnect = true

[tx]
mode = "queue_by_line"     # queue_by_line | queue_by_frame | exclusive | primary_wins
primary = "ui"
write_lock_ms = 3000
write_timeout_ms = 5000
max_frame_bytes = 65536
max_write_bytes = 65536
slow_client = "drop_oldest"
client_queue = 256
slow_block_ms = 1000

[api]
bind = "127.0.0.1:8787"
enabled = true
can_read = true
can_write = true
# 物理 DTR/RTS/BREAK 控制；每次请求仍必须带写租约
can_control = false
# token_env = "SERIALHUB_API_TOKEN"
# cors_origins = ["https://serial-console.example.com"]

[[clients]]
type = "tcp"
name = "tcp"
bind = "127.0.0.1:8788"

[[clients]]
type = "websocket"
name = "agent"
history_bytes = 65536

# 仅 macOS / Linux
# [[clients]]
# type = "pty"
# name = "ui"
# link = "/tmp/serialhub-ui"

[ledger]
memory_events = 16384
memory_bytes = 33554432
stream_capacity = 1024
# directory = "./serialhub-ledger"  # 开启哈希 NDJSON 持久化
rotate_bytes = 67108864
fsync_each_event = false

[log]
mirror_console = true
format = "hex+text"
```

`real.usb` 可选用于按 USB 身份选择设备，避免 COM/tty 路径在重连后变化：
填写非零 VID/PID，并在同型号设备超过一个时填写 `serial_number`。每次打开前
都会重新枚举；零匹配或多匹配会保持断开并报告错误，不会猜测目标设备。selector
不能和 `mock:` 路径同时使用。

多串口可由同一进程独立监督：

```bash
serialhub supervise -c board-a.toml -c board-b.toml
```

启动前会检查 API/TCP/WS 监听、PTY 链接、真实设备路径、USB selector 和账本
目录冲突；任一 profile 启动失败会回滚已经启动的 hub，Ctrl+C 会逐个优雅关闭。
详细约定见 [`SUPERVISOR.md`](./SUPERVISOR.md)。

| 字段 | 含义 |
|------|------|
| `real.path` | 设备路径或 `mock:名称` |
| `tx.mode` | 并发写策略 |
| `tx.write_timeout_ms` | 入队到主机写入确认的总超时 |
| `tx.max_frame_bytes` / `max_write_bytes` | 流式帧与原子写入的大小上限 |
| `tx.slow_client` / `client_queue` / `slow_block_ms` | 每个读客户端的有界背压策略 |
| `api.bind` | HTTP/WS 地址；明文监听始终限制为回环地址 |
| `api.token_env` | 保存 API Bearer 密钥的环境变量名，密钥不写入 TOML |
| `api.cors_origins` | 精确的浏览器 Origin 白名单；空值仅同源，拒绝 `*` |
| `api.can_control` | 显式开启 DTR/RTS/BREAK 与交接能力；每次请求仍需写租约 |
| `ledger.memory_events` / `memory_bytes` | 始终启用的有界事件证据 ring |
| `ledger.directory` | 可选的追加式哈希 NDJSON 持久化根目录 |
| `ledger.stream_capacity` / `rotate_bytes` | 实时事件订阅上限 / 分段大小目标 |
| `ledger.fsync_each_event` | 每个事件都强制进入系统存储缓存；更稳但更慢 |
| `can_read` / `can_write` | 客户端权限 |

---

## 命令行

```bash
serialhub share <device> [串口/端点选项]  # 零配置启动 hub
serialhub run -c serialhub.toml    # 启动 hub
serialhub check -c serialhub.toml  # 验证 TOML、权限与监听安全约束，不打开真实串口
serialhub supervise -c board-a.toml -c board-b.toml  # 单进程多真口
serialhub init [-o file]           # 生成示例配置
serialhub list-ports               # 列出串口
serialhub status [--api URL]       # 查询运行状态
serialhub bridge-com COM13 --tcp 127.0.0.1:8788  # 现有 COM 对 -> TCP
serialhub replay <source>          # 校验并输出封存的账本捕获
serialhub replay <source> --mode original --speed 2
serialhub replay <source> --mode manual --step 10
```

当 TCP 端点连接二进制协议或 `bridge-com` 时，`share` 请增加 `--tcp-raw`；
它会跳过按行/分隔符组帧，让每个 TCP 读取块作为一个有界原子 TX 单元进入 Hub。

`share` 和 `run` 支持 `--baud`、`--data-bits`、`--parity`、`--stop-bits`、
`--flow-control`；`run` 的这些选项只临时覆盖 TOML，不会改写配置文件。完整
参数以 `serialhub share --help` / `serialhub run --help` 为准。

```bash
RUST_LOG=debug serialhub run -c serialhub.toml
```

---

## HTTP / WebSocket API

**默认根地址：** `http://127.0.0.1:8787`

明文 API 和独立 WebSocket 监听始终限制为回环地址。配置 `api.token_env` 后，除 `/v1/health` 外的所有 `/v1/*` 请求都必须带 `Authorization: Bearer <token>`。密钥只从该环境变量读取，不要放进 TOML、URL 或日志。Bearer 不能保护网络上的明文 `http://` / `ws://`，因此即使配置 token，非回环监听也会拒绝启动；远程访问请使用 SSH 隧道，或在回环监听前部署 TLS 反向代理。

浏览器默认只能同源调用；请求的 Host 还必须对应实际回环监听地址，以阻断 DNS rebinding 别名。`api.cors_origins` 只放行逐项精确匹配的 Origin，通配符会被拒绝。WebSocket 还会单独检查 `Origin` 是否同主机或在白名单中。浏览器用 `new WebSocket(url, ["bearer", token])` 传 Bearer，不支持查询参数 token；无 `Origin` 的非浏览器客户端在启用鉴权时仍须提供 Bearer。

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/v1/health` | 存活检查 |
| `GET` | `/v1/status` | 串口/客户端/锁/统计 |
| `GET` / `POST` | `/v1/serial/settings` | 读取/修改串口参数；POST 需要控制权限和有效租约 |
| `GET` | `/v1/serial/ports` | Hub host serial-port inventory |
| `GET` | `/v1/endpoints` | 已配置的并联端点 |
| `GET` | `/v1/clients` | 客户端列表 |
| `GET` | `/v1/events/status` | 账本会话、ring、持久化和恢复状态 |
| `GET` | `/v1/events` | 按游标查询，可过滤类型/epoch/actor/字节 |
| `GET` | `/v1/events/export` | 规范事件 NDJSON 导出 |
| `GET` | `/v1/metrics` | Prometheus 文本指标（遵守读取权限） |
| `POST` | `/v1/workflows/run` | 有界线性 lease/send/expect 工作流 |
| `POST` | `/v1/write` | 向设备发送 text 或 hex |
| `POST` | `/v1/control` | DTR/RTS/BREAK；需要 `can_control` 与租约 token |
| `POST` | `/v1/handoff` | 关闭真实串口，给外部维护工具一个有界窗口 |
| `POST` | `/v1/handoff/resume` | 用一次性交接 token 恢复 owner |
| `POST` | `/v1/lock` | 申请写锁 |
| `DELETE` | `/v1/lock` | 释放写锁 |
| `WS` | `/v1/stream` | 实时 RX |
| `WS` | `/v1/events/stream` | 只读 JSON 事件：先快照再实时 |

### 发送示例

```bash
curl -s -X POST http://127.0.0.1:8787/v1/write \
  -H 'content-type: application/json' \
  -d '{"text":"AT","newline":true,"as_client":"agent"}'

curl -s -X POST http://127.0.0.1:8787/v1/write \
  -H 'content-type: application/json' \
  -d '{"hex":"41 54 0d 0a","as_client":"agent"}'
```

HTTP 的 text/hex 都按一次原子命令处理，不受分隔符组帧影响。`ok: true` 表示串口所有者线程已完成主机侧 `write_all` 和 `flush`，不代表设备已解析或确认命令。入队和确认共用 `tx.write_timeout_ms` 截止时间；若错误提示结果可能为 partial/unknown，驱动可能已经写出部分或全部字节，不能盲目重试。

租约生效时，写请求必须携带 `lease_token`。`POST /v1/lock` 首次申请会返回随机 token；带 token 再次 POST 是续租；`DELETE /v1/lock` 带 token 才能释放。状态接口不会泄露 token。

物理控制线默认关闭；设置 `api.can_control = true` 后，先申请写租约，再用
`POST /v1/control` 操作 DTR/RTS/BREAK。命令由唯一串口 owner 执行并等待主机驱动确认；
mock 口没有物理控制线，硬件流控启用时 RTS 会被拒绝。需要临时让 PuTTY、SSCOM
等工具直接打开真串口时，使用 [`HANDOFF.md`](./HANDOFF.md) 的有界交接协议；交接 token
只可使用一次，不进入状态或事件账本。

### WebSocket

```text
ws://127.0.0.1:8787/v1/stream
```

- 服务端发二进制 RX；连接后可能先发送历史缓存。
- 客户端发文本时补换行并走流式组帧；发二进制时整帧作为一次原子写入，受 `max_write_bytes` 限制。
- 写入被拒绝时会收到 `type = "ohmyserial.error"` 的 JSON 文本帧。WebSocket 入队不等于设备写入确认；需要主机写入 + flush 结果时使用 HTTP。

### TCP

```bash
nc 127.0.0.1 8788
```

原始 TCP 没有 API Bearer 握手，必须保持回环监听。远程使用时通过 SSH 隧道转发：

```bash
ssh -L 8788:127.0.0.1:8788 user@device-host
nc 127.0.0.1 8788
```

### 最小 Python 示例

```python
import json, urllib.request

req = urllib.request.Request(
    "http://127.0.0.1:8787/v1/write",
    data=json.dumps({"text": "status", "newline": True}).encode(),
    headers={"content-type": "application/json"},
    method="POST",
)
print(urllib.request.urlopen(req).read().decode())
```

---

## 事件账本与安全回放

每次运行都有一条有序的 v1 证据流，记录进程实际观察到的精确 RX 字节、主机侧确认完成的 TX、连接世代、控制动作和显式不确定性 `gap`。有界内存 ring 始终启用；设置 `ledger.directory` 后，还会写入轮转的 SHA-256 链式 NDJSON 分段，执行保守的崩溃恢复，并支持磁盘补全查询/导出。

```bash
# 从排他序号游标之后查询规范事件。
curl -s 'http://127.0.0.1:8787/v1/events?after_seq=0&limit=100&type=rx,tx'

# 回放一个封存分段，或只包含一个会话的目录。
serialhub replay ./one-session-directory --mode original --speed 2
```

原始 `/v1/stream` WebSocket 承载双向串口字节；`/v1/events/stream` 是另一条只读通道，发送 JSON 文本事件并支持游标/过滤器。回放只会校验并输出原始事件，不会打开设备，也不会把历史 TX 重新送进实时 Broker。

分段哈希能发现损坏和链断裂，但不是数字签名或来源证明；程序也不会自动删除旧分段。RX 证据从进程成功读到字节时才开始，硬件或驱动在此之前的丢失可能无法得知。主机侧 TX `write_all` + `flush` 不等于设备确认。Mock 测试也不等于硬件在环测试。

完整的 envelope、事件类型、gap 语义、存储/恢复模型、API 分页与 WebSocket 补流流程、回放安全边界见 [`EVENTS.md`](./EVENTS.md)；工作流 DSL 和证据游标见 [`WORKFLOWS.md`](./WORKFLOWS.md)。

---

## 发送策略（TX）

| 模式 | 行为 | 适用 |
|------|------|------|
| `queue_by_line` **（默认）** | 等到 `\n` 再整行发送 | 文本 / AT / CLI |
| `queue_by_frame` | 等到分隔字节 | 简单二进制帧 |
| `exclusive` | 必须持有写锁才能发 | 烧录 / 危险操作 |
| `primary_wins` | 优先 `tx.primary` | 人在环 |

**写租约** 生效期间，只有携带随机 `lease_token` 的请求可以 TX；owner 字符串只用于显示/审计。租约仅在 TTL 到期或持 token 主动释放时结束，同名 HTTP、WebSocket、TCP 或 PTY 客户端断线不会释放租约。

每个可读客户端都有以块计数的有界 RX 队列 `client_queue`：

| `slow_client` | 队列满时的行为 |
|---------------|----------------|
| `drop_oldest` **（默认）** | 丢弃该客户端最旧的待处理 RX 块，再放入新块 |
| `drop_newest` | 保留已有数据，丢弃发给该客户端的新块 |
| `disconnect_slow` | 立即断开慢客户端 |
| `block` | 最多等待 `slow_block_ms`，仍无空间则断开慢客户端 |

`queue_by_line` / `queue_by_frame` 的缓存受 `max_frame_bytes` 限制，HTTP 和 WS 二进制原子写受 `max_write_bytes` 限制。每次连接都有递增 epoch；写入在真正触发主机写操作前会再次核对 epoch、截止时间和租约，因此断线前排队的旧字节不会在重连后回放到新会话。

启动时会先完成配置校验和监听端口绑定；任一绑定失败都会让 hub 启动失败并撤销已经启动的任务。关闭时会停止串口所有者、关闭 fan-out，并拒绝/排空待写队列，不留下脱管后台任务。

---

## Unix 虚拟串口（PTY）

```toml
[[clients]]
type = "pty"
name = "ui"
link = "/tmp/serialhub-ui"
can_write = true
can_read = true
```

在 minicom / screen / Serial Studio 等中打开 `/tmp/serialhub-ui`。

> 真实波特率由 hub 的 `[real]` 决定。部分软件对 PTY 的波特率 ioctl 可能失败，数据通道通常仍可用。

---

## Windows 说明

| 需求 | 做法 |
|------|------|
| Agent / 自动化 | HTTP + WebSocket ✅ |
| 简单字节流 | TCP `127.0.0.1:8788` ✅ |
| 硬件 | `path = "COM3"` ✅ |
| 只认 COM 的老上位机 | `bridge-com` + 已安装的 com0com 等虚拟 COM 提供方 |
| `type = "pty"` | 不支持 |

---

## 安全

- 默认只绑 **`127.0.0.1`**  
- 串口写入等同于碰硬件（复位、危险指令）  
- 明文 API、WebSocket 和原始 TCP 都只能监听回环地址；远程访问使用 SSH 或 TLS 反向代理
- 人类日志、事件分段和导出都可能含设备吐出的敏感信息
- 分段哈希用于发现损坏，不能认证捕获的产生者或修改者

---

## 目录结构

```text
serialhub/
├── README.md           # English（默认）
├── README.zh-CN.md     # 简体中文
├── README.es.md        # Español
├── POSITIONING.md
├── EVENTS.md           # 规范事件账本、持久化、API、回放
├── WORKFLOWS.md        # 有界线性 Agent 工作流契约
├── serialhub.example.toml
├── src/ ...
└── tests/
```

---

## 开发

```bash
cargo test
cargo run -- run -c serialhub.example.toml
cargo fmt
cargo clippy
```

CI：Ubuntu · macOS · Windows。

---

## 当前发布范围

当前源码/本地候选版本为 **0.0.4**，历史公开下载为 **v0.2.3**；以下能力以当前源码为准。包含核心 Hub、可信 TX 与租约、Unix PTY、TCP、
HTTP/WebSocket、RFC2217、多 profile 监督、事件账本与安全回放、设备身份选择、
有界维护交接、Prometheus 指标和内嵌 Web 控制台，以及单屏调试工作台、
信号仪表和可配置的六语言界面；参见[发布验证与跨平台包](./RELEASING.md)。

它明确**不承诺**自研 Windows 内核虚拟 COM 驱动、UDP 传输、完整终端模拟、
通用脚本引擎、云 SaaS，或对每一种适配器与设备组合的硬件认证。完整的平台支持、
安全 / 部署边界、文档导航和 HIL 要求见 [`POSITIONING.md`](./POSITIONING.md)。

---

## 常见问题

**两个客户端能同时写吗？**  
不会静默交错字节。默认按完整行排队；写锁可给独占窗口。

**Agent 必须虚拟 COM 吗？**  
不必，推荐 WebSocket + HTTP。

**PTY 上改波特率为何不影响设备？**  
真口参数由 hub 持有。

**这是串口嗅探器吗？**  
不是。它是可交互的 **共享中枢**，带 TX 控制。

**mock 需要硬件吗？**  
不需要。`mock:demo` 能验证 hub、策略、租约、API 和关闭流程，但不能证明操作系统串口驱动、USB/UART 时序、物理控制线或真实设备命令确认正确。

---

## 贡献

Issue / PR：https://github.com/tianrking/serialhub

请与 [`POSITIONING.md`](./POSITIONING.md) 对齐。

---

## 许可证

[MIT](./LICENSE) © serialhub contributors

---

## 技术标签

`串口` · `UART` · `COM` · `tty` · `串口共享` · `串口复用` · `嵌入式` · `调试` · `AI Agent` · `WebSocket` · `HTTP API` · `TCP` · `PTY` · `Tokio` · `Axum` · `Rust` · `跨平台` · `macOS` · `Linux` · `Windows` · `TOML` · `MIT` · `serialhub`

---

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="./README.es.md">Español</a>
  <br/>
  <sub>一个串口，共享接入。</sub>
</p>
