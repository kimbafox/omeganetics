const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "juegocrisger@gmail.com").toLowerCase();
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const teamDataDir = path.join(__dirname, "data");
const teamDataFile = path.join(teamDataDir, "equipo.json");
const teamUploadsDir = path.join(__dirname, "uploads", "team");

if (!fs.existsSync(teamDataDir)) {
  fs.mkdirSync(teamDataDir, { recursive: true });
}

if (!fs.existsSync(teamUploadsDir)) {
  fs.mkdirSync(teamUploadsDir, { recursive: true });
}

if (!process.env.JWT_SECRET) {
  console.warn("JWT_SECRET no configurado: se usara una clave temporal para esta ejecucion.");
}

if (!GOOGLE_CLIENT_ID) {
  console.warn("GOOGLE_CLIENT_ID no configurado: el panel admin de equipo quedara deshabilitado.");
}

if (!ADMIN_PASSWORD && !ADMIN_PASSWORD_HASH) {
  console.warn("ADMIN_PASSWORD/ADMIN_PASSWORD_HASH no configurado: el acceso por clave del panel admin quedara deshabilitado.");
}

app.use(express.json({ limit: "2mb" }));
app.use("/uploads/team", express.static(teamUploadsDir));

const uploadStorage = multer.diskStorage({
  destination: teamUploadsDir,
  filename(req, file, cb) {
    const safeBaseName = String(path.basename(file.originalname, path.extname(file.originalname)))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "imagen";

    cb(null, `${Date.now()}-${safeBaseName}${path.extname(file.originalname).toLowerCase()}`);
  }
});

const uploadTeamImage = multer({ storage: uploadStorage });

function normalizeSlug(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeContacts(contacts) {
  return {
    email: normalizeText(contacts?.email),
    phone: normalizeText(contacts?.phone),
    instagram: normalizeText(contacts?.instagram),
    tiktok: normalizeText(contacts?.tiktok),
    discord: normalizeText(contacts?.discord),
    website: normalizeText(contacts?.website)
  };
}

function sanitizeLocation(location) {
  return {
    country: normalizeText(location?.country),
    city: normalizeText(location?.city)
  };
}

function sanitizeMember(member, fallbackIndex = 0) {
  const name = normalizeText(member?.name);
  const slug = normalizeSlug(member?.slug || name || `integrante-${fallbackIndex + 1}`);

  return {
    id: normalizeText(member?.id) || slug,
    slug,
    name,
    fullName: normalizeText(member?.fullName),
    role: normalizeText(member?.role),
    tier: normalizeText(member?.tier),
    badge: normalizeText(member?.badge),
    image: normalizeText(member?.image),
    shortBio: normalizeText(member?.shortBio),
    summary: normalizeText(member?.summary),
    lifeStory: normalizeText(member?.lifeStory),
    specialties: Array.isArray(member?.specialties)
      ? member.specialties.map(item => normalizeText(item)).filter(Boolean)
      : [],
    location: sanitizeLocation(member?.location),
    contacts: sanitizeContacts(member?.contacts),
    featured: Boolean(member?.featured)
  };
}

function sanitizeWorkgroupEntry(entry, fallbackIndex = 0) {
  const name = normalizeText(entry?.name);
  return {
    id: normalizeText(entry?.id) || `grupo-${fallbackIndex + 1}`,
    name,
    role: normalizeText(entry?.role),
    image: normalizeText(entry?.image),
    description: normalizeText(entry?.description),
    location: sanitizeLocation(entry?.location)
  };
}

function sanitizeTeamContent(content) {
  const about = content?.about || {};
  const workgroup = content?.workgroup || {};
  const members = Array.isArray(content?.members) ? content.members : [];
  const crew = Array.isArray(workgroup?.members) ? workgroup.members : [];

  return {
    about: {
      eyebrow: normalizeText(about.eyebrow),
      title: normalizeText(about.title),
      description: normalizeText(about.description)
    },
    members: members.map((member, index) => sanitizeMember(member, index)),
    workgroup: {
      title: normalizeText(workgroup.title),
      description: normalizeText(workgroup.description),
      members: crew.map((entry, index) => sanitizeWorkgroupEntry(entry, index))
    }
  };
}

async function getPublicTeamContent() {
  const content = await readTeamContent();
  return sanitizeTeamContent(content);
}

async function verifyGoogleToken(idToken) {
  if (!GOOGLE_CLIENT_ID) {
    const error = new Error("google_not_configured");
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!response.ok) {
    const error = new Error("invalid_google_token");
    error.statusCode = 401;
    throw error;
  }

  const payload = await response.json();
  if (payload.aud !== GOOGLE_CLIENT_ID) {
    const error = new Error("google_audience_mismatch");
    error.statusCode = 401;
    throw error;
  }

  if (payload.email_verified !== "true" || !payload.email) {
    const error = new Error("google_email_not_verified");
    error.statusCode = 401;
    throw error;
  }

  return payload;
}

async function validateAdminPassword(password) {
  if (!password || (!ADMIN_PASSWORD && !ADMIN_PASSWORD_HASH)) {
    return false;
  }

  if (ADMIN_PASSWORD_HASH) {
    return bcrypt.compare(password, ADMIN_PASSWORD_HASH);
  }

  return password === ADMIN_PASSWORD;
}

function createAdminToken(email, name = email) {
  return jwt.sign(
    {
      role: "admin",
      email,
      name
    },
    JWT_SECRET,
    { expiresIn: "2h" }
  );
}

function requireTeamAdmin(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Autenticacion requerida." });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== "admin" || String(decoded.email || "").toLowerCase() !== ADMIN_EMAIL) {
      return res.status(403).json({ error: "Solo el administrador autorizado puede editar este contenido." });
    }

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Sesion expirada o invalida." });
  }
}

// Redirige a HTTPS solo en produccion detras de proxy (Railway/Heroku-like).
app.use((req, res, next) => {
  const isProduction = process.env.NODE_ENV === "production";
  const proto = req.headers["x-forwarded-proto"];

  if (isProduction && proto && proto !== "https") {
    return res.redirect("https://" + req.headers.host + req.url);
  }
  next();
});

// Sitio principal Omeganetics
app.use(express.static(__dirname));

let tienditaEnabled = false;
let initDatabase = async () => {};
let teamPool = null;
let teamStorageMode = "file";
const TEAM_CONTENT_KEY = "main";

function resolveDatabaseUrl() {
  const directCandidates = [
    "DATABASE_URL",
    "DATABASE_PUBLIC_URL",
    "DATABASE_PRIVATE_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL",
    "POSTGRES_URI",
    "POSTGRES_PRISMA_URL",
    "POSTGRESQL_URL",
    "PG_URL"
  ];

  for (const key of directCandidates) {
    const value = process.env[key];
    if (value && /^postgres(ql)?:\/\//i.test(value)) {
      return value;
    }
  }

  // Busca cualquier variable que parezca URL de Postgres.
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    const looksLikeDbKey = /(database|postgres|pg).*(url|uri)/i.test(key);
    const looksLikeDbValue = /^postgres(ql)?:\/\//i.test(value);
    if (looksLikeDbKey && looksLikeDbValue) {
      return value;
    }
  }

  const {
    PGHOST,
    PGPORT,
    PGUSER,
    PGPASSWORD,
    PGDATABASE
  } = process.env;

  if (PGHOST && PGPORT && PGUSER && PGPASSWORD && PGDATABASE) {
    const user = encodeURIComponent(PGUSER);
    const password = encodeURIComponent(PGPASSWORD);
    const database = encodeURIComponent(PGDATABASE);
    return `postgresql://${user}:${password}@${PGHOST}:${PGPORT}/${database}`;
  }

  const {
    POSTGRES_HOST,
    POSTGRES_PORT,
    POSTGRES_USER,
    POSTGRES_PASSWORD,
    POSTGRES_DB
  } = process.env;

  if (POSTGRES_HOST && POSTGRES_PORT && POSTGRES_USER && POSTGRES_PASSWORD && POSTGRES_DB) {
    const user = encodeURIComponent(POSTGRES_USER);
    const password = encodeURIComponent(POSTGRES_PASSWORD);
    const database = encodeURIComponent(POSTGRES_DB);
    return `postgresql://${user}:${password}@${POSTGRES_HOST}:${POSTGRES_PORT}/${database}`;
  }

  return null;
}

const resolvedDatabaseUrl = resolveDatabaseUrl();

if (resolvedDatabaseUrl) {
  process.env.DATABASE_URL = resolvedDatabaseUrl;

  teamPool = new Pool({
    connectionString: resolvedDatabaseUrl,
    ssl: resolvedDatabaseUrl.includes("railway")
      ? { rejectUnauthorized: false }
      : false
  });
  teamStorageMode = "database";
}

function readTeamContentFromFile() {
  const raw = fs.readFileSync(teamDataFile, "utf8");
  return JSON.parse(raw);
}

function writeTeamContentToFile(content) {
  fs.writeFileSync(teamDataFile, JSON.stringify(content, null, 2));
}

async function initTeamStorage() {
  if (!teamPool) {
    return;
  }

  await teamPool.query(`
    CREATE TABLE IF NOT EXISTS team_content (
      content_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const existing = await teamPool.query(
    "SELECT payload FROM team_content WHERE content_key = $1 LIMIT 1",
    [TEAM_CONTENT_KEY]
  );

  if (!existing.rows.length) {
    const fileContent = sanitizeTeamContent(readTeamContentFromFile());
    await teamPool.query(
      `
        INSERT INTO team_content (content_key, payload, updated_at)
        VALUES ($1, $2::jsonb, NOW())
      `,
      [TEAM_CONTENT_KEY, JSON.stringify(fileContent)]
    );
  }
}

async function readTeamContent() {
  if (!teamPool) {
    return readTeamContentFromFile();
  }

  const result = await teamPool.query(
    "SELECT payload FROM team_content WHERE content_key = $1 LIMIT 1",
    [TEAM_CONTENT_KEY]
  );

  if (!result.rows.length) {
    const fallbackContent = sanitizeTeamContent(readTeamContentFromFile());
    await writeTeamContent(fallbackContent);
    return fallbackContent;
  }

  return result.rows[0].payload;
}

async function writeTeamContent(content) {
  if (!teamPool) {
    writeTeamContentToFile(content);
    return;
  }

  await teamPool.query(
    `
      INSERT INTO team_content (content_key, payload, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (content_key)
      DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()
    `,
    [TEAM_CONTENT_KEY, JSON.stringify(content)]
  );

  writeTeamContentToFile(content);
}

app.get("/api/team/auth-config", (req, res) => {
  res.json({
    googleClientId: GOOGLE_CLIENT_ID,
    adminEmail: ADMIN_EMAIL,
    passwordEnabled: Boolean(ADMIN_PASSWORD || ADMIN_PASSWORD_HASH)
  });
});

app.post("/api/team/login/google", async (req, res) => {
  try {
    const credential = req.body?.credential;
    if (!credential) {
      return res.status(400).json({ error: "Token de Google requerido." });
    }

    const googleUser = await verifyGoogleToken(credential);
    const email = String(googleUser.email || "").toLowerCase();

    if (email !== ADMIN_EMAIL) {
      return res.status(403).json({ error: "Esta cuenta no tiene permisos de administrador." });
    }

    const token = createAdminToken(email, googleUser.name || googleUser.given_name || email);

    return res.json({ token, role: "admin", email });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const message = statusCode === 503
      ? "Google Login no esta configurado en el servidor."
      : "No se pudo validar la cuenta de Google.";

    return res.status(statusCode).json({ error: message });
  }
});

app.post("/api/team/login/password", async (req, res) => {
  try {
    if (!ADMIN_PASSWORD && !ADMIN_PASSWORD_HASH) {
      return res.status(503).json({ error: "El acceso por clave no esta configurado en el servidor." });
    }

    const email = String(req.body?.email || "").toLowerCase().trim();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Correo y clave son obligatorios." });
    }

    if (email !== ADMIN_EMAIL) {
      return res.status(403).json({ error: "Esta cuenta no tiene permisos de administrador." });
    }

    const isValid = await validateAdminPassword(password);
    if (!isValid) {
      return res.status(401).json({ error: "Clave invalida." });
    }

    const token = createAdminToken(email);
    return res.json({ token, role: "admin", email });
  } catch (error) {
    return res.status(500).json({ error: "No se pudo iniciar sesion con clave." });
  }
});

app.get("/api/team/content", async (req, res) => {
  try {
    const content = await getPublicTeamContent();
    res.json(content);
  } catch (error) {
    res.status(500).json({ error: "No se pudo cargar el contenido del equipo." });
  }
});

app.get("/api/team/members/:slug", async (req, res) => {
  try {
    const content = await getPublicTeamContent();
    const member = content.members.find(item => item.slug === normalizeSlug(req.params.slug));

    if (!member) {
      return res.status(404).json({ error: "Integrante no encontrado." });
    }

    return res.json(member);
  } catch (error) {
    return res.status(500).json({ error: "No se pudo cargar el integrante." });
  }
});

app.put("/api/team/content", requireTeamAdmin, async (req, res) => {
  const content = sanitizeTeamContent(req.body);

  try {
    if (!content.about.title || !content.about.description) {
      return res.status(400).json({ error: "La seccion principal de quienes somos requiere titulo y descripcion." });
    }

    if (!content.members.length) {
      return res.status(400).json({ error: "Debes mantener al menos un integrante." });
    }

    const duplicateSlug = content.members.find((member, index) => {
      return content.members.findIndex(item => item.slug === member.slug) !== index;
    });

    if (duplicateSlug) {
      return res.status(400).json({ error: `El slug ${duplicateSlug.slug} esta repetido.` });
    }

    await writeTeamContent(content);
    return res.json(content);
  } catch (error) {
    return res.status(500).json({ error: "No se pudo guardar el contenido del equipo." });
  }
});

app.post("/api/team/upload", requireTeamAdmin, uploadTeamImage.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Debes enviar una imagen." });
  }

  return res.json({
    imagePath: `/uploads/team/${req.file.filename}`
  });
});

const { app: wikiApp } = require("./mi-wiki-hacker/server");
app.use("/wiki", wikiApp);

if (resolvedDatabaseUrl) {

  const { app: tienditaApp, initDatabase: tienditaInit } = require("./TIENDITA/backend/index");
  tienditaEnabled = true;
  initDatabase = tienditaInit;

  // Frontend de TIENDITA bajo el mismo dominio
  app.use("/tiendita", express.static(path.join(__dirname, "TIENDITA", "frontend")));

  // API + uploads de TIENDITA bajo el mismo servidor
  app.use(tienditaApp);
} else {
  console.warn("TIENDITA deshabilitada: falta configuracion de base de datos (DATABASE_URL/PG*). ");
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/tiendita", (req, res) => {
  if (!tienditaEnabled) {
    return res.status(503).send("TIENDITA deshabilitada: configura DATABASE_URL.");
  }
  res.sendFile(path.join(__dirname, "TIENDITA", "frontend", "indextienda.html"));
});

app.get("/tiendita/", (req, res) => {
  if (!tienditaEnabled) {
    return res.status(503).send("TIENDITA deshabilitada: configura DATABASE_URL.");
  }
  res.sendFile(path.join(__dirname, "TIENDITA", "frontend", "indextienda.html"));
});

app.get("/tiendita/index.html", (req, res) => {
  if (!tienditaEnabled) {
    return res.status(503).send("TIENDITA deshabilitada: configura DATABASE_URL.");
  }
  res.redirect("/tiendita/indextienda.html");
});

app.get("/wiki", (req, res) => {
  res.redirect("/wiki/");
});

// iniciar servidor
async function start() {
  try {
    await initTeamStorage();
    await initDatabase();
    app.listen(PORT, "0.0.0.0", () => {
      console.log("Servidor corriendo en puerto", PORT, "| storage equipo:", teamStorageMode);
    });
  } catch (error) {
    console.error("Error iniciando servidor:", error.message);
    process.exit(1);
  }
}

start();
