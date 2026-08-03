// medicine-reminder-app/frontend/app.js

import { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from './firebase.js';

const API_BASE_URL = 'http://localhost:5000/api';

// DOM Elements
const loginBtn = document.getElementById('login-btn');
const signupBtn = document.getElementById('signup-btn');
const authForm = document.getElementById('auth-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const authError = document.getElementById('auth-error');
const authSuccess = document.getElementById('auth-success');

const logoutBtn = document.getElementById('logout-btn');
const userEmailSpan = document.getElementById('user-email');
const settingEmailSpan = document.getElementById('setting-email');
const addMedicineForm = document.getElementById('add-medicine-form');
const medicinesContainer = document.getElementById('medicines-container');

const alarmModal = document.getElementById('alarm-modal');
const buzzerAudio = document.getElementById('buzzer-audio');
const alarmMedName = document.getElementById('alarm-medicine-name');

const navItems = document.querySelectorAll('.nav-item');
const pageSections = document.querySelectorAll('.page-section');
const pageTitle = document.getElementById('page-title');
const menuToggle = document.getElementById('menu-toggle');
const closeSidebar = document.getElementById('close-sidebar');
const sidebar = document.getElementById('sidebar');

const statActive = document.getElementById('stat-active');
const statTaken = document.getElementById('stat-taken');
const statMissed = document.getElementById('stat-missed');
const historyTableBody = document.getElementById('history-table-body');
const historyEmptyState = document.getElementById('history-empty-state');

let currentUser = null;
let cachedMedicines = [];        // Cache for better performance
let activeAlarms = new Set();    // Track active alarms
let isLoading = false;

// =============================================
// Navigation Logic
// =============================================
if (navItems.length > 0) {
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');

      const target = item.getAttribute('data-target');
      pageTitle.textContent = item.querySelector('span').textContent;

      pageSections.forEach(section => section.classList.remove('active'));
      document.getElementById(target).classList.add('active');

      if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
      }
    });
  });
}

if (menuToggle) menuToggle.addEventListener('click', () => sidebar.classList.add('open'));
if (closeSidebar) closeSidebar.addEventListener('click', () => sidebar.classList.remove('open'));

// =============================================
// Authentication Logic
// =============================================
if (authForm) {
  loginBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!authForm.checkValidity()) return authForm.reportValidity();

    const email = emailInput.value;
    const password = passwordInput.value;

    try {
      await signInWithEmailAndPassword(auth, email, password);
      window.location.href = 'index.html';
    } catch (error) {
      showError(error.message);
    }
  });

  signupBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!authForm.checkValidity()) return authForm.reportValidity();

    const email = emailInput.value;
    const password = passwordInput.value;

    try {
      await createUserWithEmailAndPassword(auth, email, password);
      showSuccess("Account created successfully! Redirecting...");
      setTimeout(() => window.location.href = 'index.html', 1500);
    } catch (error) {
      showError(error.message);
    }
  });

  function showError(msg) {
    authError.textContent = msg;
    authError.style.display = 'block';
    authSuccess.style.display = 'none';
  }

  function showSuccess(msg) {
    authSuccess.textContent = msg;
    authSuccess.style.display = 'block';
    authError.style.display = 'none';
  }
}

// =============================================
// Dashboard Logic
// =============================================
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    if (userEmailSpan) userEmailSpan.textContent = user.email;
    if (settingEmailSpan) settingEmailSpan.textContent = user.email;

    if (medicinesContainer) {
      await loadMedicines();
      checkAlarms();                    // Initial check
      setInterval(checkAlarms, 3000);  // Check every 3 seconds (optimized)
    }

    if (window.location.pathname.includes('login.html')) {
      window.location.href = 'index.html';
    }
  } else {
    currentUser = null;
    if (!window.location.pathname.includes('login.html')) {
      window.location.href = 'login.html';
    }
  }
});

if (logoutBtn) {
  logoutBtn.addEventListener('click', () => signOut(auth));
}

// =============================================
// Add Medicine Form
// =============================================
if (addMedicineForm) {
  addMedicineForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('med-name').value.trim();
    const time = document.getElementById('med-time').value;
    const duration = document.getElementById('med-duration').value;
    const phone = document.getElementById('med-phone').value.trim();
    const emergencyPhone = document.getElementById('med-emergency-phone').value.trim();
    const photoInput = document.getElementById('med-photo');

    let photo = '';
    if (photoInput.files && photoInput.files[0]) {
      const reader = new FileReader();
      reader.onloadend = () => {
        photo = reader.result;
        submitMedicine(name, time, duration, phone, emergencyPhone, photo);
      };
      reader.readAsDataURL(photoInput.files[0]);
    } else {
      submitMedicine(name, time, duration, phone, emergencyPhone, photo);
    }
  });
}

async function submitMedicine(name, time, duration, phone, emergencyPhone, photo) {
  try {
    const response = await fetch(`${API_BASE_URL}/medicines/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: currentUser.uid,
        name,
        time,
        duration: parseInt(duration),
        phone,
        emergencyPhone,
        photo
      })
    });

    if (response.ok) {
      addMedicineForm.reset();
      await loadMedicines();        // Refresh after successful add
    } else {
      alert("Failed to add medicine schedule");
    }
  } catch (error) {
    console.error("Error adding medicine:", error);
    alert("Something went wrong while adding medicine");
  }
}

// =============================================
// Optimized Load Medicines
// =============================================
async function loadMedicines() {
  if (!currentUser || isLoading) return;

  isLoading = true;
  medicinesContainer.innerHTML = `
    <div class="empty-state">
      <p>Loading your medicines...</p>
    </div>`;

  try {
    const response = await fetch(`${API_BASE_URL}/medicines/${currentUser.uid}`);
    cachedMedicines = await response.json();

    renderMedicines(cachedMedicines);
    renderHistory(cachedMedicines);
    updateStats(cachedMedicines);
  } catch (error) {
    console.error("Error loading medicines:", error);
    medicinesContainer.innerHTML = `
      <div class="empty-state">
        <p>Error loading data. Please try refreshing.</p>
      </div>`;
  } finally {
    isLoading = false;
  }
}

// =============================================
// Render Functions
// =============================================
function renderMedicines(medicines) {
  if (!medicinesContainer) return;
  medicinesContainer.innerHTML = '';

  const activeMedicines = medicines.filter(m => m.status !== 'deleted');

  if (activeMedicines.length === 0) {
    medicinesContainer.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-box-open"></i>
        <p>No active schedules found.</p>
      </div>`;
    return;
  }

  activeMedicines.forEach(med => {
    const card = document.createElement('div');
    card.className = 'med-card';

    const today = new Date().toDateString();
    const todayRecord = (med.history || []).find(h =>
      new Date(h.date).toDateString() === today
    );
    let todayStatus = 'upcoming';

    const [hours, minutes] = med.time.split(':').map(Number);
    const medicineTime = new Date();
    medicineTime.setHours(hours, minutes, 0, 0);

    const now = new Date();

    if (todayRecord) {
      if (todayRecord.status === 'taken') {
        todayStatus = 'taken';
      } else if (todayRecord.status === 'missed') {
        todayStatus = 'missed';
      } else if (todayRecord.status === 'pending') {
        todayStatus = 'pending';
      }
    } else if (now >= medicineTime) {
      todayStatus = 'pending';
    }
    card.innerHTML = `
      <div class="med-header">
        <span class="med-name"><i class="fas fa-capsules"></i> ${med.name}</span>
        <span class="status-badge status-${todayStatus}">${todayStatus}</span>
      </div>
      <div class="med-details">
        <div class="detail-item">
          <span class="detail-label">Time</span>
          <span class="detail-value">${med.time}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Days Left</span>
          <span class="detail-value">${calculateDaysLeft(med.endDate)}</span>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn secondary-btn full-width" onclick="deleteMedicine('${med._id}')" style="color:var(--danger); border-color:var(--danger);">
          <i class="fas fa-trash-alt"></i> Delete
        </button>
        ${todayStatus !== 'taken' ? `
        <button class="btn success-btn full-width" onclick="confirmMedicine('${med._id}')">
          <i class="fas fa-check"></i> Take Now
        </button>` : ''}
      </div>
    `;
    medicinesContainer.appendChild(card);
  });
}

function renderHistory(medicines) {
  if (!historyTableBody) return;
  historyTableBody.innerHTML = '';

  let allHistory = [];

  medicines.forEach(med => {
    if (med.history) {
      med.history.forEach(record => {
        allHistory.push({
          medName: med.name,
          time: med.time,
          date: record.date,
          status: record.status
        });
      });
    }
  });

  allHistory.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (allHistory.length === 0) {
    historyEmptyState.style.display = 'block';
  } else {
    historyEmptyState.style.display = 'none';
    allHistory.forEach(record => {
      const dateStr = new Date(record.date).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      });
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><strong>${record.medName}</strong></td>
        <td>${dateStr}</td>
        <td>${record.time}</td>
        <td><span class="status-badge status-${record.status}">${record.status}</span></td>
      `;
      historyTableBody.appendChild(row);
    });
  }
}

function updateStats(medicines) {
  if (!statActive) return;

  const today = new Date().toDateString();
  let takenCount = 0;
  let missedCount = 0;
  let activeCount = medicines.filter(m => m.status !== 'deleted').length;

  medicines.forEach(med => {
    const todayRecord = (med.history || []).find(h =>
      new Date(h.date).toDateString() === today
    );
    if (todayRecord) {
      if (todayRecord.status === 'taken') takenCount++;
      if (todayRecord.status === 'missed') missedCount++;
    }
  });

  statActive.textContent = activeCount;
  statTaken.textContent = takenCount;
  statMissed.textContent = missedCount;
}

function calculateDaysLeft(endDateStr) {
  if (!endDateStr) return '-';
  const end = new Date(endDateStr);
  const now = new Date();
  const diffTime = end - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays : 0;
}

// =============================================
// Global Functions (for inline onclick)
// =============================================
window.deleteMedicine = async (id) => {
  if (!confirm("Are you sure you want to delete this schedule?")) return;

  // Optimistic update
  cachedMedicines = cachedMedicines.filter(m => m._id !== id);
  renderMedicines(cachedMedicines);

  try {
    await fetch(`${API_BASE_URL}/medicines/${id}`, { method: 'DELETE' });
  } catch (error) {
    console.error(error);
    alert("Failed to delete. Refreshing...");
    loadMedicines();
  }
};

window.confirmMedicine = async (id) => {
  stopAlarm(id);

  try {
    await fetch(`${API_BASE_URL}/medicines/${id}/confirm`, {
      method: 'PUT'
    });

    await loadMedicines();
  } catch (error) {
    console.error(error);
  }
};

window.dismissMedicine = async (id) => {
  // FULL stop buzzer
  buzzerAudio.pause();
  buzzerAudio.currentTime = 0;

  alarmModal.classList.remove('active');
  alarmModal.style.display = 'none';

  activeAlarms.delete(id + '_1');

  try {
    await fetch(`${API_BASE_URL}/medicines/${id}/dismiss`, {
      method: 'PUT'
    });

    await loadMedicines();
  } catch (error) {
    console.error(error);
  }
};

function stopAlarm(id) {
  buzzerAudio.pause();
  buzzerAudio.currentTime = 0;
  alarmModal.classList.remove('active');
  alarmModal.style.display = 'none';

  if (id) {
    activeAlarms.delete(id + '_1');
    activeAlarms.delete(id + '_2');
  }
}

window.testBuzzer = () => {
  // ... your existing testBuzzer code (unchanged)
};

// =============================================
// Alarm Logic (Optimized)
// =============================================
async function checkAlarms() {
  if (!currentUser) return;

  try {
    // Use cached data if available to reduce API calls
    const medicines = cachedMedicines.length > 0 ? cachedMedicines :
      (await (await fetch(`${API_BASE_URL}/medicines/${currentUser.uid}`)).json());

    const now = new Date();
    const todayStr = now.toDateString();

    medicines.forEach(med => {
      if (med.status === 'deleted') return;

      const todayRecord = (med.history || []).find(h =>
        new Date(h.date).toDateString() === todayStr
      );

      if (todayRecord && todayRecord.status === 'taken') return;

      const [hours, minutes] = med.time.split(':').map(Number);
      const alarmTime = new Date();
      alarmTime.setHours(hours, minutes, 0, 0);

      const diffMinutes = Math.floor((now - alarmTime) / (1000 * 60));

      const firstAlarmKey = med._id + '_1';
      const secondAlarmKey = med._id + '_2';

      // First buzzer
      if (diffMinutes >= 0 && diffMinutes < 2 && !todayRecord?.firstBuzzerDismissed) {
        if (!activeAlarms.has(firstAlarmKey)) {
          activeAlarms.add(firstAlarmKey);
          triggerAlarm(med, 1);
        }
      }

      // Stop first buzzer
      if (diffMinutes >= 2 && activeAlarms.has(firstAlarmKey)) {
        stopAlarm(med._id);
      }

      // Second buzzer
      if (
        diffMinutes >= 7 &&
        diffMinutes < 9 &&
        (todayRecord?.firstBuzzerDismissed || todayRecord?.status === 'pending')
      ) {
        if (!activeAlarms.has(secondAlarmKey)) {
          activeAlarms.add(secondAlarmKey);
          triggerAlarm(med, 2);
        }
      }

      // Stop second buzzer
      if (diffMinutes >= 9 && activeAlarms.has(secondAlarmKey)) {
        stopAlarm(med._id);
      }
    });
  } catch (error) {
    console.error("Error checking alarms:", error);
  }
}

function triggerAlarm(medicine, type) {
  const alarmId = medicine._id + '_' + type;
  activeAlarms.add(alarmId);

  const dismissBtn = document.getElementById('dismiss-alarm-btn');
  const confirmBtn = document.getElementById('stop-alarm-btn');
  const photoEl = document.getElementById('alarm-medicine-photo');

  if (medicine.photo) {
    photoEl.src = medicine.photo;
    photoEl.style.display = 'block';
  } else {
    photoEl.style.display = 'none';
  }

  alarmMedName.textContent = type === 1
    ? `${medicine.name} (Time to take!)`
    : `${medicine.name} (Confirm taken!)`;

  dismissBtn.style.display = type === 1 ? 'inline-block' : 'none';

  alarmModal.classList.add('active');

  buzzerAudio.pause();
  buzzerAudio.currentTime = 0;
  buzzerAudio.play().catch(e => console.log(e));

  confirmBtn.onclick = () => window.confirmMedicine(medicine._id);
  dismissBtn.onclick = () => window.dismissMedicine(medicine._id);
}

// =============================================
// AI Nutritionist Logic
// =============================================
const generateDietBtn = document.getElementById('generate-diet-btn');
const medicalReportInput = document.getElementById('medical-report');
const medicalImageInput = document.getElementById('medical-image');
const whatsappNumberInput = document.getElementById('whatsapp-number');
const dietLoading = document.getElementById('diet-loading');
const dietResults = document.getElementById('diet-results');

if (generateDietBtn) {
  generateDietBtn.addEventListener('click', async () => {
    const reportText = medicalReportInput.value.trim();
    const whatsappNumber = whatsappNumberInput.value.trim();
    
    if (!reportText && (!medicalImageInput.files || medicalImageInput.files.length === 0)) {
      alert("Please provide either a medical report text or upload an image.");
      return;
    }

    dietLoading.style.display = 'block';
    dietResults.style.display = 'none';
    generateDietBtn.disabled = true;

    try {
      let base64Image = null;
      let mimeType = null;

      if (medicalImageInput.files && medicalImageInput.files.length > 0) {
        const file = medicalImageInput.files[0];
        mimeType = file.type;
        base64Image = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = error => reject(error);
          reader.readAsDataURL(file);
        });
      }

      const response = await fetch(`${API_BASE_URL}/ai/generate-diet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          reportText, 
          base64Image, 
          mimeType, 
          whatsappNumber,
          userId: currentUser ? currentUser.uid : null
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to generate diet plan');
      }

      const data = await response.json();
      
      // Populate summary
      document.getElementById('diet-conditions').textContent = data.summary?.detectedConditions?.join(', ') || 'None';
      document.getElementById('diet-risk').textContent = data.summary?.riskLevel || 'Unknown';
      document.getElementById('diet-calories').textContent = data.totalCalories || 0;
      
      // Populate meals
      document.getElementById('diet-early-morning-items').innerHTML = data.dietPlan?.earlyMorning?.foodItems?.join('<br>') || 'No data';
      document.getElementById('diet-morning-items').innerHTML = data.dietPlan?.morning?.foodItems?.join('<br>') || 'No data';
      document.getElementById('diet-afternoon-items').innerHTML = data.dietPlan?.afternoon?.foodItems?.join('<br>') || 'No data';
      document.getElementById('diet-snacks-items').innerHTML = data.dietPlan?.snacks?.foodItems?.join('<br>') || 'No data';
      document.getElementById('diet-night-items').innerHTML = data.dietPlan?.night?.foodItems?.join('<br>') || 'No data';
      
      // Populate notes
      document.getElementById('diet-restrictions').innerHTML = `<strong>Restrictions:</strong> <br>${data.restrictions?.join('<br>') || 'None'}`;
      document.getElementById('diet-hydration').innerHTML = `<strong>Hydration:</strong> ${data.hydration || 'N/A'}`;
      document.getElementById('diet-extra-notes').innerHTML = `<strong>Notes:</strong> ${data.notes || ''}`;

      dietResults.style.display = 'block';
    } catch (error) {
      console.error(error);
      alert("Error generating diet plan: " + error.message);
    } finally {
      dietLoading.style.display = 'none';
      generateDietBtn.disabled = false;
    }
  });
}