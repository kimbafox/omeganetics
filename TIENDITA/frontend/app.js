// ===============================
// 🔐 LOGIN
// ===============================
const API_BASE = "/api";
const UPLOADS_BASE = "/uploads";
const STOREFRONT_THEME_KEY = "tienditaTheme";
let googleLoginConfig = null;

function login() {
  return loginReal();
}

function guardarSesion(data) {
  localStorage.setItem("token", data.token);
  localStorage.setItem("rol", data.rol);

  if (data.rol === "admin") {
    window.location.href = "admin.html";
  } else {
    window.location.href = "indextienda.html";
  }
}

async function loginReal() {
  const correo = document.getElementById("correo")?.value;
  const password = document.getElementById("password")?.value;

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correo, password })
    });

    const data = await res.json();

    if (data.token) {
      guardarSesion(data);
    } else {
      alert(data.error || "Error login");
    }
  } catch (err) {
    alert("Error de conexión con el servidor");
  }
}

function setGoogleLoginStatus(message, isError = false) {
  const status = document.getElementById("googleLoginStatus");
  if (!status) return;

  status.textContent = message || "";
  status.classList.toggle("error", Boolean(message) && isError);
  status.classList.toggle("success", Boolean(message) && !isError);
}

async function loginConGoogle(credential) {
  try {
    setGoogleLoginStatus("Validando acceso con Google...");

    const res = await fetch(`${API_BASE}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential })
    });

    const data = await res.json();

    if (!res.ok || !data.token) {
      setGoogleLoginStatus(data.error || "No se pudo iniciar sesión con Google", true);
      return;
    }

    setGoogleLoginStatus("Acceso confirmado. Redirigiendo...");
    guardarSesion(data);
  } catch (err) {
    setGoogleLoginStatus("Error de conexión con el servidor", true);
  }
}

async function iniciarLoginGoogle() {
  const mount = document.getElementById("googleLoginMount");
  if (!mount) return;

  try {
    const res = await fetch(`${API_BASE}/auth/google-config`);
    googleLoginConfig = await res.json();
  } catch {
    setGoogleLoginStatus("No se pudo cargar la configuración de Google", true);
    return;
  }

  if (!googleLoginConfig?.enabled || !googleLoginConfig?.clientId) {
    setGoogleLoginStatus("Falta configurar GOOGLE_CLIENT_ID en Railway", true);
    return;
  }

  const allowedEmail = document.querySelector(".login-allowed-email");
  if (allowedEmail && googleLoginConfig.allowedEmail) {
    allowedEmail.textContent = `Cuenta permitida: ${googleLoginConfig.allowedEmail}`;
  }

  if (!window.google?.accounts?.id) {
    setGoogleLoginStatus("La librería de Google no cargó correctamente", true);
    return;
  }

  window.google.accounts.id.initialize({
    client_id: googleLoginConfig.clientId,
    callback: ({ credential }) => loginConGoogle(credential)
  });

  mount.innerHTML = "";
  window.google.accounts.id.renderButton(mount, {
    theme: "outline",
    size: "large",
    shape: "rectangular",
    text: "continue_with",
    width: 320
  });

  setGoogleLoginStatus("Usa la cuenta de Google autorizada para continuar.");
}

function cerrarSesion() {
  localStorage.removeItem("token");
  localStorage.removeItem("rol");
  window.location.href = "login.html";
}

let avisoSesionMostrado = false;

function tokenExpirado(token) {
  try {
    const payloadBase64 = token.split(".")[1];
    const payload = JSON.parse(atob(payloadBase64));
    if (!payload.exp) return false;
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
}

function manejarSesionExpirada(mensaje = "Tu sesión expiró. Inicia sesión nuevamente.") {
  if (!avisoSesionMostrado) {
    alert(mensaje);
    avisoSesionMostrado = true;
  }
  cerrarSesion();
}

function obtenerTokenValido() {
  const token = localStorage.getItem("token");
  if (!token) return null;

  if (tokenExpirado(token)) {
    manejarSesionExpirada();
    return null;
  }

  return token;
}

// ===============================
// ⬆️ SUBIR PROYECTO (REAL)
// ===============================
async function subirProyecto() {
  const nombre = document.getElementById("nombre").value;
  const categoria = document.getElementById("categoria").value;
  const descripcion = document.getElementById("descripcion")?.value || "";
  const portada = document.getElementById("portada").files[0];
  const imagenes = Array.from(document.getElementById("imagenes")?.files || []);
  const archivo = document.getElementById("archivo")?.files[0];

  if (!nombre || !categoria || !portada) {
    alert("Completa todos los campos");
    return;
  }

  if (imagenes.length > 6) {
    alert("Solo puedes subir hasta 6 imágenes adicionales");
    return;
  }

  const formData = new FormData();
  formData.append("nombre", nombre);
  formData.append("categoria", categoria);
  formData.append("descripcion", descripcion);
  formData.append("portada", portada);
  imagenes.forEach(imagen => formData.append("imagenes", imagen));
  if (archivo) {
    formData.append("archivo", archivo);
  }

  try {
    const token = obtenerTokenValido();

    if (!token) {
      alert("Debes iniciar sesión");
      window.location.href = "login.html";
      return;
    }

    const res = await fetch(`${API_BASE}/proyectos/subir`, {
      method: "POST",
      headers: { "Authorization": token },
      body: formData
    });

    if (res.status === 401 || res.status === 403) {
      manejarSesionExpirada("Sesión inválida para subir proyecto");
      return;
    }

    const data = await res.json();

    if (data.ok) {
      alert("Proyecto subido correctamente");
      window.location.href = "indextienda.html";
    } else {
      alert("Error al subir");
    }
  } catch (err) {
    alert("Error de conexión con el servidor");
  }
}

function buildUploadUrl(fileName) {
  return `${UPLOADS_BASE}/${encodeURIComponent(fileName)}`;
}

let proyectosCache = [];

function obtenerImagenesProyecto(proyecto) {
  return [proyecto?.portada, ...(Array.isArray(proyecto?.imagenes) ? proyecto.imagenes : [])]
    .filter(Boolean);
}

function resumenTexto(texto, max = 90) {
  if (!texto) return "Sin descripción";
  return texto.length > max ? `${texto.slice(0, max).trim()}...` : texto;
}

function formatearCategoria(categoria) {
  const categorias = {
    omegacraft: "Omegacraft",
    herramientas: "Herramientas",
    juegos: "Juegos",
    libros: "Libros"
  };

  return categorias[categoria] || categoria || "Sin categoría";
}

function tarjetaProyectoHTML(p) {
  const imagenes = obtenerImagenesProyecto(p);
  const resumen = resumenTexto(p.descripcion, 180);
  const imagenesSlides = imagenes
    .map((imagen, index) => `
      <figure class="card-slide ${index === 0 ? "active" : ""}" data-slide-index="${index}">
        <img class="card-portada" src="${buildUploadUrl(imagen)}" alt="Vista ${index + 1} de ${p.nombre}">
      </figure>
    `)
    .join("");
  const indicadores = imagenes
    .map((_, index) => `
      <button class="card-indicador ${index === 0 ? "active" : ""}" type="button" aria-label="Ir a la imagen ${index + 1}" data-card-go="${index}"></button>
    `)
    .join("");
  const textoBoton = p.archivo ? "Ver e instalar" : "Ver producto";
  const textoGaleria = imagenes.length > 1
    ? `${imagenes.length} vistas disponibles`
    : "Vista única";

  return `
    <article class="card-proyecto">
      <div class="card-imagen-wrap" data-card-carousel>
        <div class="card-slides">
          ${imagenesSlides}
        </div>
        ${imagenes.length > 1 ? `
          <button class="card-carousel-btn prev" type="button" aria-label="Imagen anterior" data-card-prev>
            <span aria-hidden="true">&#8249;</span>
          </button>
          <button class="card-carousel-btn next" type="button" aria-label="Imagen siguiente" data-card-next>
            <span aria-hidden="true">&#8250;</span>
          </button>
        ` : ""}
        <div class="card-indicadores" aria-label="Galería del producto">
          ${indicadores}
        </div>
      </div>
      <div class="card-contenido">
        <div class="card-cabecera">
          <p class="card-categoria">${formatearCategoria(p.categoria)}</p>
          <small class="card-fecha">${new Date(p.fecha).toLocaleDateString()}</small>
        </div>
        <h3 class="card-titulo">${p.nombre}</h3>
        <p class="card-descripcion">${resumen}</p>
        <div class="card-footer">
          <p class="card-resumen-extra">${textoGaleria}</p>
          <button class="btn btn-ver-detalle" data-id="${p.id}">${textoBoton}</button>
        </div>
      </div>
    </article>
  `;
}

function actualizarCarruselTarjeta(card, nextIndex) {
  if (!card) return;

  const slides = Array.from(card.querySelectorAll(".card-slide"));
  const indicadores = Array.from(card.querySelectorAll(".card-indicador"));

  if (!slides.length) return;

  const total = slides.length;
  const indexNormalizado = ((nextIndex % total) + total) % total;

  card.dataset.currentSlide = String(indexNormalizado);

  slides.forEach((slide, index) => {
    slide.classList.toggle("active", index === indexNormalizado);
  });

  indicadores.forEach((indicador, index) => {
    indicador.classList.toggle("active", index === indexNormalizado);
  });
}

function moverCarruselTarjeta(control, delta) {
  const card = control.closest(".card-proyecto");
  if (!card) return;

  const current = Number(card.dataset.currentSlide || 0);
  actualizarCarruselTarjeta(card, current + delta);
}

function obtenerProyectoPorId(id) {
  return proyectosCache.find(p => String(p.id) === String(id));
}

function crearModalProyectoSiNoExiste() {
  if (document.getElementById("modalProyecto")) return;

  const modal = document.createElement("div");
  modal.id = "modalProyecto";
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-contenido" role="dialog" aria-modal="true" aria-label="Detalle del proyecto">
      <button class="btn modal-cerrar" data-cerrar-modal="true">Cerrar</button>
      <div id="modalProyectoBody"></div>
    </div>
  `;

  document.body.appendChild(modal);
}

function abrirDetalleProyecto(id) {
  const proyecto = obtenerProyectoPorId(id);
  const modal = document.getElementById("modalProyecto");
  const body = document.getElementById("modalProyectoBody");

  if (!proyecto || !modal || !body) return;

  const archivoBoton = proyecto.archivo
    ? `<a class="btn btn-descargar" href="${buildUploadUrl(proyecto.archivo)}" download>Instalar ahora</a>`
    : `<span class="sin-archivo">Este producto no incluye archivo descargable.</span>`;
  const descripcion = proyecto.descripcion || "Sin descripcion";
  const resumen = resumenTexto(descripcion, 220);
  const imagenes = obtenerImagenesProyecto(proyecto);
  const galeria = imagenes
    .filter(Boolean)
    .map((imagen, index) => `
      <button class="galeria-thumb ${index === 0 ? "active" : ""}" type="button" data-galeria-src="${buildUploadUrl(imagen)}">
        <img src="${buildUploadUrl(imagen)}" alt="Vista ${index + 1} de ${proyecto.nombre}">
      </button>
    `)
    .join("");

  body.innerHTML = `
    <div class="modal-grid">
      <div class="modal-imagen-wrap">
        <div class="modal-hero-media">
          <img id="modalImagenPrincipal" class="modal-portada" src="${buildUploadUrl(proyecto.portada)}" alt="Portada de ${proyecto.nombre}">
        </div>
        <div class="galeria-thumbs">${galeria}</div>
      </div>

      <div class="modal-info">
        <div class="modal-header-copy">
          <p class="modal-kicker">${formatearCategoria(proyecto.categoria)}</p>
          <h2>${proyecto.nombre}</h2>
          <p class="modal-fecha">Publicado el ${new Date(proyecto.fecha).toLocaleDateString()}</p>
        </div>
        <div class="modal-resumen-box">
          <span class="modal-label">Resumen</span>
          <p class="modal-resumen">${resumen}</p>
        </div>
        <div class="modal-detalle-box">
          <span class="modal-label">Descripción completa</span>
          <p class="modal-descripcion">${descripcion}</p>
        </div>
        <div class="acciones-proyecto">${archivoBoton}</div>
      </div>
    </div>
  `;

  modal.classList.add("visible");
}

function cerrarDetalleProyecto() {
  const modal = document.getElementById("modalProyecto");
  if (!modal) return;
  modal.classList.remove("visible");
}

function pintarProyectos(data) {
  const cont = document.getElementById("proyectos");
  if (!cont) return;

  const lista = Array.isArray(data) ? data : [];

  if (lista.length === 0) {
    cont.innerHTML = `
      <div class="empty-state">
        <h3>No hay reliquias disponibles</h3>
        <p>Pronto aparecerán nuevos proyectos en este reino.</p>
      </div>
    `;
    return;
  }

  cont.innerHTML = lista.map(tarjetaProyectoHTML).join("");
}

function actualizarBotonesFiltro(cat) {
  document.querySelectorAll(".filtro-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.cat === cat);
  });
}

// ===============================
// 📦 CARGAR PROYECTOS DESDE DB
// ===============================
async function cargar() {
  const cont = document.getElementById("proyectos");
  if (!cont) return;

  cont.innerHTML = `
    <div class="empty-state loading-state">
      <h3>Cargando catálogo...</h3>
      <p>Invocando reliquias del reino.</p>
    </div>
  `;

  try {
    const res = await fetch(`${API_BASE}/proyectos/listar`);
    const data = await res.json();

    proyectosCache = Array.isArray(data)
      ? [...data].sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      : [];

    actualizarBotonesFiltro("todos");
    pintarProyectos(proyectosCache);

  } catch (err) {
    cont.innerHTML = `
      <div class="empty-state">
        <h3>Error cargando proyectos</h3>
        <p>Hubo un problema al conectar con el servidor.</p>
      </div>
    `;
  }
}

// ===============================
// 🔍 FILTRAR (FRONTEND)
// ===============================
async function filtrar(cat) {
  actualizarBotonesFiltro(cat);

  if (!proyectosCache.length) {
    try {
      const res = await fetch(`${API_BASE}/proyectos/listar`);
      const data = await res.json();
      proyectosCache = Array.isArray(data) ? data : [];
    } catch {
      pintarProyectos([]);
      return;
    }
  }

  const filtrados = cat === "todos"
    ? proyectosCache
    : proyectosCache.filter(p => p.categoria === cat);

  pintarProyectos(filtrados);
}

function actualizarNavAdmin() {
  const btnAdmin = document.getElementById("btnAdmin");
  const btnEntrar = document.getElementById("btnEntrar");
  const btnLogout = document.getElementById("btnLogout");
  const token = obtenerTokenValido();
  const isAdmin = localStorage.getItem("rol") === "admin";

  if (btnAdmin) {
    btnAdmin.style.display = isAdmin ? "inline-block" : "none";
  }

  if (btnEntrar) {
    btnEntrar.style.display = token ? "none" : "inline-block";
  }

  if (btnLogout) {
    btnLogout.style.display = token ? "inline-block" : "none";
  }
}

function protegerVistaSubir() {
  const path = window.location.pathname.toLowerCase();
  const esVistaSubir = path.endsWith("/subir.html") || path.endsWith("subir.html");

  if (!esVistaSubir) return;

  const token = obtenerTokenValido();
  const rol = localStorage.getItem("rol");

  if (!token || rol !== "admin") {
    alert("Solo admin puede entrar a subir proyectos");
    window.location.href = "login.html";
  }
}

function actualizarEstadoLoginPage() {
  const path = window.location.pathname.toLowerCase();
  const esLogin = path.endsWith("/login.html") || path.endsWith("login.html");
  if (!esLogin) return;

  const token = localStorage.getItem("token");
  const mensaje = document.getElementById("sesionActiva");
  const btnLogoutLogin = document.getElementById("btnLogoutLogin");
  const btnIngresar = document.getElementById("btnIngresar");

  if (!token) return;

  if (tokenExpirado(token)) {
    localStorage.removeItem("token");
    localStorage.removeItem("rol");
    return;
  }

  if (mensaje) {
    mensaje.style.display = "block";
    mensaje.innerText = "Ya tienes una sesión activa.";
  }

  if (btnLogoutLogin) {
    btnLogoutLogin.style.display = "inline-block";
  }

  if (btnIngresar) {
    btnIngresar.style.display = "none";
  }
}

// ===============================
// 🖼️ PREVIEW
// ===============================
function previewPortada() {
  const file = document.getElementById("portada").files[0];
  const img = document.getElementById("imgPreview");
  const descripcion = document.getElementById("descripcion")?.value || "";
  const descripcionPreview = document.getElementById("descripcionPreview");

  if (file) {
    img.src = URL.createObjectURL(file);
  }

  document.getElementById("tituloPreview").innerText =
    document.getElementById("nombre").value || "Nombre del proyecto";

  document.getElementById("fechaPreview").innerText =
    "Fecha: " + new Date().toLocaleDateString();

  if (descripcionPreview) {
    descripcionPreview.innerText = descripcion || "Añade una descripción amplia para ver cómo se mostrará la ficha.";
  }
}

function previewGaleria() {
  const files = Array.from(document.getElementById("imagenes")?.files || []);
  const cont = document.getElementById("galeriaPreview");

  if (!cont) return;

  if (!files.length) {
    cont.innerHTML = "";
    return;
  }

  cont.innerHTML = files.slice(0, 6).map(file => `
    <div class="preview-gallery-item">
      <img src="${URL.createObjectURL(file)}" alt="Vista previa ${file.name}">
    </div>
  `).join("");
}

// ===============================
// 🎞️ CARRUSEL
// ===============================
function iniciarCarrusel() {
  const slides = document.querySelectorAll(".slide");

  if (slides.length === 0) return;

  let index = 0;

  setInterval(() => {
    slides[index].classList.remove("active");
    index = (index + 1) % slides.length;
    slides[index].classList.add("active");
  }, 4000);
}

function aplicarTemaTienda(theme = "default") {
  const body = document.body;
  if (!body || !body.classList.contains("storefront-page")) return;

  const useCrimson = theme === "crimson";
  body.classList.toggle("theme-crimson", useCrimson);

  const toggle = document.getElementById("logoThemeToggle");
  if (toggle) {
    toggle.setAttribute("aria-pressed", String(useCrimson));
  }
}

function alternarTemaTienda() {
  const body = document.body;
  if (!body || !body.classList.contains("storefront-page")) return;

  const nextTheme = body.classList.contains("theme-crimson") ? "default" : "crimson";
  aplicarTemaTienda(nextTheme);
  localStorage.setItem(STOREFRONT_THEME_KEY, nextTheme);
}

// ===============================
// 🚀 INICIO
// ===============================
document.addEventListener("DOMContentLoaded", () => {
  actualizarEstadoLoginPage();
  protegerVistaSubir();
  crearModalProyectoSiNoExiste();
  iniciarLoginGoogle();
  aplicarTemaTienda(localStorage.getItem(STOREFRONT_THEME_KEY) || "default");

  const logoThemeToggle = document.getElementById("logoThemeToggle");
  if (logoThemeToggle) {
    logoThemeToggle.addEventListener("click", alternarTemaTienda);
  }

  document.addEventListener("click", (e) => {
    const prevBtn = e.target.closest("[data-card-prev]");
    if (prevBtn) {
      moverCarruselTarjeta(prevBtn, -1);
      return;
    }

    const nextBtn = e.target.closest("[data-card-next]");
    if (nextBtn) {
      moverCarruselTarjeta(nextBtn, 1);
      return;
    }

    const indicador = e.target.closest("[data-card-go]");
    if (indicador) {
      const card = indicador.closest(".card-proyecto");
      actualizarCarruselTarjeta(card, Number(indicador.dataset.cardGo || 0));
      return;
    }

    const trigger = e.target.closest(".btn-ver-detalle");
    if (trigger) {
      abrirDetalleProyecto(trigger.dataset.id);
      return;
    }

    const galeriaBtn = e.target.closest("[data-galeria-src]");
    if (galeriaBtn) {
      const principal = document.getElementById("modalImagenPrincipal");
      if (principal) {
        principal.src = galeriaBtn.dataset.galeriaSrc;
      }

      document.querySelectorAll(".galeria-thumb").forEach(btn => btn.classList.remove("active"));
      galeriaBtn.classList.add("active");
      return;
    }

    if (e.target.matches("[data-cerrar-modal='true']") || e.target.id === "modalProyecto") {
      cerrarDetalleProyecto();
    }
  });

  const nombreInput = document.getElementById("nombre");
  const descripcionInput = document.getElementById("descripcion");

  if (nombreInput) {
    nombreInput.addEventListener("input", previewPortada);
  }

  if (descripcionInput) {
    descripcionInput.addEventListener("input", previewPortada);
  }

  cargar();
  iniciarCarrusel();
  actualizarNavAdmin();
});
