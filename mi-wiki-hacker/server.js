require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken'); // NUEVO: Para la seguridad
const cloudinary = require('./cloudinary');

const app = express();
const PORT = process.env.PORT || 3001;
const DATABASE_URL = process.env.DATABASE_URL;
const uploadsDir = path.join(__dirname, 'uploads');
const publicDir = path.join(__dirname, 'public');

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'juegocrisger@gmail.com').toLowerCase();
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const cloudinaryEnabled = Boolean(
    cloudinary &&
    process.env.CLOUD_NAME &&
    process.env.CLOUD_API_KEY &&
    process.env.CLOUD_API_SECRET
);

if (!process.env.JWT_SECRET) {
    console.warn('> JWT_SECRET_NO_CONFIGURADO: se usara una clave temporal para esta ejecucion.');
}

if (!GOOGLE_CLIENT_ID) {
    console.warn('> GOOGLE_CLIENT_ID_NO_CONFIGURADO: el acceso admin con Google quedara deshabilitado.');
}

if (!cloudinaryEnabled) {
    console.warn('> CLOUDINARY_NO_CONFIGURADO: la subida de imagenes del lore quedara deshabilitada.');
}

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
            short_description TEXT,
            category VARCHAR(120),
            timeline TEXT,
            canon_type VARCHAR(80),
            other_names TEXT,
            appearances TEXT,
            additional_notes TEXT,
            img1 VARCHAR(255) NOT NULL,
            img2 VARCHAR(255),
            img3 VARCHAR(255),
            created_at TIMESTAMP DEFAULT NOW()
        );
    `).catch(err => console.error("Error creando tabla:", err));

    pool.query(`
        ALTER TABLE lore
        ADD COLUMN IF NOT EXISTS short_description TEXT,
        ADD COLUMN IF NOT EXISTS category VARCHAR(120),
        ADD COLUMN IF NOT EXISTS timeline TEXT,
        ADD COLUMN IF NOT EXISTS canon_type VARCHAR(80),
        ADD COLUMN IF NOT EXISTS other_names TEXT,
        ADD COLUMN IF NOT EXISTS appearances TEXT,
        ADD COLUMN IF NOT EXISTS additional_notes TEXT,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
    `).catch(err => console.error("Error actualizando tabla lore:", err));
}

const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));
app.use('/uploads', express.static(uploadsDir));

app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'indexwiki.html'));
});

app.get('/index.html', (req, res) => {
    res.redirect(`${req.baseUrl || ''}/indexwiki.html`);
});

app.get('/api/auth-config', (req, res) => {
    res.json({
        googleClientId: GOOGLE_CLIENT_ID,
        adminEmail: ADMIN_EMAIL
    });
});

async function verifyGoogleToken(idToken) {
    if (!GOOGLE_CLIENT_ID) {
        const error = new Error('google_not_configured');
        error.statusCode = 503;
        throw error;
    }

    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);

    if (!response.ok) {
        const error = new Error('invalid_google_token');
        error.statusCode = 401;
        throw error;
    }

    const payload = await response.json();
    if (payload.aud !== GOOGLE_CLIENT_ID) {
        const error = new Error('google_audience_mismatch');
        error.statusCode = 401;
        throw error;
    }

    if (payload.email_verified !== 'true' || !payload.email) {
        const error = new Error('google_email_not_verified');
        error.statusCode = 401;
        throw error;
    }

    return payload;
}

app.post('/api/login/google', async (req, res) => {
    try {
        const credential = req.body?.credential;
        if (!credential) {
            return res.status(400).json({ error: '> TOKEN_DE_GOOGLE_REQUERIDO' });
        }

        const googleUser = await verifyGoogleToken(credential);
        const email = String(googleUser.email || '').toLowerCase();

        if (email !== ADMIN_EMAIL) {
            return res.status(403).json({ error: '> ESTA_CUENTA_NO_TIENE_PERMISOS_DE_ADMIN' });
        }

        const token = jwt.sign(
            {
                role: 'admin',
                email,
                name: googleUser.name || googleUser.given_name || email
            },
            JWT_SECRET,
            { expiresIn: '2h' }
        );

        res.json({ token, role: 'admin', email });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        const fallbackMessage = statusCode === 503
            ? '> GOOGLE_LOGIN_NO_CONFIGURADO_EN_EL_SERVIDOR'
            : '> NO_SE_PUDO_VALIDAR_LA_CUENTA_DE_GOOGLE';

        res.status(statusCode).json({ error: fallbackMessage });
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
        if (decoded.role !== 'admin') return res.status(403).json({ error: "> SOLO_ADMIN_PUEDE_SUBIR_REGISTROS" });
        req.user = decoded;
        next(); // Todo está bien, pasa a la siguiente función
    });
};

function uploadToCloudinary(file, fieldName) {
    return new Promise((resolve, reject) => {
        if (!cloudinary) {
            reject(new Error('cloudinary_sdk_missing'));
            return;
        }

        const extension = path.extname(file.originalname || '') || '.jpg';
        const publicId = `${fieldName}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;

        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: 'mi-wiki-hacker/lore',
                resource_type: 'image',
                public_id: publicId,
                format: extension.replace('.', '').toLowerCase()
            },
            (error, result) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve(result.secure_url);
            }
        );

        uploadStream.end(file.buffer);
    });
}

function readLorePayload(body) {
    return {
        title: body.title,
        description: body.description,
        shortDescription: body.shortDescription,
        category: body.category,
        timeline: body.timeline,
        canonType: body.canonType,
        otherNames: body.otherNames,
        appearances: body.appearances,
        additionalNotes: body.additionalNotes
    };
}

// --- RUTAS DE LORE ---
app.get('/api/lore/recent', async (req, res) => {
    if (!dbEnabled) {
        return res.status(503).json({ error: "> BASE_DE_DATOS_NO_CONFIGURADA: define DATABASE_URL." });
    }

    try {
        const result = await pool.query(`
            SELECT id, title, description, short_description, category, timeline, canon_type, other_names, appearances, additional_notes, img1, img2, img3, created_at
            FROM lore
            ORDER BY created_at DESC, id DESC
            LIMIT 4
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/lore/sealed-carousel', async (req, res) => {
    if (!dbEnabled) {
        return res.status(503).json({ error: "> BASE_DE_DATOS_NO_CONFIGURADA: define DATABASE_URL." });
    }

    try {
        const result = await pool.query(`
            SELECT id, title, short_description, category, img1, created_at
            FROM lore
            WHERE img1 IS NOT NULL
            ORDER BY RANDOM()
            LIMIT 12
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/lore/:title', async (req, res) => {
    if (!dbEnabled) {
        return res.status(503).json({ error: "> BASE_DE_DATOS_NO_CONFIGURADA: define DATABASE_URL." });
    }

    try {
        const { title } = req.params;
        const result = await pool.query(
            `
                SELECT id, title, description, short_description, category, timeline, canon_type, other_names, appearances, additional_notes, img1, img2, img3, created_at
                FROM lore
                WHERE LOWER(title) = LOWER($1)
                OR LOWER(title) LIKE LOWER($2)
                ORDER BY CASE WHEN LOWER(title) = LOWER($1) THEN 0 ELSE 1 END, created_at DESC, id DESC
                LIMIT 1
            `,
            [title, `%${title}%`]
        );
        
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

    if (!cloudinaryEnabled) {
        return res.status(503).json({ error: "> CLOUDINARY_NO_CONFIGURADO: no se pueden guardar imagenes." });
    }

    try {
        const {
            title,
            description,
            shortDescription,
            category,
            timeline,
            canonType,
            otherNames,
            appearances,
            additionalNotes
        } = readLorePayload(req.body);
        const img1File = req.files?.img1?.[0] || null;
        const img2File = req.files?.img2?.[0] || null;
        const img3File = req.files?.img3?.[0] || null;

        if (!img1File) return res.status(400).json({ error: "La imagen 1 es obligatoria" });

        if (!title || !description || !category || !shortDescription) {
            return res.status(400).json({ error: "Titulo, categoria, mini descripcion y descripcion completa son obligatorios." });
        }

        const [img1, img2, img3] = await Promise.all([
            uploadToCloudinary(img1File, 'img1'),
            img2File ? uploadToCloudinary(img2File, 'img2') : Promise.resolve(null),
            img3File ? uploadToCloudinary(img3File, 'img3') : Promise.resolve(null)
        ]);

        const newLore = await pool.query(
            `
                INSERT INTO lore (
                    title,
                    description,
                    short_description,
                    category,
                    timeline,
                    canon_type,
                    other_names,
                    appearances,
                    additional_notes,
                    img1,
                    img2,
                    img3
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING *
            `,
            [
                title,
                description,
                shortDescription,
                category,
                timeline || null,
                canonType || null,
                otherNames || null,
                appearances || null,
                additionalNotes || null,
                img1,
                img2,
                img3
            ]
        );
        res.status(201).json(newLore.rows[0]);
    } catch (err) {
        if (err.code === '23505') res.status(400).json({ error: "Ese título de lore ya existe." });
        else res.status(500).json({ error: err.message });
    }
});

app.put('/api/lore/:id', verificarToken, cpUpload, async (req, res) => {
    if (!dbEnabled) {
        return res.status(503).json({ error: "> BASE_DE_DATOS_NO_CONFIGURADA: no se puede editar lore." });
    }

    try {
        const loreId = Number(req.params.id);
        if (!Number.isInteger(loreId) || loreId <= 0) {
            return res.status(400).json({ error: 'ID de lore invalido.' });
        }

        const existingLore = await pool.query(
            `
                SELECT id, img1, img2, img3
                FROM lore
                WHERE id = $1
                LIMIT 1
            `,
            [loreId]
        );

        if (!existingLore.rows.length) {
            return res.status(404).json({ error: 'Lore no encontrado.' });
        }

        const {
            title,
            description,
            shortDescription,
            category,
            timeline,
            canonType,
            otherNames,
            appearances,
            additionalNotes
        } = readLorePayload(req.body);

        if (!title || !description || !category || !shortDescription) {
            return res.status(400).json({ error: 'Titulo, categoria, mini descripcion y descripcion completa son obligatorios.' });
        }

        const img1File = req.files?.img1?.[0] || null;
        const img2File = req.files?.img2?.[0] || null;
        const img3File = req.files?.img3?.[0] || null;
        const currentLore = existingLore.rows[0];

        if (!cloudinaryEnabled && (img1File || img2File || img3File)) {
            return res.status(503).json({ error: '> CLOUDINARY_NO_CONFIGURADO: no se pueden reemplazar imagenes.' });
        }

        const [img1, img2, img3] = await Promise.all([
            img1File ? uploadToCloudinary(img1File, 'img1') : Promise.resolve(currentLore.img1),
            img2File ? uploadToCloudinary(img2File, 'img2') : Promise.resolve(currentLore.img2),
            img3File ? uploadToCloudinary(img3File, 'img3') : Promise.resolve(currentLore.img3)
        ]);

        const updatedLore = await pool.query(
            `
                UPDATE lore
                SET
                    title = $1,
                    description = $2,
                    short_description = $3,
                    category = $4,
                    timeline = $5,
                    canon_type = $6,
                    other_names = $7,
                    appearances = $8,
                    additional_notes = $9,
                    img1 = $10,
                    img2 = $11,
                    img3 = $12
                WHERE id = $13
                RETURNING *
            `,
            [
                title,
                description,
                shortDescription,
                category,
                timeline || null,
                canonType || null,
                otherNames || null,
                appearances || null,
                additionalNotes || null,
                img1,
                img2,
                img3,
                loreId
            ]
        );

        res.json(updatedLore.rows[0]);
    } catch (err) {
        if (err.code === '23505') res.status(400).json({ error: 'Ese título de lore ya existe.' });
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
