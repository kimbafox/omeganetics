// Módulo de Torneos con brackets de eliminación simple.
//   GET  /api/torneos                      lista (público)
//   GET  /api/torneos/:id                  detalle + participantes + bracket (público)
//   POST /api/torneos                      crear (admin)
//   POST /api/torneos/:id/inscribir        inscribirse (usuario, en inscripción)
//   POST /api/torneos/:id/salir            salir (usuario)
//   POST /api/torneos/:id/generar          generar bracket (admin)
//   POST /api/torneos/match/:matchId/ganador  marcar ganador y avanzar (admin)
//   DELETE /api/torneos/:id                eliminar (admin)

const express = require("express");
const { Pool } = require("pg");
const { requireUser } = require("../auth-discord");

const router = express.Router();
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes("railway") ? { rejectUnauthorized: false } : false })
  : null;

async function initTorneos() {
  if (!pool) { console.warn("[torneos] sin DATABASE_URL: módulo deshabilitado."); return; }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      game TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'inscripcion',
      max_participants INTEGER NOT NULL DEFAULT 0,
      created_by_id TEXT NOT NULL DEFAULT '',
      created_by_name TEXT NOT NULL DEFAULT '',
      winner_id TEXT NOT NULL DEFAULT '',
      winner_name TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tournament_participants (
      tournament_id INTEGER NOT NULL,
      discord_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tournament_id, discord_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tournament_matches (
      id SERIAL PRIMARY KEY,
      tournament_id INTEGER NOT NULL,
      round INTEGER NOT NULL,
      slot INTEGER NOT NULL,
      p1_id TEXT NOT NULL DEFAULT '', p1_name TEXT NOT NULL DEFAULT '',
      p2_id TEXT NOT NULL DEFAULT '', p2_name TEXT NOT NULL DEFAULT '',
      winner_id TEXT NOT NULL DEFAULT '', winner_name TEXT NOT NULL DEFAULT ''
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
const nextPow2 = (n) => { let p = 1; while (p < n) p *= 2; return Math.max(p, 2); };
const mapT = (r) => ({ id: r.id, name: r.name, game: r.game, description: r.description, status: r.status, maxParticipants: r.max_participants, createdByName: r.created_by_name, winnerId: r.winner_id, winnerName: r.winner_name, createdAt: r.created_at });
const mapM = (r) => ({ id: r.id, round: r.round, slot: r.slot, p1Id: r.p1_id, p1: r.p1_name, p2Id: r.p2_id, p2: r.p2_name, winnerId: r.winner_id, winner: r.winner_name });

// Lista (público).
router.get("/api/torneos", async (req, res) => {
  if (!pool) return res.json([]);
  try {
    const r = await pool.query(`
      SELECT t.*, COALESCE(c.n, 0) AS players
      FROM tournaments t
      LEFT JOIN (SELECT tournament_id, COUNT(*) n FROM tournament_participants GROUP BY tournament_id) c ON c.tournament_id = t.id
      ORDER BY t.created_at DESC
    `);
    return res.json(r.rows.map((row) => ({ ...mapT(row), players: Number(row.players) })));
  } catch (e) { return res.json([]); }
});

// Detalle + participantes + bracket (público).
router.get("/api/torneos/:id", async (req, res) => {
  if (!pool) return res.status(404).json({ error: "No encontrado." });
  try {
    const t = await pool.query("SELECT * FROM tournaments WHERE id = $1", [req.params.id]);
    if (!t.rows.length) return res.status(404).json({ error: "Torneo no encontrado." });
    const p = await pool.query("SELECT discord_id, name FROM tournament_participants WHERE tournament_id = $1 ORDER BY created_at ASC", [req.params.id]);
    const m = await pool.query("SELECT * FROM tournament_matches WHERE tournament_id = $1 ORDER BY round ASC, slot ASC", [req.params.id]);
    return res.json({
      tournament: mapT(t.rows[0]),
      participants: p.rows.map((x) => ({ discordId: x.discord_id, name: x.name })),
      matches: m.rows.map(mapM),
    });
  } catch (e) { return res.status(500).json({ error: "Error." }); }
});

// Crear (admin).
router.post("/api/torneos", requireAdmin, async (req, res) => {
  const name = clean(req.body?.name), game = clean(req.body?.game), description = clean(req.body?.description);
  const max = parseInt(req.body?.maxParticipants, 10) || 0;
  if (!name || !game) return res.status(400).json({ error: "Nombre y juego son obligatorios." });
  try {
    const r = await pool.query(
      "INSERT INTO tournaments (name, game, description, max_participants, created_by_id, created_by_name) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [name, game, description, max, req.user.discordId, req.user.globalName || req.user.username || "admin"],
    );
    return res.json({ ok: true, id: r.rows[0].id });
  } catch (e) { return res.status(500).json({ error: "No se pudo crear." }); }
});

// Inscribirse (usuario).
router.post("/api/torneos/:id/inscribir", requireUser, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "BD no configurada." });
  try {
    const t = await pool.query("SELECT status, max_participants FROM tournaments WHERE id = $1", [req.params.id]);
    if (!t.rows.length) return res.status(404).json({ error: "Torneo no encontrado." });
    if (t.rows[0].status !== "inscripcion") return res.status(400).json({ error: "Las inscripciones están cerradas." });
    const max = t.rows[0].max_participants;
    if (max > 0) {
      const c = await pool.query("SELECT COUNT(*)::int n FROM tournament_participants WHERE tournament_id = $1", [req.params.id]);
      if (c.rows[0].n >= max) return res.status(400).json({ error: "El torneo está lleno." });
    }
    const name = req.user.globalName || req.user.username || "Jugador";
    await pool.query("INSERT INTO tournament_participants (tournament_id, discord_id, name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [req.params.id, req.user.discordId, name]);
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ error: "No se pudo inscribir." }); }
});

// Salir (usuario).
router.post("/api/torneos/:id/salir", requireUser, async (req, res) => {
  try {
    const t = await pool.query("SELECT status FROM tournaments WHERE id = $1", [req.params.id]);
    if (t.rows[0]?.status !== "inscripcion") return res.status(400).json({ error: "Ya no puedes salir." });
    await pool.query("DELETE FROM tournament_participants WHERE tournament_id = $1 AND discord_id = $2", [req.params.id, req.user.discordId]);
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ error: "Error." }); }
});

// Eliminar (admin).
router.delete("/api/torneos/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM tournament_matches WHERE tournament_id = $1", [req.params.id]);
    await pool.query("DELETE FROM tournament_participants WHERE tournament_id = $1", [req.params.id]);
    await pool.query("DELETE FROM tournaments WHERE id = $1", [req.params.id]);
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ error: "No se pudo eliminar." }); }
});

// Generar bracket (admin).
router.post("/api/torneos/:id/generar", requireAdmin, async (req, res) => {
  const id = req.params.id;
  try {
    const parts = (await pool.query("SELECT discord_id, name FROM tournament_participants WHERE tournament_id = $1 ORDER BY created_at ASC", [id])).rows;
    if (parts.length < 2) return res.status(400).json({ error: "Se necesitan al menos 2 participantes." });
    const size = nextPow2(parts.length);
    const rounds = Math.round(Math.log2(size));
    await pool.query("DELETE FROM tournament_matches WHERE tournament_id = $1", [id]);
    // Ronda 1: emparejado j vs (size-1-j); los huecos son byes.
    for (let j = 0; j < size / 2; j += 1) {
      const p1 = parts[j] || null;
      const p2 = parts[size - 1 - j] || null;
      await pool.query(
        "INSERT INTO tournament_matches (tournament_id, round, slot, p1_id, p1_name, p2_id, p2_name) VALUES ($1,1,$2,$3,$4,$5,$6)",
        [id, j, p1?.discord_id || "", p1?.name || "", p2?.discord_id || "", p2?.name || ""],
      );
    }
    // Rondas siguientes vacías.
    for (let r = 2; r <= rounds; r += 1) {
      const matchesInRound = size / 2 ** r;
      for (let s = 0; s < matchesInRound; s += 1) {
        await pool.query("INSERT INTO tournament_matches (tournament_id, round, slot) VALUES ($1,$2,$3)", [id, r, s]);
      }
    }
    await pool.query("UPDATE tournaments SET status = 'en_curso' WHERE id = $1", [id]);
    // Resolver byes de la ronda 1 (quien no tiene rival avanza solo).
    const r1 = (await pool.query("SELECT * FROM tournament_matches WHERE tournament_id = $1 AND round = 1", [id])).rows;
    for (const m of r1) {
      if (m.p1_id && !m.p2_id) await advanceWinner(id, m, m.p1_id, m.p1_name);
      else if (!m.p1_id && m.p2_id) await advanceWinner(id, m, m.p2_id, m.p2_name);
    }
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ error: "No se pudo generar el bracket." }); }
});

// Avanza al ganador de un match al siguiente; si era la final, finaliza el torneo.
async function advanceWinner(tournamentId, match, winnerId, winnerName) {
  await pool.query("UPDATE tournament_matches SET winner_id = $1, winner_name = $2 WHERE id = $3", [winnerId, winnerName, match.id]);
  const nextRound = match.round + 1;
  const nx = await pool.query("SELECT id FROM tournament_matches WHERE tournament_id = $1 AND round = $2 AND slot = $3", [tournamentId, nextRound, Math.floor(match.slot / 2)]);
  if (nx.rows.length) {
    const col = match.slot % 2 === 0 ? "p1" : "p2";
    await pool.query(`UPDATE tournament_matches SET ${col}_id = $1, ${col}_name = $2 WHERE id = $3`, [winnerId, winnerName, nx.rows[0].id]);
  } else {
    // Era la final.
    await pool.query("UPDATE tournaments SET status = 'finalizado', winner_id = $1, winner_name = $2 WHERE id = $3", [winnerId, winnerName, tournamentId]);
    onTournamentFinish(tournamentId, winnerId, winnerName).catch(() => {});
  }
}

// Marcar ganador (admin).
router.post("/api/torneos/match/:matchId/ganador", requireAdmin, async (req, res) => {
  const winnerId = clean(req.body?.winnerId);
  try {
    const m = (await pool.query("SELECT * FROM tournament_matches WHERE id = $1", [req.params.matchId])).rows[0];
    if (!m) return res.status(404).json({ error: "Match no encontrado." });
    if (winnerId !== m.p1_id && winnerId !== m.p2_id) return res.status(400).json({ error: "El ganador debe ser uno de los dos jugadores." });
    const winnerName = winnerId === m.p1_id ? m.p1_name : m.p2_name;
    await advanceWinner(m.tournament_id, m, winnerId, winnerName);
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ error: "No se pudo registrar el ganador." }); }
});

async function onTournamentFinish(tournamentId, winnerId, winnerName) {
  try {
    const t = (await pool.query("SELECT name FROM tournaments WHERE id = $1", [tournamentId])).rows[0];
    const tName = t?.name || "el torneo";
    // Insignia de Campeón (las monedas legendarias se otorgan al cargar su perfil).
    await pool.query("INSERT INTO user_achievements (discord_id, achievement_key, granted_at, granted_by) VALUES ($1,'champion',NOW(),'torneo') ON CONFLICT DO NOTHING", [winnerId]).catch(() => {});
    const da = require("../discord-activity");
    da.grantRole?.(winnerId, "🏆 Campeón", "legendario");
    da.dmUser?.(winnerId, `🏆 ¡Ganaste el torneo "${tName}"! Te dimos el logro Campeón (y sus Omegacoins). ¡Felicidades!`);
    const channelId = process.env.EVENTS_CHANNEL_ID;
    if (channelId && da.announceTournamentWinner) da.announceTournamentWinner(channelId, tName, winnerName, winnerId);
  } catch (e) { /* noop */ }
}

module.exports = { router, initTorneos };
