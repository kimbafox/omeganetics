require("dotenv").config();
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("❌ DATABASE_URL no definida en .env");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("railway")
    ? { rejectUnauthorized: false }
    : false
});

module.exports = pool;