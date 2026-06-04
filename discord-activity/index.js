// Lector de actividad de Discord integrado al sitio.
// Mantiene una conexión al servidor de Discord y, cada X minutos, guarda en la base
// de datos qué juegos se están jugando (tablas discord_active_games / discord_server_stats).
// Así la página /actividad.html siempre tiene datos frescos SIN un servicio aparte.
//
// Variables: DISCORD_TOKEN, GUILD_ID, DATABASE_URL (y opcional ACTIVITY_REFRESH_MINUTES).

const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, ActivityType, Partials, EmbedBuilder } = require("discord.js");
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
  const userGames = new Map(); // discordId -> Set(nombreJuego)
  const members = new Map(); // discordId -> { username, displayName, avatar }
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
      if (!userGames.has(member.id)) userGames.set(member.id, new Set());
      userGames.get(member.id).add(activity.name);
      if (!members.has(member.id)) {
        members.set(member.id, {
          username: member.user.username || "",
          displayName: member.displayName || member.user.globalName || member.user.username || "",
          avatar: typeof member.user.displayAvatarURL === "function"
            ? member.user.displayAvatarURL({ extension: "png", size: 128 })
            : "",
        });
      }
    }
  }
  const ranked = [...games.values()]
    .map(({ name, users }) => ({ game: name, players: users.size }))
    .sort((a, b) => b.players - a.players);
  return { totalActive: activeUsers.size, games: ranked, userGames, members };
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
  // Actividad por usuario y juego: cada muestra = 1 refresco (REFRESH_MINUTES).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_game_activity (
      discord_id TEXT NOT NULL,
      game TEXT NOT NULL,
      samples INTEGER NOT NULL DEFAULT 0,
      first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (discord_id, game)
    );
  `);
  // Datos de miembros (para mostrar nombre/avatar en el ranking, registrados o no).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_members (
      discord_id TEXT PRIMARY KEY,
      username TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Actividad diaria por usuario (para ranking por semana/mes).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_activity_daily (
      discord_id TEXT NOT NULL,
      day DATE NOT NULL,
      samples INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (discord_id, day)
    );
  `);
  // Acumulado de juegos por día (cada muestra suma los jugadores de ese juego).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_activity_daily (
      game TEXT NOT NULL,
      day DATE NOT NULL,
      samples INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (game, day)
    );
  `);
  // Columnas extra de actividad diaria: tiempo en voz y mensajes.
  await pool.query("ALTER TABLE user_activity_daily ADD COLUMN IF NOT EXISTS voice_samples INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE user_activity_daily ADD COLUMN IF NOT EXISTS messages INTEGER NOT NULL DEFAULT 0");
  // Estado del bot (ej. id del mensaje del leaderboard para editarlo en sitio).
  await pool.query("CREATE TABLE IF NOT EXISTS bot_state (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')");
  // A quién ya le mandamos DM de reactivación (para no repetir).
  await pool.query("CREATE TABLE IF NOT EXISTS outreach_dm (discord_id TEXT PRIMARY KEY, sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
}

async function getState(key) {
  if (!pool) return null;
  try {
    const r = await pool.query("SELECT value FROM bot_state WHERE key = $1", [key]);
    return r.rows[0]?.value || null;
  } catch (e) {
    return null;
  }
}
async function setState(key, value) {
  if (!pool) return;
  try {
    await pool.query("INSERT INTO bot_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2", [key, value]);
  } catch (e) { /* noop */ }
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

async function saveUserActivity(userGames) {
  if (!userGames || userGames.size === 0) return;
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    for (const [discordId, gameSet] of userGames) {
      for (const game of gameSet) {
        await db.query(
          `INSERT INTO user_game_activity (discord_id, game, samples, first_seen, last_seen)
           VALUES ($1, $2, 1, NOW(), NOW())
           ON CONFLICT (discord_id, game) DO UPDATE
             SET samples = user_game_activity.samples + 1, last_seen = NOW()`,
          [discordId, game]
        );
      }
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    console.warn("[activity] no pude guardar actividad por usuario:", err.message);
  } finally {
    db.release();
  }
}

async function saveMembersAndDaily(members) {
  if (!members || members.size === 0) return;
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    for (const [discordId, info] of members) {
      await db.query(
        `INSERT INTO discord_members (discord_id, username, display_name, avatar_url, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (discord_id) DO UPDATE
           SET username = EXCLUDED.username, display_name = EXCLUDED.display_name,
               avatar_url = EXCLUDED.avatar_url, updated_at = NOW()`,
        [discordId, info.username, info.displayName, info.avatar]
      );
      await db.query(
        `INSERT INTO user_activity_daily (discord_id, day, samples)
         VALUES ($1, CURRENT_DATE, 1)
         ON CONFLICT (discord_id, day) DO UPDATE SET samples = user_activity_daily.samples + 1`,
        [discordId]
      );
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    console.warn("[activity] no pude guardar miembros/diario:", err.message);
  } finally {
    db.release();
  }
}

async function saveGameDaily(games) {
  if (!games || games.length === 0) return;
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    for (const { game, players } of games) {
      await db.query(
        `INSERT INTO game_activity_daily (game, day, samples)
         VALUES ($1, CURRENT_DATE, $2)
         ON CONFLICT (game, day) DO UPDATE SET samples = game_activity_daily.samples + $2`,
        [game, players]
      );
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    console.warn("[activity] no pude guardar juegos del día:", err.message);
  } finally {
    db.release();
  }
}

// Mensajes acumulados en memoria entre refrescos.
const pendingMessages = new Map(); // discordId -> { count, username, displayName, avatar }

async function flushMessages() {
  if (pendingMessages.size === 0) return;
  const batch = [...pendingMessages.entries()];
  pendingMessages.clear();
  console.log(`[activity] volcando mensajes de ${batch.length} usuario(s)`);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    for (const [discordId, info] of batch) {
      await db.query(
        `INSERT INTO discord_members (discord_id, username, display_name, avatar_url, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (discord_id) DO UPDATE
           SET username = EXCLUDED.username, display_name = EXCLUDED.display_name,
               avatar_url = CASE WHEN EXCLUDED.avatar_url <> '' THEN EXCLUDED.avatar_url ELSE discord_members.avatar_url END,
               updated_at = NOW()`,
        [discordId, info.username, info.displayName, info.avatar]
      );
      await db.query(
        `INSERT INTO user_activity_daily (discord_id, day, samples, voice_samples, messages)
         VALUES ($1, CURRENT_DATE, 0, 0, $2)
         ON CONFLICT (discord_id, day) DO UPDATE SET messages = user_activity_daily.messages + $2`,
        [discordId, info.count]
      );
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    console.warn("[activity] no pude volcar mensajes:", err.message);
  } finally {
    db.release();
  }
}

function computeVoiceMembers(guild) {
  // Canales AFK que NO cuentan para puntos (AFK_CHANNEL_ID + el AFK nativo del server).
  const afk = new Set(
    (process.env.AFK_CHANNEL_ID || "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  if (guild.afkChannelId) afk.add(guild.afkChannelId);

  const voice = new Map();
  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;
    if (!member.voice || !member.voice.channelId) continue;
    if (afk.has(member.voice.channelId)) continue; // en AFK: no acumula
    voice.set(member.id, {
      username: member.user.username || "",
      displayName: member.displayName || member.user.globalName || member.user.username || "",
      avatar: typeof member.user.displayAvatarURL === "function"
        ? member.user.displayAvatarURL({ extension: "png", size: 128 })
        : "",
    });
  }
  return voice;
}

async function saveVoiceActivity(voice) {
  if (!voice || voice.size === 0) return;
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    for (const [discordId, info] of voice) {
      await db.query(
        `INSERT INTO discord_members (discord_id, username, display_name, avatar_url, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (discord_id) DO UPDATE
           SET username = EXCLUDED.username, display_name = EXCLUDED.display_name,
               avatar_url = EXCLUDED.avatar_url, updated_at = NOW()`,
        [discordId, info.username, info.displayName, info.avatar]
      );
      await db.query(
        `INSERT INTO user_activity_daily (discord_id, day, voice_samples)
         VALUES ($1, CURRENT_DATE, 1)
         ON CONFLICT (discord_id, day) DO UPDATE SET voice_samples = user_activity_daily.voice_samples + 1`,
        [discordId]
      );
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    console.warn("[activity] no pude guardar voz:", err.message);
  } finally {
    db.release();
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
  await saveUserActivity(snap.userGames);
  await saveMembersAndDaily(snap.members);
  await saveGameDaily(snap.games);
  const voice = computeVoiceMembers(guild);
  await saveVoiceActivity(voice);
  await flushMessages();
  console.log(`[activity] ${snap.totalActive} jugando · ${snap.games.length} juegos · ${voice.size} en voz`);
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
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
    ],
    partials: [Partials.GuildMember, Partials.User],
  });

  // Conteo de mensajes (acumula en memoria y se vuelca cada refresco).
  client.on("messageCreate", (msg) => {
    try {
      if (!msg.guild || msg.guild.id !== GUILD_ID) return;
      if (!msg.author || msg.author.bot) return;
      const id = msg.author.id;
      const prev = pendingMessages.get(id) || { count: 0, username: "", displayName: "", avatar: "" };
      prev.count += 1;
      prev.username = msg.author.username || prev.username;
      prev.displayName = (msg.member && msg.member.displayName) || msg.author.globalName || msg.author.username || prev.displayName;
      if (typeof msg.author.displayAvatarURL === "function") {
        prev.avatar = msg.author.displayAvatarURL({ extension: "png", size: 128 });
      }
      pendingMessages.set(id, prev);
    } catch (e) {
      /* noop */
    }
  });

  // Bienvenida a nuevos miembros con invitación a la web.
  client.on("guildMemberAdd", async (member) => {
    const channelId = process.env.WELCOME_CHANNEL_ID;
    if (!channelId || member.guild.id !== GUILD_ID || member.user.bot) return;
    try {
      const ch = await client.channels.fetch(channelId);
      if (!ch || typeof ch.send !== "function") return;
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`👑 ¡Bienvenido a Omeganetics, ${member.displayName || member.user.username}!`)
        .setDescription(
          "Entra a nuestra plataforma para ver tu **perfil**, tu **actividad**, **eventos** y todo lo que se viene 👇\n\n" +
            "🌐 **https://omeganetics.com/login.html**\n\n" +
            "Inicia sesión con Discord y empieza a ganar **XP** y **Omegacoins**. ⚔️",
        )
        .setThumbnail(typeof member.user.displayAvatarURL === "function" ? member.user.displayAvatarURL() : null);
      await ch.send({ content: `${member}`, embeds: [embed] });
    } catch (e) {
      console.warn("[welcome] error:", e.message);
    }
  });

  // Comando /omegacoins: muestra el saldo (mismo dato que la web).
  client.on("interactionCreate", async (i) => {
    try {
      if (typeof i.isChatInputCommand !== "function" || !i.isChatInputCommand() || i.commandName !== "omegacoins") return;
      const { getBalance } = require("../omegacoins");
      const bal = await getBalance(i.user.id);
      await i.reply({
        content: `🪙 Tienes **${bal.toLocaleString("es")}** Omegacoins.\nGánalos por actividad, niveles y logros en https://omeganetics.com/perfil.html`,
        ephemeral: true,
      });
    } catch (e) {
      console.warn("[omegacoins] interacción:", e.message);
    }
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
    setInterval(flushMessages, 60 * 1000); // los mensajes se guardan cada minuto
    try {
      await client.application.commands.set(
        [{ name: "omegacoins", description: "Mira tu saldo de Omegacoins 🪙" }],
        GUILD_ID,
      );
      console.log("[omegacoins] comando /omegacoins registrado");
    } catch (e) {
      console.warn("[omegacoins] no pude registrar el comando:", e.message);
    }
    if (process.env.LEADERBOARD_CHANNEL_ID) {
      updateLeaderboard();
      setInterval(updateLeaderboard, 15 * 60 * 1000); // actualiza el leaderboard cada 15 min
    }
    setTimeout(runDripIfDue, 60 * 1000); // primer chequeo de goteo al minuto
    setInterval(runDripIfDue, 2 * 60 * 60 * 1000); // y cada 2 h (envía 1 vez por día)
  });

  client.on("error", (e) => console.warn("[activity] error de cliente:", e.message));
  client.login(DISCORD_TOKEN).catch((e) => console.warn("[activity] login falló:", e.message));
}

// Publica un evento aprobado en el canal de anuncios de Discord (EVENTS_CHANNEL_ID).
async function announceEvent(event) {
  const channelId = process.env.EVENTS_CHANNEL_ID;
  if (!client || !channelId) return false;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || typeof channel.send !== "function") return false;
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🎉 Nuevo evento: ${event.name}`)
      .setDescription((event.description || "").slice(0, 600))
      .addFields(
        { name: "🎮 Juego", value: event.game || "—", inline: true },
        {
          name: "📅 Inicio",
          value: event.startDate ? new Date(event.startDate).toLocaleDateString("es") : "—",
          inline: true,
        },
      )
      .setFooter({ text: `Por ${event.createdByName || "la comunidad"} · omeganetics.com/eventos.html` });
    if (event.expectedDuration) {
      embed.addFields({ name: "⏱️ Duración", value: event.expectedDuration, inline: true });
    }
    await channel.send({
      content: "@everyone 📅 ¡Nuevo evento en la comunidad!",
      embeds: [embed],
      allowedMentions: { parse: ["everyone"] },
    });
    return true;
  } catch (err) {
    console.warn("[activity] no pude anunciar el evento:", err.message);
    return false;
  }
}

// Anuncia un video de un creador: en el canal CONTENIDO + aviso en general (con @everyone).
async function announceContent(creator, video) {
  if (!client) return false;
  const contentId = process.env.CONTENT_CHANNEL_ID;
  const generalId = process.env.GENERAL_CHANNEL_ID;
  const creatorName = creator.channelName || creator.nickname || creator.fullName || "un creador";
  try {
    if (contentId) {
      const ch = await client.channels.fetch(contentId);
      if (ch && typeof ch.send === "function") {
        const embed = new EmbedBuilder()
          .setColor(0xff2d78)
          .setTitle(`🎬 ${video.title}`)
          .setDescription((video.description || "").slice(0, 600))
          .addFields({ name: "Creador", value: creatorName, inline: true })
          .setFooter({ text: "Omeganetics · ¡Apoya a nuestros creadores!" });
        if (/^https?:\/\//i.test(video.url || "")) embed.setURL(video.url);
        await ch.send({
          content: `@everyone 🎥 ¡Nuevo contenido de **${creatorName}**! Pásate a verlo y déjale tu apoyo 🔥\n${video.url || ""}`,
          embeds: [embed],
          allowedMentions: { parse: ["everyone"] },
        });
      }
    }
    if (generalId) {
      const gch = await client.channels.fetch(generalId);
      if (gch && typeof gch.send === "function") {
        const ref = contentId ? `<#${contentId}>` : "el canal de CONTENIDO";
        await gch.send({
          content: `@everyone 📢 ¡Se subió nuevo contenido a ${ref}! Vayan a verlo y apoyen a **${creatorName}**. 🍿`,
          allowedMentions: { parse: ["everyone"] },
        });
      }
    }
    return true;
  } catch (err) {
    console.warn("[content] no pude anunciar el contenido:", err.message);
    return false;
  }
}

// Publica/actualiza el leaderboard semanal en un canal (mensaje editado en sitio).
async function updateLeaderboard() {
  const channelId = process.env.LEADERBOARD_CHANNEL_ID;
  if (!client || !pool || !channelId) return;
  try {
    const VOICE_W = 5;
    const MSG_W = 1;
    const refreshMinutes = Number(process.env.ACTIVITY_REFRESH_MINUTES || 5);
    const r = await pool.query(`
      SELECT d.discord_id,
             COALESCE(SUM(d.voice_samples),0)::int AS v,
             COALESCE(SUM(d.messages),0)::int AS m,
             mem.display_name, mem.username
      FROM user_activity_daily d
      LEFT JOIN discord_members mem ON mem.discord_id = d.discord_id
      WHERE d.day >= (CURRENT_DATE - INTERVAL '6 days')
      GROUP BY d.discord_id, mem.display_name, mem.username
      ORDER BY (COALESCE(SUM(d.voice_samples),0)*${VOICE_W} + COALESCE(SUM(d.messages),0)*${MSG_W}) DESC
      LIMIT 10
    `);
    const lines = r.rows.map((row, i) => {
      const pts = row.v * VOICE_W + row.m * MSG_W;
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `\`${i + 1}.\``;
      const name = row.display_name || row.username || "Jugador";
      const voiceH = Math.round((row.v * refreshMinutes) / 60 * 10) / 10;
      return `${medal} **${name}** — ${pts} pts · 🎙️ ${voiceH}h · 💬 ${row.m}`;
    });
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🏆 Top jugadores de la semana")
      .setDescription(lines.length ? lines.join("\n") : "Aún no hay actividad registrada esta semana.")
      .setFooter({ text: "Por voz + mensajes · omeganetics.com/actividad.html" })
      .setTimestamp(new Date());

    const channel = await client.channels.fetch(channelId);
    if (!channel || typeof channel.send !== "function") return;
    const msgId = await getState("leaderboard_msg");
    if (msgId) {
      try {
        const msg = await channel.messages.fetch(msgId);
        await msg.edit({ embeds: [embed] });
        return;
      } catch (e) { /* el mensaje ya no existe, se reenvía abajo */ }
    }
    const sent = await channel.send({ embeds: [embed] });
    await setState("leaderboard_msg", sent.id);
  } catch (e) {
    console.warn("[leaderboard]", e.message);
  }
}

// Crea (si hace falta) y asigna un rol de Discord por un logro.
const TIER_COLOR = { comun: 0x8aa0ff, raro: 0x43d1ff, epico: 0xc084fc, legendario: 0xffd35c };
async function grantRole(discordId, roleName, tier) {
  if (!client) return;
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;
    let role = guild.roles.cache.find((x) => x.name === roleName);
    if (!role) {
      role = await guild.roles.create({ name: roleName, color: TIER_COLOR[tier] || 0x99aab5, hoist: false, reason: "Logro de Omeganetics" });
    }
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (member && !member.roles.cache.has(role.id)) {
      await member.roles.add(role.id, "Logro desbloqueado");
    }
  } catch (e) {
    console.warn("[roles] grantRole:", e.message);
  }
}

// Envía un DM a un usuario (notificaciones transaccionales).
async function dmUser(discordId, content) {
  if (!client || !discordId) return false;
  try {
    const user = await client.users.fetch(discordId);
    await user.send(content);
    return true;
  } catch (e) {
    return false;
  }
}

// Goteo diario de DMs de reactivación a miembros activos que aún NO se registraron en la web.
async function runDripIfDue() {
  if (!client || !pool) return;
  const perDay = Number(process.env.DRIP_PER_DAY || 0);
  if (perDay <= 0) return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    if ((await getState("drip_date")) === today) return;
    const r = await pool.query(
      `SELECT m.discord_id
       FROM discord_members m
       LEFT JOIN outreach_dm o ON o.discord_id = m.discord_id
       LEFT JOIN community_users cu ON cu.discord_id = m.discord_id
       WHERE o.discord_id IS NULL AND cu.discord_id IS NULL AND m.updated_at >= NOW() - INTERVAL '2 days'
       LIMIT $1`,
      [perDay],
    );
    for (const row of r.rows) {
      await dmUser(
        row.discord_id,
        "👑 ¡Hola! Ahora en **Omeganetics** puedes ver tu perfil, nivel, logros y ganar **Omegacoins** por tu actividad.\nEntra con tu Discord 👉 https://omeganetics.com/login.html",
      );
      await pool.query("INSERT INTO outreach_dm (discord_id) VALUES ($1) ON CONFLICT DO NOTHING", [row.discord_id]);
      await new Promise((res) => setTimeout(res, 3000)); // espaciar para no parecer spam
    }
    await setState("drip_date", today);
    if (r.rows.length) console.log(`[drip] ${r.rows.length} DMs de reactivación enviados`);
  } catch (e) {
    console.warn("[drip]", e.message);
  }
}

module.exports = { initDiscordActivity, announceEvent, announceContent, grantRole, dmUser };
