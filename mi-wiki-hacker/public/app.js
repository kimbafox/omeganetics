const searchInput = document.getElementById('searchInput');
const resultSection = document.getElementById('resultSection');
const uploadSection = document.getElementById('uploadSection');
const searchSection = document.getElementById('searchSection');
const loginSection = document.getElementById('loginSection'); // NUEVO
const uploadForm = document.getElementById('uploadForm');
const loginForm = document.getElementById('loginForm'); // NUEVO
const searchError = document.getElementById('searchError');
const loginError = document.getElementById('loginError'); // NUEVO
const recentLoreGrid = document.getElementById('recentLoreGrid');
const loreCategory = document.getElementById('loreCategory');
const loreShortDesc = document.getElementById('loreShortDesc');
const loreMetaChips = document.getElementById('loreMetaChips');
const loreDetails = document.getElementById('loreDetails');

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

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function splitValues(value) {
    return (value || '')
        .split(/\n|,/)
        .map(item => item.trim())
        .filter(Boolean);
}

function formatArchiveDate(value) {
    if (!value) return 'Fecha sin registro';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function renderLoreDescription(rawText) {
    const descContainer = document.getElementById('loreDesc');
    descContainer.innerHTML = '';

    const text = (rawText || '').replace(/\r\n/g, '\n').trim();
    if (!text) {
        const emptyParagraph = document.createElement('p');
        emptyParagraph.textContent = 'Sin descripcion disponible.';
        descContainer.appendChild(emptyParagraph);
        return;
    }

    const blocks = text.split(/\n{2,}/).map(block => block.trim()).filter(Boolean);

    blocks.forEach(block => {
        const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
        const isList = lines.length > 0 && lines.every(line => /^[-*]\s+/.test(line));

        if (isList) {
            const list = document.createElement('ul');
            lines.forEach(line => {
                const item = document.createElement('li');
                item.textContent = line.replace(/^[-*]\s+/, '');
                list.appendChild(item);
            });
            descContainer.appendChild(list);
            return;
        }

        if (lines.length === 1 && /:$/.test(lines[0])) {
            const heading = document.createElement('h3');
            heading.textContent = lines[0].replace(/:$/, '');
            descContainer.appendChild(heading);
            return;
        }

        const paragraph = document.createElement('p');
        paragraph.textContent = lines.join(' ');
        descContainer.appendChild(paragraph);
    });
}

function renderMetaChips(data) {
    loreMetaChips.innerHTML = '';
    const chips = [
        data.timeline ? `Cronologia: ${data.timeline}` : null,
        data.canon_type ? `Estado: ${data.canon_type}` : null,
        data.created_at ? `Subido: ${formatArchiveDate(data.created_at)}` : null
    ].filter(Boolean);

    chips.forEach(text => {
        const chip = document.createElement('span');
        chip.className = 'meta-chip';
        chip.textContent = text;
        loreMetaChips.appendChild(chip);
    });
}

function renderLoreDetails(data) {
    const aliases = splitValues(data.other_names);
    const appearances = splitValues(data.appearances);
    const sections = [
        {
            title: 'Identidad',
            open: true,
            content: `
                <div class="detail-grid">
                    <div>
                        <span class="detail-label">Categoria</span>
                        <p>${escapeHtml(data.category || 'Sin categoria')}</p>
                    </div>
                    <div>
                        <span class="detail-label">Estado</span>
                        <p>${escapeHtml(data.canon_type || 'Sin definir')}</p>
                    </div>
                </div>
                ${aliases.length ? `<div><span class="detail-label">Otros nombres</span><div class="token-list">${aliases.map(alias => `<span>${escapeHtml(alias)}</span>`).join('')}</div></div>` : ''}
            `
        },
        {
            title: 'Cronologia',
            content: `
                <div class="detail-grid">
                    <div>
                        <span class="detail-label">Periodo</span>
                        <p>${escapeHtml(data.timeline || 'No especificado')}</p>
                    </div>
                    <div>
                        <span class="detail-label">Fecha de carga</span>
                        <p>${escapeHtml(formatArchiveDate(data.created_at))}</p>
                    </div>
                </div>
            `
        },
        {
            title: 'Apariciones',
            content: appearances.length
                ? `<div><span class="detail-label">Registros asociados</span><div class="token-list">${appearances.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div></div>`
                : '<p class="detail-empty">Sin apariciones registradas.</p>'
        },
        {
            title: 'Notas adicionales',
            content: data.additional_notes
                ? `<p>${escapeHtml(data.additional_notes).replace(/\n/g, '<br>')}</p>`
                : '<p class="detail-empty">No hay notas adicionales.</p>'
        }
    ];

    loreDetails.innerHTML = sections.map(section => `
        <details class="info-accordion" ${section.open ? 'open' : ''}>
            <summary>${section.title}</summary>
            <div class="info-panel">${section.content}</div>
        </details>
    `).join('');
}

function renderLoreResult(data) {
    document.getElementById('loreTitle').innerText = (data.title || '').toUpperCase();
    loreCategory.textContent = data.category ? `Archivo ${data.category}` : 'Archivo de lore';
    loreShortDesc.textContent = data.short_description || 'Sin mini descripcion archivada.';
    renderMetaChips(data);
    renderLoreDetails(data);
    renderLoreDescription(data.description);

    const imgContainer = document.getElementById('loreImagesContainer');
    imgContainer.innerHTML = '';
    [data.img1, data.img2, data.img3].forEach(imgSrc => {
        if (imgSrc) {
            const img = document.createElement('img');
            img.src = normalizeImageSrc(imgSrc);
            img.alt = data.title || 'Imagen de lore';
            imgContainer.appendChild(img);
        }
    });

    resultSection.style.display = 'block';
}

async function loadLore(keyword) {
    const response = await fetch(buildApiUrl(`/lore/${encodeURIComponent(keyword)}`));
    if (!response.ok) {
        throw new Error('not_found');
    }

    const data = await response.json();
    renderLoreResult(data);
    searchError.style.display = 'none';
}

async function loadRecentLore() {
    try {
        const response = await fetch(buildApiUrl('/lore/recent'));
        if (!response.ok) {
            recentLoreGrid.innerHTML = '<div class="recent-empty">No fue posible cargar los registros recientes.</div>';
            return;
        }

        const items = await response.json();
        if (!items.length) {
            recentLoreGrid.innerHTML = '<div class="recent-empty">Todavia no hay entradas publicadas.</div>';
            return;
        }

        const [featured, ...secondary] = items;
        const renderCard = (item, variant, label) => `
            <article class="recent-card ${variant}" data-title="${escapeHtml(item.title)}">
                <div class="recent-image-wrap">
                    <img src="${escapeHtml(normalizeImageSrc(item.img1))}" alt="${escapeHtml(item.title)}">
                </div>
                <div class="recent-content">
                    <p class="recent-label">${label}</p>
                    <h3>${escapeHtml(item.title)}</h3>
                    <p class="recent-meta">${escapeHtml(item.category || 'Sin categoria')} · ${escapeHtml(formatArchiveDate(item.created_at))}</p>
                    <p>${escapeHtml(item.short_description || item.description || 'Sin resumen disponible.')}</p>
                </div>
            </article>
        `;

        recentLoreGrid.innerHTML = `
            ${renderCard(featured, 'featured', 'ULTIMO REGISTRO')}
            <div class="recent-side-column">
                ${secondary.map(item => renderCard(item, 'compact', 'ARCHIVO RECIENTE')).join('')}
            </div>
        `;

        recentLoreGrid.querySelectorAll('[data-title]').forEach(card => {
            card.addEventListener('click', async () => {
                const title = card.getAttribute('data-title');
                searchInput.value = title;
                try {
                    await loadLore(title);
                } catch (error) {
                    resultSection.style.display = 'none';
                    searchError.innerText = '> LORE_NO_ENCONTRADO_EN_LA_BASE_DE_DATOS';
                    searchError.style.display = 'block';
                }
            });
        });
    } catch (error) {
        recentLoreGrid.innerHTML = '<div class="recent-empty">No fue posible conectar con el archivo reciente.</div>';
    }
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
            await loadLore(keyword);
        } catch (error) {
            resultSection.style.display = 'none';
            searchError.innerText = '> LORE_NO_ENCONTRADO_EN_LA_BASE_DE_DATOS';
            searchError.style.display = 'block';
            console.error("Error:", error);
        }
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
            await loadRecentLore();
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

loadRecentLore();
