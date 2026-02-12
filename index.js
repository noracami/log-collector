import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import session from "express-session";
import MongoStore from "connect-mongo";
import { MongoClient } from "mongodb";

const __dirname = dirname(fileURLToPath(import.meta.url));

const COMMIT = process.env.ZEABUR_GIT_COMMIT_SHA?.slice(0, 7)
  || (() => { try { return readFileSync(".commit", "utf8").trim(); } catch { return "dev"; } })();

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/log-collector";
const PORT = process.env.PORT || 3000;

// Discord OAuth2 config
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const ALLOWED_DISCORD_IDS = (process.env.ALLOWED_DISCORD_IDS || "").split(",").filter(Boolean);
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";

// UTC+8 offset in milliseconds
const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;

function nowUTC8ISO() {
  const now = new Date();
  const utc8 = new Date(now.getTime() + UTC8_OFFSET_MS);
  // Format: YYYY-MM-DDTHH:mm:ss.sss+08:00
  const iso = utc8.toISOString().replace("Z", "+08:00");
  return iso;
}

function todayDateStringUTC8() {
  const now = new Date();
  const utc8 = new Date(now.getTime() + UTC8_OFFSET_MS);
  return utc8.toISOString().slice(0, 10);
}

// Connect to MongoDB
const client = new MongoClient(MONGO_URI);
await client.connect();
console.log("Connected to MongoDB");

const db = client.db();
const logsCollection = db.collection("logs");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Session middleware (uses existing MongoDB connection)
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ client, dbName: db.databaseName }),
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    sameSite: "lax",
  },
}));

// --- Auth helpers ---

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  if (!req.session.user.approved) {
    return res.send(unauthorizedPage(req.session.user));
  }
  next();
}

function loginPage() {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>登入 — Debug Log Viewer</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; background: #0d1117; color: #c9d1d9; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
  .card { text-align: center; }
  h1 { font-size: 24px; margin-bottom: 8px; color: #58a6ff; }
  p { color: #8b949e; margin-bottom: 24px; }
  .btn { display: inline-flex; align-items: center; gap: 8px; background: #5865F2; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 16px; font-weight: 500; transition: background 0.2s; }
  .btn:hover { background: #4752C4; }
  .btn svg { width: 20px; height: 20px; fill: currentColor; }
</style>
</head>
<body>
<div class="card">
  <h1>Debug Log Viewer</h1>
  <p>請使用 Discord 帳號登入</p>
  <a class="btn" href="/auth/discord">
    <svg viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
    使用 Discord 登入
  </a>
</div>
</body>
</html>`;
}

function unauthorizedPage(user) {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>未授權 — Debug Log Viewer</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; background: #0d1117; color: #c9d1d9; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
  .card { text-align: center; }
  h1 { font-size: 24px; margin-bottom: 8px; color: #f85149; }
  .user { color: #8b949e; margin-bottom: 8px; }
  p { color: #8b949e; margin-bottom: 24px; }
  a { color: #58a6ff; }
</style>
</head>
<body>
<div class="card">
  <h1>尚未通過審核</h1>
  <div class="user">登入帳號：${escHtml(user.username)}</div>
  <p>您的 Discord 帳號尚未被加入允許名單，請聯絡管理員。</p>
  <a href="/logout">登出</a>
</div>
</body>
</html>`;
}

// --- OAuth2 routes ---

// Login page
app.get("/login", (_req, res) => {
  res.send(loginPage());
});

// Start Discord OAuth2 flow
app.get("/auth/discord", (_req, res) => {
  if (!DISCORD_CLIENT_ID || !DISCORD_REDIRECT_URI) {
    return res.status(500).send("Discord OAuth is not configured");
  }
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify",
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

// Discord OAuth2 callback
app.get("/auth/discord/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect("/login");

  try {
    // Exchange code for token
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      console.error("Discord token exchange failed:", tokenData);
      return res.redirect("/login");
    }

    // Fetch user info
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const user = await userRes.json();

    const approved = ALLOWED_DISCORD_IDS.includes(user.id);
    req.session.user = {
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      approved,
    };

    res.redirect("/");
  } catch (err) {
    console.error("Discord OAuth callback error:", err);
    res.redirect("/login");
  }
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// GET /version — version info
app.get("/version", (_req, res) => {
  res.json({ commit: COMMIT });
});

// GET / — query UI (protected by Discord OAuth)
app.get("/", requireAuth, (_req, res) => {
  res.sendFile(join(__dirname, "public", "index.html"));
});

// POST /logs — receive batched log entries
app.post("/logs", async (req, res) => {
  try {
    const { logs } = req.body;

    if (!Array.isArray(logs) || logs.length === 0) {
      return res.status(400).json({ ok: false, error: "logs array is required and must not be empty" });
    }

    const receivedAt = nowUTC8ISO();
    const docs = logs.map((entry) => ({ ...entry, receivedAt }));

    await logsCollection.insertMany(docs);
    res.json({ ok: true, count: docs.length });
  } catch (err) {
    console.error("POST /logs error:", err);
    // Return 200 on server error to prevent client retry floods
    res.json({ ok: false, error: "server error" });
  }
});

// GET /logs — query log entries
app.get("/logs", async (req, res) => {
  try {
    const { date, level, tag, sid, q } = req.query;
    const filter = {};

    // Date filter: default to today (UTC+8)
    const dateStr = date || todayDateStringUTC8();
    const dayStart = `${dateStr}T00:00:00.000+08:00`;
    const [year, month, day] = dateStr.split("-").map(Number);
    const nextDate = new Date(Date.UTC(year, month - 1, day + 1));
    const nextDayStr = nextDate.toISOString().slice(0, 10);
    const dayEnd = `${nextDayStr}T00:00:00.000+08:00`;
    filter.receivedAt = { $gte: dayStart, $lt: dayEnd };

    if (level) filter.level = level;
    if (tag) filter.tag = tag;
    if (sid) filter.sid = sid;
    if (q) {
      filter.$or = [
        { msg: { $regex: q, $options: "i" } },
        { ctx: { $regex: q, $options: "i" } },
      ];
    }

    const results = await logsCollection.find(filter).sort({ receivedAt: 1 }).toArray();

    // Remove MongoDB _id from response
    const cleaned = results.map(({ _id, ...rest }) => rest);
    res.json(cleaned);
  } catch (err) {
    console.error("GET /logs error:", err);
    res.json([]);
  }
});

app.listen(PORT, () => {
  console.log(`Log collector listening on port ${PORT}`);
});
