# Remote Debug Logger - Server 端需求規格

## 概述

接收 client 端批次送出的 debug log entries，寫入 JSONL 檔案，並提供簡易查詢介面。

用途：追蹤 iOS 儲存按鈕失效、MindAR 拍照無聲失敗等線上問題。

## 架構

```
Client (browser)                    Server
┌─────────────────┐                ┌──────────────────────┐
│ remoteLogger     │  POST /logs   │ Express app          │
│ - buffer logs    │ ─────────────→│ - 收 JSON            │
│ - auto flush     │               │ - 寫 JSONL 檔案      │
│ - device context │               │ - GET /logs 查詢     │
└─────────────────┘                └──────────────────────┘
```

## API

### `POST /logs`

接收批次 log entries。

**Request：**

```http
POST /logs
Content-Type: application/json
```

```json
{
  "logs": [
    {
      "ts": "2026-02-12T10:30:00.123Z",
      "level": "error",
      "tag": "share-download",
      "msg": "navigator.share() failed",
      "ctx": { "src": "https://...", "error": "AbortError", "ios": true },
      "device": { "ua": "...", "os": "iOS", "screen": "390x844", "viewport": "390x844", "lang": "zh-TW", "online": true, "browser": "Safari" },
      "sid": "abc-123"
    }
  ]
}
```

**欄位說明：**

| 欄位 | 型別 | 必填 | 說明 |
|------|------|------|------|
| `ts` | string (ISO 8601) | Y | client 端時間戳 |
| `level` | `"debug"` \| `"info"` \| `"warn"` \| `"error"` | Y | log 等級 |
| `tag` | string | Y | 模組標籤，如 `share-download`、`snapshot`、`mindar` |
| `msg` | string | Y | 訊息描述 |
| `ctx` | object | N | 額外上下文，內容隨 tag 不同 |
| `device` | object | Y | 裝置資訊（ua, os, browser, screen, viewport, lang, online） |
| `sid` | string (UUID) | Y | 頁面載入時產生的 session ID |

**Response：**

- `200 OK`：`{ "ok": true, "count": 3 }`（count = 實際寫入筆數）
- `400 Bad Request`：body 缺少 `logs` 陣列或陣列為空

### `GET /logs`

回傳指定條件的 log entries，方便線上查閱。

**Query params：**

| 參數 | 型別 | 預設 | 說明 |
|------|------|------|------|
| `date` | `YYYY-MM-DD` | 今天 | 讀取哪一天的 log 檔 |
| `level` | string | （不篩選） | 篩選等級，如 `error` |
| `tag` | string | （不篩選） | 篩選模組標籤 |
| `sid` | string | （不篩選） | 篩選 session ID |
| `q` | string | （不篩選） | 全文搜尋 `msg` 和 `ctx`（JSON 序列化後比對） |

**Response：** `200 OK`，JSON 陣列 `[{...}, {...}]`

若該日期無 log 檔，回傳空陣列 `[]`。

## 儲存格式

- 目錄：`logs/`
- 檔名：`YYYY-MM-DD.jsonl`（每日一檔）
- 格式：每行一筆 JSON（JSONL），server 收到時加入 `receivedAt` 欄位

```jsonl
{"ts":"2026-02-12T10:30:00.123Z","level":"error","tag":"snapshot","msg":"toBlob returned null","device":{...},"sid":"abc-123","receivedAt":"2026-02-12T10:30:01.456Z"}
```

## 需求

- CORS 允許 `*`（臨時偵錯用途）
- 不需要身分驗證（內部工具）
- 建議用 Express 或同等級輕量框架
- 不需要資料庫，直接寫檔即可
- Server 端錯誤不應回 5xx 讓 client 重試（避免洪水），回 200 並在 server log 記錄即可

## Client 端已埋設的 tag 與訊息

供 server 端查詢與儀表板參考：

| tag | level | msg | 來源 |
|-----|-------|-----|------|
| `share-download` | info | `shareOrDownload called` | Vue composable |
| `share-download` | info | `share succeeded` | Vue composable |
| `share-download` | error | `share failed` | Vue composable |
| `share-download` | warn | `fallback to downloadBlob` | Vue composable |
| `share-download` | error | `fetch image failed` | Vue composable |
| `share-download` | info | `download called` | Vue composable |
| `snapshot` | debug | `snapshot start` | mindar/index.html |
| `snapshot` | debug | `snapshot drawImage done` | mindar/index.html |
| `snapshot` | error | `toBlob returned null` | mindar/index.html |
| `snapshot` | info | `photo stored` | mindar/index.html |
| `snapshot` | error | `snapshot failed` | mindar/index.html |
| `mindar` | info | `sharePhoto called` | mindar/index.html |
| `mindar` | info | `share succeeded` | mindar/index.html |
| `mindar` | error | `share failed` | mindar/index.html |
| `mindar` | warn | `downloadPhoto fallback` | mindar/index.html |
