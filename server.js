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
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.DATABASE_PUBLIC_URL) return process.env.DATABASE_PUBLIC_URL;

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

  return null;
}

const resolvedDatabaseUrl = resolveDatabaseUrl();

if (resolvedDatabaseUrl) {
  process.env.DATABASE_URL = resolvedDatabaseUrl;

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
  res.sendFile(path.join(__dirname, "TIENDITA", "frontend", "index.html"));
});

app.get("/tiendita/", (req, res) => {
  if (!tienditaEnabled) {
    return res.status(503).send("TIENDITA deshabilitada: configura DATABASE_URL.");
  }
  res.sendFile(path.join(__dirname, "TIENDITA", "frontend", "index.html"));
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
