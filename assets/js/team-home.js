const homeState = {
  content: null
};

function teamContactLink(url, label) {
  if (!url) return '';
  return `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`;
}

function escapeTeamHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function locationLine(location) {
  const parts = [location?.city, location?.country].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Ubicacion por definir';
}

function memberUrl(member) {
  const dedicatedPages = {
    'emperador-kimba': '/kimba.html',
    'anxpo': '/anxpo.html',
    'sebillas': '/sebillas.html'
  };

  return dedicatedPages[member.slug] || `/integrante.html?slug=${encodeURIComponent(member.slug)}`;
}

function renderTeamCards(members) {
  const grid = document.getElementById('teamCardsGrid');
  if (!grid) return;

  grid.innerHTML = members.map(member => `
    <a href="${memberUrl(member)}" class="team-dropdown-card">
      <div class="team-dropdown-avatar-wrap">
        <img src="${escapeTeamHtml(member.image)}" alt="${escapeTeamHtml(member.name)}" class="team-dropdown-avatar">
      </div>
      <div class="team-dropdown-card-copy">
        <span class="member-tier">${escapeTeamHtml(member.tier || 'Integrante')}</span>
        <h4>${escapeTeamHtml(member.name)}</h4>
        <p>${escapeTeamHtml(member.shortBio || member.summary || '')}</p>
      </div>
    </a>
  `).join('');
}

async function loadTeamHome() {
  try {
    const response = await fetch('/api/team/content');
    if (!response.ok) {
      throw new Error('No se pudo cargar el equipo.');
    }

    homeState.content = await response.json();
    const { about, members } = homeState.content;

    const teamTitle = document.getElementById('teamTitle');
    const teamDescription = document.getElementById('teamDescription');
    const eyebrow = document.querySelector('.team-eyebrow');

    if (eyebrow) eyebrow.textContent = about?.eyebrow || 'Quienes somos';
    if (teamTitle) teamTitle.textContent = about?.title || 'Equipo Omeganetics';
    if (teamDescription) teamDescription.textContent = about?.description || '';

    renderTeamCards(members);
  } catch (error) {
    const teamTitle = document.getElementById('teamTitle');
    const teamDescription = document.getElementById('teamDescription');
    const membersGrid = document.getElementById('teamCardsGrid');
    if (teamTitle) teamTitle.textContent = 'No fue posible cargar el equipo';
    if (teamDescription) teamDescription.textContent = error.message;
    if (membersGrid) membersGrid.innerHTML = '<p class="helper-copy">Intenta nuevamente cuando el servidor este disponible.</p>';
  }
}

loadTeamHome();