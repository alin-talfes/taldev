document.addEventListener('DOMContentLoaded', () => {
  const toast = document.getElementById('toast');
  const clockButton = document.getElementById('clockButton');
  const exportButton = document.getElementById('exportButton');
  const employeeFilter = document.getElementById('employeeFilter');
  const rows = [...document.querySelectorAll('#timesheetRows tr')];
  let clockedIn = false;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 3200);
  }

  clockButton.addEventListener('click', () => {
    clockedIn = !clockedIn;
    clockButton.textContent = clockedIn ? 'Înregistrează ieșirea' : 'Înregistrează intrarea';
    clockButton.setAttribute('aria-pressed', String(clockedIn));
    showToast(clockedIn ? 'Intrare demonstrativă înregistrată la ora curentă.' : 'Ieșire demonstrativă înregistrată. Pontajul nu este salvat.');
  });

  exportButton.addEventListener('click', () => showToast('Export demonstrativ pregătit. În versiunea finală se poate genera PDF sau Excel.'));

  employeeFilter.addEventListener('change', () => {
    rows.forEach(row => row.hidden = employeeFilter.value !== 'all' && row.dataset.employee !== employeeFilter.value);
  });

  document.querySelectorAll('.nav button').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.nav button').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
      showToast(`${button.textContent.trim()}: modul disponibil în versiunea completă.`);
    });
  });
});
