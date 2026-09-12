// medicine-reminder-app/frontend/app.js

import { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from './firebase.js';

const API_BASE_URL = 'https://medicine-reminder-backend-k64i.onrender.com/api';

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
const sidebarOverlay = document.getElementById('sidebar-overlay');

const statActive = document.getElementById('stat-active');
const statTaken = document.getElementById('stat-taken');
const statMissed = document.getElementById('stat-missed');
const historyTableBody = document.getElementById('history-table-body');
const historyEmptyState = document.getElementById('history-empty-state');

let currentUser = null;
let cachedMedicines = [];        // Cache for better performance
let activeAlarms = new Set();    // Track active alarms
let isLoading = false;

// Function to open/close mobile sidebar cleanly
function toggleMobileSidebar(open) {
  if (!sidebar) return;
  if (open) {
    sidebar.classList.add('open');
    if (sidebarOverlay) sidebarOverlay.classList.add('active');
  } else {
    sidebar.classList.remove('open');
    if (sidebarOverlay) sidebarOverlay.classList.remove('active');
  }
}

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

      toggleMobileSidebar(false);
    });
  });
}

if (menuToggle) menuToggle.addEventListener('click', () => toggleMobileSidebar(true));
if (closeSidebar) closeSidebar.addEventListener('click', () => toggleMobileSidebar(false));
if (sidebarOverlay) sidebarOverlay.addEventListener('click', () => toggleMobileSidebar(false));

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
      await loadUserDevices();
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
    const reminderMode = document.getElementById('med-reminder-mode') ? document.getElementById('med-reminder-mode').value : 'mobile';
    const deviceId = document.getElementById('med-device-id') ? document.getElementById('med-device-id').value : '';
    const photoInput = document.getElementById('med-photo');

    let photo = '';
    if (photoInput.files && photoInput.files[0]) {
      const reader = new FileReader();
      reader.onloadend = () => {
        photo = reader.result;
        submitMedicine(name, time, duration, phone, emergencyPhone, photo, reminderMode, deviceId);
      };
      reader.readAsDataURL(photoInput.files[0]);
    } else {
      submitMedicine(name, time, duration, phone, emergencyPhone, photo, reminderMode, deviceId);
    }
  });
}

async function submitMedicine(name, time, duration, phone, emergencyPhone, photo, reminderMode, deviceId) {
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
        photo,
        reminderMode: reminderMode || 'mobile',
        deviceId: deviceId || ''
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
    const isIot = med.reminderMode === 'iot';
    const modeBadge = isIot
      ? `<span class="mode-badge iot-badge" style="font-size: 11px; background: rgba(139, 92, 246, 0.2); color: #a78bfa; padding: 2px 8px; border-radius: 12px; margin-left: 6px;"><i class="fas fa-microchip"></i> IoT (${med.deviceId || 'ESP32'})</span>`
      : `<span class="mode-badge mobile-badge" style="font-size: 11px; background: rgba(59, 130, 246, 0.2); color: #60a5fa; padding: 2px 8px; border-radius: 12px; margin-left: 6px;"><i class="fas fa-mobile-alt"></i> Mobile</span>`;

    card.innerHTML = `
      <div class="med-header">
        <span class="med-name"><i class="fas fa-capsules"></i> ${med.name} ${modeBadge}</span>
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

function stopAlarm(id) {
  if (buzzerAudio) {
    buzzerAudio.pause();
    buzzerAudio.currentTime = 0;
  }
  if (alarmModal) {
    alarmModal.classList.remove('active');
    alarmModal.style.display = 'none';
  }

  if (id) {
    activeAlarms.delete(id + '_1');
    activeAlarms.delete(id + '_2');
  }
}

window.confirmMedicine = async (id) => {
  stopAlarm(id);

  // Optimistically update cachedMedicines so checkAlarms immediately sees status === 'taken'
  const today = new Date().toDateString();
  const med = cachedMedicines.find(m => m._id === id);
  if (med) {
    if (!med.history) med.history = [];
    let todayRecord = med.history.find(h => new Date(h.date).toDateString() === today);
    if (!todayRecord) {
      todayRecord = { date: new Date(), status: 'taken', takenAt: new Date() };
      med.history.push(todayRecord);
    } else {
      todayRecord.status = 'taken';
      todayRecord.takenAt = new Date();
    }
    renderMedicines(cachedMedicines);
    renderHistory(cachedMedicines);
    updateStats(cachedMedicines);
  }

  try {
    await fetch(`${API_BASE_URL}/medicines/${id}/confirm`, {
      method: 'PUT'
    });
    await loadMedicines();
  } catch (error) {
    console.error("Error confirming medicine:", error);
  }
};

window.dismissMedicine = async (id) => {
  stopAlarm(id);

  // Optimistically update cachedMedicines
  const today = new Date().toDateString();
  const med = cachedMedicines.find(m => m._id === id);
  if (med) {
    if (!med.history) med.history = [];
    let todayRecord = med.history.find(h => new Date(h.date).toDateString() === today);
    if (!todayRecord) {
      todayRecord = { date: new Date(), status: 'pending', firstBuzzerDismissed: true };
      med.history.push(todayRecord);
    } else {
      todayRecord.firstBuzzerDismissed = true;
    }
  }

  try {
    await fetch(`${API_BASE_URL}/medicines/${id}/dismiss`, {
      method: 'PUT'
    });
    await loadMedicines();
  } catch (error) {
    console.error("Error dismissing medicine:", error);
  }
};

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
      if (med.reminderMode === 'iot') return; // ESP32 handles physical audio/LED reminder for IoT mode

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

// =============================================
// IoT Device Management
// =============================================
const registerDeviceForm = document.getElementById('register-device-form');
const devicesContainer = document.getElementById('devices-container');
const medDeviceIdSelect = document.getElementById('med-device-id');

async function loadUserDevices() {
  if (!currentUser) return;
  try {
    const response = await fetch(`${API_BASE_URL}/devices/user/${currentUser.uid}`);
    if (!response.ok) return;

    const devices = await response.json();
    renderDevices(devices);
    populateDeviceDropdown(devices);
  } catch (error) {
    console.error("Error loading user devices:", error);
  }
}

function renderDevices(devices) {
  if (!devicesContainer) return;
  devicesContainer.innerHTML = '';

  if (!devices || devices.length === 0) {
    devicesContainer.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-microchip"></i>
        <p>No IoT devices connected yet.</p>
      </div>`;
    return;
  }

  devices.forEach(dev => {
    const isOnline = dev.status === 'online';
    const lastSeenStr = dev.lastSeen ? new Date(dev.lastSeen).toLocaleTimeString() : 'Never';
    const card = document.createElement('div');
    card.className = 'glass-panel';
    card.style.cssText = 'padding: 16px; border-radius: 12px; display: flex; flex-direction: column; gap: 10px; border: 1px solid var(--border-color);';

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 600; font-size: 15px; color: var(--accent);"><i class="fas fa-microchip"></i> ${dev.deviceName}</span>
        <span class="status-badge" style="background: ${isOnline ? 'rgba(16, 185, 129, 0.2)' : 'rgba(148, 163, 184, 0.2)'}; color: ${isOnline ? 'var(--success)' : 'var(--text-secondary)'}; font-size: 11px;">
          ${isOnline ? '🟢 Online' : '⚪ Offline'}
        </span>
      </div>
      <div style="font-size: 12px; color: var(--text-secondary); display: grid; grid-template-columns: 1fr 1fr; gap: 6px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px;">
        <div><strong>ID:</strong> ${dev.deviceId}</div>
        <div><strong>Type:</strong> ${dev.connectionType || 'WiFi'}</div>
        <div><strong>Sync:</strong> ${dev.syncStatus || 'synced'}</div>
        <div><strong>Last Seen:</strong> ${lastSeenStr}</div>
      </div>
      <button class="btn secondary-btn" onclick="disconnectDevice('${dev.deviceId}')" style="color: var(--danger); border-color: var(--danger); width: 100%; margin-top: 5px;">
        <i class="fas fa-unlink"></i> Disconnect Device
      </button>
    `;

    devicesContainer.appendChild(card);
  });
}

function populateDeviceDropdown(devices) {
  if (!medDeviceIdSelect) return;
  medDeviceIdSelect.innerHTML = '<option value="">No ESP32 Selected (Uses Default)</option>';

  if (devices && devices.length > 0) {
    devices.forEach(dev => {
      const opt = document.createElement('option');
      opt.value = dev.deviceId;
      opt.textContent = `⚡ ${dev.deviceName} (${dev.deviceId})`;
      medDeviceIdSelect.appendChild(opt);
    });
  }
}

if (registerDeviceForm) {
  registerDeviceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return alert("Please login first");

    const deviceId = document.getElementById('dev-id').value.trim();
    const deviceName = document.getElementById('dev-name').value.trim();
    const connectionType = document.getElementById('dev-type').value;

    try {
      const response = await fetch(`${API_BASE_URL}/devices/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          userId: currentUser.uid,
          deviceName,
          connectionType
        })
      });

      if (response.ok) {
        registerDeviceForm.reset();
        await loadUserDevices();
        alert("Device registered successfully!");
      } else {
        const errData = await response.json();
        alert(errData.error || "Failed to register device");
      }
    } catch (error) {
      console.error("Error registering device:", error);
      alert("Something went wrong while registering device");
    }
  });
}

window.disconnectDevice = async (deviceId) => {
  if (!confirm(`Are you sure you want to disconnect device ${deviceId}?`)) return;

  try {
    const response = await fetch(`${API_BASE_URL}/devices/${deviceId}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      await loadUserDevices();
      await loadMedicines();
    } else {
      alert("Failed to disconnect device");
    }
  } catch (error) {
    console.error("Error disconnecting device:", error);
  }
};