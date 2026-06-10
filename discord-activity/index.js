// Lector de actividad de Discord integrado al sitio.
// Mantiene una conexión al servidor de Discord y, cada X minutos, guarda en la base
// de datos qué juegos se están jugando (tablas discord_active_games / discord_server_stats).
// Así la página /actividad.html siempre tiene datos frescos SIN un servicio aparte.
//
// Variables: DISCORD_TOKEN, GUILD_ID, DATABASE_URL (y opcional ACTIVITY_REFRESH_MINUTES).

const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, ActivityType, Partials, EmbedBuilder } = require("discord.js");
const { joinVoiceChannel, entersState, VoiceConnectionStatus } = require("@discordjs/voice");
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
  // Snapshot diario de miembros (para la gráfica de crecimiento).
  await pool.query("CREATE TABLE IF NOT EXISTS server_daily (day DATE PRIMARY KEY, members INTEGER NOT NULL DEFAULT 0)");
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
  try { await setState("guild_members", String(guild.memberCount || 0)); } catch (e) { /* noop */ }
  try { await pool.query("INSERT INTO server_daily (day, members) VALUES (CURRENT_DATE, $1) ON CONFLICT (day) DO UPDATE SET members = EXCLUDED.members", [guild.memberCount || 0]); } catch (e) { /* noop */ }
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
      // Bump de DISBOARD: premiar 10 🪙 al que lo hizo (con candado de 2 h).
      // Detecta cualquier respuesta de DISBOARD a una interacción (robusto entre versiones).
      const bumpMeta = msg.interaction || msg.interactionMetadata;
      if (msg.author?.bot && /disboard/i.test(msg.author.username || "") && bumpMeta && bumpMeta.user) {
        onBump(bumpMeta.user.id, msg.channel?.id).catch(() => {});
        return;
      }
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

  // === TEST: cuando ANXPO entra a un canal de voz, el bot entra, suena un sonido
  // del soundboard y se desconecta a los 6 s. ===
  const ANXPO_ID = process.env.ANXPO_USER_ID || "688477815514857479";
  const ANXPO_SOUND_ID = process.env.ANXPO_SOUND_ID || "1512623682747498670";
  let anxpoBusy = false;
  client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
      if (newState.id !== ANXPO_ID) return;
      // Solo al ENTRAR (o cambiar) a un canal de voz; ignorar salidas/mute/etc.
      if (!newState.channelId || oldState.channelId === newState.channelId) return;
      if (anxpoBusy) return;
      const guild = newState.guild;
      if (!guild || guild.id !== GUILD_ID) return;
      const channel = newState.channel || guild.channels.cache.get(newState.channelId);
      if (!channel) return;

      anxpoBusy = true;
      console.log("[anxpo] entró a voz:", channel.name, "→ reproduciendo soundboard");
      const conn = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
      });
      try {
        await entersState(conn, VoiceConnectionStatus.Ready, 12000);
        await client.rest.post(`/channels/${channel.id}/send-soundboard-sound`, {
          body: { sound_id: ANXPO_SOUND_ID, source_guild_id: guild.id },
        });
        console.log("[anxpo] sonido enviado.");
      } catch (e) {
        console.warn("[anxpo] no se pudo reproducir el sonido:", e.message);
      }
      setTimeout(() => {
        try { conn.destroy(); } catch (e) { /* noop */ }
        anxpoBusy = false;
        console.log("[anxpo] desconectado tras 6 s.");
      }, 6000);
    } catch (e) {
      console.warn("[anxpo] error:", e.message);
      anxpoBusy = false;
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
    setTimeout(runWeeklyAwardIfDue, 90 * 1000); // chequeo del premio semanal
    setInterval(runWeeklyAwardIfDue, 2 * 60 * 60 * 1000); // cada 2 h (premia 1 vez al iniciar la semana)
    if (process.env.TWITCH_CLIENT_ID) {
      setTimeout(pollTwitch, 30 * 1000);
      setInterval(pollTwitch, 4 * 60 * 1000); // alertas de Twitch cada 4 min
    }
    setTimeout(bumpReminder, 2 * 60 * 1000);
    setInterval(bumpReminder, 15 * 60 * 1000); // recordatorio de /bump
    setInterval(revertExpiredChannels, 15 * 60 * 1000); // revertir canales de voz renombrados
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
             mem.display_name, mem.username, dec.emoji AS name_emoji
      FROM user_activity_daily d
      LEFT JOIN discord_members mem ON mem.discord_id = d.discord_id
      LEFT JOIN user_decoration dec ON dec.discord_id = d.discord_id
      WHERE d.day >= (CURRENT_DATE - INTERVAL '6 days')
      GROUP BY d.discord_id, mem.display_name, mem.username, dec.emoji
      ORDER BY (COALESCE(SUM(d.voice_samples),0)*${VOICE_W} + COALESCE(SUM(d.messages),0)*${MSG_W}) DESC
      LIMIT 10
    `);
    const lines = r.rows.map((row, i) => {
      const pts = row.v * VOICE_W + row.m * MSG_W;
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `\`${i + 1}.\``;
      const name = `${row.name_emoji ? row.name_emoji + " " : ""}${row.display_name || row.username || "Jugador"}`;
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

// Rangos por nivel (escalera). Solo SUMA el rango alcanzado (nunca quita, para no romper accesos a canales).
const RANK_LADDER = [
  { match: "recluta", level: 1 },
  { match: "conquista", level: 5 },
  { match: "exterminador", level: 10 },
  { match: "erudito", level: 20 },
  { match: "élite omega", level: 30 },
  { match: "mítico omega", level: 50 },
];
async function assignRankByLevel(discordId, level) {
  if (!client || !level) return;
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;
    let target = null;
    for (const r of RANK_LADDER) {
      if (r.level > level) continue;
      const role = guild.roles.cache.find((x) => x.name.toLowerCase().includes(r.match));
      if (role) target = role;
    }
    if (!target) return;
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (member && !member.roles.cache.has(target.id)) {
      await member.roles.add(target.id, `Rango por nivel ${level}`);
    }
  } catch (e) {
    console.warn("[rangos]", e.message);
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

// Premio semanal automático: al iniciar una semana nueva, premia al #1 de la semana anterior con 1000 Omegacoins.
function mondayOf(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // 0 = lunes
  x.setUTCDate(x.getUTCDate() - dow);
  return x;
}
const ymd = (d) => d.toISOString().slice(0, 10);

async function runWeeklyAwardIfDue() {
  if (!client || !pool) return;
  try {
    const thisMon = mondayOf(new Date());
    const thisKey = ymd(thisMon);
    const last = await getState("weekly_award");
    if (!last) { await setState("weekly_award", thisKey); return; } // primera vez: solo fija la base
    if (last === thisKey) return; // ya se premió esta semana
    const prevMon = new Date(thisMon);
    prevMon.setUTCDate(prevMon.getUTCDate() - 7);
    const r = await pool.query(
      `SELECT discord_id, (COALESCE(SUM(voice_samples),0)*5 + COALESCE(SUM(messages),0)) AS pts
       FROM user_activity_daily WHERE day >= $1 AND day < $2
       GROUP BY discord_id ORDER BY pts DESC LIMIT 1`,
      [ymd(prevMon), thisKey],
    );
    await setState("weekly_award", thisKey);
    const top = r.rows[0];
    if (!top || Number(top.pts) <= 0) return;
    const { addCoins } = require("../omegacoins");
    await addCoins(top.discord_id, 1000, "Premio semanal del leaderboard 🏆");
    let name = "El campeón";
    try {
      const m = await pool.query("SELECT display_name, username FROM discord_members WHERE discord_id = $1", [top.discord_id]);
      name = m.rows[0]?.display_name || m.rows[0]?.username || name;
    } catch (e) { /* noop */ }
    const channelId = process.env.LEADERBOARD_CHANNEL_ID || process.env.GENERAL_CHANNEL_ID;
    if (channelId) {
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (ch && typeof ch.send === "function") {
        const embed = new EmbedBuilder()
          .setColor(0xffd35c)
          .setTitle("🏆 Campeón de la semana")
          .setDescription(`¡Felicidades **${name}**! Fuiste el **#1** del leaderboard y ganaste **1000 Omegacoins** 🪙`)
          .setTimestamp(new Date());
        await ch.send({ content: `<@${top.discord_id}>`, embeds: [embed], allowedMentions: { users: [top.discord_id] } }).catch(() => {});
      }
    }
    dmUser(top.discord_id, "🏆 ¡Fuiste el #1 del leaderboard esta semana! Ganaste **1000 Omegacoins** 🪙").catch(() => {});
    console.log(`[weekly] premio semanal otorgado a ${name}`);
  } catch (e) {
    console.warn("[weekly]", e.message);
  }
}

// --- Alertas de streamers (Twitch) ---
let twitchToken = null, twitchTokenExp = 0;
async function getTwitchToken() {
  const id = process.env.TWITCH_CLIENT_ID, sec = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !sec) return null;
  if (twitchToken && Date.now() < twitchTokenExp - 60000) return twitchToken;
  try {
    const r = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${sec}&grant_type=client_credentials`, { method: "POST" });
    const d = await r.json();
    if (!d.access_token) return null;
    twitchToken = d.access_token;
    twitchTokenExp = Date.now() + (d.expires_in || 3600) * 1000;
    return twitchToken;
  } catch (e) { return null; }
}
async function announceStream(channelId, row, s) {
  try {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch || typeof ch.send !== "function") return;
    const thumb = (s.thumbnail_url || "").replace("{width}", "480").replace("{height}", "270");
    const embed = new EmbedBuilder()
      .setColor(0x9146ff)
      .setTitle(`🔴 ${s.user_name} está EN VIVO`)
      .setURL(`https://twitch.tv/${row.login}`)
      .setDescription(s.title || "")
      .addFields(
        { name: "Juego", value: s.game_name || "—", inline: true },
        { name: "Espectadores", value: String(s.viewer_count || 0), inline: true },
      )
      .setImage(thumb || null)
      .setTimestamp(new Date());
    const mention = row.discord_id ? `<@${row.discord_id}> ` : "";
    await ch.send({ content: `${mention}🎬 ¡Directo en vivo! https://twitch.tv/${row.login}`, embeds: [embed] }).catch(() => {});
  } catch (e) { /* noop */ }
}
async function pollTwitch() {
  const id = process.env.TWITCH_CLIENT_ID;
  if (!client || !pool || !id) return;
  const channelId = process.env.STREAMS_CHANNEL_ID;
  try {
    const rows = (await pool.query("SELECT * FROM stream_watch WHERE platform = 'twitch'")).rows;
    if (!rows.length) return;
    const token = await getTwitchToken();
    if (!token) return;
    const logins = rows.map((r) => r.login);
    const live = {};
    for (let i = 0; i < logins.length; i += 100) {
      const batch = logins.slice(i, i + 100);
      const qs = batch.map((l) => `user_login=${encodeURIComponent(l)}`).join("&");
      const r = await fetch(`https://api.twitch.tv/helix/streams?${qs}`, { headers: { "Client-ID": id, Authorization: `Bearer ${token}` } });
      const d = await r.json();
      for (const s of (d.data || [])) live[s.user_login.toLowerCase()] = s;
    }
    for (const row of rows) {
      const s = live[row.login.toLowerCase()];
      if (s && !row.is_live) {
        await pool.query("UPDATE stream_watch SET is_live = true WHERE id = $1", [row.id]);
        if (channelId) await announceStream(channelId, row, s);
      } else if (!s && row.is_live) {
        await pool.query("UPDATE stream_watch SET is_live = false WHERE id = $1", [row.id]);
      }
    }
  } catch (e) {
    console.warn("[twitch]", e.message);
  }
}

// Premia 10 Omegacoins a quien hace /bump (candado de 2 h para no farmear).
async function onBump(userId, channelId) {
  if (!pool || !userId) return;
  const now = Date.now();
  const lastTs = Number((await getState("bump_last_ts")) || 0);
  if (now - lastTs < 110 * 60 * 1000) return; // ya se premió hace poco
  await setState("bump_last_ts", String(now));
  try { const { addCoins } = require("../omegacoins"); await addCoins(userId, 10, "Bump del servidor 🚀"); } catch (e) { /* noop */ }
  try {
    const target = process.env.BUMP_CHANNEL_ID || channelId;
    const ch = target ? await client.channels.fetch(target).catch(() => null) : null;
    if (ch && typeof ch.send === "function") await ch.send(`🚀 ¡Gracias <@${userId}> por el **/bump**! +10 🪙 — te aviso en ~2 h para el siguiente.`).catch(() => {});
  } catch (e) { /* noop */ }
}

// Recordatorio de bump (~2 h después del último, una sola vez por ciclo).
async function bumpReminder() {
  if (!client || !pool) return;
  const channelId = process.env.BUMP_CHANNEL_ID || process.env.GENERAL_CHANNEL_ID;
  if (!channelId) return;
  try {
    const now = Date.now();
    const TWO_H = 2 * 60 * 60 * 1000;
    const lastBump = Number((await getState("bump_last_ts")) || 0);
    const lastReminder = Number((await getState("bump_reminder_ts")) || 0);
    // Recuerda cada ~2 h, pero solo si no se ha bumpeado en las últimas 2 h.
    if (now - lastBump >= TWO_H && now - lastReminder >= TWO_H) {
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (ch && typeof ch.send === "function") await ch.send("⏰ ¡Ya se puede hacer **/bump**! El primero que lo haga gana **10 🪙** y ayuda a que más gente descubra el server 🚀").catch(() => {});
      await setState("bump_reminder_ts", String(now));
    }
  } catch (e) {
    console.warn("[bump]", e.message);
  }
}

// Entrega un rol cosmético comprado en la tienda (lo crea si no existe y lo posiciona alto).
async function grantStoreRole(discordId, roleName, color, hoist) {
  if (!client) return false;
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return false;
    let role = guild.roles.cache.find((x) => x.name === roleName);
    if (!role) {
      role = await guild.roles.create({ name: roleName, color: color || undefined, hoist: !!hoist, reason: "Tienda Omeganetics" });
      try {
        const myTop = guild.members.me?.roles?.highest;
        if (myTop) await role.setPosition(Math.max(1, myTop.position - 1));
      } catch (e) { /* posición best-effort */ }
    }
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (member && !member.roles.cache.has(role.id)) await member.roles.add(role.id, "Compra en la tienda");
    return true;
  } catch (e) {
    console.warn("[tienda]", e.message);
    return false;
  }
}

// Color personalizado de la tienda: crea/actualiza UN rol de color por usuario, lo
// posiciona alto (para que su color gane) y lo asigna. Devuelve el id del rol (o "").
async function grantCustomColor(discordId, colorInt, displayName, existingRoleId) {
  if (!client) return "";
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return "";
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) return "";

    let role = existingRoleId ? guild.roles.cache.get(existingRoleId) : null;
    if (role) {
      await role.setColor(colorInt, "Color personalizado actualizado");
    } else {
      role = await guild.roles.create({ name: `🎨 ${displayName}`.slice(0, 90), color: colorInt, hoist: false, reason: "Color personalizado (tienda)" });
    }
    // Posiciona el rol lo más alto que el bot pueda, para que su color prevalezca.
    try {
      const myTop = guild.members.me?.roles?.highest;
      if (myTop) await role.setPosition(Math.max(1, myTop.position - 1));
    } catch (e) { /* best-effort */ }
    if (!member.roles.cache.has(role.id)) await member.roles.add(role.id, "Color personalizado (tienda)");
    return role.id;
  } catch (e) {
    console.warn("[color]", e.message);
    return "";
  }
}

// Decora el nombre (apodo) del miembro con un emoji. No funciona en admins/dueño (jerarquía).
async function setNameDecoration(discordId, emoji) {
  if (!client || !emoji) return false;
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return false;
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) return false;
    const current = member.nickname || member.user.globalName || member.user.username || "";
    if (current.startsWith(emoji)) return true;
    const nick = `${emoji} ${current}`.slice(0, 32);
    await member.setNickname(nick, "Decoración de la tienda");
    return true;
  } catch (e) {
    return false; // probablemente admin/dueño: no se puede cambiar su apodo
  }
}

// Anuncia el campeón de un torneo en un canal.
async function announceTournamentWinner(channelId, tournamentName, winnerName, winnerId) {
  if (!client || !channelId) return;
  try {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch || typeof ch.send !== "function") return;
    const embed = new EmbedBuilder()
      .setColor(0xffd35c)
      .setTitle("🏆 ¡Tenemos campeón!")
      .setDescription(`**${winnerName}** ganó el torneo **${tournamentName}** 🎉`)
      .setTimestamp(new Date());
    await ch.send({ content: `@everyone ¡Felicidades <@${winnerId}>! 👑`, embeds: [embed], allowedMentions: { parse: ["everyone"], users: [winnerId] } }).catch(() => {});
  } catch (e) { /* noop */ }
}

// Aviso al canal central de administración (canjes, solicitudes, aprobaciones…).
async function notifyAdmins(title, desc, color) {
  const channelId = process.env.ADMIN_LOG_CHANNEL_ID;
  if (!client || !channelId) return;
  try {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch || typeof ch.send !== "function") return;
    const embed = new EmbedBuilder().setColor(color || 0x5865f2).setTitle(title).setDescription((desc || "").slice(0, 2000)).setTimestamp(new Date());
    await ch.send({ embeds: [embed] }).catch(() => {});
  } catch (e) { /* noop */ }
}

// Canales de voz renombrables desde la tienda (allowlist: campos de batalla + campo-global).
const RENAMABLE_VC = (process.env.RENAMABLE_VC_IDS || "1395843129285935337,1183607153802620960,1428934172436729866,1421370530082066583")
  .split(",").map((s) => s.trim()).filter(Boolean);
function getVoiceChannels() {
  if (!client) return [];
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return [];
    // Ordenados como en la allowlist.
    return RENAMABLE_VC
      .map((id) => guild.channels.cache.get(id))
      .filter((c) => c && c.type === 2)
      .map((c) => ({ id: c.id, name: c.name }));
  } catch (e) { return []; }
}

// Renombra un canal de voz por X horas (guarda el original para revertir).
async function renameVoiceChannel(channelId, newName, hours) {
  if (!client) return false;
  try {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch || ch.type !== 2) return false;
    if (!(await getState("vcorig_" + channelId))) await setState("vcorig_" + channelId, ch.name);
    await setState("vcexp_" + channelId, String(Date.now() + (hours || 24) * 3600 * 1000));
    await ch.setName(String(newName).slice(0, 90), "Renombrado por la tienda");
    return true;
  } catch (e) { console.warn("[vcrename]", e.message); return false; }
}
async function revertExpiredChannels() {
  if (!client || !pool) return;
  try {
    const r = await pool.query("SELECT key, value FROM bot_state WHERE key LIKE 'vcexp_%'");
    for (const row of r.rows) {
      if (Number(row.value) > Date.now()) continue;
      const channelId = row.key.slice("vcexp_".length);
      const orig = await getState("vcorig_" + channelId);
      const ch = await client.channels.fetch(channelId).catch(() => null);
      if (ch && orig) { try { await ch.setName(orig, "Fin del renombrado de la tienda"); } catch (e) {} }
      await pool.query("DELETE FROM bot_state WHERE key IN ($1,$2)", ["vcexp_" + channelId, "vcorig_" + channelId]);
    }
  } catch (e) { console.warn("[vcrevert]", e.message); }
}

// Publica un shoutout (texto ya filtrado) en el canal de anuncios.
async function postShoutout(text, byName) {
  const channelId = process.env.SHOUTOUT_CHANNEL_ID || process.env.EVENTS_CHANNEL_ID;
  if (!client || !channelId) return false;
  try {
    const ch = await client.channels.fetch(channelId).catch(() => null);
    if (!ch || typeof ch.send !== "function") return false;
    const embed = new EmbedBuilder().setColor(0x43d1ff).setTitle("📢 Shoutout de la comunidad").setDescription(String(text).slice(0, 1000)).setFooter({ text: `Cortesía de ${byName} · canjeado con Omegacoins` }).setTimestamp(new Date());
    await ch.send({ embeds: [embed] }).catch(() => {});
    return true;
  } catch (e) { return false; }
}

// === Emojis exclusivos: restringir emojis del servidor a ciertos roles ===
// Lista los emojis personalizados del servidor con sus roles permitidos (si los hay).
function listGuildEmojis() {
  if (!client) return [];
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return [];
    return guild.emojis.cache.map((e) => ({
      id: e.id,
      name: e.name,
      animated: !!e.animated,
      url: e.imageURL ? e.imageURL({ size: 64 }) : e.url,
      roles: e.roles?.cache ? e.roles.cache.map((r) => r.name) : [],
    }));
  } catch (e) { return []; }
}

// Lista los roles asignables (sin @everyone ni roles gestionados por integraciones).
function listGuildRoles() {
  if (!client) return [];
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return [];
    return guild.roles.cache
      .filter((r) => r.id !== guild.id && !r.managed)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({ id: r.id, name: r.name }));
  } catch (e) { return []; }
}

// Restringe un emoji a una lista de roles (por nombre). Lista vacía = disponible para todos.
async function setEmojiRoles(emojiId, roleNames) {
  if (!client) return false;
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return false;
    const emoji = guild.emojis.cache.get(emojiId);
    if (!emoji) return false;
    const names = Array.isArray(roleNames) ? roleNames : [];
    const roleIds = names
      .map((n) => guild.roles.cache.find((r) => r.name === n)?.id)
      .filter(Boolean);
    await emoji.edit({ roles: roleIds }); // requiere permiso "Gestionar Emojis y Stickers"
    return true;
  } catch (e) { console.warn("[emojis]", e.message); return false; }
}

module.exports = { initDiscordActivity, announceEvent, announceContent, grantRole, dmUser, assignRankByLevel, announceTournamentWinner, grantStoreRole, grantCustomColor, setNameDecoration, notifyAdmins, getVoiceChannels, renameVoiceChannel, postShoutout, listGuildEmojis, listGuildRoles, setEmojiRoles };
