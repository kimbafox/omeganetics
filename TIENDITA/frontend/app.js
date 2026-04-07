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
        window.location.href = "index.html";
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
  const archivo = document.getElementById("archivo")?.files[0];

  if (!nombre || !categoria || !portada) {
    alert("Completa todos los campos");
    return;
  }

  const formData = new FormData();
  formData.append("nombre", nombre);
  formData.append("categoria", categoria);
  formData.append("descripcion", descripcion);
  formData.append("portada", portada);
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
      alert("Proyecto subido 🔥");
      window.location.href = "index.html";
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
  if (!texto) return "Sin descripcion";
  return texto.length > max ? `${texto.slice(0, max).trim()}...` : texto;
}

function tarjetaProyectoHTML(p) {
  const portadaUrl = buildUploadUrl(p.portada);

  return `
    <article class="card-proyecto">
      <div class="card-imagen-wrap">
        <img class="card-portada" src="${portadaUrl}" alt="Portada de ${p.nombre}">
      </div>
      <h3 class="card-titulo">${p.nombre}</h3>
      <p class="card-categoria">${p.categoria}</p>
      <p class="card-descripcion">${resumenTexto(p.descripcion)}</p>
      <small>${new Date(p.fecha).toLocaleDateString()}</small>
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

  body.innerHTML = `
    <div class="modal-grid">
      <div class="modal-imagen-wrap">
        <img class="modal-portada" src="${buildUploadUrl(proyecto.portada)}" alt="Portada de ${proyecto.nombre}">
      </div>

      <div class="modal-info">
        <h2>${proyecto.nombre}</h2>
        <p><strong>Categoria:</strong> ${proyecto.categoria}</p>
        <p><strong>Fecha:</strong> ${new Date(proyecto.fecha).toLocaleDateString()}</p>
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

  proyectosCache = data;

  cont.innerHTML = "";

  data.forEach(p => {
    cont.innerHTML += tarjetaProyectoHTML(p);
  });
}

// ===============================
// 📦 CARGAR PROYECTOS DESDE DB
// ===============================
async function cargar() {
  const cont = document.getElementById("proyectos");
  if (!cont) return;

  try {
    const res = await fetch(`${API_BASE}/proyectos/listar`);
    const data = await res.json();
    pintarProyectos(data);

  } catch (err) {
    cont.innerHTML = "<p>Error cargando proyectos</p>";
  }
}

// ===============================
// 🔍 FILTRAR (FRONTEND)
// ===============================
async function filtrar(cat) {
  const res = await fetch(`${API_BASE}/proyectos/listar`);
  const data = await res.json();

  let filtrados = data;

  if (cat !== "todos") {
    filtrados = data.filter(p => p.categoria === cat);
  }

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

  if (file) {
    img.src = URL.createObjectURL(file);
  }

  document.getElementById("tituloPreview").innerText =
    document.getElementById("nombre").value || "Nombre del proyecto";

  document.getElementById("fechaPreview").innerText =
    "Fecha: " + new Date().toLocaleDateString();
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

    if (e.target.matches("[data-cerrar-modal='true']") || e.target.id === "modalProyecto") {
      cerrarDetalleProyecto();
    }
  });

  cargar();
  iniciarCarrusel();
  actualizarNavAdmin();
});