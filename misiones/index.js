// Misiones diarias — pequeñas metas que se renuevan cada día y dan Omegacoins.
// El progreso se calcula SIEMPRE en el servidor (actividad real + minijuego), nunca
// se confía en el cliente. Cada misión se reclama una vez por día.
//
//   GET  /api/me/misiones           misiones de hoy con progreso y estado
//   POST /api/me/misiones/reclamar  { key } -> paga la recompensa si está completa

const express = require("express");
const { Pool } = require("pg");
const { requireUser } = require("../auth-discord");
const { addCoins, getBalance } = require("../omegacoins");

const router = express.Router();
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes("railway") ? { rejectUnauthorized: false } : false })
  : null;

const REFRESH_MIN = Number(process.env.ACTIVITY_REFRESH_MINUTES || 5);

// Catálogo de misiones diarias (recompensas fáciles de ajustar).
const MISSIONS = [
  { key: "minijuego", icon: "🚀", title: "Farmea en Omega Invaders", desc: "Juega una partida del minijuego.", reward: 50, target: 1, unit: "" },
  { key: "mensajes", icon: "💬", title: "Conversa en el servidor", desc: "Envía 10 mensajes en Discord.", reward: 30, target: 10, unit: "msg" },
  { key: "voz", icon: "🎙️", title: "Únete a una llamada", desc: "Pasa 30 min en canales de voz.", reward: 50, target: 30, unit: "min" },
  { key: "visita", icon: "🌐", title: "Pásate por la web", desc: "Visita la plataforma hoy.", reward: 20, target: 1, unit: "" },
];
const BYKEY = Object.fromEntries(MISSIONS.map((m) => [m.key, m]));

async function initMisiones() {
  if (!pool) { console.warn("[misiones] sin DATABASE_URL: módulo deshabilitado."); return; }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_mission_claims (
      discord_id TEXT NOT NULL,
      day DATE NOT NULL,
      mission_key TEXT NOT NULL,
      reward INTEGER NOT NULL DEFAULT 0,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (discord_id, day, mission_key)
    );
  `);
}

// Progreso real de hoy para cada misión (calculado en servidor).
async function progressFor(discordId) {
  const prog = { minijuego: 0, mensajes: 0, voz: 0, visita: 1 }; // visita: por estar logueado
  if (!pool) return prog;
  try {
    const a = await pool.query(
      "SELECT messages, voice_samples FROM user_activity_daily WHERE discord_id = $1 AND day = CURRENT_DATE",
      [discordId],
    );
    if (a.rows[0]) {
      prog.mensajes = Number(a.rows[0].messages || 0);
      prog.voz = Number(a.rows[0].voice_samples || 0) * REFRESH_MIN;
    }
  } catch (e) { /* noop */ }
  try {
    const m = await pool.query(
      "SELECT 1 FROM minigame_runs WHERE discord_id = $1 AND last_played_at::date = CURRENT_DATE",
      [discordId],
    );
    prog.minijuego = m.rows.length ? 1 : 0;
  } catch (e) { /* noop */ }
  return prog;
}

async function claimedSet(discordId) {
  const set = new Set();
  if (!pool) return set;
  try {
    const r = await pool.query("SELECT mission_key FROM daily_mission_claims WHERE discord_id = $1 AND day = CURRENT_DATE", [discordId]);
    r.rows.forEach((row) => set.add(row.mission_key));
  } catch (e) { /* noop */ }
  return set;
}

function buildList(prog, claimed) {
  return MISSIONS.map((m) => {
    const progress = Math.min(prog[m.key] || 0, m.target);
    return {
      key: m.key, icon: m.icon, title: m.title, desc: m.desc, reward: m.reward,
      target: m.target, unit: m.unit, progress,
      done: (prog[m.key] || 0) >= m.target,
      claimed: claimed.has(m.key),
    };
  });
}

router.get("/api/me/misiones", requireUser, async (req, res) => {
  if (!pool) return res.json({ missions: [], resetsAt: null });
  const [prog, claimed] = await Promise.all([progressFor(req.user.discordId), claimedSet(req.user.discordId)]);
  const list = buildList(prog, claimed);
  const pending = list.filter((m) => m.done && !m.claimed).length;
  return res.json({ missions: list, pending });
});

router.post("/api/me/misiones/reclamar", requireUser, async (req, res) => {
  const m = BYKEY[String(req.body?.key || "")];
  if (!m) return res.status(400).json({ error: "Misión inválida." });
  if (!pool) return res.json({ ok: true, reward: m.reward, balance: 0 });

  // Recalcular progreso en servidor — nunca confiar en el cliente.
  const prog = await progressFor(req.user.discordId);
  if ((prog[m.key] || 0) < m.target) return res.status(400).json({ error: "Misión aún no completada." });

  try {
    // Marca atómica: si la fila ya existe, no se reclama de nuevo.
    const r = await pool.query(
      "INSERT INTO daily_mission_claims (discord_id, day, mission_key, reward) VALUES ($1, CURRENT_DATE, $2, $3) ON CONFLICT DO NOTHING RETURNING 1",
      [req.user.discordId, m.key, m.reward],
    );
    if (!r.rows.length) return res.status(409).json({ error: "Ya reclamaste esta misión hoy." });
    await addCoins(req.user.discordId, m.reward, `Misión diaria: ${m.title}`);
    const balance = await getBalance(req.user.discordId);
    return res.json({ ok: true, reward: m.reward, balance });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo reclamar la misión." });
  }
});

module.exports = { router, initMisiones };
