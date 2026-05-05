function escapeMemberHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getMemberSlug() {
  const params = new URLSearchParams(window.location.search);
  return params.get('slug') || document.body.dataset.memberSlug || 'emperador-kimba';
}

function renderContactItem(label, value) {
  if (!value) return '';
  const isLink = /^https?:\/\//i.test(value);
  const content = isLink
    ? `<a href="${escapeMemberHtml(value)}" target="_blank" rel="noreferrer">${escapeMemberHtml(label)}</a>`
    : escapeMemberHtml(value);
  return `<div class="meta-item"><span>${escapeMemberHtml(label)}</span>${content}</div>`;
}

function renderMemberPage(member) {
  document.title = `${member.name} | Omeganetics`;

  const hero = document.getElementById('memberHero');
  const profile = document.getElementById('memberProfile');
  const story = document.getElementById('memberStory');
  const meta = document.getElementById('memberMeta');
  const fullName = document.getElementById('memberFullName');
  const specialties = document.getElementById('memberSpecialties');
  const contacts = document.getElementById('memberContacts');
  const workgroupTitle = document.getElementById('memberWorkgroupTitle');
  const workgroupDescription = document.getElementById('memberWorkgroupDescription');
  const workgroupGrid = document.getElementById('memberWorkgroupGrid');
  const location = [member.location?.city, member.location?.country].filter(Boolean).join(', ') || 'Ubicacion por definir';
  const profileSummary = member.summary || member.shortBio || 'Perfil profesional no disponible.';

  hero.classList.remove('skeleton-card');
  hero.innerHTML = `
    <div class="resume-hero-media">
      <img src="${escapeMemberHtml(member.image)}" alt="${escapeMemberHtml(member.name)}" class="resume-hero-image">
    </div>
    <div class="resume-hero-copy">
      <span class="resume-kicker">${escapeMemberHtml(member.tier || member.role || 'Integrante')}</span>
      <h1>${escapeMemberHtml(member.name)}</h1>
      <p class="resume-role">${escapeMemberHtml(member.role || '')}</p>
      <p class="member-real-name">${escapeMemberHtml(member.fullName || 'Nombre real por definir')}</p>
      <p class="resume-summary">${escapeMemberHtml(profileSummary)}</p>
      <div class="resume-highlights">
        <div class="resume-highlight-item"><span>Distintivo</span><strong>${escapeMemberHtml(member.badge || 'Omeganetics')}</strong></div>
        <div class="resume-highlight-item"><span>Ubicacion</span><strong>${escapeMemberHtml(location)}</strong></div>
      </div>
      <div class="resume-hero-actions">
        <a href="/index.html" class="btn">Volver al inicio</a>
        <a href="/index.html" class="resume-text-link">Portal Omeganetics</a>
      </div>
    </div>
  `;

  if (profile) {
    profile.innerHTML = `<p>${escapeMemberHtml(profileSummary)}</p>`;
  }

  story.innerHTML = `<p>${escapeMemberHtml(member.lifeStory || member.shortBio || 'Sin historia registrada.')}</p>`;
  meta.innerHTML = `
    <div class="meta-item"><span>Cargo</span><strong>${escapeMemberHtml(member.role || 'Sin definir')}</strong></div>
    <div class="meta-item"><span>Jerarquia</span><strong>${escapeMemberHtml(member.tier || 'Sin definir')}</strong></div>
    <div class="meta-item"><span>Ubicacion</span><strong>${escapeMemberHtml(location)}</strong></div>
    <div class="meta-item"><span>Distintivo</span><strong>${escapeMemberHtml(member.badge || 'Omeganetics')}</strong></div>
  `;

  fullName.innerHTML = `
    <div class="meta-item"><span>Nombre completo</span><strong>${escapeMemberHtml(member.fullName || 'No publicado')}</strong></div>
    <div class="meta-item"><span>Presentacion</span><strong>${escapeMemberHtml(member.name || 'Integrante')}</strong></div>
  `;

  specialties.innerHTML = (member.specialties || []).map(item => `<span>${escapeMemberHtml(item)}</span>`).join('') || '<span>Sin especialidades registradas</span>';
  contacts.innerHTML = [
    renderContactItem('Email', member.contacts?.email),
    renderContactItem('Telefono', member.contacts?.phone),
    renderContactItem('Instagram', member.contacts?.instagram),
    renderContactItem('TikTok', member.contacts?.tiktok),
    renderContactItem('Discord', member.contacts?.discord),
    renderContactItem('Website', member.contacts?.website)
  ].join('') || '<p class="helper-copy">Sin contactos publicados.</p>';

  if (workgroupTitle) {
    workgroupTitle.textContent = 'Equipo de trabajo';
  }
  if (workgroupDescription) {
    workgroupDescription.textContent = '';
  }
  if (workgroupGrid) {
    workgroupGrid.innerHTML = '';
  }
}

function renderWorkgroup(workgroup) {
  const workgroupTitle = document.getElementById('memberWorkgroupTitle');
  const workgroupDescription = document.getElementById('memberWorkgroupDescription');
  const workgroupGrid = document.getElementById('memberWorkgroupGrid');

  if (!workgroupGrid) return;

  if (workgroupTitle) {
    workgroupTitle.textContent = workgroup?.title || 'Equipo de trabajo';
  }

  if (workgroupDescription) {
    workgroupDescription.textContent = workgroup?.description || '';
  }

  const members = Array.isArray(workgroup?.members) ? workgroup.members : [];
  workgroupGrid.innerHTML = members.map(entry => {
    const location = [entry.location?.city, entry.location?.country].filter(Boolean).join(', ') || 'Ubicacion por definir';
    return `
      <article class="workgroup-card">
        <img src="${escapeMemberHtml(entry.image)}" alt="${escapeMemberHtml(entry.name)}" class="workgroup-image">
        <div class="workgroup-copy-block">
          <p class="member-tier">${escapeMemberHtml(entry.role || 'Equipo')}</p>
          <h4>${escapeMemberHtml(entry.name)}</h4>
          <span class="workgroup-location">${escapeMemberHtml(location)}</span>
          <p>${escapeMemberHtml(entry.description || '')}</p>
        </div>
      </article>
    `;
  }).join('');
}

async function loadMemberPage() {
  const slug = getMemberSlug();

  try {
    const [memberResponse, teamResponse] = await Promise.all([
      fetch(`/api/team/members/${encodeURIComponent(slug)}`),
      fetch('/api/team/content')
    ]);

    if (!memberResponse.ok) {
      throw new Error('No se encontro el integrante solicitado.');
    }

    const member = await memberResponse.json();
    renderMemberPage(member);

    if (teamResponse.ok) {
      const teamContent = await teamResponse.json();
      renderWorkgroup(teamContent.workgroup);
    }
  } catch (error) {
    const hero = document.getElementById('memberHero');
    const story = document.getElementById('memberStory');
    hero.classList.remove('skeleton-card');
    hero.innerHTML = '<div class="member-hero-copy"><span class="panel-label">Error</span><h1>Perfil no disponible</h1><p>No se pudo cargar este integrante.</p><a href="/index.html#quienes-somos" class="btn">Volver al inicio</a></div>';
    story.innerHTML = `<p>${escapeMemberHtml(error.message)}</p>`;
  }
}

loadMemberPage();