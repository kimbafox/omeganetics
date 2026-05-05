// routes/projectRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/projectController");
const multer = require("multer");
const path = require("path");
const { verificarToken, soloAdmin } = require("../middlewares/authMiddleware");

// CONFIG SUBIDA
const storage = multer.diskStorage({
  destination: path.join(__dirname, "..", "uploads"),
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});
const upload = multer({ storage });

// RUTAS
router.post(
  "/subir",
  verificarToken,
  upload.fields([
    { name: "portada", maxCount: 1 },
    { name: "imagenes", maxCount: 6 },
    { name: "archivo", maxCount: 1 }
  ]),
  ctrl.subirProyecto
);
router.get("/listar", ctrl.obtenerProyectos);
router.delete("/eliminar/:id", verificarToken, soloAdmin, ctrl.eliminarProyecto);

module.exports = router;