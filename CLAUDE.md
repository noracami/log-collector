# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Remote Debug Logger — a lightweight Express server that receives batched client-side debug logs via HTTP, stores them in MongoDB, and provides a query endpoint for retrieval. Used for tracking iOS save button failures, MindAR camera capture issues, and similar hard-to-reproduce client bugs.

Deployed to Zeabur with managed MongoDB service.

Full specification: `docs/features/remote-debug-logger.md`

## Commands

```bash
npm install      # install dependencies
npm start        # run the server (requires MongoDB)
```

## Environment Variables

| Variable    | Default                                  | Description          |
|-------------|------------------------------------------|----------------------|
| `MONGO_URI` | `mongodb://localhost:27017/log-collector` | MongoDB connection string |
| `PORT`      | `3000`                                   | Server listen port   |

## Architecture

```
Client (browser)  —POST /logs→  Express server  —insertMany→  MongoDB (logs collection)
                  ←GET /logs—                   ←find————————
```

- **POST /logs** — accepts `{ "logs": [...] }`, inserts each entry (with `receivedAt` in UTC+8) to MongoDB, returns `{ "ok": true, "count": N }`
- **GET /logs** — query params: `date`, `level`, `tag`, `sid`, `q` (regex on msg/ctx)
- Storage: MongoDB collection `logs`, one document per log entry
- `receivedAt` stored as ISO 8601 string with `+08:00` offset
- CORS: allow `*` (internal debug tool, no auth)
- Server errors return 200 (not 5xx) to prevent client retry floods

## Key Design Constraints

- Single-file server (`index.js`) — POC, no module splitting
- MongoDB official driver (no Mongoose)
- ESM (`"type": "module"` in package.json)
- Log entry fields: `ts`, `level`, `tag`, `msg`, `ctx` (optional), `device`, `sid`, plus server-added `receivedAt`
