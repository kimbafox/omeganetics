// Bot de Omeganetics — calcula los "juegos activos del servidor" y los expone por API.
//
// Lee la presencia de los miembros del servidor de Discord, agrupa por juego y publica
// el ranking (del más jugado al menos) en:  GET http://localhost:PORT/api/active-games
//
// Requisitos en el portal de Discord (https://discord.com/developers/applications):
//   - Activar PRESENCE INTENT y SERVER MEMBERS INTENT en la pestaña "Bot".
//   - Invitar el bot al servidor.
// Variables en bot/.env:  DISCORD_TOKEN, GUILD_ID (y opcional PORT)

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import { Client, GatewayIntentBits, ActivityType, Partials } from 'discord.js';

// Fuente única de secretos: el .env.local de la raíz del repo.
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env.local') });
config({ path: resolve(__dirname, '.env') }); // override local opcional, si existe

// Lista de apps que NO son juegos (editable en bot/non-games.json).
const nonGames = JSON.parse(readFileSync(resolve(__dirname, 'non-games.json'), 'utf8'));
const IGNORAR = new Set((nonGames.ignorar || []).map((s) => s.toLowerCase()));
const PALABRAS_CLAVE = (nonGames.palabrasClave || []).map((s) => s.toLowerCase());

function esJuego(nombre) {
  const n = nombre.toLowerCase();
  if (IGNORAR.has(n)) return false;
  if (PALABRAS_CLAVE.some((kw) => n.includes(kw))) return false;
  return true;
}

const { DISCORD_TOKEN, GUILD_ID, PORT = 3001 } = process.env;
// Modo cron: se conecta, guarda un snapshot y se apaga (RUN_ONCE=true).
const RUN_ONCE = process.env.RUN_ONCE === 'true' || process.argv.includes('--once');

if (!DISCORD_TOKEN || !GUILD_ID) {
  console.error('Faltan variables. Edita el archivo .env.local en la raíz del repo y rellena DISCORD_TOKEN y GUILD_ID.');
  process.exit(1);
}

// --- Base de datos (opcional pero recomendada): guarda los juegos activos en Postgres ---
const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('railway') ? { rejectUnauthorized: false } : false,
    })
  : null;

if (!pool) {
  console.warn('DATABASE_URL no configurada: el bot no guardará los juegos activos en la base de datos.');
}

// Crea las tablas del bot si no existen (no toca las tablas existentes del sitio).
async function ensureSchema() {
  if (!pool) return;
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

// Reemplaza el snapshot actual en la BD (transacción: borra y reinserta).
async function saveSnapshotToDB(snap) {
  if (!pool) return;
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dbClient.query('DELETE FROM discord_active_games');
    for (const { game, players } of snap.games) {
      await dbClient.query(
        'INSERT INTO discord_active_games (game, players, updated_at) VALUES ($1, $2, NOW())',
        [game, players],
      );
    }
    await dbClient.query(
      `INSERT INTO discord_server_stats (id, total_active, games_count, updated_at)
       VALUES (1, $1, $2, NOW())
       ON CONFLICT (id) DO UPDATE
         SET total_active = EXCLUDED.total_active,
             games_count = EXCLUDED.games_count,
             updated_at = NOW()`,
      [snap.totalActive, snap.games.length],
    );
    await dbClient.query('COMMIT');
  } catch (err) {
    await dbClient.query('ROLLBACK');
    console.warn('No pude guardar el snapshot en la BD:', err.message);
  } finally {
    dbClient.release();
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
  partials: [Partials.GuildMember, Partials.User],
});

// Último snapshot calculado (lo que sirve la API).
let snapshot = { updatedAt: null, totalActive: 0, games: [] };

// Recorre los miembros del servidor y agrupa por juego ("Playing").
function computeActiveGames(guild) {
  const games = new Map(); // claveMinusculas -> { name, users: Set(userId) }
  const activeUsers = new Set();

  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;
    const presence = member.presence;
    if (!presence || presence.status === 'offline') continue;

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

  return {
    updatedAt: new Date().toISOString(),
    totalActive: activeUsers.size,
    games: ranked,
  };
}

async function refresh() {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    console.warn(`No encuentro el servidor con GUILD_ID=${GUILD_ID}. ¿El bot está invitado?`);
    return;
  }
  try {
    await guild.members.fetch(); // trae miembros + presencias al caché
  } catch (err) {
    console.warn('No pude refrescar miembros:', err.message);
  }
  snapshot = computeActiveGames(guild);
  console.log(`[${snapshot.updatedAt}] ${snapshot.totalActive} jugando · ${snapshot.games.length} juegos`);
  await saveSnapshotToDB(snapshot);
}

client.once('ready', async () => {
  console.log(`Bot conectado como ${client.user.tag}`);
  const guilds = client.guilds.cache.map((g) => `${g.name} (${g.id})`);
  console.log(`Servidores donde está el bot (${guilds.length}): ${guilds.join(', ') || 'NINGUNO'}`);
  await ensureSchema();
  await refresh();
  if (RUN_ONCE) {
    console.log('Modo RUN_ONCE (cron): snapshot guardado en la BD. Cerrando.');
    await client.destroy();
    process.exit(0);
  }
  setInterval(refresh, 60_000); // recalcula cada minuto
});

// Recalcula al instante cuando alguien cambia de actividad.
client.on('presenceUpdate', () => {
  const guild = client.guilds.cache.get(GUILD_ID);
  if (guild) snapshot = computeActiveGames(guild);
});

// --- API HTTP ---
const app = express();
app.use(cors());

app.get('/api/active-games', (_req, res) => res.json(snapshot));
app.get('/', (_req, res) =>
  res.send('Omeganetics bot OK. Mira /api/active-games para el ranking de juegos activos.'),
);

// En modo cron no levantamos el servidor HTTP (no hace falta).
if (!RUN_ONCE) {
  app.listen(PORT, () => console.log(`API de juegos activos en http://localhost:${PORT}/api/active-games`));
}

// Seguridad: en modo cron, si algo se cuelga, salir a los 90s para no consumir de más.
if (RUN_ONCE) {
  setTimeout(() => {
    console.warn('RUN_ONCE: tiempo límite alcanzado, saliendo.');
    process.exit(1);
  }, 90_000);
}

client.login(DISCORD_TOKEN);
