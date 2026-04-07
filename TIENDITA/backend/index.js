// index.js
const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcrypt");
const fs = require("fs");
require("dotenv").config();
const projectRoutes = require("./routes/projectRoutes");
const authRoutes = require("./routes/authRoutes");

const app = express();
const uploadsDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(uploadsDir));

app.use("/api/proyectos", projectRoutes);
app.use("/api/auth", authRoutes);

// CREAR TABLAS
const pool = require("./config/db");

async function crearTablas() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS proyectos (
      id SERIAL PRIMARY KEY,
      nombre TEXT,
      categoria TEXT,
      descripcion TEXT,
      portada TEXT,
      archivo TEXT,
      fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migra tablas ya existentes sin romper datos previos.
  await pool.query("ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS descripcion TEXT");
  await pool.query("ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS archivo TEXT");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      correo TEXT UNIQUE,
      password TEXT,
      rol TEXT DEFAULT 'user'
    );
  `);

  // Crea admin por defecto si no existe (para primer arranque).
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASS) {
    const existe = await pool.query("SELECT id FROM usuarios WHERE correo=$1", [process.env.ADMIN_EMAIL]);
    if (existe.rows.length === 0) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASS, 10);
      await pool.query(
        "INSERT INTO usuarios(correo, password, rol) VALUES($1,$2,$3)",
        [process.env.ADMIN_EMAIL, hash, "admin"]
      );
    }
  }
}

async function initDatabase() {
  await crearTablas();
}

async function startServer() {
  try {
    const port = process.env.PORT || 3000;
    await initDatabase();
    app.listen(port, () => console.log(`Server ON en puerto ${port}`));
  } catch (err) {
    console.error("No se pudo iniciar el servidor:", err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  initDatabase
};