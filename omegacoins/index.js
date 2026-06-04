// Módulo de Omegacoins — la plataforma es la fuente de verdad de la moneda.
// Se ganan por: subir de nivel (100 + 10 por nivel), logros (según rareza) y premios.
//
//   GET  /api/me/omegacoins      saldo + movimientos recientes (usuario)
//   POST /api/omegacoins/dar     {user, amount, reason}  (admin)
//
// Funciones exportadas para que otros módulos otorguen monedas:
//   addCoins, getBalance, rewardLevelUps, rewardAchievement

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

// Recompensa de monedas por rareza de logro.
const TIER_REWARD = { comun: 100, raro: 300, epico: 1000, legendario: 5000 };

async function initOmegacoins() {
  if (!pool) {
    console.warn("[omegacoins] sin DATABASE_URL: módulo deshabilitado.");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS omegacoins (
      discord_id TEXT PRIMARY KEY,
      balance BIGINT NOT NULL DEFAULT 0,
      last_rewarded_level INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS omegacoin_tx (
      id SERIAL PRIMARY KEY,
      discord_id TEXT NOT NULL,
      amount BIGINT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function ensureRow(discordId) {
  if (!pool) return;
  await pool.query("INSERT INTO omegacoins (discord_id) VALUES ($1) ON CONFLICT (discord_id) DO NOTHING", [discordId]);
}

async function getBalance(discordId) {
  if (!pool) return 0;
  try {
    const r = await pool.query("SELECT balance FROM omegacoins WHERE discord_id = $1", [discordId]);
    return r.rows[0] ? Number(r.rows[0].balance) : 0;
  } catch (e) {
    return 0;
  }
}

async function addCoins(discordId, amount, reason) {
  if (!pool || !amount) return;
  await ensureRow(discordId);
  await pool.query("UPDATE omegacoins SET balance = balance + $2, updated_at = NOW() WHERE discord_id = $1", [discordId, amount]);
  await pool.query("INSERT INTO omegacoin_tx (discord_id, amount, reason) VALUES ($1, $2, $3)", [discordId, amount, reason]);
}

// Nivel 2 = 100 monedas, y +10 por cada nivel siguiente.
function levelUpReward(level) {
  return 100 + (level - 2) * 10;
}

// Paga las monedas por los niveles nuevos que el usuario haya alcanzado.
async function rewardLevelUps(discordId, currentLevel) {
  if (!pool || !currentLevel || currentLevel < 2) return 0;
  await ensureRow(discordId);
  const r = await pool.query("SELECT last_rewarded_level FROM omegacoins WHERE discord_id = $1", [discordId]);
  const last = r.rows[0]?.last_rewarded_level || 1;
  if (currentLevel <= last) return 0;
  let total = 0;
  for (let L = last + 1; L <= currentLevel; L += 1) total += levelUpReward(L);
  await pool.query(
    "UPDATE omegacoins SET balance = balance + $2, last_rewarded_level = $3, updated_at = NOW() WHERE discord_id = $1",
    [discordId, total, currentLevel],
  );
  await pool.query("INSERT INTO omegacoin_tx (discord_id, amount, reason) VALUES ($1, $2, $3)", [discordId, total, `Subiste a nivel ${currentLevel}`]);
  return total;
}

// Paga las monedas de un logro (idempotente: usa el tx como marcador).
async function rewardAchievement(discordId, key, tier) {
  if (!pool) return 0;
  const amount = TIER_REWARD[tier] || 0;
  if (!amount) return 0;
  const reason = `Logro: ${key}`;
  const exists = await pool.query("SELECT 1 FROM omegacoin_tx WHERE discord_id = $1 AND reason = $2 LIMIT 1", [discordId, reason]);
  if (exists.rows.length) return 0;
  await addCoins(discordId, amount, reason);
  return amount;
}

function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: "Solo administradores." });
    next();
  });
}

async function resolveUser(user) {
  const u = String(user || "").trim();
  if (!u) return null;
  if (/^\d{5,}$/.test(u)) return u;
  const clean = u.replace(/^@/, "").toLowerCase();
  try {
    const r = await pool.query(
      "SELECT discord_id FROM discord_members WHERE LOWER(username) = $1 OR LOWER(display_name) = $1 LIMIT 1",
      [clean],
    );
    return r.rows[0]?.discord_id || null;
  } catch (e) {
    return null;
  }
}

// Mi saldo + movimientos.
router.get("/api/me/omegacoins", requireUser, async (req, res) => {
  if (!pool) return res.json({ balance: 0, recent: [] });
  try {
    const balance = await getBalance(req.user.discordId);
    const tx = await pool.query(
      "SELECT amount, reason, created_at FROM omegacoin_tx WHERE discord_id = $1 ORDER BY created_at DESC LIMIT 10",
      [req.user.discordId],
    );
    return res.json({ balance, recent: tx.rows.map((t) => ({ amount: Number(t.amount), reason: t.reason, at: t.created_at })) });
  } catch (e) {
    return res.json({ balance: 0, recent: [] });
  }
});

// Otorgar monedas (admin) — útil para el premio semanal del leaderboard.
router.post("/api/omegacoins/dar", requireAdmin, async (req, res) => {
  const amount = parseInt(req.body?.amount, 10);
  if (!Number.isFinite(amount) || amount === 0) return res.status(400).json({ error: "Cantidad inválida." });
  const discordId = await resolveUser(req.body?.user);
  if (!discordId) return res.status(404).json({ error: "Usuario no encontrado (usa @usuario o ID)." });
  try {
    await addCoins(discordId, amount, String(req.body?.reason || `Otorgado por ${req.user.globalName || req.user.username}`).slice(0, 120));
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo otorgar." });
  }
});

module.exports = { router, initOmegacoins, getBalance, addCoins, rewardLevelUps, rewardAchievement };
