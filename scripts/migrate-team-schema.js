require("dotenv").config();

const { initTeamStorage } = require("../server");

async function run() {
  try {
    await initTeamStorage();
    console.log("Migracion de team completada. Revisa las tablas team_* en la base de datos.");
    process.exit(0);
  } catch (error) {
    console.error("No se pudo migrar el esquema de team:", error.message);
    process.exit(1);
  }
}

run();