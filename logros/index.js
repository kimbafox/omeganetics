// Módulo de Logros / Insignias.
// - Automáticos: se otorgan solos según la actividad (mensajes, voz, nivel, eventos).
// - Manuales: los otorga un admin (ganar un torneo, streamer aliado, etc.).
//
//   GET  /api/logros            catálogo (público)
//   GET  /api/me/logros         mis logros (usuario; auto-otorga los que correspondan)
//   POST /api/logros/otorgar    {user, key}  (admin)
//   POST /api/logros/quitar     {user, key}  (admin)

const express = require("express");
const { Pool } = require("pg");
const { requireUser } = require("../auth-discord");
const { rewardLevelUps, rewardAchievement } = require("../omegacoins");

const router = express.Router();

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("railway") ? { rejectUnauthorized: false } : false,
    })
  : null;

// Catálogo de logros. Los "auto" se otorgan según `metric` >= `threshold`.
// tier (rareza, de menor a mayor brillo): comun < raro < epico < legendario
const CATALOG = [
  { key: "first_message", name: "Primer mensaje", icon: "💬", description: "Envía tu primer mensaje en el servidor.", type: "auto", metric: "messages", threshold: 1, tier: "comun" },
  { key: "chatty", name: "Conversador", icon: "🗨️", description: "Envía 100 mensajes en el servidor.", type: "auto", metric: "messages", threshold: 100, tier: "raro" },
  { key: "unstoppable", name: "Imparable", icon: "🔥", description: "Envía 1000 mensajes en el servidor.", type: "auto", metric: "messages", threshold: 1000, tier: "epico", role: true },
  { key: "voice_starter", name: "En la llamada", icon: "🎙️", description: "Acumula 1 hora en canales de voz (sin contar el AFK).", type: "auto", metric: "voiceMinutes", threshold: 60, tier: "comun" },
  { key: "voice_pro", name: "Voz del servidor", icon: "🎧", description: "Acumula 10 horas en canales de voz.", type: "auto", metric: "voiceMinutes", threshold: 600, tier: "epico", role: true },
  { key: "level5", name: "Nivel 5", icon: "⭐", description: "Llega al nivel 5 (XP por voz y mensajes).", type: "auto", metric: "level", threshold: 5, tier: "raro" },
  { key: "level10", name: "Veterano", icon: "🏅", description: "Llega al nivel 10.", type: "auto", metric: "level", threshold: 10, tier: "epico", role: true },
  { key: "organizer", name: "Organizador", icon: "📅", description: "Crea un evento y que un admin lo apruebe.", type: "auto", metric: "eventsCreated", threshold: 1, tier: "raro" },
  { key: "champion", name: "Campeón", icon: "🏆", description: "La otorga un admin por ganar un evento o torneo.", type: "manual", tier: "legendario", role: true },
  { key: "streamer", name: "Streamer aliado", icon: "📺", description: "La otorga un admin a los streamers de la comunidad.", type: "manual", tier: "epico", role: true },
  { key: "founder", name: "Fundador", icon: "👑", description: "La otorga un admin a los miembros fundadores.", type: "manual", tier: "legendario", role: true },
  { key: "mvp", name: "MVP del mes", icon: "🥇", description: "La otorga un admin al jugador más destacado del mes.", type: "manual", tier: "legendario", role: true },
];
const CATALOG_KEYS = new Set(CATALOG.map((a) => a.key));

async function initLogros() {
  if (!pool) {
    console.warn("[logros] sin DATABASE_URL: módulo deshabilitado.");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_achievements (
      discord_id TEXT NOT NULL,
      achievement_key TEXT NOT NULL,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      granted_by TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (discord_id, achievement_key)
    );
  `);
}

function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: "Solo administradores." });
    next();
  });
}

function levelFromXp(xp) {
  let level = 1, total = 0, need = 100;
  while (xp >= total + need) { total += need; level += 1; need = Math.round(need * 1.35); }
  return level;
}

async function getUserStats(discordId) {
  const refreshMinutes = Number(process.env.ACTIVITY_REFRESH_MINUTES || 5);
  const stats = { voiceMinutes: 0, messages: 0, level: 1, eventsCreated: 0 };
  try {
    const s = await pool.query(
      "SELECT COALESCE(SUM(voice_samples),0)::int AS v, COALESCE(SUM(messages),0)::int AS m FROM user_activity_daily WHERE discord_id = $1",
      [discordId],
    );
    const row = s.rows[0] || {};
    stats.voiceMinutes = (row.v || 0) * refreshMinutes;
    stats.messages = row.m || 0;
    stats.level = levelFromXp((row.v || 0) * 5 + (row.m || 0));
  } catch (e) { /* sin datos */ }
  try {
    const e = await pool.query("SELECT COUNT(*)::int AS c FROM events WHERE created_by_id = $1 AND status = 'aprobado'", [discordId]);
    stats.eventsCreated = e.rows[0]?.c || 0;
  } catch (e) { /* sin eventos */ }
  return stats;
}

async function autoGrant(discordId, stats) {
  const newly = [];
  for (const a of CATALOG) {
    if (a.type !== "auto") continue;
    if ((stats[a.metric] || 0) < a.threshold) continue;
    try {
      const r = await pool.query(
        "INSERT INTO user_achievements (discord_id, achievement_key, granted_at) VALUES ($1, $2, NOW()) ON CONFLICT (discord_id, achievement_key) DO NOTHING RETURNING achievement_key",
        [discordId, a.key],
      );
      if (r.rows.length) newly.push(a);
    } catch (e) { /* noop */ }
  }
  if (newly.length) {
    try {
      const { dmUser } = require("../discord-activity");
      const names = newly.map((a) => `${a.icon} ${a.name}`).join(", ");
      dmUser(discordId, `🏅 ¡Desbloqueaste ${newly.length > 1 ? "logros" : "un logro"}: ${names}! Míralos en https://omeganetics.com/perfil.html`).catch(() => {});
    } catch (e) { /* noop */ }
  }
}

async function resolveUser(user) {
  const u = String(user || "").trim();
  if (!u) return null;
  if (/^\d{5,}$/.test(u)) return u; // ya es un ID de Discord
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

// Catálogo público.
router.get("/api/logros", (req, res) => res.json(CATALOG));

// Mis logros (auto-otorga los que correspondan y devuelve ganados + bloqueados).
router.get("/api/me/logros", requireUser, async (req, res) => {
  if (!pool) return res.json({ list: CATALOG.map((a) => ({ ...a, earned: false })), stats: {} });
  try {
    const stats = await getUserStats(req.user.discordId);
    await autoGrant(req.user.discordId, stats);
    const r = await pool.query("SELECT achievement_key, granted_at FROM user_achievements WHERE discord_id = $1", [req.user.discordId]);
    const earned = new Map(r.rows.map((x) => [x.achievement_key, x.granted_at]));
    const list = CATALOG.map((a) => ({ ...a, earned: earned.has(a.key), grantedAt: earned.get(a.key) || null }));
    // Recompensas en Omegacoins: por subir de nivel y por cada logro ganado.
    try {
      await rewardLevelUps(req.user.discordId, stats.level);
      let da = null;
      for (const a of list) {
        if (!a.earned) continue;
        await rewardAchievement(req.user.discordId, a.key, a.tier);
        if (a.role) {
          try { da = da || require("../discord-activity"); da.grantRole(req.user.discordId, `${a.icon} ${a.name}`, a.tier); } catch (e) { /* noop */ }
        }
      }
    } catch (e) { /* no bloquea la respuesta */ }
    return res.json({ list, stats });
  } catch (e) {
    return res.json({ list: CATALOG.map((a) => ({ ...a, earned: false })), stats: {} });
  }
});

// Otorgar insignia (admin).
router.post("/api/logros/otorgar", requireAdmin, async (req, res) => {
  const key = String(req.body?.key || "").trim();
  if (!CATALOG_KEYS.has(key)) return res.status(400).json({ error: "Insignia inválida." });
  const discordId = await resolveUser(req.body?.user);
  if (!discordId) return res.status(404).json({ error: "Usuario no encontrado (usa su @usuario o su ID de Discord)." });
  try {
    const ins = await pool.query(
      "INSERT INTO user_achievements (discord_id, achievement_key, granted_at, granted_by) VALUES ($1, $2, NOW(), $3) ON CONFLICT (discord_id, achievement_key) DO NOTHING RETURNING achievement_key",
      [discordId, key, req.user.globalName || req.user.username || "admin"],
    );
    const ach = CATALOG.find((a) => a.key === key);
    if (ach) {
      rewardAchievement(discordId, key, ach.tier).catch(() => {});
      if (ach.role) { try { require("../discord-activity").grantRole(discordId, `${ach.icon} ${ach.name}`, ach.tier); } catch (e) { /* noop */ } }
      if (ins.rows.length) { try { require("../discord-activity").dmUser(discordId, `🏅 ¡Un admin te otorgó el logro ${ach.icon} ${ach.name}!`); } catch (e) { /* noop */ } }
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo otorgar." });
  }
});

// Quitar insignia (admin).
router.post("/api/logros/quitar", requireAdmin, async (req, res) => {
  const key = String(req.body?.key || "").trim();
  const discordId = await resolveUser(req.body?.user);
  if (!discordId) return res.status(404).json({ error: "Usuario no encontrado." });
  try {
    await pool.query("DELETE FROM user_achievements WHERE discord_id = $1 AND achievement_key = $2", [discordId, key]);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "No se pudo quitar." });
  }
});

module.exports = { router, initLogros, CATALOG };
