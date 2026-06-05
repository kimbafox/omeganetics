// routes/projectRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/projectController");
const multer = require("multer");
const path = require("path");
const { requireUser } = require("../../../auth-discord");

// Realms ahora se protege con la sesión de Discord del sitio: solo administradores.
function requireDiscordAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: "Solo administradores." });
    next();
  });
}

// Si Cloudinary está configurado guardamos en memoria (para subir el buffer a la nube);
// si no, caemos al disco local como antes (no se rompe nada, pero es efímero en Railway).
const CLOUD_ON = !!(process.env.CLOUDINARY_URL || (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET));

const storage = CLOUD_ON
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: path.join(__dirname, "..", "uploads"),
      filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
    });

const fileFilter = (req, file, cb) => {
  const esImagen = file.fieldname === "portada" || file.fieldname === "imagenes";
  if (esImagen && !/image\/(jpeg|png|webp|gif)/i.test(file.mimetype)) {
    return cb(new Error("En portada y galería solo se aceptan imágenes JPG, PNG, WEBP o GIF."));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // hasta 100 MB por archivo (proyectos grandes)
    files: 8,
  },
});

// RUTAS
router.post(
  "/subir",
  requireDiscordAdmin,
  (req, res, next) => {
    upload.fields([
      { name: "portada", maxCount: 1 },
      { name: "imagenes", maxCount: 6 },
      { name: "archivo", maxCount: 1 },
    ])(req, res, (err) => {
      if (err) {
        const message = err.code === "LIMIT_FILE_SIZE"
          ? "Un archivo supera los 100 MB. Reduce su tamaño."
          : err.message || "Error al subir archivos.";
        return res.status(400).json({ error: message });
      }
      next();
    });
  },
  ctrl.subirProyecto
);
router.get("/listar", ctrl.obtenerProyectos);
router.delete("/eliminar/:id", requireDiscordAdmin, ctrl.eliminarProyecto);

module.exports = router;
