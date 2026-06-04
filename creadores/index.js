// Módulo de Creadores de contenido.
// - Un usuario logueado postula (queda 'pendiente'); un admin aprueba.
// - Un creador aprobado sube videos -> se anuncian en Discord (CONTENIDO + general).
//
//   POST /api/creadores                 postular (usuario)
//   GET  /api/creadores/mi-estado       mi estado (usuario)
//   GET  /api/creadores/pendientes      pendientes (admin)
//   POST /api/creadores/:id/aprobar     (admin)
//   POST /api/creadores/:id/rechazar    (admin)
//   POST /api/creadores/video           subir video (creador aprobado)

const express = require("express");
const { Pool } = require("pg");
const { requireUser } = require("../auth-discord");
const { announceContent, dmUser } = require("../discord-activity");

const router = express.Router();

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("railway") ? { rejectUnauthorized: false } : false,
    })
  : null;

async function initCreadores() {
  if (!pool) {
    console.warn("[creadores] sin DATABASE_URL: módulo deshabilitado.");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS content_creators (
      discord_id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL DEFAULT '',
      nickname TEXT NOT NULL DEFAULT '',
      channel_name TEXT NOT NULL DEFAULT '',
      channel_url TEXT NOT NULL DEFAULT '',
      platforms TEXT NOT NULL DEFAULT '',
      channel_type TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pendiente',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_by TEXT NOT NULL DEFAULT '',
      reviewed_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS creator_videos (
      id SERIAL PRIMARY KEY,
      discord_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: "Solo administradores." });
    next();
  });
}

const clean = (v) => (typeof v === "string" ? v.trim() : "");

function mapCreator(r) {
  return {
    discordId: r.discord_id,
    fullName: r.full_name,
    nickname: r.nickname,
    channelName: r.channel_name,
    channelUrl: r.channel_url,
    platforms: r.platforms ? r.platforms.split(",").filter(Boolean) : [],
    channelType: r.channel_type,
    status: r.status,
    createdAt: r.created_at,
  };
}

// Postular como creador (queda pendiente). Una postulación por usuario.
router.post("/api/creadores", requireUser, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Base de datos no configurada." });
  const fullName = clean(req.body?.fullName);
  const nickname = clean(req.body?.nickname);
  const channelName = clean(req.body?.channelName);
  const channelUrl = clean(req.body?.channelUrl);
  const channelType = clean(req.body?.channelType);
  const platforms = Array.isArray(req.body?.platforms)
    ? req.body.platforms.map((p) => clean(p)).filter(Boolean).join(",")
    : clean(req.body?.platforms);

  if (!nickname || !channelName || !channelUrl) {
    return res.status(400).json({ error: "Nick, nombre del canal y enlace del canal son obligatorios." });
  }

  try {
    await pool.query(
      `INSERT INTO content_creators
         (discord_id, full_name, nickname, channel_name, channel_url, platforms, channel_type, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente', NOW())
       ON CONFLICT (discord_id) DO UPDATE
         SET full_name = EXCLUDED.full_name, nickname = EXCLUDED.nickname,
             channel_name = EXCLUDED.channel_name, channel_url = EXCLUDED.channel_url,
             platforms = EXCLUDED.platforms, channel_type = EXCLUDED.channel_type,
             status = 'pendiente', created_at = NOW()`,
      [req.user.discordId, fullName, nickname, channelName, channelUrl, platforms, channelType],
    );
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo enviar la solicitud." });
  }
});

// Mi estado como creador.
router.get("/api/creadores/mi-estado", requireUser, async (req, res) => {
  if (!pool) return res.json({ status: "none" });
  try {
    const r = await pool.query("SELECT * FROM content_creators WHERE discord_id = $1", [req.user.discordId]);
    if (!r.rows.length) return res.json({ status: "none" });
    return res.json({ status: r.rows[0].status, creator: mapCreator(r.rows[0]) });
  } catch (e) {
    return res.json({ status: "none" });
  }
});

// Pendientes (admin).
router.get("/api/creadores/pendientes", requireAdmin, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM content_creators WHERE status = 'pendiente' ORDER BY created_at ASC");
    return res.json(r.rows.map(mapCreator));
  } catch (e) {
    return res.json([]);
  }
});

router.post("/api/creadores/:id/aprobar", requireAdmin, async (req, res) => {
  try {
    await pool.query(
      "UPDATE content_creators SET status = 'aprobado', reviewed_by = $1, reviewed_at = NOW() WHERE discord_id = $2",
      [req.user.globalName || req.user.username || "admin", req.params.id],
    );
    dmUser(req.params.id, "🎬 ¡Tu solicitud de creador fue aprobada! Ya puedes subir tu contenido en https://omeganetics.com/creadores.html").catch(() => {});
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo aprobar." });
  }
});

router.post("/api/creadores/:id/rechazar", requireAdmin, async (req, res) => {
  try {
    await pool.query(
      "UPDATE content_creators SET status = 'rechazado', reviewed_by = $1, reviewed_at = NOW() WHERE discord_id = $2",
      [req.user.globalName || req.user.username || "admin", req.params.id],
    );
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo rechazar." });
  }
});

// Subir un video (solo creador aprobado) -> guarda + anuncia en Discord.
router.post("/api/creadores/video", requireUser, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Base de datos no configurada." });
  const title = clean(req.body?.title);
  const url = clean(req.body?.url);
  const description = clean(req.body?.description);
  if (!title || !url) return res.status(400).json({ error: "Título y enlace son obligatorios." });

  try {
    const c = await pool.query("SELECT * FROM content_creators WHERE discord_id = $1", [req.user.discordId]);
    const creator = c.rows[0];
    if (!creator || creator.status !== "aprobado") {
      return res.status(403).json({ error: "Solo creadores aprobados pueden subir contenido." });
    }

    await pool.query(
      "INSERT INTO creator_videos (discord_id, title, url, description) VALUES ($1, $2, $3, $4)",
      [req.user.discordId, title, url, description],
    );

    announceContent(mapCreator(creator), { title, url, description }).catch(() => {});
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo subir el contenido." });
  }
});

module.exports = { router, initCreadores };
