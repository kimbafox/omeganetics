// Ranking / Leaderboard de la comunidad.
// Tres tablas: Omegacoins, Nivel (XP) y Tiempo en voz. Devuelve el Top N y la
// posición del usuario que consulta (si tiene sesión).
//
//   GET /api/leaderboard           top de las 3 categorías + mi posición

const express = require("express");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");

const router = express.Router();
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, ssl: databaseUrl.includes("railway") ? { rejectUnauthorized: false } : false })
  : null;

const TOP_N = 20;
const REFRESH_MIN = Number(process.env.ACTIVITY_REFRESH_MINUTES || 5);

// Mismo cálculo de nivel que auth-discord (cada nivel cuesta progresivamente más).
function levelFromXp(xp) {
  let level = 1, total = 0, need = 100;
  while (xp >= total + need) { total += need; level += 1; need = Math.round(need * 1.35); }
  return level;
}

// Lee la sesión sin obligar a tenerla (para incluir "mi posición" si está logueado).
function softUser(req) {
  try {
    const cookie = (req.headers.cookie || "").split(";").map((c) => c.trim()).find((c) => c.startsWith("session="));
    const token = cookie ? cookie.slice("session=".length) : "";
    if (!token) return null;
    return jwt.verify(token, process.env.JWT_SECRET || "");
  } catch (e) { return null; }
}

function pubRow(r, value) {
  return {
    discordId: r.discord_id,
    name: (r.emoji ? r.emoji + " " : "") + (r.global_name || r.username || "Anónimo"),
    avatar: r.avatar_url || "",
    value,
  };
}

// Posición (rank) de un usuario dentro de una consulta ordenada.
async function rankOf(table, valueExpr, where, discordId) {
  try {
    const q = `SELECT rnk FROM (
      SELECT discord_id, RANK() OVER (ORDER BY ${valueExpr} DESC) AS rnk, ${valueExpr} AS val
      FROM ${table} ${where}
    ) t WHERE discord_id = $1`;
    const r = await pool.query(q, [discordId]);
    return r.rows[0] ? Number(r.rows[0].rnk) : null;
  } catch (e) { return null; }
}

router.get("/api/leaderboard", async (req, res) => {
  if (!pool) return res.json({ coins: [], level: [], voice: [], me: {} });
  const me = softUser(req);
  const out = { coins: [], level: [], voice: [], me: {} };

  // --- Omegacoins ---
  try {
    const r = await pool.query(
      `SELECT o.discord_id, o.balance, u.username, u.global_name, u.avatar_url, d.emoji
       FROM omegacoins o
       LEFT JOIN community_users u ON u.discord_id = o.discord_id
       LEFT JOIN user_decoration d ON d.discord_id = o.discord_id
       WHERE o.balance > 0
       ORDER BY o.balance DESC LIMIT $1`,
      [TOP_N],
    );
    out.coins = r.rows.map((row) => pubRow(row, Number(row.balance)));
  } catch (e) { /* noop */ }

  // --- Tiempo en voz (minutos) ---
  try {
    const r = await pool.query(
      `SELECT a.discord_id, a.v, u.username, u.global_name, u.avatar_url, d.emoji
       FROM (SELECT discord_id, COALESCE(SUM(voice_samples),0)::int AS v FROM user_activity_daily GROUP BY discord_id) a
       LEFT JOIN community_users u ON u.discord_id = a.discord_id
       LEFT JOIN user_decoration d ON d.discord_id = a.discord_id
       WHERE a.v > 0
       ORDER BY a.v DESC LIMIT $1`,
      [TOP_N],
    );
    out.voice = r.rows.map((row) => pubRow(row, Number(row.v) * REFRESH_MIN));
  } catch (e) { /* noop */ }

  // --- Nivel / XP ---
  try {
    const r = await pool.query(
      `SELECT a.discord_id, a.xp, u.username, u.global_name, u.avatar_url, d.emoji
       FROM (SELECT discord_id, (COALESCE(SUM(voice_samples),0)*5 + COALESCE(SUM(messages),0))::int AS xp FROM user_activity_daily GROUP BY discord_id) a
       LEFT JOIN community_users u ON u.discord_id = a.discord_id
       LEFT JOIN user_decoration d ON d.discord_id = a.discord_id
       WHERE a.xp > 0
       ORDER BY a.xp DESC LIMIT $1`,
      [TOP_N],
    );
    out.level = r.rows.map((row) => { const o = pubRow(row, levelFromXp(Number(row.xp))); o.xp = Number(row.xp); return o; });
  } catch (e) { /* noop */ }

  // --- Mi posición en cada tabla ---
  if (me && me.discordId) {
    out.me = {
      coins: await rankOf("omegacoins", "balance", "WHERE balance > 0", me.discordId),
      voice: await rankOf("(SELECT discord_id, COALESCE(SUM(voice_samples),0)::int AS v FROM user_activity_daily GROUP BY discord_id) s", "v", "WHERE v > 0", me.discordId),
      level: await rankOf("(SELECT discord_id, (COALESCE(SUM(voice_samples),0)*5 + COALESCE(SUM(messages),0))::int AS xp FROM user_activity_daily GROUP BY discord_id) s", "xp", "WHERE xp > 0", me.discordId),
    };
  }

  return res.json(out);
});

function initLeaderboard() { /* sin tablas propias: lee de omegacoins y actividad */ }

module.exports = { router, initLeaderboard };
