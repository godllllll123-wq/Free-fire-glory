
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

app.use(express.json({ limit: "32kb" }));
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || true,
  allowedHeaders: ["Content-Type", "x-admin-token"],
  methods: ["GET", "POST", "PUT", "OPTIONS"]
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL &&
    !process.env.DATABASE_URL.includes("localhost")
    ? { rejectUnauthorized: false }
    : false
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      guild_name TEXT NOT NULL DEFAULT 'LG OW',
      guild_uid TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT 'India',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    INSERT INTO guild (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS glory_entries (
      id BIGSERIAL PRIMARY KEY,
      member_name TEXT NOT NULL,
      member_uid TEXT DEFAULT '',
      glory INTEGER NOT NULL CHECK (glory >= 0),
      note TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

function requireAdmin(req, res, next) {
  const token = process.env.ADMIN_TOKEN;

  if (!token) {
    return res.status(503).json({
      error: "Admin token not configured"
    });
  }

  if (req.get("x-admin-token") !== token) {
    return res.status(401).json({
      error: "Invalid admin token"
    });
  }

  next();
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      service: "LG OW API",
      database: "connected",
      time: new Date().toISOString()
    });
  } catch {
    res.status(503).json({
      status: "error",
      database: "unavailable"
    });
  }
});

app.get("/api/guild", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT guild_name, guild_uid, region, updated_at FROM guild WHERE id=1"
    );
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: "Could not load guild" });
  }
});

app.put("/api/guild", requireAdmin, async (req, res) => {
  const { guild_name, guild_uid, region } = req.body || {};

  if (typeof guild_name !== "string" ||
      !guild_name.trim() || guild_name.length > 50) {
    return res.status(400).json({ error: "Invalid guild name" });
  }

  if (typeof guild_uid !== "string" || guild_uid.length > 30) {
    return res.status(400).json({ error: "Invalid guild UID" });
  }

  if (typeof region !== "string" || region.length > 30) {
    return res.status(400).json({ error: "Invalid region" });
  }

  try {
    const result = await pool.query(
      `UPDATE guild
       SET guild_name=$1, guild_uid=$2, region=$3, updated_at=NOW()
       WHERE id=1
       RETURNING guild_name, guild_uid, region, updated_at`,
      [guild_name.trim(), guild_uid.trim(), region.trim()]
    );

    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: "Could not save guild" });
  }
});

app.get("/api/glory", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, member_name, member_uid, glory, note, created_at
       FROM glory_entries
       ORDER BY created_at DESC LIMIT 30`
    );

    const total = await pool.query(
      "SELECT COALESCE(SUM(glory),0)::bigint AS total FROM glory_entries"
    );

    res.json({
      entries: result.rows,
      total_glory: total.rows[0].total
    });
  } catch {
    res.status(500).json({ error: "Could not load Glory" });
  }
});

app.post("/api/glory", requireAdmin, async (req, res) => {
  const {
    member_name,
    member_uid = "",
    glory,
    note = ""
  } = req.body || {};

  const amount = Number(glory);

  if (typeof member_name !== "string" ||
      !member_name.trim() || member_name.length > 50) {
    return res.status(400).json({ error: "Invalid member name" });
  }

  if (typeof member_uid !== "string" || member_uid.length > 30) {
    return res.status(400).json({ error: "Invalid member UID" });
  }

  if (!Number.isSafeInteger(amount) || amount < 0) {
    return res.status(400).json({ error: "Invalid Glory amount" });
  }

  if (typeof note !== "string" || note.length > 160) {
    return res.status(400).json({ error: "Invalid note" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO glory_entries
       (member_name, member_uid, glory, note)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [member_name.trim(), member_uid.trim(), amount, note.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch {
    res.status(500).json({ error: "Could not save record" });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

const PORT = process.env.PORT || 3000;

initDb().then(() => {
  app.listen(PORT, () => {
    console.log("LG OW server running on port " + PORT);
  });
}).catch(error => {
  console.error("Database error:", error.message);
  process.exit(1);
});
