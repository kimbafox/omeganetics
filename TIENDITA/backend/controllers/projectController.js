// controllers/projectController.js
const pool = require("../config/db");

// SUBIR
exports.subirProyecto = async (req, res) => {
  try {
    const { nombre, categoria, descripcion } = req.body;
    const portada = req.files?.portada?.[0]?.filename;
    const imagenes = (req.files?.imagenes || []).map(file => file.filename);
    const archivo = req.files?.archivo?.[0]?.filename || null;

    if (!portada) {
      return res.status(400).json({ error: "La portada es obligatoria" });
    }

    await pool.query(
      "INSERT INTO proyectos(nombre, categoria, descripcion, portada, archivo, imagenes) VALUES($1,$2,$3,$4,$5,$6)",
      [nombre, categoria, descripcion || "", portada, archivo, JSON.stringify(imagenes)]
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