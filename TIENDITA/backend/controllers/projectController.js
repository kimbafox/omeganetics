// controllers/projectController.js
const pool = require("../config/db");
const CATEGORIAS_VALIDAS = new Set([
  "omegacraft",
  "herramientas",
  "juegos",
  "libros",
  "arte y diseno"
]);

// Cloudinary (almacenamiento permanente). Si no está configurado, se usa el disco local.
const CLOUD_ON = !!(process.env.CLOUDINARY_URL || (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET));
let cloudinary = null;
if (CLOUD_ON) {
  cloudinary = require("cloudinary").v2;
  if (!process.env.CLOUDINARY_URL) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }
}

// Sube un buffer a Cloudinary y devuelve la URL segura (https permanente).
function subirACloud(buffer, resourceType) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "realms", resource_type: resourceType || "auto" },
      (err, result) => (err ? reject(err) : resolve(result.secure_url)),
    );
    stream.end(buffer);
  });
}

// SUBIR
exports.subirProyecto = async (req, res) => {
  try {
    const { nombre, categoria, descripcion } = req.body;
    const categoriaNormalizada = String(categoria || "").trim().toLowerCase();

    // En modo nube cada archivo es un buffer -> URL; en disco es un filename (compat).
    let portada, imagenes, archivo;
    if (CLOUD_ON) {
      const fp = req.files?.portada?.[0];
      portada = fp ? await subirACloud(fp.buffer, "image") : null;
      imagenes = await Promise.all((req.files?.imagenes || []).map((f) => subirACloud(f.buffer, "image")));
      const fa = req.files?.archivo?.[0];
      archivo = fa ? await subirACloud(fa.buffer, "raw") : null;
    } else {
      portada = req.files?.portada?.[0]?.filename;
      imagenes = (req.files?.imagenes || []).map((file) => file.filename);
      archivo = req.files?.archivo?.[0]?.filename || null;
    }

    if (!nombre || !categoriaNormalizada) {
      return res.status(400).json({ error: "Nombre y categoria son obligatorios" });
    }

    if (!CATEGORIAS_VALIDAS.has(categoriaNormalizada)) {
      return res.status(400).json({ error: "Categoria no valida" });
    }

    if (!portada) {
      return res.status(400).json({ error: "La portada es obligatoria" });
    }

    await pool.query(
      "INSERT INTO proyectos(nombre, categoria, descripcion, portada, archivo, imagenes) VALUES($1,$2,$3,$4,$5,$6)",
      [nombre, categoriaNormalizada, descripcion || "", portada, archivo, JSON.stringify(imagenes)]
    );

    res.json({ ok: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Error al subir" });
  }
};

// LISTAR
exports.obtenerProyectos = async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM proyectos ORDER BY fecha DESC"
  );

  const proyectos = result.rows.map(proyecto => {
    let imagenes = [];

    try {
      imagenes = proyecto.imagenes ? JSON.parse(proyecto.imagenes) : [];
    } catch {
      imagenes = [];
    }

    return {
      ...proyecto,
      imagenes: Array.isArray(imagenes) ? imagenes : []
    };
  });

  res.json(proyectos);
};

// ELIMINAR (ADMIN)
exports.eliminarProyecto = async (req, res) => {
  const { id } = req.params;

  await pool.query("DELETE FROM proyectos WHERE id=$1", [id]);

  res.json({ ok: true });
};