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
    createdByName: r.created_by_name,
    createdAt: r.created_at,
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

  if (!game || !name || !description || !startDate) {
    return res.status(400).json({ error: "Juego, nombre, descripción y fecha de inicio son obligatorios." });
  }

  try {
    const r = await pool.query(
      `INSERT INTO events
         (game, name, description, expected_duration, start_date, end_date, files_url, status, created_by_id, created_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente', $8, $9)
       RETURNING *`,
      [game, name, description, expectedDuration, startDate, endDate, filesUrl, req.user.discordId, req.user.globalName || req.user.username || ""],
    );
    return res.json({ ok: true, event: mapEvent(r.rows[0]) });
  } catch (error) {
    return res.status(500).json({ error: "No se pudo crear el evento." });
  }
});

// Listar eventos aprobados (público).
router.get("/api/eventos", async (req, res) => {
  if (!pool) return res.json([]);
  try {
    const r = await pool.query(
      "SELECT * FROM events WHERE status = 'aprobado' ORDER BY start_date ASC NULLS LAST, created_at DESC",
    );
    return res.json(r.rows.map(mapEvent));
  } catch (error) {
    return res.json([]);
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
    await pool.query(
      "UPDATE events SET status = 'aprobado', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2",
      [req.user.globalName || req.user.username || "admin", req.params.id],
    );
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
