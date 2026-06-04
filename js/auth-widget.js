// Menú hamburguesa para móvil: inyecta el botón y abre/cierra la navegación.
(function () {
  const header = document.querySelector("header.header");
  if (!header) return;
  const nav = header.querySelector("nav");
  if (!nav || header.querySelector(".nav-toggle-btn")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "nav-toggle-btn";
  btn.setAttribute("aria-label", "Abrir menú");
  btn.innerHTML = "<span></span><span></span><span></span>";
  header.insertBefore(btn, nav);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    header.classList.toggle("nav-open");
  });
  document.addEventListener("click", (e) => {
    if (!header.contains(e.target)) header.classList.remove("nav-open");
  });
})();

// Convierte el botón "Login" (#navLogin) en un menú de usuario cuando hay sesión.
(async function () {
  const slot = document.getElementById("navLogin");
  if (!slot) return;

  let me = null;
  try {
    const res = await fetch("/api/auth/me");
    if (res.ok) me = await res.json();
  } catch (e) {
    return;
  }
  if (!me) return; // sin sesión: se queda el botón "Login"

  // Estado de creador (para mostrar "Subir contenido" si está aprobado).
  let creatorStatus = "none";
  try {
    const cr = await fetch("/api/creadores/mi-estado");
    if (cr.ok) creatorStatus = (await cr.json()).status || "none";
  } catch (e) {
    /* noop */
  }

  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const name = me.globalName || me.username || "Cuenta";
  const li = slot.closest("li") || slot;

  const wrap = document.createElement("div");
  wrap.className = "user-menu";
  wrap.innerHTML = `
    <button class="user-menu-btn" type="button" aria-haspopup="true" aria-expanded="false">
      ${me.avatar ? `<img src="${esc(me.avatar)}" class="user-menu-avatar" alt="">` : ""}
      <span class="user-menu-name">${esc(name)}</span>
      ${me.isAdmin ? '<span class="user-menu-badge">admin</span>' : ""}
      <span class="user-menu-caret">▾</span>
    </button>
    <div class="user-menu-dropdown" role="menu" hidden>
      <div class="user-menu-head">@${esc(me.username || "")}</div>
      <a role="menuitem" href="/perfil.html">Ver perfil</a>
      <a role="menuitem" href="/perfil.html#actividad">Mi actividad</a>
      <a role="menuitem" href="/tienda.html">🛒 Tienda de canjes</a>
      <a role="menuitem" href="/creadores.html">${creatorStatus === "aprobado" ? "🎬 Subir contenido" : "🎬 Creadores"}</a>
      ${me.isAdmin ? '<a role="menuitem" href="/admin.html">Panel de admin</a>' : ""}
      <div class="user-menu-sep"></div>
      <button role="menuitem" type="button" class="user-menu-logout">Cerrar sesión</button>
    </div>`;

  if (slot === li) {
    slot.replaceWith(wrap);
  } else {
    li.innerHTML = "";
    li.appendChild(wrap);
  }

  const btn = wrap.querySelector(".user-menu-btn");
  const dd = wrap.querySelector(".user-menu-dropdown");

  const close = () => { dd.setAttribute("hidden", ""); btn.setAttribute("aria-expanded", "false"); };
  const open = () => { dd.removeAttribute("hidden"); btn.setAttribute("aria-expanded", "true"); };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    dd.hasAttribute("hidden") ? open() : close();
  });
  document.addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  wrap.querySelector(".user-menu-logout").addEventListener("click", async () => {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch (e) {}
    window.location.reload();
  });

  // Onboarding: se muestra una sola vez (primer login en este navegador).
  if (!localStorage.getItem("omg_onboarded")) {
    const ov = document.createElement("div");
    ov.id = "omgOnboard";
    ov.innerHTML = `
      <div class="omg-ob-card">
        <div class="omg-ob-emoji">👑</div>
        <h2>¡Bienvenido a Omeganetics!</h2>
        <p>Así avanzas en la comunidad:</p>
        <ul>
          <li>🎙️ <b>Habla en voz</b> y 💬 <b>chatea</b> para ganar <b>XP</b> y <b>Omegacoins</b>.</li>
          <li>⭐ Sube de <b>nivel</b> y desbloquea <b>logros</b> (algunos te dan rol en Discord).</li>
          <li>🎯 Crea o únete a <b>eventos</b> y compite en el <b>ranking semanal</b>.</li>
          <li>🔗 Invita amigos con tu <b>link de referido</b> y gana un 10% extra.</li>
        </ul>
        <button class="btn" id="omgObClose">¡Entendido!</button>
      </div>`;
    document.body.appendChild(ov);
    document.getElementById("omgObClose").addEventListener("click", () => {
      localStorage.setItem("omg_onboarded", "1");
      ov.remove();
    });
  }
})();
