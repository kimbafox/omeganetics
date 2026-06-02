// Módulo de Login con Discord (OAuth2) para Omeganetics.
//
// Flujo:
//   GET  /api/auth/discord            -> manda al usuario a autorizar en Discord
//   GET  /api/auth/discord/callback   -> Discord regresa aquí; validamos, guardamos y damos sesión
//   GET  /api/auth/me                 -> devuelve el usuario logueado (o 401)
//   POST /api/auth/logout             -> cierra sesión
//
// Restricción: solo pueden entrar MIEMBROS del servidor de Discord (GUILD_ID).
// Variables de entorno necesarias (en el servicio web de Railway):
//   DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, GUILD_ID, JWT_SECRET, DATABASE_URL

const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const router = express.Router();

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "";
const GUILD_ID = process.env.GUILD_ID || "";
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const IS_PROD = process.env.NODE_ENV === "production";
const API = "https://discord.com/api/v10";
const SCOPES = "identify email guilds";

// Admins: por correo (igual que el panel) o por ID de Discord (lo más confiable).
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS
    ? process.env.ADMIN_EMAILS.split(",")
    : ["juegocrisger@gmail.com", "jsebastianarduzespa@gmail.com"]
  )
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);
const ADMIN_DISCORD_IDS = new Set(
  (process.env.ADMIN_DISCORD_IDS || "").split(",").map((s) => s.trim()).filter(Boolean)
);
function isAdminUser(user) {
  const email = String(user.email || "").toLowerCase();
  return ADMIN_EMAILS.has(email) || ADMIN_DISCORD_IDS.has(String(user.id));
}

if (!process.env.JWT_SECRET) {
  console.warn("[auth-discord] JWT_SECRET no configurado: las sesiones se invalidan al reiniciar.");
}
if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
  console.warn("[auth-discord] DISCORD_CLIENT_ID/SECRET no configurados: el login con Discord quedará deshabilitado.");
}

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl
  ? new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("railway") ? { rejectUnauthorized: false } : false,
    })
  : null;

// Crea la tabla de usuarios de comunidad (independiente de la tabla `usuarios` de TIENDITA).
async function initAuthDiscord() {
  if (!pool) {
    console.warn("[auth-discord] Sin base de datos: el login no podrá guardar usuarios.");
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS community_users (
      discord_id TEXT PRIMARY KEY,
      username TEXT NOT NULL DEFAULT '',
      global_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'viewer',
      is_member BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Por si la tabla ya existía sin la columna de rol.
  await pool.query("ALTER TABLE community_users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'viewer'");
}

const isConfigured = () => Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET);

function getBaseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function redirectUri(req) {
  return `${getBaseUrl(req)}/api/auth/discord/callback`;
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function setCookie(res, name, value, maxAgeSeconds) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    maxAge: maxAgeSeconds * 1000,
    path: "/",
  });
}

function avatarUrl(user) {
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
  }
  return "";
}

// Paso 1: redirigir a Discord para autorizar.
router.get("/api/auth/discord", (req, res) => {
  if (!isConfigured()) {
    return res.status(503).send("Login con Discord no configurado en el servidor.");
  }

  const state = crypto.randomBytes(16).toString("hex");
  setCookie(res, "oauth_state", state, 600); // 10 minutos

  const params = new URLSearchParams({
    response_type: "code",
    client_id: DISCORD_CLIENT_ID,
    scope: SCOPES,
    redirect_uri: redirectUri(req),
    state,
    prompt: "consent",
  });

  res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

// Paso 2: Discord regresa con un código; validamos y creamos sesión.
router.get("/api/auth/discord/callback", async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).send("Login con Discord no configurado en el servidor.");
  }

  try {
    const { code, state } = req.query;
    const cookies = parseCookies(req);

    if (!code || !state || state !== cookies.oauth_state) {
      return res.status(400).send("Solicitud inválida (state). Intenta entrar de nuevo.");
    }
    res.clearCookie("oauth_state", { path: "/" });

    // Intercambia el código por un access token.
    const tokenRes = await fetch(`${API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: redirectUri(req),
      }),
    });

    if (!tokenRes.ok) {
      return res.status(401).send("No se pudo validar con Discord.");
    }
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Datos del usuario.
    const userRes = await fetch(`${API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) {
      return res.status(401).send("No se pudo obtener tu perfil de Discord.");
    }
    const user = await userRes.json();

    // Verifica que sea miembro del servidor.
    const guildsRes = await fetch(`${API}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const guilds = guildsRes.ok ? await guildsRes.json() : [];
    const isMember = Array.isArray(guilds) && guilds.some((g) => g.id === GUILD_ID);

    if (!isMember) {
      return res
        .status(403)
        .send("Debes ser miembro del servidor de Discord de Omeganetics para entrar. Únete y vuelve a intentar.");
    }

    // Guarda/actualiza al usuario y resuelve su rol desde la base de datos.
    // Primer ingreso => 'viewer'. Si está en la lista de admins => 'admin'.
    // Si ya tenía un rol asignado a mano, no se pisa (salvo que sea admin por lista).
    const seedAdmin = isAdminUser(user);
    let role = seedAdmin ? "admin" : "viewer";

    if (pool) {
      const result = await pool.query(
        `INSERT INTO community_users (discord_id, username, global_name, email, avatar_url, role, is_member, last_login_at)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())
         ON CONFLICT (discord_id) DO UPDATE
           SET username = EXCLUDED.username,
               global_name = EXCLUDED.global_name,
               email = EXCLUDED.email,
               avatar_url = EXCLUDED.avatar_url,
               is_member = TRUE,
               last_login_at = NOW(),
               role = CASE WHEN $7 THEN 'admin' ELSE community_users.role END
         RETURNING role`,
        [user.id, user.username || "", user.global_name || "", user.email || "", avatarUrl(user), role, seedAdmin],
      );
      role = result.rows[0]?.role || role;
    }

    // Emite la sesión (JWT en cookie httpOnly). El rol viene de la base de datos.
    const token = jwt.sign(
      {
        role: role === "admin" ? "admin" : "user",
        communityRole: role,
        isAdmin: role === "admin",
        discordId: user.id,
        username: user.username,
        globalName: user.global_name || user.username,
        avatar: avatarUrl(user),
      },
      JWT_SECRET,
      { expiresIn: "30d" },
    );
    setCookie(res, "session", token, 60 * 60 * 24 * 30); // 30 días

    res.redirect("/login.html");
  } catch (error) {
    console.error("[auth-discord] callback error:", error.message);
    res.status(500).send("Error al iniciar sesión con Discord.");
  }
});

// Usuario actual (lee la cookie de sesión).
router.get("/api/auth/me", (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies.session;
  if (!token) return res.status(401).json({ error: "No autenticado." });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return res.json({
      discordId: decoded.discordId,
      username: decoded.username,
      globalName: decoded.globalName,
      avatar: decoded.avatar,
      role: decoded.communityRole || (decoded.isAdmin ? "admin" : "viewer"),
      isAdmin: Boolean(decoded.isAdmin),
    });
  } catch (error) {
    return res.status(401).json({ error: "Sesión inválida o expirada." });
  }
});

// Cerrar sesión.
router.post("/api/auth/logout", (req, res) => {
  res.clearCookie("session", { path: "/" });
  res.json({ ok: true });
});

// Perfil del usuario logueado (datos de community_users).
router.get("/api/me/profile", requireUser, async (req, res) => {
  const base = {
    discordId: req.user.discordId,
    username: req.user.username,
    globalName: req.user.globalName,
    avatar: req.user.avatar,
    isAdmin: Boolean(req.user.isAdmin),
    role: req.user.communityRole || (req.user.isAdmin ? "admin" : "viewer"),
    createdAt: null,
    lastLoginAt: null,
  };
  if (!pool) return res.json(base);
  try {
    const r = await pool.query(
      "SELECT username, global_name, avatar_url, role, created_at, last_login_at FROM community_users WHERE discord_id = $1",
      [req.user.discordId],
    );
    const row = r.rows[0];
    if (row) {
      base.username = row.username || base.username;
      base.globalName = row.global_name || base.globalName;
      base.avatar = row.avatar_url || base.avatar;
      base.role = row.role || base.role;
      base.createdAt = row.created_at;
      base.lastLoginAt = row.last_login_at;
    }
    return res.json(base);
  } catch (e) {
    return res.json(base);
  }
});

// Actividad de juegos del usuario logueado.
router.get("/api/me/activity", requireUser, async (req, res) => {
  const refreshMinutes = Number(process.env.ACTIVITY_REFRESH_MINUTES || 5);
  if (!pool) return res.json({ refreshMinutes, games: [] });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_game_activity (
        discord_id TEXT NOT NULL, game TEXT NOT NULL, samples INTEGER NOT NULL DEFAULT 0,
        first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (discord_id, game)
      );
    `);
    const r = await pool.query(
      "SELECT game, samples, last_seen FROM user_game_activity WHERE discord_id = $1 ORDER BY samples DESC, last_seen DESC LIMIT 20",
      [req.user.discordId],
    );
    const games = r.rows.map((row) => ({
      game: row.game,
      minutes: row.samples * refreshMinutes,
      lastSeen: row.last_seen,
    }));
    return res.json({ refreshMinutes, games });
  } catch (e) {
    return res.json({ refreshMinutes, games: [] });
  }
});

// Middleware reutilizable para proteger rutas de usuario (lo usaremos en eventos/moneda).
function requireUser(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies.session || (req.headers.authorization || "").replace(/^Bearer\s+/, "");
  if (!token) return res.status(401).json({ error: "Inicia sesión con Discord." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ error: "Sesión inválida o expirada." });
  }
}

module.exports = { router, initAuthDiscord, requireUser };
