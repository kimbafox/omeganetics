const teamAdminState = {
  authConfig: null,
  token: null,
  content: null,
  lastSavedContent: null,
  selectedMemberIndex: -1,
  selectedWorkgroupIndex: -1
};

function $(id) {
  return document.getElementById(id);
}

function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch (error) {
    return null;
  }
}

function getStoredToken() {
  const token = localStorage.getItem('teamAdminToken');
  if (!token) return null;
  const payload = decodeJwt(token);
  if (!payload || payload.role !== 'admin' || !payload.exp || Date.now() >= payload.exp * 1000) {
    localStorage.removeItem('teamAdminToken');
    return null;
  }
  return token;
}

function createSlug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function setAuthMessage(message, isError = false) {
  const node = $('authMessage');
  if (!node) return;
  node.textContent = message;
  node.classList.toggle('error-copy', isError);
}

function setSaveMessage(message, isError = false) {
  const node = $('saveMessage');
  if (!node) return;
  node.textContent = message;
  node.classList.toggle('error-copy', isError);
  node.dataset.tone = isError ? 'error' : 'neutral';
}

function cloneContent(content) {
  return JSON.parse(JSON.stringify(content));
}

function hasUnsavedChanges() {
  if (!teamAdminState.content || !teamAdminState.lastSavedContent) {
    return false;
  }

  return JSON.stringify(teamAdminState.content) !== JSON.stringify(teamAdminState.lastSavedContent);
}

function updateDirtyState() {
  const saveButton = $('saveContentButton');
  const resetButton = $('resetContentButton');
  const isDirty = hasUnsavedChanges();

  if (saveButton) {
    saveButton.disabled = !isDirty;
  }

  if (resetButton) {
    resetButton.disabled = !isDirty;
  }

  if (!teamAdminState.content) {
    setSaveMessage('');
    return;
  }

  if (isDirty) {
    setSaveMessage('Hay cambios sin guardar.', false);
    $('saveMessage').dataset.tone = 'warning';
  } else {
    setSaveMessage('Sin cambios pendientes.');
  }
}

function setAuthStatus(text, tone = 'neutral') {
  const node = $('authStatus');
  if (!node) return;
  node.textContent = text;
  node.dataset.tone = tone;
}

function togglePasswordLogin(visible) {
  const form = $('passwordLoginForm');
  if (!form) return;
  form.classList.toggle('hidden', !visible);
}

function defaultMember() {
  return {
    id: `member-${Date.now()}`,
    slug: `nuevo-integrante-${Date.now()}`,
    name: 'Nuevo integrante',
    fullName: '',
    role: 'Ascendido',
    tier: 'Ascendidos',
    badge: '',
    image: 'assets/logo.png',
    shortBio: '',
    summary: '',
    lifeStory: '',
    specialties: [],
    location: { country: '', city: '' },
    contacts: { email: '', phone: '', instagram: '', tiktok: '', discord: '', website: '' },
    featured: false
  };
}

function defaultWorkgroupMember() {
  return {
    id: `crew-${Date.now()}`,
    name: 'Nuevo miembro',
    role: 'Equipo',
    image: 'assets/logo.png',
    description: '',
    location: { country: '', city: '' }
  };
}

function renderMemberList() {
  const list = $('memberList');
  if (!list || !teamAdminState.content) return;

  list.innerHTML = teamAdminState.content.members.map((member, index) => `
    <button type="button" class="admin-list-item ${index === teamAdminState.selectedMemberIndex ? 'active' : ''}" data-member-index="${index}">
      <span>${member.name}</span>
      <small>${member.role || member.tier || 'Sin rol'}</small>
    </button>
  `).join('');

  list.querySelectorAll('[data-member-index]').forEach(button => {
    button.addEventListener('click', () => {
      teamAdminState.selectedMemberIndex = Number(button.dataset.memberIndex);
      renderMemberList();
      fillMemberEditor();
    });
  });
}

function renderWorkgroupList() {
  const list = $('workgroupList');
  if (!list || !teamAdminState.content) return;

  list.innerHTML = teamAdminState.content.workgroup.members.map((member, index) => `
    <button type="button" class="admin-list-item ${index === teamAdminState.selectedWorkgroupIndex ? 'active' : ''}" data-workgroup-index="${index}">
      <span>${member.name}</span>
      <small>${member.role || 'Sin rol'}</small>
    </button>
  `).join('');

  list.querySelectorAll('[data-workgroup-index]').forEach(button => {
    button.addEventListener('click', () => {
      teamAdminState.selectedWorkgroupIndex = Number(button.dataset.workgroupIndex);
      renderWorkgroupList();
      fillWorkgroupEditor();
    });
  });
}

function fillAboutEditor() {
  $('aboutEyebrow').value = teamAdminState.content.about.eyebrow || '';
  $('aboutTitle').value = teamAdminState.content.about.title || '';
  $('aboutDescription').value = teamAdminState.content.about.description || '';
  $('workgroupTitleInput').value = teamAdminState.content.workgroup.title || '';
  $('workgroupDescriptionInput').value = teamAdminState.content.workgroup.description || '';
}

function fillMemberEditor() {
  const editor = $('memberEditor');
  const member = teamAdminState.content.members[teamAdminState.selectedMemberIndex];
  if (!editor || !member) {
    editor.classList.add('hidden');
    return;
  }

  editor.classList.remove('hidden');
  $('memberEditorTitle').textContent = member.name || 'Integrante';
  $('memberPreview').src = member.image || 'assets/logo.png';
  $('memberName').value = member.name || '';
  $('memberFullNameInput').value = member.fullName || '';
  $('memberSlug').value = member.slug || '';
  $('memberRole').value = member.role || '';
  $('memberTier').value = member.tier || '';
  $('memberBadge').value = member.badge || '';
  $('memberCountry').value = member.location?.country || '';
  $('memberCity').value = member.location?.city || '';
  $('memberFeatured').checked = Boolean(member.featured);
  $('memberSummary').value = member.summary || '';
  $('memberShortBio').value = member.shortBio || '';
  $('memberLifeStory').value = member.lifeStory || '';
  $('memberSpecialtiesInput').value = (member.specialties || []).join(', ');
  $('memberEmail').value = member.contacts?.email || '';
  $('memberPhone').value = member.contacts?.phone || '';
  $('memberInstagram').value = member.contacts?.instagram || '';
  $('memberTiktok').value = member.contacts?.tiktok || '';
  $('memberDiscord').value = member.contacts?.discord || '';
  $('memberWebsite').value = member.contacts?.website || '';
}

function fillWorkgroupEditor() {
  const editor = $('workgroupEditor');
  const member = teamAdminState.content.workgroup.members[teamAdminState.selectedWorkgroupIndex];
  if (!editor || !member) {
    editor.classList.add('hidden');
    return;
  }

  editor.classList.remove('hidden');
  $('workgroupEditorTitle').textContent = member.name || 'Miembro';
  $('workgroupPreview').src = member.image || 'assets/logo.png';
  $('workgroupName').value = member.name || '';
  $('workgroupRole').value = member.role || '';
  $('workgroupCountry').value = member.location?.country || '';
  $('workgroupCity').value = member.location?.city || '';
  $('workgroupDescriptionField').value = member.description || '';
}

function syncAboutEditor() {
  teamAdminState.content.about.eyebrow = $('aboutEyebrow').value;
  teamAdminState.content.about.title = $('aboutTitle').value;
  teamAdminState.content.about.description = $('aboutDescription').value;
  teamAdminState.content.workgroup.title = $('workgroupTitleInput').value;
  teamAdminState.content.workgroup.description = $('workgroupDescriptionInput').value;
  updateDirtyState();
}

function syncMemberEditor() {
  const member = teamAdminState.content.members[teamAdminState.selectedMemberIndex];
  if (!member) return;

  member.name = $('memberName').value;
  member.fullName = $('memberFullNameInput').value;
  member.slug = $('memberSlug').value || createSlug(member.name);
  member.role = $('memberRole').value;
  member.tier = $('memberTier').value;
  member.badge = $('memberBadge').value;
  member.location.country = $('memberCountry').value;
  member.location.city = $('memberCity').value;
  member.featured = $('memberFeatured').checked;
  member.summary = $('memberSummary').value;
  member.shortBio = $('memberShortBio').value;
  member.lifeStory = $('memberLifeStory').value;
  member.specialties = $('memberSpecialtiesInput').value.split(',').map(item => item.trim()).filter(Boolean);
  member.contacts.email = $('memberEmail').value;
  member.contacts.phone = $('memberPhone').value;
  member.contacts.instagram = $('memberInstagram').value;
  member.contacts.tiktok = $('memberTiktok').value;
  member.contacts.discord = $('memberDiscord').value;
  member.contacts.website = $('memberWebsite').value;
  member.id = member.id || member.slug;
  renderMemberList();
  fillMemberEditor();
  updateDirtyState();
}

function syncWorkgroupEditor() {
  const member = teamAdminState.content.workgroup.members[teamAdminState.selectedWorkgroupIndex];
  if (!member) return;

  member.name = $('workgroupName').value;
  member.role = $('workgroupRole').value;
  member.location.country = $('workgroupCountry').value;
  member.location.city = $('workgroupCity').value;
  member.description = $('workgroupDescriptionField').value;
  renderWorkgroupList();
  fillWorkgroupEditor();
  updateDirtyState();
}

async function uploadImage(file) {
  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch('/api/team/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${teamAdminState.token}`
    },
    body: formData
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'No se pudo subir la imagen.');
  }

  return data.imagePath;
}

async function handleMemberImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    setSaveMessage('Subiendo imagen...');
    const imagePath = await uploadImage(file);
    const member = teamAdminState.content.members[teamAdminState.selectedMemberIndex];
    if (member) {
      member.image = imagePath;
      fillMemberEditor();
      renderMemberList();
    }
    updateDirtyState();
    setSaveMessage('Imagen subida correctamente. Falta guardar los cambios.');
    $('saveMessage').dataset.tone = 'warning';
  } catch (error) {
    setSaveMessage(error.message, true);
  } finally {
    event.target.value = '';
  }
}

async function handleWorkgroupImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    setSaveMessage('Subiendo imagen...');
    const imagePath = await uploadImage(file);
    const member = teamAdminState.content.workgroup.members[teamAdminState.selectedWorkgroupIndex];
    if (member) {
      member.image = imagePath;
      fillWorkgroupEditor();
      renderWorkgroupList();
    }
    updateDirtyState();
    setSaveMessage('Imagen subida correctamente. Falta guardar los cambios.');
    $('saveMessage').dataset.tone = 'warning';
  } catch (error) {
    setSaveMessage(error.message, true);
  } finally {
    event.target.value = '';
  }
}

async function saveContent() {
  syncAboutEditor();
  syncMemberEditor();
  syncWorkgroupEditor();

  try {
    setSaveMessage('Guardando cambios...');
    const response = await fetch('/api/team/content', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${teamAdminState.token}`
      },
      body: JSON.stringify(teamAdminState.content)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'No se pudo guardar el contenido.');
    }

    await loadContent();
    setSaveMessage('Cambios guardados correctamente y recargados desde el servidor.');
    updateDirtyState();
  } catch (error) {
    setSaveMessage(error.message, true);
  }
}

function renderAllEditors() {
  fillAboutEditor();
  renderMemberList();
  renderWorkgroupList();
  fillMemberEditor();
  fillWorkgroupEditor();
}

async function loadContent() {
  const response = await fetch('/api/team/content');
  if (!response.ok) {
    throw new Error('No se pudo cargar el contenido editable.');
  }

  teamAdminState.content = await response.json();
  teamAdminState.lastSavedContent = cloneContent(teamAdminState.content);
  teamAdminState.selectedMemberIndex = teamAdminState.content.members.length ? 0 : -1;
  teamAdminState.selectedWorkgroupIndex = teamAdminState.content.workgroup.members.length ? 0 : -1;
  renderAllEditors();
  updateDirtyState();
}

async function resetContent() {
  if (hasUnsavedChanges() && !window.confirm('Se perderan los cambios no guardados. Quieres restablecer el contenido?')) {
    return;
  }

  try {
    setSaveMessage('Restableciendo contenido guardado...');
    await loadContent();
    setSaveMessage('Cambios locales descartados. Se restauro la ultima version guardada.');
  } catch (error) {
    setSaveMessage(error.message, true);
  }
}

function enableWorkspace() {
  $('adminWorkspace').classList.remove('hidden');
  $('logoutButton').style.display = 'inline-flex';
}

function disableWorkspace() {
  $('adminWorkspace').classList.add('hidden');
  $('logoutButton').style.display = 'none';
}

async function handleGoogleCredential(response) {
  try {
    const loginResponse = await fetch('/api/team/login/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    });

    const data = await loginResponse.json();
    if (!loginResponse.ok) {
      throw new Error(data.error || 'No fue posible iniciar sesion.');
    }

    localStorage.setItem('teamAdminToken', data.token);
    teamAdminState.token = data.token;
    setAuthStatus(`Sesion iniciada como ${data.email}`, 'success');
    setAuthMessage('Acceso concedido al panel.');
    enableWorkspace();
    await loadContent();
  } catch (error) {
    disableWorkspace();
    setAuthStatus('Acceso denegado', 'error');
    setAuthMessage(error.message, true);
  }
}

async function handlePasswordLogin(event) {
  event.preventDefault();

  const email = $('adminEmailInput').value.trim();
  const password = $('adminPasswordInput').value;

  try {
    setAuthStatus('Validando acceso por clave...', 'neutral');
    setAuthMessage('');

    const loginResponse = await fetch('/api/team/login/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await loginResponse.json();
    if (!loginResponse.ok) {
      throw new Error(data.error || 'No fue posible iniciar sesion.');
    }

    localStorage.setItem('teamAdminToken', data.token);
    teamAdminState.token = data.token;
    $('adminPasswordInput').value = '';
    setAuthStatus(`Sesion iniciada como ${data.email}`, 'success');
    setAuthMessage('Acceso concedido al panel.');
    enableWorkspace();
    await loadContent();
  } catch (error) {
    disableWorkspace();
    setAuthStatus('Acceso denegado', 'error');
    setAuthMessage(error.message, true);
  }
}

function initializeGoogleLogin() {
  const clientId = teamAdminState.authConfig?.googleClientId;
  if (!clientId) {
    setAuthStatus('Google Login no configurado', 'error');
    setAuthMessage('Falta GOOGLE_CLIENT_ID en el servidor. Sin eso el panel no puede autenticar administradores.', true);
    return;
  }

  if (!window.google?.accounts?.id) {
    setAuthStatus('Google Login no disponible', 'error');
    setAuthMessage('No se pudo cargar el SDK de Google.', true);
    return;
  }

  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: handleGoogleCredential
  });

  window.google.accounts.id.renderButton($('googleLoginMount'), {
    theme: 'outline',
    size: 'large',
    text: 'continue_with',
    shape: 'pill'
  });
}

async function bootstrapAdmin() {
  try {
    const response = await fetch('/api/team/auth-config');
    if (!response.ok) {
      throw new Error('No se pudo obtener la configuracion de acceso.');
    }

    teamAdminState.authConfig = await response.json();
    teamAdminState.token = getStoredToken();

    if (teamAdminState.token) {
      setAuthStatus('Sesion activa', 'success');
      setAuthMessage('Sesion restaurada.');
      enableWorkspace();
      await loadContent();
    } else {
      disableWorkspace();
      setAuthStatus(`Acceso solo para ${teamAdminState.authConfig.adminEmail}`, 'neutral');
    }

    $('adminEmailInput').value = teamAdminState.authConfig.adminEmail || '';
    togglePasswordLogin(Boolean(teamAdminState.authConfig.passwordEnabled));
    initializeGoogleLogin();
  } catch (error) {
    disableWorkspace();
    setAuthStatus('Error de configuracion', 'error');
    setAuthMessage(error.message, true);
  }
}

function bindInputs() {
  [
    'aboutEyebrow', 'aboutTitle', 'aboutDescription', 'workgroupTitleInput', 'workgroupDescriptionInput'
  ].forEach(id => $(id).addEventListener('input', syncAboutEditor));

  [
    'memberName', 'memberSlug', 'memberRole', 'memberTier', 'memberBadge', 'memberCountry', 'memberCity',
    'memberFullNameInput', 'memberSummary', 'memberShortBio', 'memberLifeStory', 'memberSpecialtiesInput', 'memberEmail', 'memberPhone',
    'memberInstagram', 'memberTiktok', 'memberDiscord', 'memberWebsite'
  ].forEach(id => $(id).addEventListener('input', syncMemberEditor));
  $('memberFeatured').addEventListener('change', syncMemberEditor);

  ['workgroupName', 'workgroupRole', 'workgroupCountry', 'workgroupCity', 'workgroupDescriptionField']
    .forEach(id => $(id).addEventListener('input', syncWorkgroupEditor));

  $('saveContentButton').addEventListener('click', saveContent);
  $('resetContentButton').addEventListener('click', resetContent);

  $('addMemberButton').addEventListener('click', () => {
    teamAdminState.content.members.push(defaultMember());
    teamAdminState.selectedMemberIndex = teamAdminState.content.members.length - 1;
    renderAllEditors();
    updateDirtyState();
  });

  $('removeMemberButton').addEventListener('click', () => {
    if (teamAdminState.selectedMemberIndex < 0) return;
    const currentMember = teamAdminState.content.members[teamAdminState.selectedMemberIndex];
    const confirmed = window.confirm(`Vas a eliminar a ${currentMember?.name || 'este integrante'}. Esta accion se guardara cuando pulses Guardar cambios. Deseas continuar?`);
    if (!confirmed) return;
    teamAdminState.content.members.splice(teamAdminState.selectedMemberIndex, 1);
    teamAdminState.selectedMemberIndex = teamAdminState.content.members.length ? 0 : -1;
    renderAllEditors();
    updateDirtyState();
  });

  $('addWorkgroupButton').addEventListener('click', () => {
    teamAdminState.content.workgroup.members.push(defaultWorkgroupMember());
    teamAdminState.selectedWorkgroupIndex = teamAdminState.content.workgroup.members.length - 1;
    renderAllEditors();
    updateDirtyState();
  });

  $('removeWorkgroupButton').addEventListener('click', () => {
    if (teamAdminState.selectedWorkgroupIndex < 0) return;
    const currentMember = teamAdminState.content.workgroup.members[teamAdminState.selectedWorkgroupIndex];
    const confirmed = window.confirm(`Vas a eliminar a ${currentMember?.name || 'este miembro del grupo'}. Esta accion se guardara cuando pulses Guardar cambios. Deseas continuar?`);
    if (!confirmed) return;
    teamAdminState.content.workgroup.members.splice(teamAdminState.selectedWorkgroupIndex, 1);
    teamAdminState.selectedWorkgroupIndex = teamAdminState.content.workgroup.members.length ? 0 : -1;
    renderAllEditors();
    updateDirtyState();
  });

  $('memberImageUpload').addEventListener('change', handleMemberImageUpload);
  $('workgroupImageUpload').addEventListener('change', handleWorkgroupImageUpload);

  $('logoutButton').addEventListener('click', () => {
    localStorage.removeItem('teamAdminToken');
    teamAdminState.token = null;
    disableWorkspace();
    setAuthStatus('Sesion cerrada', 'neutral');
    setAuthMessage('Vuelve a iniciar sesion para editar.');
  });

  $('passwordLoginForm').addEventListener('submit', handlePasswordLogin);

  window.addEventListener('beforeunload', event => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

bindInputs();
bootstrapAdmin();