const express = require("express");
const path = require("path");

const app = express();

// 🔥 IMPORTANTE: usar SOLO process.env.PORT
const PORT = process.env.PORT;

// servir archivos estáticos
app.use(express.static(__dirname));

// ruta principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// iniciar servidor
app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
