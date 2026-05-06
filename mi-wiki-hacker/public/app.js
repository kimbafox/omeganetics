const searchInput = document.getElementById('searchInput');
const resultSection = document.getElementById('resultSection');
const uploadSection = document.getElementById('uploadSection');
const searchSection = document.getElementById('searchSection');
const loginSection = document.getElementById('loginSection');
const uploadForm = document.getElementById('uploadForm');
const searchError = document.getElementById('searchError');
const loginError = document.getElementById('loginError');
const recentLoreGrid = document.getElementById('recentLoreGrid');
const sealedCarouselTrack = document.getElementById('sealedCarouselTrack');
const adminLoreActions = document.getElementById('adminLoreActions');
const editLoreButton = document.getElementById('editLoreButton');
const loreCategory = document.getElementById('loreCategory');
const loreShortDesc = document.getElementById('loreShortDesc');
const loreMetaChips = document.getElementById('loreMetaChips');
const loreDetails = document.getElementById('loreDetails');
const googleLoginMount = document.getElementById('googleLoginMount');
const googleLoginHint = document.getElementById('googleLoginHint');
const uploadSectionTitle = document.getElementById('uploadSectionTitle');
const uploadGuide = document.getElementById('uploadGuide');
const editLoreId = document.getElementById('editLoreId');
const formTitle = document.getElementById('formTitle');
const formCategory = document.getElementById('formCategory');
const formCanonType = document.getElementById('formCanonType');
const formShortDesc = document.getElementById('formShortDesc');
const formTimeline = document.getElementById('formTimeline');
const formOtherNames = document.getElementById('formOtherNames');
const formAppearances = document.getElementById('formAppearances');
const formDesc = document.getElementById('formDesc');
const formAdditionalNotes = document.getElementById('formAdditionalNotes');
const img1Input = document.getElementById('img1');
const img2Input = document.getElementById('img2');
const img3Input = document.getElementById('img3');
const img1Label = document.getElementById('img1Label');
const editImageHint = document.getElementById('editImageHint');
const cancelEditButton = document.getElementById('cancelEditButton');
const submitButton = document.querySelector('.btn-submit');
const imagePreviewSection = document.getElementById('imagePreviewSection');
const imagePreviewGrid = document.getElementById('imagePreviewGrid');

const BASE_PATH = window.location.pathname.startsWith('/wiki') ? '/wiki' : '';
let authConfig = {
    googleClientId: '',
    adminEmail: 'juegocrisger@gmail.com'
};
let googleInitialized = false;
let sealedCarouselAnimationId = null;
let activeLoreRecord = null;

function renderImagePreviews(currentLore = null) {
    const previewItems = [];
    const inputConfig = [
        { input: img1Input, key: 'img1', label: 'Imagen principal' },
        { input: img2Input, key: 'img2', label: 'Imagen adicional 1' },
        { input: img3Input, key: 'img3', label: 'Imagen adicional 2' }
    ];

    inputConfig.forEach(({ input, key, label }) => {
        const selectedFile = input.files && input.files[0] ? input.files[0] : null;
        if (selectedFile) {
            previewItems.push({
                src: URL.createObjectURL(selectedFile),
                title: label,
                subtitle: `Nueva seleccion: ${selectedFile.name}`,
                revoke: true
            });
            return;
        }

        if (currentLore && currentLore[key]) {
            previewItems.push({
                src: normalizeImageSrc(currentLore[key]),
                title: label,
                subtitle: 'Imagen actual del sellado',
                revoke: false
            });
        }
    });

    if (!previewItems.length) {
        imagePreviewGrid.innerHTML = '';
        imagePreviewSection.style.display = 'none';
        return;
    }

    imagePreviewGrid.innerHTML = previewItems.map(item => `
        <article class="image-preview-card">
            <img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.title)}">
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(item.subtitle)}</span>
        </article>
    `).join('');
    imagePreviewSection.style.display = 'block';

    previewItems.forEach(item => {
        if (!item.revoke) {
            return;
        }

        const previewImage = imagePreviewGrid.querySelector(`img[src="${CSS.escape(item.src)}"]`);
        if (previewImage) {
            previewImage.addEventListener('load', () => URL.revokeObjectURL(item.src), { once: true });
        }
    });
}

function buildApiUrl(endpoint) {
    return `${BASE_PATH}/api${endpoint}`;
}

function decodeTokenPayload(token) {
    try {
        const payload = token.split('.')[1];
        if (!payload) return null;
        return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    } catch (error) {
        return null;
    }
}

function getStoredAdminToken() {
    const token = localStorage.getItem('wikiAdminToken');
    if (!token) return null;

    const payload = decodeTokenPayload(token);
    if (!payload || payload.role !== 'admin' || !payload.exp || Date.now() >= payload.exp * 1000) {
        localStorage.removeItem('wikiAdminToken');
        return null;
    }

    return token;
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
    activeLoreRecord = data;
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
    adminLoreActions.style.display = getStoredAdminToken() ? 'flex' : 'none';
}

function resetUploadFormMode() {
    uploadForm.reset();
    editLoreId.value = '';
    uploadSectionTitle.textContent = 'Añadir Nuevo Conocimiento al Pergamino';
    uploadGuide.textContent = 'Guia breve: completa lo esencial, resume en pocas lineas y agrega la imagen principal.';
    img1Input.required = true;
    img1Label.textContent = 'Imagen Principal (Obligatoria):';
    editImageHint.style.display = 'none';
    cancelEditButton.style.display = 'none';
    submitButton.textContent = 'Sellar en el Pergamino';
    renderImagePreviews(null);
}

function fillUploadFormForEdit(data) {
    editLoreId.value = data.id || '';
    formTitle.value = data.title || '';
    formCategory.value = data.category || '';
    formCanonType.value = data.canon_type || '';
    formShortDesc.value = data.short_description || '';
    formTimeline.value = data.timeline || '';
    formOtherNames.value = data.other_names || '';
    formAppearances.value = data.appearances || '';
    formDesc.value = data.description || '';
    formAdditionalNotes.value = data.additional_notes || '';
    img1Input.required = false;
    img1Label.textContent = 'Imagen Principal (Opcional al editar):';
    uploadSectionTitle.textContent = `Editar Sellado: ${data.title || ''}`;
    uploadGuide.textContent = 'Modo edicion: actualiza el registro y reemplaza imagenes solo si subes archivos nuevos.';
    editImageHint.style.display = 'block';
    cancelEditButton.style.display = 'inline-flex';
    submitButton.textContent = 'Guardar cambios del sellado';
    renderImagePreviews(data);
}

function beginLoreEdit() {
    if (!activeLoreRecord || !getStoredAdminToken()) {
        return;
    }

    resetUploadFormMode();
    fillUploadFormForEdit(activeLoreRecord);
    showSection('upload');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openLoreFromTitle(title) {
    searchInput.value = title;
    searchInput.dispatchEvent(new Event('input'));
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

function stopSealedCarouselAnimation() {
    if (sealedCarouselAnimationId) {
        cancelAnimationFrame(sealedCarouselAnimationId);
        sealedCarouselAnimationId = null;
    }
}

function startSealedCarouselAnimation() {
    stopSealedCarouselAnimation();

    if (!sealedCarouselTrack || sealedCarouselTrack.children.length < 2) {
        return;
    }

    let offset = 0;
    let lastTime = null;

    const tick = (timestamp) => {
        if (lastTime === null) {
            lastTime = timestamp;
        }

        const delta = timestamp - lastTime;
        lastTime = timestamp;
        offset += delta * 0.006;
        const loopWidth = sealedCarouselTrack.scrollWidth / 2;
        if (loopWidth > 0 && offset >= loopWidth) {
            offset -= loopWidth;
        }

        sealedCarouselTrack.style.transform = `translateX(${-offset}px)`;
        sealedCarouselAnimationId = requestAnimationFrame(tick);
    };

    sealedCarouselAnimationId = requestAnimationFrame(tick);
}

async function loadSealedCarousel() {
    if (!sealedCarouselTrack) {
        return;
    }

    try {
        const response = await fetch(buildApiUrl('/lore/sealed-carousel'));
        if (!response.ok) {
            sealedCarouselTrack.innerHTML = '<div class="sealed-carousel-empty">No fue posible abrir el carrusel de sellados.</div>';
            stopSealedCarouselAnimation();
            return;
        }

        const items = await response.json();
        if (!items.length) {
            sealedCarouselTrack.innerHTML = '<div class="sealed-carousel-empty">Aun no hay imagenes selladas para mostrar.</div>';
            stopSealedCarouselAnimation();
            return;
        }

        const cards = items.map(item => `
            <article class="sealed-carousel-card" data-title="${escapeHtml(item.title)}">
                <img src="${escapeHtml(normalizeImageSrc(item.img1))}" alt="${escapeHtml(item.title)}">
                <div class="sealed-carousel-overlay">
                    <strong>${escapeHtml(item.title)}</strong>
                    <span>${escapeHtml(item.category || 'Archivo')}</span>
                </div>
            </article>
        `).join('');

        sealedCarouselTrack.innerHTML = `${cards}${cards}`;
        sealedCarouselTrack.querySelectorAll('[data-title]').forEach(card => {
            card.addEventListener('click', () => {
                const title = card.getAttribute('data-title');
                openLoreFromTitle(title);
            });
        });

        startSealedCarouselAnimation();
    } catch (error) {
        sealedCarouselTrack.innerHTML = '<div class="sealed-carousel-empty">No fue posible conectar con el archivo rotativo.</div>';
        stopSealedCarouselAnimation();
    }
}

function updateGoogleLoginHint(message, isError = false) {
    googleLoginHint.textContent = message;
    googleLoginHint.classList.toggle('is-error', isError);
}

async function handleGoogleCredentialResponse(googleResponse) {
    loginError.style.display = 'none';
    updateGoogleLoginHint('Validando cuenta...');

    try {
        const response = await fetch(buildApiUrl('/login/google'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: googleResponse.credential })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || '> ACCESO_DENEGADO');
        }

        localStorage.setItem('wikiAdminToken', data.token);
        updateGoogleLoginHint(`Sesion admin activa: ${data.email}`);
        showSection('upload');
    } catch (error) {
        localStorage.removeItem('wikiAdminToken');
        loginError.innerText = error.message || '> NO_SE_PUDO_VALIDAR_LA_CUENTA';
        loginError.style.display = 'block';
        updateGoogleLoginHint(`Admin permitido: ${authConfig.adminEmail}`, true);
    }
}

async function initGoogleLogin() {
    try {
        const response = await fetch(buildApiUrl('/auth-config'));
        const data = await response.json();
        authConfig = {
            googleClientId: data.googleClientId || '',
            adminEmail: data.adminEmail || authConfig.adminEmail
        };
    } catch (error) {
        updateGoogleLoginHint('No se pudo cargar la configuracion de acceso.', true);
        return;
    }

    if (!authConfig.googleClientId) {
        updateGoogleLoginHint('Falta GOOGLE_CLIENT_ID en el servidor.', true);
        return;
    }

    if (!window.google || !window.google.accounts || !window.google.accounts.id) {
        updateGoogleLoginHint('Google Sign-In no esta disponible en este navegador.', true);
        return;
    }

    if (!googleInitialized) {
        window.google.accounts.id.initialize({
            client_id: authConfig.googleClientId,
            callback: handleGoogleCredentialResponse
        });
        googleInitialized = true;
    }

    googleLoginMount.innerHTML = '';
    window.google.accounts.id.renderButton(googleLoginMount, {
        theme: 'filled_black',
        size: 'large',
        shape: 'rectangular',
        text: 'continue_with',
        width: 320
    });
    updateGoogleLoginHint(`Admin permitido: ${authConfig.adminEmail}`);
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
        const token = getStoredAdminToken();
        if (token) {
            uploadSection.style.display = 'block';
        } else {
            resetUploadFormMode();
            loginSection.style.display = 'flex';
            initGoogleLogin();
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

// Subir formulario (Actualizado con seguridad)
uploadForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const formData = new FormData(uploadForm);
    const loreId = editLoreId.value.trim();
    const isEditing = Boolean(loreId);
    const submitBtn = submitButton;
    submitBtn.innerText = "Sellando..."; submitBtn.disabled = true;

    // Recuperar el token para enviarlo como pase VIP
    const token = getStoredAdminToken();

    try {
        if (!token) {
            alert('Inicia sesion con Google como administrador.');
            showSection('upload');
            return;
        }

        const response = await fetch(buildApiUrl(isEditing ? `/lore/${encodeURIComponent(loreId)}` : '/lore'), {
            method: isEditing ? 'PUT' : 'POST',
            headers: {
                'Authorization': `Bearer ${token}` // NUEVO: Enviar credencial
            },
            body: formData 
        });

        const result = await response.json();

        if (response.ok) {
            alert(isEditing
                ? `Los cambios de "${result.title}" fueron actualizados en el pergamino.`
                : `¡El conocimiento sobre "${result.title}" ha sido sellado en el pergamino!`);
            resetUploadFormMode();
            await loadRecentLore();
            await loadSealedCarousel();
            showSection('search');
            openLoreFromTitle(result.title);
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
        submitBtn.innerText = editLoreId.value.trim() ? 'Guardar cambios del sellado' : 'Sellar en el Pergamino';
        submitBtn.disabled = false;
    }
});

editLoreButton.addEventListener('click', beginLoreEdit);

cancelEditButton.addEventListener('click', () => {
    resetUploadFormMode();
    showSection('search');
});

[img1Input, img2Input, img3Input].forEach(input => {
    input.addEventListener('change', () => {
        renderImagePreviews(editLoreId.value.trim() ? activeLoreRecord : null);
    });
});

// Botón secreto para cerrar sesión (Opcional, lo puedes poner en la consola del navegador)
window.logoutAdmin = function() {
    localStorage.removeItem('wikiAdminToken');
    adminLoreActions.style.display = 'none';
    resetUploadFormMode();
    alert("Sesión cerrada. Acceso revocado.");
    showSection('search');
}

resetUploadFormMode();
initGoogleLogin();
loadRecentLore();
loadSealedCarousel();
