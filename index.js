import { readFileSync } from "node:fs";
import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";

const COMMIT = process.env.ZEABUR_GIT_COMMIT_SHA?.slice(0, 7)
  || (() => { try { return readFileSync(".commit", "utf8").trim(); } catch { return "dev"; } })();

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/log-collector";
const PORT = process.env.PORT || 3000;

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

// GET /version — version info
app.get("/version", (_req, res) => {
  res.json({ commit: COMMIT });
});

// GET / — query UI
app.use(express.static("public"));

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
