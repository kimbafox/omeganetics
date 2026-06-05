// Estadísticas para el panel de administración: KPIs de economía y comunidad
// + series temporales para gráficas. Solo accesible por administradores.
//
//   GET /api/admin/stats   KPIs + flujo de Omegacoins (14 días) + actividad

const express = require("express");
const { Pool } = require("pg");
const { requireUser } = require("../auth-discord");

const router = express.Router();
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes("railway") ? { rejectUnauthorized: false } : false })
  : null;

const REFRESH_MIN = Number(process.env.ACTIVITY_REFRESH_MINUTES || 5);

function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: "Solo administradores." });
    next();
  });
}

async function one(sql, params, field, def = 0) {
  try { const r = await pool.query(sql, params || []); return r.rows[0] ? Number(r.rows[0][field]) : def; }
  catch (e) { return def; }
}

router.get("/api/admin/stats", requireAdmin, async (req, res) => {
  if (!pool) return res.json({ kpis: {}, coinsFlow: [], activity: [] });

  const kpis = {};
  kpis.members = await one("SELECT COUNT(*)::int n FROM community_users", [], "n");
  kpis.coinsCirculating = await one("SELECT COALESCE(SUM(balance),0)::bigint n FROM omegacoins", [], "n");
  kpis.coinsEarned7d = await one("SELECT COALESCE(SUM(amount),0)::bigint n FROM omegacoin_tx WHERE amount > 0 AND created_at > NOW() - INTERVAL '7 days'", [], "n");
  kpis.coinsSpent7d = await one("SELECT COALESCE(SUM(-amount),0)::bigint n FROM omegacoin_tx WHERE amount < 0 AND created_at > NOW() - INTERVAL '7 days'", [], "n");
  kpis.activeToday = await one("SELECT COUNT(DISTINCT discord_id)::int n FROM user_activity_daily WHERE day = CURRENT_DATE", [], "n");
  kpis.active7d = await one("SELECT COUNT(DISTINCT discord_id)::int n FROM user_activity_daily WHERE day > CURRENT_DATE - 7", [], "n");
  kpis.minigamePlaysToday = await one("SELECT COUNT(*)::int n FROM minigame_runs WHERE last_played_at::date = CURRENT_DATE", [], "n");
  kpis.missionsClaimedToday = await one("SELECT COUNT(*)::int n FROM daily_mission_claims WHERE day = CURRENT_DATE", [], "n");
  kpis.raffleEntries = await one("SELECT COUNT(*)::int n FROM raffle_entries", [], "n");
  kpis.openRaffles = await one("SELECT COUNT(*)::int n FROM raffles WHERE status = 'open'", [], "n");
  kpis.storePending = await one("SELECT COUNT(*)::int n FROM store_purchases WHERE status = 'pendiente'", [], "n");

  // Flujo de Omegacoins por día (14 días): ganadas vs gastadas.
  let coinsFlow = [];
  try {
    const r = await pool.query(
      `SELECT to_char(created_at::date,'YYYY-MM-DD') d,
              COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END),0)::bigint earned,
              COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END),0)::bigint spent
       FROM omegacoin_tx WHERE created_at > NOW() - INTERVAL '14 days'
       GROUP BY 1 ORDER BY 1`,
    );
    coinsFlow = r.rows.map((x) => ({ day: x.d, earned: Number(x.earned), spent: Number(x.spent) }));
  } catch (e) { /* noop */ }

  // Actividad por día (14 días): minutos en voz + mensajes.
  let activity = [];
  try {
    const r = await pool.query(
      `SELECT to_char(day,'YYYY-MM-DD') d, COALESCE(SUM(voice_samples),0)::int v, COALESCE(SUM(messages),0)::int m
       FROM user_activity_daily WHERE day > CURRENT_DATE - 14 GROUP BY day ORDER BY day`,
    );
    activity = r.rows.map((x) => ({ day: x.d, voiceMinutes: x.v * REFRESH_MIN, messages: x.m }));
  } catch (e) { /* noop */ }

  return res.json({ kpis, coinsFlow, activity });
});

function initAdminStats() { /* sin tablas propias */ }

module.exports = { router, initAdminStats };
