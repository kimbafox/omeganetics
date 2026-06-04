// Encabezado unificado de Omeganetics — se inyecta en CADA página (incluidas wiki/realm).
// 2 desplegables neutros (Actividad, Comunidad) + cuenta/login. Reemplaza el <header> existente.
(function () {
  if (document.querySelector(".omega-header")) return; // evitar doble inyección

  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const NAV = [
    { label: "Actividad", items: [
      { href: "/actividad.html", icon: "📊", text: "Actividad del servidor" },
      { href: "/eventos.html", icon: "🎯", text: "Eventos" },
      { href: "/torneos.html", icon: "🏆", text: "Torneos" },
    ] },
    { label: "Comunidad", items: [
      { href: "/wiki/", icon: "📚", text: "Wiki", dot: "#3ba55c" },
      { href: "/tiendita/indextienda.html", icon: "🏰", text: "Realm", dot: "#c0392b" },
      { href: "/creadores.html", icon: "🎬", text: "Creadores", dot: "#ff6fae" },
      { href: "/tienda.html", icon: "🛒", text: "Tienda de canjes", dot: "#ffd35c" },
      { href: "https://discord.gg/bCWjyns8U5", icon: "💬", text: "Discord", ext: true, dot: "#5865F2" },
    ] },
    { label: "Únete a nosotros", items: [
      { href: "/eventos.html", icon: "🎯", text: "¿Tienes un evento?", dot: "#5865F2" },
      { href: "/creadores.html", icon: "🎬", text: "¿Eres creador de contenido?", dot: "#ff6fae" },
    ] },
  ];

  const dot = (it) => (it.dot ? `<span class="oh-dot" style="background:${it.dot}"></span>` : '<span class="oh-dot oh-dot-none"></span>');
  const itemHtml = (it) => `<a role="menuitem" href="${esc(it.href)}"${it.ext ? ' target="_blank" rel="noopener"' : ""}${it.team ? ' data-team="1"' : ""}>${dot(it)}<span class="oh-ic">${it.icon}</span> ${esc(it.text)}</a>`;
  const ddHtml = (g) => `<div class="oh-dd"><button class="oh-trigger" type="button" aria-haspopup="true" aria-expanded="false">${esc(g.label)} <span class="oh-caret">▾</span></button><div class="oh-menu" hidden>${g.items.map(itemHtml).join("")}</div></div>`;

  const header = document.createElement("header");
  header.className = "header omega-header";
  header.innerHTML = `
    <a class="omega-logo" href="/"><img src="/assets/logo.png" width="34" height="34" alt=""><span>Omeganetics</span></a>
    <button class="oh-burger" type="button" aria-label="Menú"><span></span><span></span><span></span></button>
    <nav class="omega-nav">
      ${NAV.map(ddHtml).join("")}
      <button class="oh-trigger oh-team" id="teamToggle" type="button">👑 ¿Quiénes somos?</button>
      <div class="oh-account" id="ohAccount"><a href="/login.html" id="navLogin" class="oh-login">Entrar</a></div>
    </nav>`;

  // En sub-apps (wiki/realm) con <meta name="omega-header" content="prepend"> se antepone
  // (conserva su header propio). En las demás páginas reemplaza el header existente.
  const prepend = document.querySelector('meta[name="omega-header"]')?.content === "prepend";
  const existing = prepend ? null : document.querySelector("header.header, header");
  if (existing) existing.replaceWith(header);
  else document.body.insertBefore(header, document.body.firstChild);

  // Resaltar la página activa.
  const path = location.pathname.replace(/\/index\.html$/, "/");
  header.querySelectorAll(".oh-menu a").forEach((a) => {
    try {
      const u = new URL(a.getAttribute("href"), location.origin);
      if (u.pathname === path || (u.pathname !== "/" && path.startsWith(u.pathname))) {
        a.classList.add("active");
        a.closest(".oh-dd")?.querySelector(".oh-trigger")?.classList.add("active");
      }
    } catch (e) { /* noop */ }
  });

  const closeAll = () => header.querySelectorAll(".oh-dd").forEach((dd) => {
    dd.classList.remove("open");
    dd.querySelector(".oh-menu")?.setAttribute("hidden", "");
    dd.querySelector(".oh-trigger")?.setAttribute("aria-expanded", "false");
  });
  const wireDd = (dd) => {
    const t = dd.querySelector(".oh-trigger"); const m = dd.querySelector(".oh-menu");
    t.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = dd.classList.contains("open");
      closeAll();
      if (!open) { dd.classList.add("open"); m.removeAttribute("hidden"); t.setAttribute("aria-expanded", "true"); }
    });
  };
  header.querySelectorAll(".oh-dd").forEach(wireDd);
  document.addEventListener("click", closeAll);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });

  header.querySelector(".oh-burger").addEventListener("click", (e) => { e.stopPropagation(); header.classList.toggle("nav-open"); });
  document.addEventListener("click", (e) => { if (!header.contains(e.target)) header.classList.remove("nav-open"); });

  // "¿Quiénes somos?" (3ª pestaña): en el inicio abre el panel del equipo; en otras páginas va al inicio.
  // El render de las tarjetas lo hace team-home.js (escucha este mismo #teamToggle).
  const teamBtn = header.querySelector(".oh-team");
  const closeTeam = () => { const dd = document.getElementById("teamDropdown"); if (dd) { dd.classList.remove("open"); dd.setAttribute("aria-hidden", "true"); } };
  if (teamBtn) teamBtn.addEventListener("click", (e) => {
    const dd = document.getElementById("teamDropdown");
    if (dd) {
      e.preventDefault();
      e.stopPropagation();
      closeAll();
      const open = dd.classList.contains("open");
      dd.classList.toggle("open", !open);
      dd.setAttribute("aria-hidden", String(open));
    } else {
      window.location.href = "/";
    }
  });
  // Cerrar el panel del equipo: botón "Cerrar", clic afuera y Escape.
  document.getElementById("teamClose")?.addEventListener("click", closeTeam);
  document.addEventListener("click", (e) => {
    const dd = document.getElementById("teamDropdown");
    if (!dd || !dd.classList.contains("open")) return;
    if (dd.contains(e.target) || (teamBtn && teamBtn.contains(e.target))) return;
    closeTeam();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeTeam(); });

  // En páginas normales (no inicio, no sub-apps) inyectamos y rellenamos el panel del equipo,
  // así "¿Quiénes somos?" se despliega en cualquier página.
  (async function ensureTeamPanel() {
    if (document.getElementById("teamDropdown")) return; // el inicio ya lo tiene (lo llena team-home.js)
    const panel = document.createElement("section");
    panel.id = "teamDropdown";
    // En sub-apps (wiki/realm) usamos estilos propios de site-extra (clase marca).
    panel.className = "team-dropdown" + (prepend ? " omega-team-panel" : "");
    panel.setAttribute("aria-hidden", "true");
    panel.innerHTML = `<div class="team-dropdown-inner">
      <div class="team-dropdown-header"><div><span class="team-eyebrow">¿Quiénes somos?</span><h2 id="teamTitle">Equipo Omeganetics</h2></div><button id="teamClose" class="team-close-button" type="button">Cerrar</button></div>
      <p id="teamDescription" class="team-dropdown-copy"></p>
      <div id="teamCardsGrid" class="team-dropdown-grid"></div>
    </div>`;
    document.body.appendChild(panel);
    panel.querySelector("#teamClose").addEventListener("click", closeTeam);
    try {
      const d = await (await fetch("/api/team/content")).json();
      if (d.about?.title) panel.querySelector("#teamTitle").textContent = d.about.title;
      panel.querySelector("#teamDescription").textContent = d.about?.description || "";
      const grid = panel.querySelector("#teamCardsGrid");
      if (grid && Array.isArray(d.members)) {
        grid.innerHTML = d.members.map((m) => {
          const img = /^(https?:|\/)/.test(m.image || "") ? m.image : "/" + (m.image || ""); // ruta absoluta (funciona en wiki/realm)
          return `<a class="team-dropdown-card" href="/integrante.html?slug=${encodeURIComponent(m.slug || "")}"><div class="team-dropdown-avatar-wrap"><img class="team-dropdown-avatar" src="${esc(img)}" alt="${esc(m.name)}" loading="lazy"></div><div class="team-dropdown-card-copy"><span class="member-tier">${esc(m.tier || "Integrante")}</span><h4>${esc(m.name)}</h4><p>${esc(m.shortBio || m.summary || "")}</p></div></a>`;
        }).join("");
      }
    } catch (e) { /* noop */ }
  })();

  // Cuenta / login (a la derecha).
  (async function () {
    let me = null;
    try { const r = await fetch("/api/auth/me"); if (r.ok) me = await r.json(); } catch (e) { return; }
    if (!me) return;
    let creator = "none";
    try { const cr = await fetch("/api/creadores/mi-estado"); if (cr.ok) creator = (await cr.json()).status || "none"; } catch (e) { /* noop */ }
    const name = me.globalName || me.username || "Cuenta";
    const acc = header.querySelector("#ohAccount");
    acc.innerHTML = `
      <div class="oh-dd oh-user">
        <button class="oh-trigger oh-userbtn" type="button" aria-haspopup="true" aria-expanded="false">
          ${me.avatar ? `<img src="${esc(me.avatar)}" class="oh-avatar" alt="">` : ""}
          <span class="oh-uname">${esc(name)}</span>
          ${me.isAdmin ? '<span class="oh-badge">admin</span>' : ""}
          <span class="oh-caret">▾</span>
        </button>
        <div class="oh-menu oh-menu-right" hidden>
          <div class="oh-head">@${esc(me.username || "")}</div>
          <a role="menuitem" href="/perfil.html"><span class="oh-dot oh-dot-none"></span><span class="oh-ic">👤</span> Ver perfil</a>
          <a role="menuitem" href="/tienda.html"><span class="oh-dot oh-dot-none"></span><span class="oh-ic">🛒</span> Tienda de canjes</a>
          <a role="menuitem" href="/creadores.html"><span class="oh-dot oh-dot-none"></span><span class="oh-ic">🎬</span> ${creator === "aprobado" ? "Subir contenido" : "Creadores"}</a>
          ${me.isAdmin ? '<a role="menuitem" href="/admin.html"><span class="oh-dot oh-dot-none"></span><span class="oh-ic">🛡️</span> Panel admin</a>' : ""}
          <button role="menuitem" type="button" class="oh-logout">Cerrar sesión</button>
        </div>
      </div>`;
    const dd = acc.querySelector(".oh-dd");
    wireDd(dd);
    acc.querySelector(".oh-logout").addEventListener("click", async () => {
      try { await fetch("/api/auth/logout", { method: "POST" }); } catch (e) { /* noop */ }
      window.location.reload();
    });

    // Onboarding (una sola vez).
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
})();
