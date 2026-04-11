require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const jwt = require('jsonwebtoken'); // NUEVO: Para la seguridad

const app = express();
const PORT = process.env.PORT || 3001;
const DATABASE_URL = process.env.DATABASE_URL;
const uploadsDir = path.join(__dirname, 'uploads');
const publicDir = path.join(__dirname, 'public');

// Configuración de Seguridad del Admin (Se leerán desde Railway o el archivo .env)
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "juegocrisger@gmail.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "170893666Lp.";
const ADMIN_KEYWORD = process.env.ADMIN_KEYWORD || "evolucion";
const JWT_SECRET = process.env.JWT_SECRET || "clave_secreta_super_hacker_123";

if (!fs.existsSync(uploadsDir)) { fs.mkdirSync(uploadsDir, { recursive: true }); }

let pool = null;
const dbEnabled = Boolean(DATABASE_URL);

if (dbEnabled) {
    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
} else {
    console.warn('> BASE_DE_DATOS_DESHABILITADA: define DATABASE_URL para activar las rutas de lore.');
}

if (dbEnabled) {
    pool.query(`
        CREATE TABLE IF NOT EXISTS lore (
            id SERIAL PRIMARY KEY,
            title VARCHAR(255) UNIQUE NOT NULL,
            description TEXT NOT NULL,
            img1 VARCHAR(255) NOT NULL,
            img2 VARCHAR(255),
            img3 VARCHAR(255)
        );
    `).catch(err => console.error("Error creando tabla:", err));
}

const storage = multer.diskStorage({
    destination: uploadsDir,
    filename: function(req, file, cb) {
        cb(null, 'lore-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));
app.use('/uploads', express.static(uploadsDir));

// --- NUEVO: RUTA DE LOGIN ---
app.post('/api/login', (req, res) => {
    const { email, password, keyword } = req.body;

    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD && keyword === ADMIN_KEYWORD) {
        // Si todo coincide, creamos un token válido por 2 horas
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '2h' });
        res.json({ token });
    } else {
        res.status(401).json({ error: "> ACCESO_DENEGADO: Credenciales incorrectas o nivel de seguridad insuficiente." });
    }
});

// --- NUEVO: MIDDLEWARE DE SEGURIDAD ---
// Esta función verifica que tengas el "pase VIP" antes de dejarte subir imágenes
const verificarToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // El token viene como "Bearer [token]"

    if (!token) return res.status(403).json({ error: "> ERROR_FATAL: Se requiere autenticación." });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ error: "> SESIÓN_EXPIRADA_O_INVÁLIDA" });
        next(); // Todo está bien, pasa a la siguiente función
    });
};

// --- RUTAS DE LORE ---
app.get('/api/lore/:title', async (req, res) => {
    if (!dbEnabled) {
        return res.status(503).json({ error: "> BASE_DE_DATOS_NO_CONFIGURADA: define DATABASE_URL." });
    }

    try {
        const { title } = req.params;
        const result = await pool.query('SELECT * FROM lore WHERE LOWER(title) = LOWER($1)', [title]);
        
        if (result.rows.length > 0) res.json(result.rows[0]);
        else res.status(404).json({ message: "Lore no encontrado" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const cpUpload = upload.fields([{ name: 'img1', maxCount: 1 }, { name: 'img2', maxCount: 1 }, { name: 'img3', maxCount: 1 }]);

// NOTA: Añadimos 'verificarToken' justo antes de la función de subida
app.post('/api/lore', verificarToken, cpUpload, async (req, res) => {
    if (!dbEnabled) {
        return res.status(503).json({ error: "> BASE_DE_DATOS_NO_CONFIGURADA: no se puede guardar lore." });
    }

    try {
        const { title, description } = req.body;
        const img1 = req.files['img1'] ? `/uploads/${req.files['img1'][0].filename}` : null;
        const img2 = req.files['img2'] ? `/uploads/${req.files['img2'][0].filename}` : null;
        const img3 = req.files['img3'] ? `/uploads/${req.files['img3'][0].filename}` : null;

        if (!img1) return res.status(400).json({ error: "La imagen 1 es obligatoria" });

        const newLore = await pool.query(
            'INSERT INTO lore (title, description, img1, img2, img3) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [title, description, img1, img2, img3]
        );
        res.status(201).json(newLore.rows[0]);
    } catch (err) {
        if (err.code === '23505') res.status(400).json({ error: "Ese título de lore ya existe." });
        else res.status(500).json({ error: err.message });
    }
});

function start() {
    app.listen(PORT, () => console.log(`> PROTOCOLO_DE_SEGURIDAD_ACTIVO_EN_PUERTO_${PORT}`));
}

if (require.main === module) {
    start();
}

module.exports = {
    app,
    start
};
