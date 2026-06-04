// Encabezado unificado de Omeganetics — se inyecta en CADA página (incluidas wiki/realm).
// 2 desplegables neutros (Actividad, Comunidad) + cuenta/login. Reemplaza el <header> existente.
(function () {
  if (document.querySelector(".omega-header")) return; // evitar doble inyección

  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const NAV = [
    { label: "Actividad", tour: "actividad", items: [
      { href: "/actividad.html", icon: "📊", text: "Actividad del servidor" },
      { href: "/eventos.html", icon: "🎯", text: "Eventos" },
      { href: "/torneos.html", icon: "🏆", text: "Torneos" },
    ] },
    { label: "Comunidad", tour: "comunidad", items: [
      { href: "/reglas.html", icon: "📜", text: "Reglas de la comunidad", dot: "#ffd35c" },
      { href: "/wiki/", icon: "📚", text: "Wiki (lore)", dot: "#3ba55c" },
      { href: "/tiendita/indextienda.html", icon: "🏰", text: "Realm", dot: "#c0392b" },
      { href: "/tienda.html", icon: "🛒", text: "Tienda de canjes", dot: "#ffd35c" },
      { href: "https://discord.gg/bCWjyns8U5", icon: "💬", text: "Discord", ext: true, dot: "#5865F2" },
    ] },
    { label: "Únete a nosotros", tour: "unete", items: [
      { href: "/eventos.html", icon: "🎯", text: "¿Tienes un evento?", dot: "#5865F2" },
      { href: "/creadores.html", icon: "🎬", text: "¿Eres creador de contenido?", dot: "#ff6fae" },
    ] },
  ];

  const dot = (it) => (it.dot ? `<span class="oh-dot" style="background:${it.dot}"></span>` : '<span class="oh-dot oh-dot-none"></span>');
  const itemHtml = (it) => `<a role="menuitem" href="${esc(it.href)}"${it.ext ? ' target="_blank" rel="noopener"' : ""}${it.team ? ' data-team="1"' : ""}>${dot(it)}<span class="oh-ic">${it.icon}</span> ${esc(it.text)}</a>`;
  const ddHtml = (g) => `<div class="oh-dd"><button class="oh-trigger" type="button" data-tour="${g.tour || ""}" aria-haspopup="true" aria-expanded="false">${esc(g.label)} <span class="oh-caret">▾</span></button><div class="oh-menu" hidden>${g.items.map(itemHtml).join("")}</div></div>`;

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
        <button class="oh-trigger oh-userbtn" type="button" data-tour="cuenta" aria-haspopup="true" aria-expanded="false">
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

    // Tutorial de bienvenida (recorrido guiado, una sola vez, solo en el inicio).
    startTour(header, esc);
  })();

  // --- Tutorial guiado de bienvenida ---
  function startTour(header, esc) {
    const isHome = location.pathname === "/" || /\/index\.html$/.test(location.pathname);
    if (!isHome || localStorage.getItem("omg_tour_v2")) return;
    const STEPS = [
      { title: "¡Bienvenido a OmeganeticsCorp! 👑", body: "Te damos un recorrido rápido por el sitio. Toca «Siguiente».", sel: null },
      { title: "Actividad", body: "Aquí ves la actividad del servidor: juegos más jugados, personas más activas y eventos actuales.", sel: '[data-tour="actividad"]' },
      { title: "Comunidad", body: "Descubre la info de nuestro Discord: reglas, lore y nuestra tienda de canjes.", sel: '[data-tour="comunidad"]' },
      { title: "Únete a nosotros", body: "¿Eres creador de contenido o tienes ideas de eventos increíbles? ¡Muéstranos! Apoyamos a creadores e ideas innovadoras.", sel: '[data-tour="unete"]' },
      { title: "Tu perfil", body: "Aquí ves tus datos. Tu presencia se recompensa: gana logros, sé de los más activos y consigue OMEGACOINS 🪙 para canjear cosméticos, cosas exclusivas y tarjetas de regalo.", sel: '[data-tour="cuenta"]' },
    ];
    let i = 0;
    const prevZ = header.style.zIndex;
    header.style.zIndex = "100001";
    const backdrop = document.createElement("div"); backdrop.className = "tour-backdrop";
    const ring = document.createElement("div"); ring.className = "tour-ring";
    const card = document.createElement("div"); card.className = "tour-card";
    document.body.append(backdrop, ring, card);

    const finish = () => {
      localStorage.setItem("omg_tour_v2", "1");
      header.style.zIndex = prevZ;
      backdrop.remove(); ring.remove(); card.remove();
      window.removeEventListener("resize", render);
    };

    function render() {
      const step = STEPS[i];
      const target = step.sel ? header.querySelector(step.sel) : null;
      if (target) {
        const r = target.getBoundingClientRect();
        ring.style.display = "block";
        ring.style.left = (r.left - 6) + "px";
        ring.style.top = (r.top - 6) + "px";
        ring.style.width = (r.width + 12) + "px";
        ring.style.height = (r.height + 12) + "px";
      } else {
        ring.style.display = "none";
      }
      const last = i === STEPS.length - 1;
      card.innerHTML = `
        <div class="tour-step">${i + 1} / ${STEPS.length}</div>
        <h3>${esc(step.title)}</h3>
        <p>${esc(step.body)}</p>
        <div class="tour-actions">
          <button type="button" class="tour-skip">Saltar</button>
          <button type="button" class="tour-next">${last ? "¡Entendido!" : "Siguiente →"}</button>
        </div>`;
      if (target) {
        const r = target.getBoundingClientRect();
        card.style.top = (r.bottom + 14) + "px";
        let left = r.left + r.width / 2 - 160;
        left = Math.max(12, Math.min(left, window.innerWidth - 332));
        card.style.left = left + "px";
        card.style.transform = "none";
      } else {
        card.style.top = "50%"; card.style.left = "50%"; card.style.transform = "translate(-50%, -50%)";
      }
      card.querySelector(".tour-skip").addEventListener("click", finish);
      card.querySelector(".tour-next").addEventListener("click", () => { if (last) finish(); else { i += 1; render(); } });
    }
    window.addEventListener("resize", render);
    setTimeout(render, 450);
  }
})();
