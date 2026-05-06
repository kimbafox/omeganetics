const pool = require("../config/db");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const https = require("https");

const JWT_SECRET = process.env.JWT_SECRET || "secreto";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const ALLOWED_GOOGLE_EMAIL = (process.env.ALLOWED_GOOGLE_EMAIL || "juegocrisger@gmail.com").toLowerCase();

function emitirToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        let rawData = "";

        response.on("data", (chunk) => {
          rawData += chunk;
        });

        response.on("end", () => {
          try {
            const parsed = JSON.parse(rawData || "{}");

            if (response.statusCode >= 400) {
              return reject(new Error(parsed.error_description || parsed.error || "Respuesta inválida de Google"));
            }

            resolve(parsed);
          } catch {
            reject(new Error("No se pudo interpretar la respuesta de Google"));
          }
        });
      })
      .on("error", reject);
  });
}

async function validarCredencialGoogle(idToken) {
  const googleData = await requestJson(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  );

  if (googleData.aud !== GOOGLE_CLIENT_ID) {
    throw new Error("El token no pertenece a esta aplicación");
  }

  if (googleData.email_verified !== "true") {
    throw new Error("El correo de Google no está verificado");
  }

  return {
    sub: googleData.sub,
    email: String(googleData.email || "").toLowerCase()
  };
}

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

    const token = emitirToken({ id: user.id, rol: user.rol, correo: user.correo });

    res.json({ token, rol: user.rol });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error en login" });
  }
};

exports.googleConfig = async (req, res) => {
  res.json({
    enabled: Boolean(GOOGLE_CLIENT_ID),
    clientId: GOOGLE_CLIENT_ID || null,
    allowedEmail: ALLOWED_GOOGLE_EMAIL
  });
};

exports.googleLogin = async (req, res) => {
  try {
    if (!GOOGLE_CLIENT_ID) {
      return res.status(503).json({ error: "Google login no configurado en Railway" });
    }

    const credential = req.body?.credential;

    if (!credential) {
      return res.status(400).json({ error: "Credencial de Google obligatoria" });
    }

    const googleUser = await validarCredencialGoogle(credential);

    if (googleUser.email !== ALLOWED_GOOGLE_EMAIL) {
      return res.status(403).json({ error: "Solo se admite la cuenta autorizada" });
    }

    const token = emitirToken({
      id: googleUser.sub,
      rol: "admin",
      correo: googleUser.email
    });

    res.json({ token, rol: "admin", correo: googleUser.email });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: err.message || "No se pudo validar el acceso con Google" });
  }
};
