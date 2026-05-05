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

function normalizeTier(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function isSeniorTier(value) {
  const tier = normalizeTier(value);
  return tier === 'emperador' || tier === 'ascendidos' || tier === 'ascendido';
}

function buildSpotlightContacts(member) {
  return [
    renderContactItem('Email', member.contacts?.email),
    renderContactItem('Telefono', member.contacts?.phone),
    renderContactItem('Instagram', member.contacts?.instagram),
    renderContactItem('TikTok', member.contacts?.tiktok),
    renderContactItem('Discord', member.contacts?.discord),
    renderContactItem('Website', member.contacts?.website)
  ].filter(Boolean);
}

function getVisibleWorkgroup(member, teamContent) {
  const allMembers = Array.isArray(teamContent?.members) ? teamContent.members : [];
  const visibleMembers = allMembers.filter(entry => {
    if (!entry || entry.slug === member.slug) return false;
    if (isSeniorTier(member.tier)) {
      return !isSeniorTier(entry.tier);
    }
    return normalizeTier(entry.tier) === normalizeTier(member.tier);
  });

  if (isSeniorTier(member.tier)) {
    return {
      title: 'Nuevos del equipo',
      description: 'Aqui solo aparecen integrantes nuevos. Emperador y Ascendidos no comparten este bloque.',
      members: visibleMembers.map(entry => ({
        id: entry.id,
        name: entry.name,
        role: entry.role || entry.tier || 'Nuevo integrante',
        image: entry.image,
        description: entry.summary || entry.shortBio || '',
        location: entry.location || {}
      }))
    };
  }

  return {
    title: teamContent?.workgroup?.title || 'Equipo de trabajo',
    description: teamContent?.workgroup?.description || '',
    members: visibleMembers.map(entry => ({
      id: entry.id,
      name: entry.name,
      role: entry.role || entry.tier || 'Integrante',
      image: entry.image,
      description: entry.summary || entry.shortBio || '',
      location: entry.location || {}
    }))
  };
}

function renderMemberPage(member) {
  document.title = `${member.name} | Omeganetics`;

  const spotlight = document.getElementById('memberSpotlight');
  const profile = document.getElementById('memberProfile');
  const story = document.getElementById('memberStory');
  const specialties = document.getElementById('memberSpecialties');
  const workgroupTitle = document.getElementById('memberWorkgroupTitle');
  const workgroupDescription = document.getElementById('memberWorkgroupDescription');
  const workgroupGrid = document.getElementById('memberWorkgroupGrid');
  const location = [member.location?.city, member.location?.country].filter(Boolean).join(', ') || 'Ubicacion por definir';
  const profileSummary = member.summary || member.shortBio || 'Perfil profesional no disponible.';
  const contactItems = buildSpotlightContacts(member);
  const contactMarkup = contactItems.length
    ? `<div class="resume-spotlight-contacts">${contactItems.join('')}</div>`
    : '<p class="helper-copy">Sin contactos publicados.</p>';
  const spotlightMarkup = `
    <div class="resume-spotlight-media">
      <img src="${escapeMemberHtml(member.image)}" alt="${escapeMemberHtml(member.name)}" class="resume-hero-image">
    </div>
    <div class="resume-spotlight-copy">
      <span class="resume-kicker">${escapeMemberHtml(member.tier || 'Integrante')}</span>
      <div class="resume-spotlight-info">
        <div class="resume-spotlight-row"><span>Rol</span><strong>${escapeMemberHtml(member.role || 'Sin definir')}</strong></div>
        <div class="resume-spotlight-row"><span>Nombre</span><strong>${escapeMemberHtml(member.fullName || 'No publicado')}</strong></div>
        <div class="resume-spotlight-row"><span>Apodo</span><strong>${escapeMemberHtml(member.name || 'Integrante')}</strong></div>
        <div class="resume-spotlight-row"><span>Ubicacion</span><strong>${escapeMemberHtml(location)}</strong></div>
        <div class="resume-spotlight-row"><span>Distintivo</span><strong>${escapeMemberHtml(member.badge || 'Omeganetics')}</strong></div>
      </div>
      <div class="resume-spotlight-contact-block">
        <span class="panel-label">Contacto</span>
        ${contactMarkup}
      </div>
      <a href="/index.html" class="btn">Volver al inicio</a>
    </div>
  `;

  if (spotlight) {
    spotlight.classList.remove('skeleton-card');
    spotlight.innerHTML = spotlightMarkup;
  }

  if (profile) {
    profile.innerHTML = `<p>${escapeMemberHtml(profileSummary)}</p>`;
  }

  story.innerHTML = `<p>${escapeMemberHtml(member.lifeStory || member.shortBio || 'Sin historia registrada.')}</p>`;

  specialties.innerHTML = (member.specialties || []).map(item => `<span>${escapeMemberHtml(item)}</span>`).join('') || '<span>Sin especialidades registradas</span>';

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
  if (!members.length) {
    workgroupGrid.innerHTML = '<p class="helper-copy workgroup-empty">No hay nuevos asignados a este perfil todavia.</p>';
    return;
  }

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
      renderWorkgroup(getVisibleWorkgroup(member, teamContent));
    }
  } catch (error) {
    const spotlight = document.getElementById('memberSpotlight');
    const story = document.getElementById('memberStory');
    const errorMarkup = '<div class="member-hero-copy"><span class="panel-label">Error</span><h1>Perfil no disponible</h1><p>No se pudo cargar este integrante.</p><a href="/index.html#quienes-somos" class="btn">Volver al inicio</a></div>';
    if (spotlight) {
      spotlight.classList.remove('skeleton-card');
      spotlight.innerHTML = errorMarkup;
    }
    story.innerHTML = `<p>${escapeMemberHtml(error.message)}</p>`;
  }
}

loadMemberPage();