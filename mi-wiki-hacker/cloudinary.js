let cloudinary = null;

try {
    cloudinary = require('cloudinary').v2;

    cloudinary.config({
        cloud_name: process.env.CLOUD_NAME,
        api_key: process.env.CLOUD_API_KEY,
        api_secret: process.env.CLOUD_API_SECRET
    });
} catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') {
        throw error;
    }

    console.warn('> CLOUDINARY_SDK_NO_INSTALADO: el servidor seguira activo pero la subida de imagenes quedara deshabilitada.');
}

module.exports = cloudinary;