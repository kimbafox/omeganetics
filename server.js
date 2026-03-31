const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// servir archivos estáticos
app.use(express.static(__dirname));

// abrir index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});
