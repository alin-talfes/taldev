document.addEventListener('DOMContentLoaded', () => {
  const search = document.getElementById('searchEmployee');
  const department = document.getElementById('departmentFilter');
  const status = document.getElementById('statusFilter');
  const rows = [...document.querySelectorAll('#employeeRows tr')];
  const resultCount = document.getElementById('resultCount');
  const emptyState = document.getElementById('emptyState');
  const drawer = document.getElementById('profileDrawer');
  const backdrop = document.getElementById('drawerBackdrop');
  const closeDrawer = document.getElementById('closeDrawer');
  const toast = document.getElementById('toast');
  const profiles = {
    ana: ['AM','Ana Marinescu','Manager operațional','Operațional','Nedeterminat · normă întreagă','12 februarie 2022','Andrei Pavel','Activ'],
    mihai: ['MP','Mihai Pop','Dezvoltator web','Tehnic','Nedeterminat · normă întreagă','5 iunie 2023','Sorin Iacob','Activ'],
    ioana: ['IR','Ioana Radu','Specialist HR','Administrativ','Nedeterminat · normă întreagă','18 septembrie 2021','Andrei Pavel','Activ'],
    vlad: ['VD','Vlad Dumitru','Analist suport','Tehnic','Determinat · normă întreagă','9 ianuarie 2026','Sorin Iacob','Concediu'],
    elena: ['ES','Elena Stoica','Account manager','Vânzări','Nedeterminat · normă întreagă','23 martie 2024','Dana Matei','Activ'],
    radu: ['RN','Radu Neagu','Coordonator logistică','Operațional','Determinat · normă întreagă','4 septembrie 2025','Ana Marinescu','Activ']
  };

  function filterRows() {
    const query = search.value.trim().toLocaleLowerCase('ro');
    let visible = 0;
    rows.forEach(row => {
      const searchable = `${row.dataset.name} ${row.dataset.role} ${row.textContent}`.toLocaleLowerCase('ro');
      const matches = searchable.includes(query) && (department.value === 'all' || row.dataset.department === department.value) && (status.value === 'all' || row.dataset.status === status.value);
      row.hidden = !matches;
      if (matches) visible += 1;
    });
    resultCount.textContent = `${visible} ${visible === 1 ? 'înregistrare afișată' : 'înregistrări afișate'}`;
    emptyState.hidden = visible !== 0;
  }

  function openProfile(key) {
    const [initials,name,role,dept,contract,hire,manager,state] = profiles[key];
    document.getElementById('profileAvatar').textContent = initials;
    document.getElementById('profileName').textContent = name;
    document.getElementById('profileRole').textContent = role;
    document.getElementById('profileDepartment').textContent = dept;
    document.getElementById('profileContract').textContent = contract;
    document.getElementById('profileHire').textContent = hire;
    document.getElementById('profileManager').textContent = manager;
    const profileStatus = document.getElementById('profileStatus');
    profileStatus.textContent = state;
    profileStatus.className = `badge ${state === 'Activ' ? 'active-badge' : 'leave-badge'}`;
    backdrop.hidden = false;
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden','false');
    closeDrawer.focus();
  }

  function hideDrawer() {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden','true');
    backdrop.hidden = true;
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  [search,department,status].forEach(control => control.addEventListener(control === search ? 'input' : 'change', filterRows));
  document.querySelectorAll('.view-profile').forEach(button => button.addEventListener('click', () => openProfile(button.dataset.person)));
  closeDrawer.addEventListener('click', hideDrawer);
  backdrop.addEventListener('click', hideDrawer);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && drawer.classList.contains('open')) hideDrawer(); });
  document.getElementById('addEmployee').addEventListener('click', () => showToast('Formular demonstrativ: în versiunea completă se creează un dosar nou de angajat.'));
  document.getElementById('exportEmployees').addEventListener('click', () => showToast('Export demonstrativ pregătit. Lista poate fi generată în Excel sau PDF.'));
  document.getElementById('openFullProfile').addEventListener('click', () => showToast('Dosarul complet este disponibil în versiunea finală a aplicației.'));
  document.querySelectorAll('.side-nav button').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.side-nav button').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    showToast(`${button.textContent.trim()}: modul este prezentat în versiunea completă.`);
  }));
});
