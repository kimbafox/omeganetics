const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;

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
}

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
    await initDatabase();
    app.listen(PORT, "0.0.0.0", () => {
      console.log("Servidor corriendo en puerto", PORT);
    });
  } catch (error) {
    console.error("Error iniciando servidor:", error.message);
    process.exit(1);
  }
}

start();
