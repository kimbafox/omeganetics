const searchInput = document.getElementById('searchInput');
const resultSection = document.getElementById('resultSection');
const uploadSection = document.getElementById('uploadSection');
const searchSection = document.getElementById('searchSection');
const loginSection = document.getElementById('loginSection'); // NUEVO
const uploadForm = document.getElementById('uploadForm');
const loginForm = document.getElementById('loginForm'); // NUEVO
const searchError = document.getElementById('searchError');
const loginError = document.getElementById('loginError'); // NUEVO

const BASE_PATH = window.location.pathname.startsWith('/wiki') ? '/wiki' : '';

function buildApiUrl(endpoint) {
    return `${BASE_PATH}/api${endpoint}`;
}

function normalizeImageSrc(imgSrc) {
    if (!imgSrc) return imgSrc;
    if (imgSrc.startsWith('/uploads/')) {
        return `${BASE_PATH}${imgSrc}`;
    }
    return imgSrc;
}

function showSection(section) {
    // Ocultar todo primero
    resultSection.style.display = 'none';
    searchSection.style.display = 'none';
    uploadSection.style.display = 'none';
    loginSection.style.display = 'none';
    searchError.style.display = 'none';
    loginError.style.display = 'none';

    if (section === 'search') {
        searchSection.style.display = 'flex';
        searchInput.focus();
    } else if (section === 'upload') {
        // Verificar si existe el token de seguridad en la memoria del navegador
        const token = localStorage.getItem('wikiAdminToken');
        if (token) {
            uploadSection.style.display = 'block'; // Ya está logueado
        } else {
            loginSection.style.display = 'flex'; // Requiere login
        }
    }
}

// Búsqueda (Se mantiene igual)
let debounceTimer;
searchInput.addEventListener('input', function(e) {
    clearTimeout(debounceTimer);
    const keyword = e.target.value.trim();
    if (keyword === "") { resultSection.style.display = 'none'; searchError.style.display = 'none'; return; }

    debounceTimer = setTimeout(async () => {
        try {
            const response = await fetch(buildApiUrl(`/lore/${encodeURIComponent(keyword)}`));
            if (response.ok) {
                const data = await response.json();
                document.getElementById('loreTitle').innerText = data.title.toUpperCase();
                document.getElementById('loreDesc').innerText = data.description;
                const imgContainer = document.getElementById('loreImagesContainer');
                imgContainer.innerHTML = ''; 
                [data.img1, data.img2, data.img3].forEach(imgSrc => {
                    if (imgSrc) {
                        const img = document.createElement('img'); img.src = normalizeImageSrc(imgSrc); imgContainer.appendChild(img);
                    }
                });
                resultSection.style.display = 'block';
                searchError.style.display = 'none';
            } else {
                resultSection.style.display = 'none';
                searchError.innerText = "> LORE_NO_ENCONTRADO_EN_LA_BASE_DE_DATOS";
                searchError.style.display = 'block';
            }
        } catch (error) { console.error("Error:", error); }
    }, 500); 
});

// NUEVO: Manejar el inicio de sesión
loginForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    loginError.style.display = 'none';

    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const keyword = document.getElementById('loginKeyword').value;

    try {
        const response = await fetch(buildApiUrl('/login'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, keyword })
        });

        const data = await response.json();

        if (response.ok) {
            // Guardar el token secreto en el navegador
            localStorage.setItem('wikiAdminToken', data.token);
            // Limpiar formulario y mostrar la sección de subida
            loginForm.reset();
            showSection('upload');
        } else {
            loginError.innerText = data.error;
            loginError.style.display = 'block';
        }
    } catch (error) {
        loginError.innerText = "> ERROR_DE_CONEXIÓN_CON_SERVIDOR_CENTRAL";
        loginError.style.display = 'block';
    }
});

// Subir formulario (Actualizado con seguridad)
uploadForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const formData = new FormData(uploadForm);
    const submitBtn = document.querySelector('.btn-submit');
    submitBtn.innerText = "Sellando..."; submitBtn.disabled = true;

    // Recuperar el token para enviarlo como pase VIP
    const token = localStorage.getItem('wikiAdminToken');

    try {
        const response = await fetch(buildApiUrl('/lore'), {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}` // NUEVO: Enviar credencial
            },
            body: formData 
        });

        const result = await response.json();

        if (response.ok) {
            alert(`¡El conocimiento sobre "${result.title}" ha sido sellado en el pergamino!`);
            uploadForm.reset();
            showSection('search');
            searchInput.value = result.title;
            searchInput.dispatchEvent(new Event('input'));
        } else {
            alert("Error: " + result.error);
            // Si el error es por token expirado, forzar login de nuevo
            if(response.status === 403) {
                localStorage.removeItem('wikiAdminToken');
                showSection('upload'); // Esto detectará que no hay token y mostrará el login
            }
        }
    } catch (error) {
        alert("Ocurrió un error en el servidor.");
    } finally {
        submitBtn.innerText = "Sellar en el Pergamino"; submitBtn.disabled = false;
    }
});

// Botón secreto para cerrar sesión (Opcional, lo puedes poner en la consola del navegador)
window.logoutAdmin = function() {
    localStorage.removeItem('wikiAdminToken');
    alert("Sesión cerrada. Acceso revocado.");
    showSection('search');
}
