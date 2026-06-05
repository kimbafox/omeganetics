// Sorteos — los usuarios se registran gastando Omegacoins (1 entrada por persona).
// Un admin crea el sorteo y, cuando quiere, sortea un ganador al azar entre las entradas.
//
//   GET  /api/sorteos                lista de sorteos (abiertos + sorteados) + mi estado
//   POST /api/sorteos                {title, prize, cost?, imageUrl?, endsAt?} (admin)
//   POST /api/sorteos/:id/participar (usuario) -> gasta el costo y entra
//   POST /api/sorteos/:id/sortear    (admin) -> elige ganador al azar
//   POST /api/sorteos/:id/cerrar     (admin) -> cierra sin sortear
//   DELETE /api/sorteos/:id          (admin)

const express = require("express");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const { requireUser } = require("../auth-discord");
const { spendCoins } = require("../omegacoins");

const router = express.Router();
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes("railway") ? { rejectUnauthorized: false } : false })
  : null;

const DEFAULT_COST = 1000; // Omegacoins por entrada

async function initSorteos() {
  if (!pool) { console.warn("[sorteos] sin DATABASE_URL: módulo deshabilitado."); return; }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS raffles (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      prize TEXT NOT NULL DEFAULT '',
      cost INTEGER NOT NULL DEFAULT 1000,
      image_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      winner_id TEXT,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      drawn_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS raffle_entries (
      raffle_id INTEGER NOT NULL,
      discord_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (raffle_id, discord_id)
    );
  `);
}

function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: "Solo administradores." });
    next();
  });
}

// Lee la sesión sin obligar (para marcar "ya participo" / si es admin, si hay sesión).
function softUser(req) {
  try {
    const cookie = (req.headers.cookie || "").split(";").map((c) => c.trim()).find((c) => c.startsWith("session="));
    const token = cookie ? cookie.slice("session=".length) : "";
    if (!token) return null;
    return jwt.verify(token, process.env.JWT_SECRET || "");
  } catch (e) { return null; }
}

async function nameOf(discordId) {
  if (!discordId) return "";
  try {
    const r = await pool.query("SELECT global_name, username FROM community_users WHERE discord_id = $1", [discordId]);
    return r.rows[0]?.global_name || r.rows[0]?.username || "Ganador";
  } catch (e) { return "Ganador"; }
}

router.get("/api/sorteos", async (req, res) => {
  if (!pool) return res.json({ sorteos: [], isAdmin: false });
  const me = softUser(req);
  try {
    const r = await pool.query(
      `SELECT r.*, (SELECT COUNT(*)::int FROM raffle_entries e WHERE e.raffle_id = r.id) AS entries
       FROM raffles r
       WHERE r.status != 'closed'
       ORDER BY (r.status = 'open') DESC, r.created_at DESC
       LIMIT 50`,
    );
    const mine = new Set();
    if (me?.discordId) {
      const em = await pool.query("SELECT raffle_id FROM raffle_entries WHERE discord_id = $1", [me.discordId]);
      em.rows.forEach((x) => mine.add(x.raffle_id));
    }
    const sorteos = [];
    for (const row of r.rows) {
      sorteos.push({
        id: row.id, title: row.title, prize: row.prize, cost: row.cost, imageUrl: row.image_url,
        status: row.status, entries: row.entries, joined: mine.has(row.id),
        winnerId: row.winner_id, winnerName: row.winner_id ? await nameOf(row.winner_id) : "",
        endsAt: row.ends_at, createdAt: row.created_at,
      });
    }
    return res.json({ sorteos, isAdmin: Boolean(me?.isAdmin) });
  } catch (e) {
    return res.json({ sorteos: [], isAdmin: Boolean(me?.isAdmin) });
  }
});

router.post("/api/sorteos", requireAdmin, async (req, res) => {
  const title = String(req.body?.title || "").trim().slice(0, 120);
  const prize = String(req.body?.prize || "").trim().slice(0, 300);
  const imageUrl = String(req.body?.imageUrl || "").trim().slice(0, 500);
  let cost = parseInt(req.body?.cost, 10);
  if (!Number.isFinite(cost) || cost < 0) cost = DEFAULT_COST;
  const endsAt = req.body?.endsAt ? new Date(req.body.endsAt) : null;
  if (!title) return res.status(400).json({ error: "Falta el título." });
  try {
    const r = await pool.query(
      "INSERT INTO raffles (title, prize, cost, image_url, created_by, ends_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [title, prize, cost, imageUrl, req.user.discordId, endsAt && !isNaN(endsAt) ? endsAt : null],
    );
    return res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo crear el sorteo." });
  }
});

router.post("/api/sorteos/:id/participar", requireUser, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Sorteo inválido." });
  try {
    const r = await pool.query("SELECT cost, status FROM raffles WHERE id = $1", [id]);
    if (!r.rows.length) return res.status(404).json({ error: "Sorteo no encontrado." });
    if (r.rows[0].status !== "open") return res.status(400).json({ error: "Este sorteo ya no admite participantes." });
    const cost = Number(r.rows[0].cost);

    // 1) Reservar la entrada (1 por persona). Si ya existe -> no se cobra.
    const claim = await pool.query(
      "INSERT INTO raffle_entries (raffle_id, discord_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1",
      [id, req.user.discordId],
    );
    if (!claim.rows.length) return res.status(409).json({ error: "Ya estás participando en este sorteo." });

    // 2) Cobrar. Si no alcanza el saldo, liberar la entrada reservada.
    const spend = await spendCoins(req.user.discordId, cost, `Sorteo #${id}`);
    if (!spend.ok) {
      await pool.query("DELETE FROM raffle_entries WHERE raffle_id = $1 AND discord_id = $2", [id, req.user.discordId]);
      return res.status(400).json({ error: spend.error === "saldo" ? "No te alcanzan las Omegacoins." : "No se pudo procesar." });
    }
    return res.json({ ok: true, balance: spend.balance });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo participar." });
  }
});

router.post("/api/sorteos/:id/sortear", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Sorteo inválido." });
  try {
    const r = await pool.query("SELECT status FROM raffles WHERE id = $1", [id]);
    if (!r.rows.length) return res.status(404).json({ error: "Sorteo no encontrado." });
    if (r.rows[0].status === "drawn") return res.status(400).json({ error: "Este sorteo ya fue sorteado." });
    const w = await pool.query("SELECT discord_id FROM raffle_entries WHERE raffle_id = $1 ORDER BY RANDOM() LIMIT 1", [id]);
    if (!w.rows.length) return res.status(400).json({ error: "No hay participantes para sortear." });
    const winnerId = w.rows[0].discord_id;
    await pool.query("UPDATE raffles SET status = 'drawn', winner_id = $2, drawn_at = NOW() WHERE id = $1", [id, winnerId]);
    return res.json({ ok: true, winnerId, winnerName: await nameOf(winnerId) });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo sortear." });
  }
});

router.post("/api/sorteos/:id/cerrar", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Sorteo inválido." });
  try {
    await pool.query("UPDATE raffles SET status = 'closed' WHERE id = $1", [id]);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo cerrar." });
  }
});

router.delete("/api/sorteos/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Sorteo inválido." });
  try {
    await pool.query("DELETE FROM raffle_entries WHERE raffle_id = $1", [id]);
    await pool.query("DELETE FROM raffles WHERE id = $1", [id]);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo eliminar." });
  }
});

module.exports = { router, initSorteos };
