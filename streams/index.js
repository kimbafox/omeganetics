// Módulo de Streamers (alertas de directos de Twitch).
// El bot (discord-activity) consulta la API de Twitch y avisa cuando uno se pone en vivo.
//   GET    /api/streams           lista (público)
//   POST   /api/streams           agregar { login|url, discordId? } (admin)
//   DELETE /api/streams/:id       quitar (admin)

const express = require("express");
const { Pool } = require("pg");
const { requireUser } = require("../auth-discord");

const router = express.Router();
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes("railway") ? { rejectUnauthorized: false } : false })
  : null;

async function initStreams() {
  if (!pool) { console.warn("[streams] sin DATABASE_URL: módulo deshabilitado."); return; }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stream_watch (
      id SERIAL PRIMARY KEY,
      platform TEXT NOT NULL DEFAULT 'twitch',
      login TEXT NOT NULL,
      channel_name TEXT NOT NULL DEFAULT '',
      discord_id TEXT NOT NULL DEFAULT '',
      is_live BOOLEAN NOT NULL DEFAULT FALSE,
      added_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (platform, login)
    );
  `);
}

function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: "Solo administradores." });
    next();
  });
}

// Saca el login de twitch.tv/<login> o usa el texto tal cual.
function parseLogin(input) {
  let s = String(input || "").trim();
  const m = s.match(/twitch\.tv\/([A-Za-z0-9_]+)/i);
  if (m) s = m[1];
  return s.replace(/[^A-Za-z0-9_]/g, "").toLowerCase();
}

router.get("/api/streams", async (req, res) => {
  if (!pool) return res.json([]);
  try {
    const r = await pool.query("SELECT id, platform, login, channel_name, discord_id, is_live FROM stream_watch ORDER BY is_live DESC, login ASC");
    return res.json(r.rows.map((x) => ({ id: x.id, platform: x.platform, login: x.login, channelName: x.channel_name, discordId: x.discord_id, isLive: x.is_live })));
  } catch (e) { return res.json([]); }
});

router.post("/api/streams", requireAdmin, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "BD no configurada." });
  const login = parseLogin(req.body?.login || req.body?.url);
  if (!login) return res.status(400).json({ error: "Pon el usuario de Twitch o el link de su canal." });
  const discordId = String(req.body?.discordId || "").replace(/[^0-9]/g, "");
  try {
    await pool.query(
      "INSERT INTO stream_watch (platform, login, channel_name, discord_id, added_by) VALUES ('twitch',$1,$2,$3,$4) ON CONFLICT (platform, login) DO UPDATE SET discord_id = EXCLUDED.discord_id",
      [login, login, discordId, req.user.globalName || req.user.username || "admin"],
    );
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ error: "No se pudo agregar." }); }
});

router.delete("/api/streams/:id", requireAdmin, async (req, res) => {
  try { await pool.query("DELETE FROM stream_watch WHERE id = $1", [req.params.id]); return res.json({ ok: true }); }
  catch (e) { return res.status(500).json({ error: "No se pudo quitar." }); }
});

module.exports = { router, initStreams };
