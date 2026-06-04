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

const fileFilter = (req, file, cb) => {
  const esImagen = file.fieldname === "portada" || file.fieldname === "imagenes";

  if (esImagen && !/image\/(jpeg|png|webp)/i.test(file.mimetype)) {
    return cb(new Error("Solo se aceptan imágenes JPG, PNG o WEBP en portada y galería."));
  }

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 8
  }
});

// RUTAS
router.post(
  "/subir",
  verificarToken,
  (req, res, next) => {
    upload.fields([
      { name: "portada", maxCount: 1 },
      { name: "imagenes", maxCount: 6 },
      { name: "archivo", maxCount: 1 }
    ])(req, res, err => {
      if (err) {
        const message = err.code === "LIMIT_FILE_SIZE"
          ? "Una o más imágenes exceden 2 MB. Redúcelas para mantener el catálogo ligero."
          : err.message || "Error al subir archivos.";
        return res.status(400).json({ error: message });
      }
      next();
    });
  },
  ctrl.subirProyecto
);
router.get("/listar", ctrl.obtenerProyectos);
router.delete("/eliminar/:id", verificarToken, soloAdmin, ctrl.eliminarProyecto);

module.exports = router;