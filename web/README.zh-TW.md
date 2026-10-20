# SerialHub Web 控制台（繁體中文，當前原始碼 0.0.4）

本目錄為 **React + Vite + TypeScript** 前端，連線本機 **serialhub hub** 的 HTTP / WebSocket。

桌面啟動器 `serialhub-desktop` 會開啟裝置管理網頁，可開關多個實體埠及平鋪多路終端；參見 [DESKTOP.md](../DESKTOP.md) 和 [MULTIPORT.md](../MULTIPORT.md)。
點選語言選單旁的 **Aa**，可獨立調整介面文字（80–160%）與串口日誌/傳送編輯器（10–28 px）；六種語言立即生效。參見 [DISPLAY.md](../DISPLAY.md)。

## 功能清單

| 功能 | 狀態 |
|------|------|
| 設定 host/port，localStorage 記住 | ✅ |
| 本機瀏覽器會話配置（儲存 / 載入 / 刪除） | ✅ |
| `GET /v1/health` 探活 | ✅ |
| `GET /v1/status` 狀態 / 寫鎖 / 統計 | ✅ |
| `GET /v1/endpoints` 並聯端點列表 + 複製 | ✅ |
| 客戶端列表 | ✅ |
| `WS /v1/stream` 即時日誌（文字 + hex） | ✅ |
| `POST /v1/write` 文字 / hex | ✅ |
| 文字行尾選擇（無 / LF / CR / CRLF）與 Ctrl/⌘+Enter | ✅ |
| 快捷指令（文字 / Hex、行尾、編輯、刪除、localStorage） | ✅ |
| 定時發送（50 ms 起、文字 / Hex） | ✅ |
| Hex 校驗和預處理（SUM8 / XOR8 / CRC16 Modbus / CCITT） | ✅ |
| 日誌顯示模式（文字 / Hex / 兩者）、時間戳、匯出 | ✅ |
| FireWater CSV / JustFloat LE 分片解析與波形觀察 | ✅ |
| NMEA 0183 / SLIP / COBS / Modbus RTU 分析 | ✅ |
| 事件 Actor/Epoch/Hex 篩選、NDJSON 導出、Prometheus 指標 | ✅ |
| DTR / RTS / BREAK 控制線入口（授權 + 寫鎖保護） | ✅ |
| 寫鎖取得 / 釋放 | ✅ |
| 協定說明分頁 | ✅ |
| 完整協定文件 | ✅ `PROTOCOL.zh-TW.md` |

## 串口工具互動

控制台把 PuTTY 的可靠寫入、SSCOM 的文字/Hex 快速命令，以及 VOFA+ 的
資料觀察入口放在同一個頁面：

- 文字送出可明確選擇行尾；Hex 送出保留原始位元組，不會被瀏覽器轉碼。
- 快捷指令只儲存在目前瀏覽器，送出仍走 `POST /v1/write`，因此會繼續受到
  Hub 的寫鎖、TX 仲裁、大小限制與 host-confirmed 回傳保護。
- 定時送出最低 50 ms，並使用同一條寫入路徑；停止勾選後不會留下背景計時器。
- 即時日誌可分開查看文字與 Hex、顯示/隱藏時間戳，並匯出目前頁面保留的日誌。
- 即時日誌支援暫停、自動捲動和清空；波形解析只在瀏覽器本地進行，不改寫 RX 原始位元組。

串口初始參數由 CLI/TOML 或裝置管理頁指定。裝置參數分頁可在明確確認後修改 baud、data bits、parity、stop bits、flow control；需要 `api.can_control` 與有效寫入租約，等候 owner 的驅動確認，僅在目前程序內生效，不寫回 TOML。

例如 Windows 可直接使用：

```bash
serialhub share COM3 --baud 115200 --data-bits 8 --parity none --stop-bits 1 --flow-control none
```

## 推薦用法：嵌在 hub 裡（同源，最穩）

先建置前端，再編譯 Rust（會把 `web/dist` 嵌進二進位）：

```bash
cd web
npm ci
npm run build
cd ..
cargo build --release

# 一鍵共享並開啟瀏覽器控制台
./target/release/serialhub share mock:demo --ui
# 或真實裝置
./target/release/serialhub share /dev/cu.usbmodemXXXX --pty 2 --ui
```

瀏覽器開啟：**http://127.0.0.1:8787/**（與 API/WS 同源，無混合內容問題）。  
點「連線」即可（預設已填同一 host/port）。

## 本機熱重載開發（可選）

```bash
# 終端 1：hub
cargo run --locked -- run -c serialhub.dev.toml

# 終端 2：Vite
cd web
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

開啟 `http://127.0.0.1:5173`，網頁會連 `127.0.0.1:8787`。
開發 profile 使用 mock loopback，明確允許兩個本機 Vite origin；一般
`share` 預設只接受同源，直接搭配 Vite 會被 CORS / WebSocket Origin 檢查拒絕。
先停止佔用 8787 的舊 Hub；這些開發 origin 不應加入正式部署設定。

## 部署到 Vercel（可選鏡像）

```bash
cd web
npm run build
# 使用 vercel.json；Root Directory 選 web
vercel --prod
```

> **注意**：HTTPS 的 Vercel 頁連 `ws://127.0.0.1` 可能被瀏覽器封鎖。  
> **實務請優先用本機** `http://127.0.0.1:8787/`。詳見 `PROTOCOL.zh-TW.md` §2.5。

## 目錄

```text
web/
├── PROTOCOL.zh-TW.md   # HTTP/WS 協定完整說明（繁中）
├── README.zh-TW.md     # 本說明
├── src/
│   ├── api/            # 型別、HTTP client、WS 封裝
│   ├── App.tsx         # 控制台 UI
│   └── ...
└── package.json
```

## 與 CLI 關係

| 方式 | 用途 |
|------|------|
| `serialhub share ...` | 獨立串口 Hub；也可用桌面管理器開啟多埠 |
| 本 React 頁 | 可選人機監控 / 除錯面板 |
| Agent | 同一套 WS/HTTP 協定 |
