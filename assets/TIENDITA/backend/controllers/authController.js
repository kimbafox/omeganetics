const pool = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "secreto";

// REGISTRO
exports.register = async (req, res) => {
  try {
    const { correo, password } = req.body;

    if (!correo || !password) {
      return res.status(400).json({ error: "Correo y password son obligatorios" });
    }

    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      "INSERT INTO usuarios(correo, password) VALUES($1,$2)",
      [correo, hash]
    );

    res.json({ ok: true });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).json({ error: "El correo ya existe" });
    }

    console.error(err);
    res.status(500).json({ error: "Error en registro" });
  }
};

// LOGIN
exports.login = async (req, res) => {
  try {
    const { correo, password } = req.body;

    if (!correo || !password) {
      return res.status(400).json({ error: "Correo y password son obligatorios" });
    }

    const result = await pool.query(
      "SELECT * FROM usuarios WHERE correo=$1",
      [correo]
    );

    const user = result.rows[0];

    if (!user) return res.status(400).json({ error: "No existe" });

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) return res.status(400).json({ error: "Contraseña incorrecta" });

    const token = jwt.sign(
      { id: user.id, rol: user.rol },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ token, rol: user.rol });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error en login" });
  }
};
