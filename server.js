const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT;

// 🔥 AQUÍ VA (antes de todo)
app.use((req, res, next) => {
  if (req.headers["x-forwarded-proto"] !== "https") {
    return res.redirect("https://" + req.headers.host + req.url);
  }
  next();
});

// servir archivos estáticos
app.use(express.static(__dirname));

// ruta principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// iniciar servidor
app.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor corriendo en puerto", PORT);
});
