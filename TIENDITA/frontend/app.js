// ===============================
// 🔐 LOGIN
// ===============================
const API_BASE = "/api";
const UPLOADS_BASE = "/uploads";

function login() {
  return loginReal();
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
      localStorage.setItem("token", data.token);
      localStorage.setItem("rol", data.rol);

      if (data.rol === "admin") {
        window.location.href = "admin.html";
      } else {
        window.location.href = "indextienda.html";
      }
    } else {
      alert(data.error || "Error login");
    }
  } catch (err) {
    alert("Error de conexión con el servidor");
  }
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
  const portadaUrl = buildUploadUrl(p.portada);
  const imagenes = Array.isArray(p.imagenes) ? p.imagenes : [];
  const resumen = resumenTexto(p.descripcion, 180);

  return `
    <article class="card-proyecto">
      <div class="card-imagen-wrap">
        <img class="card-portada" src="${portadaUrl}" alt="Portada de ${p.nombre}">
      </div>
      <h3 class="card-titulo">${p.nombre}</h3>
      <p class="card-categoria">${formatearCategoria(p.categoria)}</p>
      <p class="card-descripcion">${resumen}</p>
      <p class="card-resumen-extra">${imagenes.length} imagen${imagenes.length === 1 ? "" : "es"} en galería</p>
      <small class="card-fecha">${new Date(p.fecha).toLocaleDateString()}</small>
      <button class="btn btn-ver-detalle" data-id="${p.id}">Ver proyecto</button>
    </article>
  `;
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
    ? `<a class="btn btn-descargar" href="${buildUploadUrl(proyecto.archivo)}" download>Descargar archivo</a>`
    : `<span class="sin-archivo">Sin archivo adjunto</span>`;
  const galeria = [proyecto.portada, ...(Array.isArray(proyecto.imagenes) ? proyecto.imagenes : [])]
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
        <img id="modalImagenPrincipal" class="modal-portada" src="${buildUploadUrl(proyecto.portada)}" alt="Portada de ${proyecto.nombre}">
        <div class="galeria-thumbs">${galeria}</div>
      </div>

      <div class="modal-info">
        <h2>${proyecto.nombre}</h2>
        <p><strong>Categoria:</strong> ${formatearCategoria(proyecto.categoria)}</p>
        <p><strong>Fecha:</strong> ${new Date(proyecto.fecha).toLocaleDateString()}</p>
        <p><strong>Resumen:</strong> ${resumenTexto(proyecto.descripcion, 240)}</p>
        <p><strong>Descripcion:</strong></p>
        <p class="modal-descripcion">${proyecto.descripcion || "Sin descripcion"}</p>
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

// ===============================
// 🚀 INICIO
// ===============================
document.addEventListener("DOMContentLoaded", () => {
  actualizarEstadoLoginPage();
  protegerVistaSubir();
  crearModalProyectoSiNoExiste();

  document.addEventListener("click", (e) => {
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
