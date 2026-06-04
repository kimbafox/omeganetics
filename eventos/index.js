// Módulo de Eventos de comunidad.
// Los usuarios logueados crean eventos (quedan 'pendiente'); los admins aprueban/rechazan.
//
//   POST /api/eventos              crear (usuario logueado)
//   GET  /api/eventos              listar aprobados (público)
//   GET  /api/eventos/mios         mis eventos (usuario logueado)
//   GET  /api/eventos/pendientes   pendientes (admin)
//   POST /api/eventos/:id/aprobar  (admin)
//   POST /api/eventos/:id/rechazar (admin)

const express = require("express");
const { Pool } = require("pg");
const { requireUser } = require("../auth-discord");
const { announceEvent, dmUser, notifyAdmins } = require("../discord-activity");

const router = express.Router();

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("railway") ? { rejectUnauthorized: false } : false,
    })
  : null;

async function initEventos() {
  if (!pool) {
    console.warn("[eventos] sin DATABASE_URL: módulo de eventos deshabilitado.");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      game TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      expected_duration TEXT NOT NULL DEFAULT '',
      start_date TIMESTAMPTZ,
      end_date TIMESTAMPTZ,
      files_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pendiente',
      created_by_id TEXT NOT NULL DEFAULT '',
      created_by_name TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT NOT NULL DEFAULT '',
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // "Me interesa" / RSVP por evento.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_rsvp (
      event_id INTEGER NOT NULL,
      discord_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (event_id, discord_id)
    );
  `);
  await pool.query("ALTER TABLE events ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT ''");
}

// Solo admins: reutiliza requireUser y exige isAdmin.
function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (!req.user || !req.user.isAdmin) {
      return res.status(403).json({ error: "Solo administradores pueden hacer esto." });
    }
    next();
  });
}

const clean = (v) => (typeof v === "string" ? v.trim() : "");
const dateOrNull = (v) => {
  const s = clean(v);
  return s || null;
};

function mapEvent(r) {
  return {
    id: r.id,
    game: r.game,
    name: r.name,
    description: r.description,
    expectedDuration: r.expected_duration,
    startDate: r.start_date,
    endDate: r.end_date,
    filesUrl: r.files_url,
    status: r.status,
    reason: r.reason || "",
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    interested: r.interested != null ? Number(r.interested) : 0,
  };
}

// Crear evento (usuario logueado) -> queda pendiente de aprobación.
router.post("/api/eventos", requireUser, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Base de datos no configurada." });
  const game = clean(req.body?.game);
  const name = clean(req.body?.name);
  const description = clean(req.body?.description);
  const expectedDuration = clean(req.body?.expectedDuration);
  const startDate = dateOrNull(req.body?.startDate);
  const endDate = dateOrNull(req.body?.endDate);
  const filesUrl = clean(req.body?.filesUrl);
  const reason = clean(req.body?.reason);

  if (!game || !name || !description || !startDate) {
    return res.status(400).json({ error: "Juego, nombre, descripción y fecha de inicio son obligatorios." });
  }

  try {
    const r = await pool.query(
      `INSERT INTO events
         (game, name, description, expected_duration, start_date, end_date, files_url, reason, status, created_by_id, created_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pendiente', $9, $10)
       RETURNING *`,
      [game, name, description, expectedDuration, startDate, endDate, filesUrl, reason, req.user.discordId, req.user.globalName || req.user.username || ""],
    );
    try { notifyAdmins?.("📅 Nuevo evento (pendiente)", `**${name}** · 🎮 ${game}\npor ${req.user.globalName || req.user.username}${reason ? `\n📝 ${reason}` : ""}\nApruébalo en omeganetics.com/admin.html`, 0x5865f2); } catch (e) {}
    return res.json({ ok: true, event: mapEvent(r.rows[0]) });
  } catch (error) {
    return res.status(500).json({ error: "No se pudo crear el evento." });
  }
});

// Listar eventos aprobados (público).
router.get("/api/eventos", async (req, res) => {
  if (!pool) return res.json([]);
  try {
    const r = await pool.query(`
      SELECT e.*, COALESCE(c.n, 0) AS interested
      FROM events e
      LEFT JOIN (SELECT event_id, COUNT(*) AS n FROM event_rsvp GROUP BY event_id) c ON c.event_id = e.id
      WHERE e.status = 'aprobado'
      ORDER BY e.start_date ASC NULLS LAST, e.created_at DESC
    `);
    return res.json(r.rows.map(mapEvent));
  } catch (error) {
    return res.json([]);
  }
});

// Marcar/desmarcar "me interesa".
router.post("/api/eventos/:id/interesa", requireUser, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "Base de datos no configurada." });
  const id = parseInt(req.params.id, 10);
  try {
    const ex = await pool.query("SELECT 1 FROM event_rsvp WHERE event_id = $1 AND discord_id = $2", [id, req.user.discordId]);
    let interested;
    if (ex.rows.length) {
      await pool.query("DELETE FROM event_rsvp WHERE event_id = $1 AND discord_id = $2", [id, req.user.discordId]);
      interested = false;
    } else {
      await pool.query("INSERT INTO event_rsvp (event_id, discord_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, req.user.discordId]);
      interested = true;
    }
    const c = await pool.query("SELECT COUNT(*)::int AS n FROM event_rsvp WHERE event_id = $1", [id]);
    return res.json({ interested, count: c.rows[0]?.n || 0 });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo." });
  }
});

// Eventos en los que marqué interés (ids).
router.get("/api/eventos/mis-interes", requireUser, async (req, res) => {
  if (!pool) return res.json([]);
  try {
    const r = await pool.query("SELECT event_id FROM event_rsvp WHERE discord_id = $1", [req.user.discordId]);
    return res.json(r.rows.map((x) => x.event_id));
  } catch (e) {
    return res.json([]);
  }
});

// Eliminar evento (admin).
router.delete("/api/eventos/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM event_rsvp WHERE event_id = $1", [req.params.id]);
    await pool.query("DELETE FROM events WHERE id = $1", [req.params.id]);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo eliminar." });
  }
});

// Mis eventos (usuario logueado).
router.get("/api/eventos/mios", requireUser, async (req, res) => {
  if (!pool) return res.json([]);
  try {
    const r = await pool.query(
      "SELECT * FROM events WHERE created_by_id = $1 ORDER BY created_at DESC",
      [req.user.discordId],
    );
    return res.json(r.rows.map(mapEvent));
  } catch (error) {
    return res.json([]);
  }
});

// Pendientes de aprobación (admin).
router.get("/api/eventos/pendientes", requireAdmin, async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM events WHERE status = 'pendiente' ORDER BY created_at ASC");
    return res.json(r.rows.map(mapEvent));
  } catch (error) {
    return res.json([]);
  }
});

// Aprobar (admin).
router.post("/api/eventos/:id/aprobar", requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      "UPDATE events SET status = 'aprobado', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2 RETURNING *",
      [req.user.globalName || req.user.username || "admin", req.params.id],
    );
    if (r.rows[0]) {
      announceEvent(mapEvent(r.rows[0])).catch(() => {});
      dmUser(r.rows[0].created_by_id, `✅ ¡Tu evento "${r.rows[0].name}" fue aprobado y ya está publicado en omeganetics.com/eventos.html!`).catch(() => {});
    }
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "No se pudo aprobar." });
  }
});

// Rechazar (admin).
router.post("/api/eventos/:id/rechazar", requireAdmin, async (req, res) => {
  try {
    await pool.query(
      "UPDATE events SET status = 'rechazado', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2",
      [req.user.globalName || req.user.username || "admin", req.params.id],
    );
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "No se pudo rechazar." });
  }
});

module.exports = { router, initEventos };
