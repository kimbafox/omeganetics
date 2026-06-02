// Lector de actividad de Discord integrado al sitio.
// Mantiene una conexión al servidor de Discord y, cada X minutos, guarda en la base
// de datos qué juegos se están jugando (tablas discord_active_games / discord_server_stats).
// Así la página /actividad.html siempre tiene datos frescos SIN un servicio aparte.
//
// Variables: DISCORD_TOKEN, GUILD_ID, DATABASE_URL (y opcional ACTIVITY_REFRESH_MINUTES).

const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, ActivityType, Partials } = require("discord.js");
const { Pool } = require("pg");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || "";
const GUILD_ID = process.env.GUILD_ID || "";
const REFRESH_MINUTES = Number(process.env.ACTIVITY_REFRESH_MINUTES || 5);

// Lista de apps que NO son juegos (reutiliza bot/non-games.json).
let IGNORAR = new Set();
let PALABRAS_CLAVE = [];
try {
  const ng = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "bot", "non-games.json"), "utf8"));
  IGNORAR = new Set((ng.ignorar || []).map((s) => s.toLowerCase()));
  PALABRAS_CLAVE = (ng.palabrasClave || []).map((s) => s.toLowerCase());
} catch (e) {
  console.warn("[activity] no pude leer non-games.json:", e.message);
}

function esJuego(nombre) {
  const n = String(nombre).toLowerCase();
  if (IGNORAR.has(n)) return false;
  if (PALABRAS_CLAVE.some((kw) => n.includes(kw))) return false;
  return true;
}

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("railway") ? { rejectUnauthorized: false } : false,
    })
  : null;

function computeActiveGames(guild) {
  const games = new Map(); // claveMinusculas -> { name, users: Set }
  const activeUsers = new Set();
  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;
    const presence = member.presence;
    if (!presence || presence.status === "offline") continue;
    for (const activity of presence.activities) {
      if (activity.type !== ActivityType.Playing) continue;
      if (!esJuego(activity.name)) continue;
      activeUsers.add(member.id);
      const key = activity.name.toLowerCase();
      if (!games.has(key)) games.set(key, { name: activity.name, users: new Set() });
      games.get(key).users.add(member.id);
    }
  }
  const ranked = [...games.values()]
    .map(({ name, users }) => ({ game: name, players: users.size }))
    .sort((a, b) => b.players - a.players);
  return { totalActive: activeUsers.size, games: ranked };
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_active_games (
      game TEXT PRIMARY KEY,
      players INTEGER NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_server_stats (
      id INTEGER PRIMARY KEY,
      total_active INTEGER NOT NULL DEFAULT 0,
      games_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function save(snap) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM discord_active_games");
    for (const { game, players } of snap.games) {
      await client.query(
        "INSERT INTO discord_active_games (game, players, updated_at) VALUES ($1, $2, NOW())",
        [game, players]
      );
    }
    await client.query(
      `INSERT INTO discord_server_stats (id, total_active, games_count, updated_at)
       VALUES (1, $1, $2, NOW())
       ON CONFLICT (id) DO UPDATE
         SET total_active = EXCLUDED.total_active,
             games_count = EXCLUDED.games_count,
             updated_at = NOW()`,
      [snap.totalActive, snap.games.length]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.warn("[activity] no pude guardar snapshot:", err.message);
  } finally {
    client.release();
  }
}

let client = null;

async function refresh() {
  if (!client) return;
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;
  try {
    await guild.members.fetch();
  } catch (e) {
    console.warn("[activity] no pude refrescar miembros:", e.message);
  }
  const snap = computeActiveGames(guild);
  await save(snap);
  console.log(`[activity] ${snap.totalActive} jugando · ${snap.games.length} juegos`);
}

// Arranca el lector. No bloquea el servidor: si falla, el sitio sigue funcionando.
function initDiscordActivity() {
  if (!DISCORD_TOKEN || !GUILD_ID) {
    console.warn("[activity] DISCORD_TOKEN/GUILD_ID no configurados: lector de actividad desactivado.");
    return;
  }
  if (!pool) {
    console.warn("[activity] sin DATABASE_URL: lector de actividad desactivado.");
    return;
  }

  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences],
    partials: [Partials.GuildMember, Partials.User],
  });

  client.once("ready", async () => {
    console.log(`[activity] conectado a Discord como ${client.user.tag} (refresco cada ${REFRESH_MINUTES} min)`);
    try {
      await ensureSchema();
      await refresh();
    } catch (e) {
      console.warn("[activity] error en arranque:", e.message);
    }
    setInterval(refresh, REFRESH_MINUTES * 60 * 1000);
  });

  client.on("error", (e) => console.warn("[activity] error de cliente:", e.message));
  client.login(DISCORD_TOKEN).catch((e) => console.warn("[activity] login falló:", e.message));
}

module.exports = { initDiscordActivity };
