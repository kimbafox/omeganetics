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
  // Motivo de postulación + flujo de aprobación de videos.
  await pool.query("ALTER TABLE content_creators ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT ''");
  // status por defecto 'aprobado' para que los videos YA existentes no se reenvíen; los nuevos se insertan 'pendiente'.
  await pool.query("ALTER TABLE creator_videos ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'aprobado'");
  await pool.query("ALTER TABLE creator_videos ADD COLUMN IF NOT EXISTS reviewed_by TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE creator_videos ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ");
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
    reason: r.reason || "",
    createdAt: r.created_at,
  };
}

function mapVideo(r) {
  return {
    id: r.id,
    discordId: r.discord_id,
    title: r.title,
    url: r.url,
    description: r.description,
    status: r.status,
    createdAt: r.created_at,
    channelName: r.channel_name || "",
    nickname: r.nickname || "",
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
  const reason = clean(req.body?.reason);

  if (!nickname || !channelName || !channelUrl) {
    return res.status(400).json({ error: "Nick, nombre del canal y enlace del canal son obligatorios." });
  }

  try {
    await pool.query(
      `INSERT INTO content_creators
         (discord_id, full_name, nickname, channel_name, channel_url, platforms, channel_type, reason, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pendiente', NOW())
       ON CONFLICT (discord_id) DO UPDATE
         SET full_name = EXCLUDED.full_name, nickname = EXCLUDED.nickname,
             channel_name = EXCLUDED.channel_name, channel_url = EXCLUDED.channel_url,
             platforms = EXCLUDED.platforms, channel_type = EXCLUDED.channel_type,
             reason = EXCLUDED.reason, status = 'pendiente', created_at = NOW()`,
      [req.user.discordId, fullName, nickname, channelName, channelUrl, platforms, channelType, reason],
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
      "INSERT INTO creator_videos (discord_id, title, url, description, status) VALUES ($1, $2, $3, $4, 'pendiente')",
      [req.user.discordId, title, url, description],
    );
    return res.json({ ok: true, pending: true });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo subir el contenido." });
  }
});

// Mis videos (creador) con su estado.
router.get("/api/creadores/mis-videos", requireUser, async (req, res) => {
  if (!pool) return res.json([]);
  try {
    const r = await pool.query("SELECT * FROM creator_videos WHERE discord_id = $1 ORDER BY created_at DESC LIMIT 20", [req.user.discordId]);
    return res.json(r.rows.map(mapVideo));
  } catch (e) {
    return res.json([]);
  }
});

// Videos pendientes de aprobación (admin).
router.get("/api/creadores/videos/pendientes", requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT v.*, c.channel_name, c.nickname
      FROM creator_videos v
      LEFT JOIN content_creators c ON c.discord_id = v.discord_id
      WHERE v.status = 'pendiente'
      ORDER BY v.created_at ASC
    `);
    return res.json(r.rows.map(mapVideo));
  } catch (e) {
    return res.json([]);
  }
});

// Aprobar video (admin) -> anuncia en Discord + DM al creador.
router.post("/api/creadores/video/:id/aprobar", requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      "UPDATE creator_videos SET status = 'aprobado', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2 AND status = 'pendiente' RETURNING *",
      [req.user.globalName || req.user.username || "admin", req.params.id],
    );
    const v = r.rows[0];
    if (v) {
      const c = await pool.query("SELECT * FROM content_creators WHERE discord_id = $1", [v.discord_id]);
      if (c.rows[0]) announceContent(mapCreator(c.rows[0]), { title: v.title, url: v.url, description: v.description }).catch(() => {});
      dmUser(v.discord_id, `🎬 ¡Tu video "${v.title}" fue aprobado y ya está publicado!`).catch(() => {});
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo aprobar." });
  }
});

// Rechazar video (admin).
router.post("/api/creadores/video/:id/rechazar", requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      "UPDATE creator_videos SET status = 'rechazado', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2 RETURNING discord_id, title",
      [req.user.globalName || req.user.username || "admin", req.params.id],
    );
    if (r.rows[0]) dmUser(r.rows[0].discord_id, `Tu video "${r.rows[0].title}" no fue aprobado esta vez. Puedes subir otro cuando quieras.`).catch(() => {});
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo rechazar." });
  }
});

module.exports = { router, initCreadores };
