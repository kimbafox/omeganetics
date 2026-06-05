// Minijuego "Omega Invaders" — farmeo diario de Omegacoins.
// La nave es el avatar del jugador; destruye asteroides (+1) y naves enemigas (+5).
// Se puede jugar 1 vez cada 24h. El servidor es la fuente de verdad: valida el
// cooldown, recorta a un tope por partida y aplica chequeos de cordura anti-trampa.
//
//   GET  /api/me/minijuego            ¿puedo jugar? + reglas (cooldown, recompensas)
//   POST /api/me/minijuego/resultado  { asteroids, ships, durationMs } -> paga monedas
//
// Nota: el juego corre en el navegador y por tanto NO es 100% inviolable, pero el
// daño de un tramposo queda acotado a "el tope, una vez al día".

const express = require("express");
const { Pool } = require("pg");
const { requireUser } = require("../auth-discord");
const { addCoins, getBalance } = require("../omegacoins");

const router = express.Router();
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes("railway") ? { rejectUnauthorized: false } : false })
  : null;

// === Parámetros del minijuego (fáciles de ajustar si cambia la economía) ===
const REWARD = { asteroid: 1, ship: 5 }; // monedas por objetivo destruido
const COOLDOWN_HOURS = 24;               // espera entre partidas
const MAX_COINS_PER_RUN = 500;           // tope de monedas por partida (se recorta)
const MIN_RUN_MS = 4000;                 // partidas más cortas no pagan (anti-spam)
const MAX_RUN_MS = 30 * 60 * 1000;       // tope de duración creíble (30 min)
const MAX_COINS_PER_SEC = 4;             // ritmo máximo creíble de farmeo
const MAX_KILLS = 5000;                  // tope duro de objetivos por partida

const COOLDOWN_MS = COOLDOWN_HOURS * 3600 * 1000;

async function initMinijuego() {
  if (!pool) { console.warn("[minijuego] sin DATABASE_URL: módulo deshabilitado."); return; }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS minigame_runs (
      discord_id TEXT PRIMARY KEY,
      last_played_at TIMESTAMPTZ,
      last_earned INTEGER NOT NULL DEFAULT 0,
      total_runs INTEGER NOT NULL DEFAULT 0,
      total_earned BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

const RULES = {
  rewards: REWARD,
  cooldownHours: COOLDOWN_HOURS,
  maxPerRun: MAX_COINS_PER_RUN,
};

// Estado: ¿puedo jugar ya? ¿cuándo vuelve a estar disponible?
router.get("/api/me/minijuego", requireUser, async (req, res) => {
  if (!pool) return res.json({ canPlay: true, nextAvailableAt: null, ...RULES });
  try {
    const r = await pool.query("SELECT last_played_at, last_earned FROM minigame_runs WHERE discord_id = $1", [req.user.discordId]);
    const last = r.rows[0]?.last_played_at ? new Date(r.rows[0].last_played_at).getTime() : 0;
    const nextTs = last ? last + COOLDOWN_MS : 0;
    const canPlay = !last || Date.now() >= nextTs;
    return res.json({
      canPlay,
      nextAvailableAt: canPlay ? null : new Date(nextTs).toISOString(),
      lastEarned: r.rows[0]?.last_earned || 0,
      ...RULES,
    });
  } catch (e) {
    return res.json({ canPlay: true, nextAvailableAt: null, ...RULES });
  }
});

// Validación numérica básica: entero, finito, dentro de [0, max].
function intIn(v, max) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

// Reportar el resultado de una partida y cobrar (si toca).
router.post("/api/me/minijuego/resultado", requireUser, async (req, res) => {
  const asteroids = intIn(req.body?.asteroids, MAX_KILLS);
  const ships = intIn(req.body?.ships, MAX_KILLS);
  const durationMs = intIn(req.body?.durationMs, MAX_RUN_MS);

  if (durationMs < MIN_RUN_MS) {
    return res.status(400).json({ error: "Partida demasiado corta para contar." });
  }

  // Recompensa cruda según objetivos, con chequeos de cordura (clamp, no rechazo).
  let earned = asteroids * REWARD.asteroid + ships * REWARD.ship;
  const rateCap = Math.ceil((durationMs / 1000) * MAX_COINS_PER_SEC);
  earned = Math.min(earned, rateCap, MAX_COINS_PER_RUN);
  if (earned < 0) earned = 0;

  if (!pool) {
    return res.json({ ok: true, earned, balance: 0, nextAvailableAt: new Date(Date.now() + COOLDOWN_MS).toISOString() });
  }

  // Guardia atómica del cooldown: el upsert sólo "gana" si nunca jugó o ya pasó el
  // cooldown. Si dos peticiones llegan a la vez, sólo una obtiene fila de vuelta.
  try {
    const claim = await pool.query(
      `INSERT INTO minigame_runs (discord_id, last_played_at, last_earned, total_runs, total_earned)
       VALUES ($1, NOW(), $2, 1, $2)
       ON CONFLICT (discord_id) DO UPDATE
         SET last_played_at = NOW(),
             last_earned = $2,
             total_runs = minigame_runs.total_runs + 1,
             total_earned = minigame_runs.total_earned + $2
       WHERE minigame_runs.last_played_at IS NULL
          OR minigame_runs.last_played_at < NOW() - ($3 || ' hours')::interval
       RETURNING last_played_at`,
      [req.user.discordId, earned, String(COOLDOWN_HOURS)],
    );

    if (!claim.rows.length) {
      // Cooldown activo: devolvemos cuándo vuelve a estar disponible.
      const r = await pool.query("SELECT last_played_at FROM minigame_runs WHERE discord_id = $1", [req.user.discordId]);
      const last = r.rows[0]?.last_played_at ? new Date(r.rows[0].last_played_at).getTime() : Date.now();
      return res.status(429).json({ error: "Aún en cooldown.", nextAvailableAt: new Date(last + COOLDOWN_MS).toISOString() });
    }

    if (earned > 0) await addCoins(req.user.discordId, earned, "Minijuego Omega Invaders");
    const balance = await getBalance(req.user.discordId);
    return res.json({ ok: true, earned, balance, nextAvailableAt: new Date(Date.now() + COOLDOWN_MS).toISOString() });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo registrar la partida." });
  }
});

module.exports = { router, initMinijuego };
