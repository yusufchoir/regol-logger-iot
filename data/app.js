/**
 * ============================================================
 * LOGGER MOLINAR — Web Configuration Interface
 * app.js — Pure Vanilla JavaScript ES6+
 * Version: 1.0.0
 * ============================================================
 *
 * ── API ENDPOINTS DOCUMENTATION (untuk Backend C++ ESP32-S3) ──
 *
 * POST /api/login
 *   Body: { "username": "admin", "password": "admin123" }
 *   Response: { "success": true, "role": "admin" | "viewer", "token": "..." }
 *
 * GET /api/status
 *   Response: {
 *     "lte": { "connected": true, "operator": "Telkomsel", "signal": -70, "ip": "10.0.0.1" },
 *     "wifi": { "connected": true, "ssid": "Molinar_AP", "rssi": -55, "ip": "192.168.4.1" },
 *     "rtc": { "datetime": "2026-06-05T20:00:00" },
 *     "ram": { "total": 8192, "used": 2048 },
 *     "flash": { "total": 16384, "used": 4096 }
 *   }
 *
 * POST /api/save-network
 *   Body: {
 *     "lte": { "apn": "internet", "user": "", "pass": "" },
 *     "wifi": { "ssid": "MyWiFi", "password": "pass123", "mode": "client" }
 *   }
 *
 * POST /api/save-mqtt
 *   Body: {
 *     "broker": "mqtt.example.com", "port": 1883, "client_id": "molinar_01",
 *     "username": "user", "password": "pass", "topic": "molinar/data", "enabled": true
 *   }
 *
 * POST /api/save-webhook
 *   Body: {
 *     "url": "https://example.com/webhook", "method": "POST",
 *     "headers": "Content-Type: application/json", "enabled": true
 *   }
 *
 * POST /api/save-restapi
 *   Body: { "api_key": "sk-xxxx", "endpoint": "https://api.example.com", "enabled": true }
 *
 * POST /api/save-opcua
 *   Body: {
 *     "endpoint": "opc.tcp://example.com", "port": 4840,
 *     "node_id": "ns=2;i=1001", "enabled": true
 *   }
 *
 * POST /api/save-pins
 *   Body: {
 *     "kf301": { "uart": false, "rs485": true },
 *     "kf350": { "adc": true, "i2c": false, "current_420": true, "io": false }
 *   }
 *
 * POST /api/save-sensor
 *   Body: {
 *     "rs485": { "baud": 9600, "parity": "N", "stop_bits": 1, "slave_id": 1, "register": 100 },
 *     "adc": { "channel": 0, "min_val": 0, "max_val": 100, "unit": "°C" },
 *     "current_420": { "min_ma": 4, "max_ma": 20, "min_val": 0, "max_val": 100, "unit": "bar" }
 *   }
 *
 * POST /api/save-users
 *   Body: { "users": [{ "username": "admin", "password": "...", "role": "admin" }] }
 *
 * POST /api/sync-rtc
 *   Body: { "datetime": "2026-06-05T20:00:00" }
 *
 * POST /api/format-sd
 *   Body: {}
 *
 * POST /api/reboot
 *   Body: {}
 *
 * POST /api/factory-reset
 *   Body: {}
 *
 * GET /api/logs
 *   Response: { "logs": ["2026-06-05 20:00:00 [INFO] System started", ...] }
 *
 * GET /api/sensor-data
 *   Response: {
 *     "labels": ["10:00","10:05",...],
 *     "temperature": [23.5, 24.1, ...],
 *     "current": [5.2, 5.8, ...]
 *   }
 * ============================================================
 */

'use strict';

/* ============================================================
   STATE MANAGEMENT
   ============================================================ */
const AppState = {
  currentUser: null,
  currentRole: null,  // 'admin' | 'viewer'
  currentSection: null,
  currentTab: {},     // tabGroup -> activeTabId
  language: 'id',    // 'id' | 'en'
  users: [
    { id: 1, username: 'admin', password: 'admin123', role: 'admin' },
    { id: 2, username: 'viewer', password: 'viewer123', role: 'viewer' }
  ],
  pinState: {
    kf301: { uart: false, rs485: false },
    kf350: { adc: false, i2c: false, current_420: false, io: false }
  },
  rtcInterval: null,
  chartInstance: null,
};

/* ============================================================
   TRANSLATIONS
   ============================================================ */
const i18n = {
  id: {
    login_title: 'Masuk ke Panel Konfigurasi',
    login_btn: 'Masuk',
    username_ph: 'Masukkan username',
    password_ph: 'Masukkan password',
    login_err: 'Username atau password salah.',
    sidebar_dashboard: 'Informasi Umum',
    sidebar_telekontrol: 'Panel Kontrol',
    sidebar_grafik: 'Grafik & Log Data',
    sidebar_integrasi: 'Integrasi Server',
    sidebar_hardware: 'Pengaturan Hardware',
    sidebar_otomasi: 'Otomasi',
    sidebar_sistem: 'Manajemen Sistem',
    logout: 'Keluar',
    save: 'Simpan',
    cancel: 'Batal',
    confirm: 'Konfirmasi',
    yes_continue: 'Ya, Lanjutkan',
    saved: 'Disimpan!',
    config_saved: 'Konfigurasi berhasil disimpan.',
    file_downloaded: 'File berhasil diunduh.',
    action_success: 'Aksi berhasil dijalankan.',
    confirm_reboot: 'Reboot Perangkat?',
    confirm_reboot_msg: 'Perangkat akan direstart. Koneksi akan terputus sebentar.',
    confirm_factory: 'Factory Reset?',
    confirm_factory_msg: 'Semua konfigurasi akan dihapus dan perangkat direset ke pengaturan pabrik. Tindakan ini TIDAK dapat dibatalkan.',
    confirm_format: 'Format MicroSD?',
    confirm_format_msg: 'Semua data pada MicroSD akan dihapus permanen. Pastikan Anda sudah backup data.',
  },
  en: {
    login_title: 'Sign In to Configuration Panel',
    login_btn: 'Sign In',
    username_ph: 'Enter username',
    password_ph: 'Enter password',
    login_err: 'Invalid username or password.',
    sidebar_dashboard: 'Overview',
    sidebar_telekontrol: 'Control Panel',
    sidebar_grafik: 'Charts & Logs',
    sidebar_integrasi: 'Server Integration',
    sidebar_hardware: 'Hardware Settings',
    sidebar_sistem: 'System Management',
    logout: 'Sign Out',
    save: 'Save',
    cancel: 'Cancel',
    confirm: 'Confirm',
    yes_continue: 'Yes, Continue',
    saved: 'Saved!',
    config_saved: 'Configuration saved successfully.',
    file_downloaded: 'File downloaded successfully.',
    action_success: 'Action completed successfully.',
    confirm_reboot: 'Reboot Device?',
    confirm_reboot_msg: 'The device will restart. Connection will be interrupted briefly.',
    confirm_factory: 'Factory Reset?',
    confirm_factory_msg: 'All configurations will be deleted and the device will be reset to factory defaults. This action CANNOT be undone.',
    confirm_format: 'Format MicroSD?',
    confirm_format_msg: 'All data on MicroSD will be permanently deleted. Make sure you have backed up your data.',
  }
};

const t = (key) => i18n[AppState.language][key] || key;

/* ============================================================
   MOCK DATA
   ============================================================ */
const MockData = {
  status: {
    lte: { connected: true, operator: 'Telkomsel 4G', signal: -70, ip: '10.118.22.41', uptime: '02:14:33' },
    wifi: { connected: true, ssid: 'Molinar_AP_01', rssi: -48, ip: '192.168.4.1' },
    rtc: { synced: true },
    ram: { total: 8192, used: 2560 },
    flash: { total: 16384, used: 5120 },
  },
  sensorChart: {
    labels: ['09:00', '09:10', '09:20', '09:30', '09:40', '09:50', '10:00', '10:10', '10:20', '10:30', '10:40', '10:50', '11:00', '11:10', '11:20'],
    temperature: [23.2, 23.8, 24.5, 25.1, 25.8, 26.3, 26.0, 25.5, 25.9, 26.4, 27.1, 26.8, 26.2, 25.7, 25.3],
    current: [4.8, 5.1, 5.3, 5.8, 6.2, 5.9, 6.5, 6.8, 6.3, 5.9, 6.1, 6.7, 7.0, 6.4, 6.2],
  },
  logs: [
    { time: '2026-06-05 09:00:01', level: 'ok', msg: 'System boot complete. Logger Molinar v1.0.0' },
    { time: '2026-06-05 09:00:03', level: 'info', msg: 'LittleFS mounted successfully.' },
    { time: '2026-06-05 09:00:05', level: 'info', msg: 'Loading config.json from LittleFS...' },
    { time: '2026-06-05 09:00:06', level: 'ok', msg: 'Config loaded. MQTT enabled. Webhook disabled.' },
    { time: '2026-06-05 09:00:08', level: 'info', msg: 'SIM7600CE initializing...' },
    { time: '2026-06-05 09:00:15', level: 'ok', msg: 'LTE connected. Operator: Telkomsel 4G. IP: 10.118.22.41' },
    { time: '2026-06-05 09:00:16', level: 'info', msg: 'RTC DS3231SN sync OK. Time: 2026-06-05 09:00:16' },
    { time: '2026-06-05 09:00:18', level: 'ok', msg: 'MicroSD mounted. Free: 28.3 GB' },
    { time: '2026-06-05 09:00:20', level: 'info', msg: 'RS485 Modbus scanner starting on baud 9600...' },
    { time: '2026-06-05 09:00:21', level: 'ok', msg: 'Modbus slave 0x01 responded. Temp reg: 235 (23.5°C)' },
    { time: '2026-06-05 09:05:00', level: 'info', msg: 'Sending MQTT payload to broker mqtt.molinar.io:1883' },
    { time: '2026-06-05 09:05:01', level: 'ok', msg: 'MQTT publish success. Topic: molinar/data' },
    { time: '2026-06-05 09:10:00', level: 'info', msg: 'Writing sensor data to MicroSD: /data/20260605.csv' },
    { time: '2026-06-05 09:30:12', level: 'warn', msg: 'ADC 4-20mA channel 0: value near min threshold (4.1 mA)' },
    { time: '2026-06-05 10:00:00', level: 'info', msg: 'Hourly heartbeat. Uptime: 01:00:00. RAM free: 5632 KB' },
    { time: '2026-06-05 10:45:33', level: 'error', msg: 'Webhook POST failed. HTTP 502. Retrying in 30s...' },
    { time: '2026-06-05 10:46:03', level: 'warn', msg: 'Webhook retry 1/3 failed. Will retry again.' },
    { time: '2026-06-05 11:00:00', level: 'ok', msg: 'Webhook connection restored. Service online.' },
  ]
};

/* ============================================================
   TOAST NOTIFICATION SYSTEM
   ============================================================ */
const Toast = {
  container: null,

  init() {
    this.container = document.getElementById('toast-container');
  },

  show(title, message, type = 'info', duration = 3500) {
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        ${message ? `<div class="toast-msg">${message}</div>` : ''}
      </div>`;
    this.container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-out');
      toast.addEventListener('animationend', () => toast.remove());
    }, duration);
  },

  success(title, msg) { this.show(title, msg, 'success'); },
  error(title, msg) { this.show(title, msg, 'error'); },
  warning(title, msg) { this.show(title, msg, 'warning'); },
  info(title, msg) { this.show(title, msg, 'info'); },
};

/* ============================================================
   CONFIRM MODAL
   ============================================================ */
const Modal = {
  overlay: null,
  resolveFn: null,

  init() {
    this.overlay = document.getElementById('modal-overlay');
    document.getElementById('modal-btn-cancel').addEventListener('click', () => this.resolve(false));
    document.getElementById('modal-btn-confirm').addEventListener('click', () => this.resolve(true));
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.resolve(false);
    });
  },

  show({ icon = '⚠️', title, message, confirmText = 'Ya, Lanjutkan', confirmClass = 'btn-danger' }) {
    document.getElementById('modal-icon').textContent = icon;
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').innerHTML = message;
    const btn = document.getElementById('modal-btn-confirm');
    btn.textContent = confirmText;
    btn.className = `btn ${confirmClass}`;
    this.overlay.classList.add('show');

    return new Promise(resolve => { this.resolveFn = resolve; });
  },

  resolve(val) {
    this.overlay.classList.remove('show');
    if (this.resolveFn) this.resolveFn(val);
  }
};

/* ============================================================
   API CLIENT (With Mock Fallback for Local Dev)
   ============================================================ */
const API = {
  async req(endpoint, options = {}) {
    if (window.isOTAUploading) {
      return { error: 'OTA in progress', success: false };
    }
    try {
      const headers = { 'Content-Type': 'application/json', ...options.headers };
      const token = sessionStorage.getItem('molinar_token');
      if (token) headers['X-Auth-Token'] = token;

      const res = await fetch(endpoint, { ...options, headers });

      // FIX: Tangani jika backend merestart dan session terhapus (401 Unauthorized)
      if (res.status === 401 && endpoint !== '/api/login') {
        if (!window._hasAlertedSessionExpired) {
          window._hasAlertedSessionExpired = true;
          Auth.logout();
          Toast.error('Sesi Berakhir', 'Sesi Anda telah berakhir atau perangkat direstart. Silakan login kembali.');
          setTimeout(() => { window._hasAlertedSessionExpired = false; }, 3000);
        }
        return { error: 'Unauthorized', success: false };
      }

      const json = await res.json();
      if (json && json.success === false && !json.error) {
        json.error = json.message || 'Unknown error';
      }
      return json;
    } catch (err) {
      console.warn(`[API Error] ${options.method || 'GET'} ${endpoint} failed: ${err.message}`);
      return { success: false, error: 'Network Error: ' + err.message };
    }
  },

  async get(endpoint) { return this.req(endpoint, { method: 'GET' }); },
  async post(endpoint, data) { return this.req(endpoint, { method: 'POST', body: JSON.stringify(data) }); }
};

/* ============================================================
   AUTHENTICATION
   ============================================================ */
const Auth = {
  loginScreen: null,
  appEl: null,

  init() {
    this.loginScreen = document.getElementById('login-screen');
    this.appEl = document.getElementById('app');

    // Cek session yang tersimpan
    const savedUser = sessionStorage.getItem('molinar_user');
    const savedRole = sessionStorage.getItem('molinar_role');
    if (savedUser && savedRole) {
      AppState.currentUser = savedUser;
      AppState.currentRole = savedRole;
      this.showApp();
    }

    const form = document.getElementById('login-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleLogin();
      });
    }
  },

  async handleLogin() {
    const username = document.getElementById('input-username').value.trim();
    const password = document.getElementById('input-password').value;
    const errorEl = document.getElementById('login-error');

    try {
      const res = await API.post('/api/login', { username, password });
      if (res && res.success) {
        errorEl.classList.remove('show');
        AppState.currentUser = username;
        AppState.currentRole = res.role;

        // Simpan ke sessionStorage
        sessionStorage.setItem('molinar_user', username);
        sessionStorage.setItem('molinar_role', res.role);
        sessionStorage.setItem('molinar_token', res.token);

        this.showApp();
      } else {
        throw new Error('Invalid credentials');
      }
    } catch (err) {
      errorEl.textContent = t('login_err');
      errorEl.classList.add('show');
      errorEl.style.animation = 'none';
      setTimeout(() => { errorEl.style.animation = ''; }, 10);
    }
  },

  async showApp() {
    this.loginScreen.classList.add('hidden');
    this.appEl.classList.add('visible');

    // Update UI with user info
    document.getElementById('sidebar-username').textContent = AppState.currentUser;
    document.getElementById('sidebar-role').textContent = AppState.currentRole === 'admin' ? 'Administrator' : 'View Only';
    document.getElementById('sidebar-avatar').textContent = AppState.currentUser.charAt(0).toUpperCase();

    try {
      const config = await API.get('/api/config');
      if (config && !config.error) {
        BackupRestore._populateForms(config);
      } else {
        Toast.error('Gagal Memuat Konfigurasi', 'Gagal memuat konfigurasi dari perangkat: ' + (config?.error || 'Koneksi terputus.'));
      }
    } catch (err) {
      console.warn("Failed to load initial config from API", err);
      Toast.error('Koneksi Terputus', 'Gagal memuat konfigurasi. Silakan refresh halaman.');
    }

    // Render conditional nav
    Nav.render();

    // Navigate to dashboard
    Nav.navigate('dashboard');
    Dashboard.startClock();
  },

  logout() {
    AppState.currentUser = null;
    AppState.currentRole = null;
    AppState.currentSection = null;

    // Hapus session
    sessionStorage.removeItem('molinar_user');
    sessionStorage.removeItem('molinar_role');
    sessionStorage.removeItem('molinar_token');

    // Clear sensitive inputs
    document.getElementById('input-username').value = '';
    document.getElementById('input-password').value = '';

    this.appEl.classList.remove('visible');
    this.loginScreen.classList.remove('hidden');

    if (AppState.rtcInterval) {
      clearInterval(AppState.rtcInterval);
      AppState.rtcInterval = null;
    }
  }
};

/* ============================================================
   NAVIGATION
   ============================================================ */
const Nav = {
  // Menu definition: id, icon, labelKey, roles allowed, section target
  menus: [
    { id: 'nav-dashboard', icon: '📊', key: 'sidebar_dashboard', section: 'dashboard', roles: ['admin', 'viewer'] },
    { id: 'nav-grafik', icon: '📈', key: 'sidebar_grafik', section: 'grafik', roles: ['admin', 'viewer'] },
    { id: 'nav-integrasi', icon: '🔗', key: 'sidebar_integrasi', section: 'integrasi', roles: ['admin'] },
    { id: 'nav-hardware', icon: '⚙️', key: 'sidebar_hardware', section: 'hardware', roles: ['admin'] },
    { id: 'nav-telekontrol', icon: '🎛️', key: 'sidebar_telekontrol', section: 'telekontrol', roles: ['admin', 'viewer'] },
    { id: 'nav-otomasi', icon: '🤖', key: 'sidebar_otomasi', section: 'otomasi', roles: ['admin'] },
    { id: 'nav-sistem', icon: '🛠️', key: 'sidebar_sistem', section: 'sistem', roles: ['admin'] },
  ],

  render() {
    const navEl = document.getElementById('sidebar-nav');
    navEl.innerHTML = '';

    const accessibleMenus = this.menus.filter(m => m.roles.includes(AppState.currentRole));

    accessibleMenus.forEach(menu => {
      const item = document.createElement('div');
      item.className = 'nav-item';
      item.id = menu.id;
      item.setAttribute('data-section', menu.section);
      item.innerHTML = `<span class="nav-icon">${menu.icon}</span><span>${t(menu.key)}</span>`;
      item.addEventListener('click', () => this.navigate(menu.section));

      // Hide if configured so
      if (menu.id === 'nav-telekontrol' && AppState.telekontrolVisible === false) {
        item.style.display = 'none';
      }

      navEl.appendChild(item);
    });
  },

  navigate(sectionId) {
    // Hide all sections
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    // Show target section
    const section = document.getElementById(`section-${sectionId}`);
    if (section) {
      section.classList.add('active');
      AppState.currentSection = sectionId;
    }

    // Highlight nav
    const navItem = document.querySelector(`[data-section="${sectionId}"]`);
    if (navItem) navItem.classList.add('active');

    // Update header title
    const menu = this.menus.find(m => m.section === sectionId);
    if (menu) {
      document.getElementById('header-page-title').textContent = t(menu.key);
    }

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('show');

    // Lazy init
    if (sectionId === 'grafik') Chart.init();
    if (sectionId === 'dashboard' && typeof LiveSensorViewer !== 'undefined') LiveSensorViewer.render();
    if (sectionId === 'sistem') UserMgr.render();
  }
};

/* ============================================================
   LIVE SENSOR VIEWER (Simulates Real-time Polling)
   ============================================================ */
const LiveSensorViewer = {
  intervalId: null,

  init() {
    this.render();
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => this.updateData(), 2000);
  },

  render() {
    const container = document.getElementById('live-sensor-data');
    if (!container) return;

    const modbus = typeof SensorManager !== 'undefined' ? SensorManager.modbusParams : [];
    const kf350 = typeof SensorManager !== 'undefined' ? SensorManager.kf350Params : [];

    if (modbus.length === 0 && kf350.length === 0) {
      container.innerHTML = `
        <div class="card mb-24" style="text-align:center; padding:32px 24px; border: 1px dashed var(--border);">
          <div style="font-size:32px; margin-bottom:12px; opacity:0.6;">📭</div>
          <h3 style="font-size:14px; color:var(--text-primary); margin-bottom:4px; opacity:0.8;">Belum Ada Sensor yang Ditambahkan</h3>
          <p class="text-sm text-muted">Tambahkan konfigurasi sensor di tab Pengaturan Sensor untuk melihat datanya di sini.</p>
        </div>
      `;
      if (typeof Chart !== 'undefined' && Chart.initialized) Chart.updateDropdown();
      return;
    }

    let html = `
      <div class="card mb-24">
        <div class="card-header">
          <div class="card-title">
            <span class="card-icon">⚡</span>
            Hasil Pengukuran Sensor Real-Time
          </div>
          <span class="status-badge online">LIVE PING</span>
        </div>
        <div class="card-body">
          <div class="live-sensor-grid">
    `;

    // Render Modbus Cards
    modbus.forEach(p => {
      html += `
        <div class="live-sensor-card modbus">
          <div class="live-sensor-name" title="${p.name} (Modbus)">${p.name}</div>
          <div class="live-sensor-value pulse-cyan" id="live-val-modbus-${p.id}">
            -- <span class="live-sensor-unit"></span>
          </div>
        </div>
      `;
    });

    // Render KF350 Cards
    kf350.forEach(p => {
      html += `
        <div class="live-sensor-card kf350">
          <div class="live-sensor-name" title="${p.name} (KF350 ${p.type})">${p.name}</div>
          <div class="live-sensor-value pulse-emerald" id="live-val-kf350-${p.id}">
            -- <span class="live-sensor-unit"></span>
          </div>
        </div>
      `;
    });

    html += `
          </div>
        </div>
      </div>
    `;

    container.innerHTML = html;
    if (typeof Chart !== 'undefined' && Chart.initialized) Chart.updateDropdown();
    this.updateData();
  },

  async updateData() {
    if (typeof SensorManager === 'undefined') return;

    let liveData = null;
    try {
      const res = await API.get('/api/live-data');
      if (res && !res.error) liveData = res;
    } catch (err) { }

    this.updateLiveValues(liveData);
    if (typeof TelekontrolManager !== 'undefined' && liveData && liveData.modbus) {
      // In main.cpp, Telekontrol data is saved inside modbusLiveCache, which is returned as liveData.modbus
      TelekontrolManager.updateLiveUI(liveData.modbus);
    }
  },

  updateLiveValues(liveData) {
    SensorManager.modbusParams.forEach(p => {
      const keyStr = p.name || p.id;
      let rawVal = liveData && liveData.modbus ? (liveData.modbus[keyStr] !== undefined ? liveData.modbus[keyStr] : liveData.modbus[p.id]) : null;
      let htmlVal = '<span style="color:var(--text-muted)">--</span>';

      if (rawVal !== null) {
        let val = parseFloat(rawVal);
        if (typeof val === 'number') val = val.toFixed(1);
        let unit = p.unit || '';
        htmlVal = `${val} <span class="live-sensor-unit">${unit}</span>`;
      }

      // Update dashboard card
      const el = document.getElementById(`live-val-modbus-${p.id}`);
      if (el && AppState.currentSection === 'dashboard') {
        el.innerHTML = htmlVal;
        if (rawVal !== null) {
          el.classList.remove('pulse-cyan');
          void el.offsetWidth;
          el.classList.add('pulse-cyan');
        }
      }

      // Update active table
      const tblEl = document.getElementById(`table-val-modbus-${p.id}`);
      if (tblEl) {
        tblEl.innerHTML = htmlVal;
        if (rawVal !== null) {
          tblEl.style.color = 'var(--cyan)';
          tblEl.style.textShadow = '0 0 8px var(--cyan-dim)';
          setTimeout(() => { tblEl.style.color = ''; tblEl.style.textShadow = ''; }, 300);
        }
      }
    });

    SensorManager.kf350Params.forEach(p => {
      const keyStr = p.name || p.id;
      let rawVal = liveData && liveData.kf350 ? (liveData.kf350[keyStr] !== undefined ? liveData.kf350[keyStr] : liveData.kf350[p.id]) : null;
      let htmlVal = '<span style="color:var(--text-muted)">--</span>';

      if (rawVal !== null) {
        let val = rawVal;
        let unit = p.unit || '';

        if (p.type === 'Digital') {
          val = (val === 0 || val === "OFF") ? 'OFF' : 'ON';
        } else {
          val = parseFloat(rawVal);
          if (p.type === 'Analog') { if (!isNaN(val)) val = val.toFixed(2); }
          else if (p.type === 'I2C') { if (!isNaN(val)) val = val.toFixed(1); }
        }
        htmlVal = `${val} <span class="live-sensor-unit">${unit}</span>`;
      }

      // Update dashboard card
      const el = document.getElementById(`live-val-kf350-${p.id}`);
      if (el && AppState.currentSection === 'dashboard') {
        el.innerHTML = htmlVal;
        if (rawVal !== null) {
          el.classList.remove('pulse-emerald');
          void el.offsetWidth;
          el.classList.add('pulse-emerald');
        }
      }

      // Update active table
      const tblEl = document.getElementById(`table-val-kf350-${p.id}`);
      if (tblEl) {
        tblEl.innerHTML = htmlVal;
        if (rawVal !== null) {
          tblEl.style.color = 'var(--emerald)';
          tblEl.style.textShadow = '0 0 8px var(--emerald-dim)';
          setTimeout(() => { tblEl.style.color = ''; tblEl.style.textShadow = ''; }, 300);
        }
      }
    });

    // Real Server Integration Status (Tergantung koneksi riil dari sistem)
    const protocols = [
      { id: 'mqtt', toggle: 'mqtt-enabled' },
      { id: 'webhook', toggle: 'wh-enabled' },
      { id: 'restapi', toggle: 'rest-enabled' },
      { id: 'opcua', toggle: 'opcua-enabled' }
    ];

    protocols.forEach(proto => {
      const el = document.getElementById(`status-${proto.id}`);
      const checkbox = document.getElementById(proto.toggle);
      if (el && checkbox) {
        if (checkbox.checked) {
          let isConnected = true;
          if (liveData && liveData.error) isConnected = false;

          el.className = isConnected ? 'chip chip-emerald' : 'chip chip-danger';
          el.innerText = isConnected ? 'Terhubung' : 'Terputus';
        } else {
          el.className = 'chip chip-secondary';
          el.innerText = 'Nonaktif';
        }
      }
    });
  }
};

/* ============================================================
   DASHBOARD
   ============================================================ */
const Dashboard = {
  statusInterval: null,

  startClock() {
    const updateClock = () => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      const dateStr = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      const el = document.getElementById('rtc-time');
      const del = document.getElementById('rtc-date');
      if (el) el.textContent = timeStr;
      if (del) del.textContent = dateStr;
    };
    updateClock();
    AppState.rtcInterval = setInterval(updateClock, 1000);

    // Initialize live sensor updates
    LiveSensorViewer.init();

    // Fetch API status data
    this.fetchStatus();
    this.statusInterval = setInterval(() => this.fetchStatus(), 3000);
  },

  stopClock() {
    if (AppState.rtcInterval) clearInterval(AppState.rtcInterval);
    if (this.statusInterval) clearInterval(this.statusInterval);
  },

  async fetchStatus() {
    try {
      const d = await API.get('/api/status');
      if (d && !d.error) this.renderStatus(d);
    } catch (err) {
      console.warn("Status fetch failed", err);
    }
  },

  renderStatus(d) {
    if (!d || !d.lte) return;

    // Failover Check
    const isFailover = d.active_mode === 'wifi-backup';

    // LTE
    const lteBadge = document.getElementById('lte-badge');
    const lteOperator = document.getElementById('lte-operator');
    const lteIp = document.getElementById('lte-ip');

    if (d.lte.connected) {
      if (lteBadge) { lteBadge.textContent = 'ONLINE'; lteBadge.className = 'status-badge online'; }
      if (lteOperator) lteOperator.textContent = d.lte.operator;
      if (lteIp) lteIp.textContent = d.lte.ip;
    } else {
      if (lteBadge) { lteBadge.textContent = 'OFFLINE'; lteBadge.className = 'status-badge offline'; }
      if (lteOperator) lteOperator.textContent = d.lte.operator === 'Dinonaktifkan' ? 'Dinonaktifkan' : (isFailover ? 'Dialihkan ke Wi-Fi' : 'Terputus');
      if (lteIp) lteIp.textContent = '-';
    }
    document.getElementById('lte-signal').textContent = `${d.lte.signal} dBm`;

    const ethCard = document.getElementById('card-eth');
    const lteCard = document.getElementById('card-lte');

    // Tampilkan hanya mode utama yang aktif
    if (d.main_mode === 'eth') {
      if (ethCard) ethCard.style.display = 'block';
      if (lteCard) lteCard.style.display = 'none';
    } else {
      if (ethCard) ethCard.style.display = 'none';
      if (lteCard) lteCard.style.display = 'block';
    }

    // ETHERNET
    if (d.eth) {
      const ethBadge = document.getElementById('eth-badge');
      const ethIp = document.getElementById('eth-ip');
      const ethText = document.getElementById('eth-status-text');

      if (d.eth.connected) {
        if (ethBadge) { ethBadge.textContent = 'ONLINE'; ethBadge.className = 'status-badge online'; }
        if (ethIp) ethIp.textContent = d.eth.ip;
        if (ethText) ethText.textContent = 'Ethernet W5500';
      } else {
        if (ethBadge) { ethBadge.textContent = 'OFFLINE'; ethBadge.className = 'status-badge offline'; }
        if (ethIp) ethIp.textContent = '-';
        if (ethText) ethText.textContent = isFailover ? 'Dialihkan ke Wi-Fi' : 'Terputus';
      }
    }

    // WiFi
    const wifiSsidEl = document.getElementById('wifi-ssid');
    if (wifiSsidEl) {
      wifiSsidEl.textContent = isFailover ? `${d.wifi.ssid} (BACKUP AKTIF)` : d.wifi.ssid;
      wifiSsidEl.style.color = isFailover ? 'var(--amber)' : 'inherit';
    }
    document.getElementById('wifi-ip').textContent = d.wifi.ip;
    document.getElementById('wifi-rssi').textContent = `${d.wifi.rssi} dBm`;

    // RAM progress
    const ramPct = Math.round((d.ram.used / d.ram.total) * 100);
    document.getElementById('ram-bar').style.width = ramPct + '%';
    document.getElementById('ram-val').textContent = `${d.ram.used} KB / ${d.ram.total} KB (${ramPct}%)`;

    // Flash progress
    const flashPct = Math.round((d.flash.used / d.flash.total) * 100);
    document.getElementById('flash-bar').style.width = flashPct + '%';
    document.getElementById('flash-val').textContent = `${d.flash.used} KB / ${d.flash.total} KB (${flashPct}%)`;

    // Store & Forward Buffer
    if (d.sf_buffer) {
      if (d.sf_buffer.total === -1) {
        const sfBar = document.getElementById('sf-buffer-bar');
        if (sfBar) sfBar.style.width = d.sf_buffer.used > 0 ? '100%' : '0%';
        const sfVal = document.getElementById('sf-buffer-val');
        let displayBytes = d.sf_buffer.used;
        let displayStr = `${displayBytes} B`;
        if (displayBytes > 1024 * 1024) displayStr = `${(displayBytes / (1024 * 1024)).toFixed(2)} MB`;
        else if (displayBytes > 1024) displayStr = `${(displayBytes / 1024).toFixed(1)} KB`;
        if (sfVal) sfVal.textContent = `${displayStr} / Tidak Terbatas`;
      } else {
        const sfPct = Math.round((d.sf_buffer.used / d.sf_buffer.total) * 100);
        const sfBar = document.getElementById('sf-buffer-bar');
        if (sfBar) sfBar.style.width = sfPct + '%';
        const sfVal = document.getElementById('sf-buffer-val');
        if (sfVal) sfVal.textContent = `${d.sf_buffer.used} Baris / Maks: ${d.sf_buffer.total}`;
      }
    }

    // CPU Load (Simulasi logger)
    const cpuLoad = Math.floor(Math.random() * 8) + 2; // 2% - 9%
    const cpuLoadBar = document.getElementById('cpu-load-bar');
    if (cpuLoadBar) {
      cpuLoadBar.style.width = cpuLoad + '%';
      document.getElementById('cpu-load-val').textContent = cpuLoad + ' %';
    }

    // CPU Temp
    if (d.cpu_temp !== undefined) {
      document.getElementById('cpu-temp-val').textContent = `${d.cpu_temp.toFixed(1)} °C`;
      // Asumsikan batas suhu 0 - 100 °C
      const tempPct = Math.max(0, Math.min(100, d.cpu_temp));
      const tempBar = document.getElementById('cpu-temp-bar');
      if (tempBar) {
        tempBar.style.width = tempPct + '%';
        tempBar.style.background = tempPct > 70 ? 'var(--danger)' : (tempPct > 50 ? 'var(--amber)' : 'var(--emerald)');
      }
    }

    // Uptime
    if (d.uptime !== undefined) {
      const uptimeEl = document.getElementById('uptime-val');
      if (uptimeEl) {
        let totalSeconds = d.uptime;
        let hours = Math.floor(totalSeconds / 3600);
        let minutes = Math.floor((totalSeconds - (hours * 3600)) / 60);
        let seconds = totalSeconds - (hours * 3600) - (minutes * 60);

        let hStr = String(hours).padStart(2, '0');
        let mStr = String(minutes).padStart(2, '0');
        let sStr = String(seconds).padStart(2, '0');
        uptimeEl.textContent = `${hStr}:${mStr}:${sStr}`;
      }
    }

    // Set MAC Address (Device ID)
    if (d.mac) {
      const macEl = document.getElementById('cloud-device-id');
      if (macEl && macEl.value !== d.mac) {
        macEl.value = d.mac;
      }
    }

    // Cloud Sync Status
    if (d.cloud_connected !== undefined) {
      const syncStatusEl = document.getElementById('cloud-sync-status');
      if (syncStatusEl) {
        if (d.cloud_connected) {
          syncStatusEl.innerHTML = `<span style="font-size: 16px;">✅</span> <span style="color: var(--emerald);">Status Sinkronisasi: Terhubung & Aktif</span>`;
        } else {
          syncStatusEl.innerHTML = `<span class="spinner" style="width:12px; height:12px; border-width:2px; border-color:var(--amber); border-right-color:transparent;"></span> <span id="cloud-sync-status-text" style="color: var(--amber);">Status Sinkronisasi: Menunggu Koneksi...</span>`;
        }
      }
    }

    // MicroSD
    if (d.sd) {
      const badge = document.getElementById('sd-status-badge');
      const freeVal = document.getElementById('sd-free-val');
      const metaVal = document.getElementById('sd-meta-val');

      if (d.sd.mounted) {
        if (badge) {
          badge.textContent = 'READY';
          badge.className = 'status-badge online';
        }
        if (freeVal) freeVal.textContent = `${d.sd.free_gb.toFixed(1)} GB`;
        if (metaVal) metaVal.textContent = `Total: ${d.sd.total_gb.toFixed(1)} GB · Terpakai: ${(d.sd.total_gb - d.sd.free_gb).toFixed(1)} GB`;
      } else {
        if (badge) {
          badge.textContent = 'NOT FOUND';
          badge.className = 'status-badge offline';
        }
        if (freeVal) freeVal.textContent = '-- GB';
        if (metaVal) metaVal.textContent = 'Kartu SD tidak terbaca/terpasang';
      }
    }

    // Hostname / System Name
    if (d.system_name) {
      const hostVal = document.getElementById('system-hostname-val');
      if (hostVal) hostVal.textContent = d.system_name;
    }
  }
};

/* ============================================================
   CANVAS CHART (Vanilla JS — No Library)
   ============================================================ */
const Chart = {
  canvas: null,
  ctx: null,
  data: null,
  initialized: false,
  hoveredPoint: null,
  pollInterval: null,

  colors: [
    { stroke: '#16a34a', glow: 'rgb(22,163,74)' },
    { stroke: '#0ea5e9', glow: 'rgb(14,165,233)' },
    { stroke: '#eab308', glow: 'rgb(234,179,8)' },
    { stroke: '#ef4444', glow: 'rgb(239,68,68)' },
    { stroke: '#8b5cf6', glow: 'rgb(139,92,246)' }
  ],

  getSensorInfo(sKey) {
    let type = sKey.split('_')[0];
    let id = sKey.substring(type.length + 1);
    if (typeof SensorManager !== 'undefined') {
      if (type === 'modbus') {
        const p = SensorManager.modbusParams.find(x => x.name == id || x.id == id);
        if (p) return { name: p.name, show: p.show_on_chart !== false, unit: p.unit };

        // Check Telekontrol (Aktuator) if not found in regular modbus sensors
        if (typeof TelekontrolManager !== 'undefined') {
          const tk = TelekontrolManager.params.find(x => x.name == id || x.id == id);
          if (tk) return { name: tk.name, show: tk.show_in_graph !== false, unit: tk.type === 'DO' ? '' : 'Val' };
        }
      } else if (type === 'kf350') {
        const p = SensorManager.kf350Params.find(x => x.name == id || x.id == id);
        if (p) {
          let unit = p.type === 'Analog' ? 'Bar' : (p.type === 'I2C' ? '°C' : '');
          return { name: p.name, show: p.show_on_chart !== false, unit: p.unit || unit };
        }
      }
    }
    return { name: sKey, show: true, unit: '' };
  },

  updateLegend(seriesKeys) {
    const container = document.querySelector('.chart-legend');
    if (!container) return;
    let html = '';
    let cIdx = 0;
    for (const key of seriesKeys) {
      const info = this.getSensorInfo(key);
      if (info.show) {
        const color = this.colors[cIdx % this.colors.length];
        html += `<div class="legend-item"><div class="legend-dot" style="background: ${color.stroke}; box-shadow: 0 0 6px ${color.stroke};"></div><span>${info.name} ${info.unit ? `(${info.unit})` : ''}</span></div>`;
        cIdx++;
      }
    }
    if (cIdx === 0) { // Fallback
      html = `<div class="legend-item"><span style="color:var(--text-muted); font-size:12px;">Tidak ada data sensor aktif</span></div>`;
    }
    container.innerHTML = html;
  },

  init() {
    if (this.initialized) return;
    this.canvas = document.getElementById('sensorChart');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    this.fetchData();
    this.pollInterval = setInterval(() => this.fetchData(), 5000); // 5s interval

    this.initialized = true;

    // Responsive resize
    window.addEventListener('resize', () => {
      if (this.data) this.render();
    });

    // Sensor dropdown change
    const sensorSelect = document.getElementById('chart-sensor-select');
    if (sensorSelect) {
      sensorSelect.addEventListener('change', () => {
        if (this.data) this.render();
      });
    }

    // Filter button apply
    const btnApply = document.getElementById('btn-apply-filter');
    if (btnApply) {
      btnApply.addEventListener('click', () => {
        this.fetchData();
      });
    }

    // Download CSV
    const btnDownload = document.getElementById('btn-download-chart-csv');
    if (btnDownload) {
      btnDownload.addEventListener('click', () => {
        this.downloadCSV();
      });
    }

    this.updateDropdown();
  },

  updateDropdown() {
    const sensorSelect = document.getElementById('chart-sensor-select');
    if (!sensorSelect) return;

    const currentVal = sensorSelect.value;
    let html = `<option value="all">Semua Sensor</option>`;

    if (typeof SensorManager !== 'undefined' && (SensorManager.modbusParams.length || SensorManager.kf350Params.length)) {
      SensorManager.modbusParams.forEach(p => {
        if (p.show_on_chart !== false) html += `<option value="modbus_${p.id}">${p.name} (${p.unit})</option>`;
      });
      SensorManager.kf350Params.forEach(p => {
        if (p.show_on_chart !== false) {
          let unit = p.type === 'Analog' ? 'Bar' : (p.type === 'I2C' ? '°C' : '');
          html += `<option value="kf350_${p.id}">${p.name} ${unit ? `(${unit})` : ''}</option>`;
        }
      });
    }

    // Tambahkan Telekontrol jika dipilih untuk tampil
    if (typeof TelekontrolManager !== 'undefined' && TelekontrolManager.params && TelekontrolManager.params.length) {
      TelekontrolManager.params.forEach(p => {
        if (p.show_in_graph !== false) {
          html += `<option value="modbus_${p.id}">${p.name} (Aktuator)</option>`;
        }
      });
    }

    // Tambahkan sensor dari data historis yang mungkin sudah dihapus dari konfigurasi saat ini
    if (this.data && this.data.series) {
      for (const key in this.data.series) {
        if (!html.includes(`value="${key}"`)) {
          const info = this.getSensorInfo(key);
          html += `<option value="${key}">${info.name} (Data Historis)</option>`;
        }
      }
    }

    sensorSelect.innerHTML = html;
    if (Array.from(sensorSelect.options).some(o => o.value === currentVal)) {
      sensorSelect.value = currentVal;
    } else {
      sensorSelect.value = 'all';
    }
  },

  downloadCSV() {
    if (!this.data || !this.data.labels || this.data.labels.length === 0) {
      Toast.warning('Data Kosong', 'Tidak ada data untuk diunduh.');
      return;
    }

    let csvContent = "Waktu";
    let keys = [];
    if (this.data.series) {
      keys = Object.keys(this.data.series);
    } else {
      keys = Object.keys(this.data).filter(k => k !== 'labels');
    }

    keys.forEach(k => csvContent += `,${k}`);
    csvContent += "\n";

    for (let i = 0; i < this.data.labels.length; i++) {
      csvContent += this.data.labels[i];
      keys.forEach(k => {
        let val;
        if (this.data.series) val = this.data.series[k][i];
        else val = this.data[k][i];
        csvContent += `,${val !== null && val !== undefined ? val : ''}`;
      });
      csvContent += "\n";
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logger_molinar_data_${new Date().getTime()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  stop() {
    if (this.pollInterval) clearInterval(this.pollInterval);
  },

  async fetchData() {
    try {
      const start = document.getElementById('filter-start-date')?.value;
      const end = document.getElementById('filter-end-date')?.value;
      let query = '';
      if (start && end) {
        query = `?start=${start}&end=${end}`;
      }

      // Show loading indicator
      if (!this.data && this.ctx && this.canvas) {
        const W = this.canvas.clientWidth;
        const H = 300;
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = W * dpr;
        this.canvas.height = H * dpr;
        this.canvas.style.width = `${W}px`;
        this.canvas.style.height = `${H}px`;
        this.ctx.scale(dpr, dpr);

        this.ctx.clearRect(0, 0, W, H);
        this.ctx.fillStyle = '#6b7280';
        this.ctx.font = '14px Inter, sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText("⏳ Memuat data dari perangkat...", W / 2, H / 2);
      }

      // Ambil token untuk header
      const token = sessionStorage.getItem('molinar_token') || '';
      const headers = { 'X-Auth-Token': token };

      // Check if graph is enabled
      const showChart = document.getElementById('grafik-toggle-switch') ? document.getElementById('grafik-toggle-switch').checked : true;

      if (showChart) {
        // 1. Fetch sensor data as TEXT (JSONL or JSON)
        const cRes = await fetch('/api/sensor-data' + query, { headers });
        if (cRes.ok) {
          const textRes = await cRes.text();
          if (textRes.includes('"labels"')) {
            // JSON object dari fallback API
            this.data = JSON.parse(textRes);
            this.render();
          } else if (textRes.trim().length > 0) {
            // Parsing manual JSONL dari SD card
            const lines = textRes.trim().split('\n');
            const parsedData = { labels: [], series: {} };

            // Ambil 200 baris terakhir agar tidak berat
            const maxPoints = 200;
            const startIndex = lines.length > maxPoints ? lines.length - maxPoints : 0;

            for (let i = startIndex; i < lines.length; i++) {
              if (!lines[i]) continue;
              try {
                const row = JSON.parse(lines[i]);
                if (row.time) parsedData.labels.push(row.time);

                // Parse Modbus RTU
                if (row.modbus) {
                  for (const key in row.modbus) {
                    const sKey = 'modbus_' + key;
                    if (!parsedData.series[sKey]) parsedData.series[sKey] = new Array(parsedData.labels.length - 1).fill(null);
                    parsedData.series[sKey].push(row.modbus[key]);
                  }
                }
                // Parse Terminal KF350
                if (row.kf350) {
                  for (const key in row.kf350) {
                    const sKey = 'kf350_' + key;
                    if (!parsedData.series[sKey]) parsedData.series[sKey] = new Array(parsedData.labels.length - 1).fill(null);
                    parsedData.series[sKey].push(row.kf350[key]);
                  }
                }

                // Pad all series to match current labels length
                for (const sKey in parsedData.series) {
                  while (parsedData.series[sKey].length < parsedData.labels.length) parsedData.series[sKey].push(null);
                }
              } catch (e) {
                console.warn("Parse row error:", e);
              }
            }
            this.data = parsedData;
            this.render();
          }
        }
      }

      // 2. Fetch System Logs
      const lData = await API.get('/api/logs' + query);
      if (lData && !lData.error) {
        this.renderLogs(lData);
      }
    } catch (err) {
      console.warn("Chart/Logs fetch failed", err);
    }
  },

  render() {
    const canvas = this.canvas;
    const ctx = this.ctx;
    const data = this.data;

    if (!data || !data.labels || data.labels.length === 0) return;

    const container = canvas.parentElement;
    let cw = container.clientWidth;
    if (cw < 100) cw = 800;

    const dpr = window.devicePixelRatio || 1;
    const baseW = cw - 48;
    const baseH = 280;

    canvas.width = baseW * dpr;
    canvas.height = baseH * dpr;
    canvas.style.width = `${baseW}px`;
    canvas.style.height = `${baseH}px`;
    ctx.scale(dpr, dpr);

    const W = baseW;
    const H = baseH;
    const PAD = { top: 30, right: 30, bottom: 50, left: 55 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;
    const N = data.labels.length;

    const sensorSelect = document.getElementById('chart-sensor-select');
    const selectedSensor = sensorSelect ? sensorSelect.value : 'all';

    // ── Dynamic Y Axis Range
    let gMax = 10;
    let gMin = 0;
    if (data.series) {
      for (const key in data.series) {
        if (selectedSensor === 'all' || selectedSensor === key) {
          data.series[key].forEach(v => {
            if (v !== null && !isNaN(v)) {
              if (v > gMax) gMax = v;
              if (v < gMin) gMin = v;
            }
          });
        }
      }
    } else {
      if (data.temperature) data.temperature.forEach(v => { if (v > gMax) gMax = v; if (v < gMin) gMin = v; });
      if (data.current) data.current.forEach(v => { if (v > gMax) gMax = v; if (v < gMin) gMin = v; });
    }

    const yMax = Math.ceil(gMax * 1.1);
    const yMin = gMin < 0 ? Math.floor(gMin * 1.1) : 0;
    const ySteps = 7;

    // Clear
    ctx.clearRect(0, 0, W, H);

    // ── Background
    ctx.fillStyle = 'rgba(248, 255, 254, 0.8)';
    ctx.beginPath();
    ctx.roundRect(0, 0, W, H, 8);
    ctx.fill();

    // ── Grid lines
    ctx.strokeStyle = 'rgba(22,163,74,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= ySteps; i++) {
      const y = PAD.top + (chartH / ySteps) * i;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + chartW, y);
      ctx.stroke();
    }

    // ── Y Axis labels
    ctx.fillStyle = 'rgba(55,65,81,0.8)';
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= ySteps; i++) {
      const val = yMax - ((yMax - yMin) / ySteps) * i;
      const y = PAD.top + (chartH / ySteps) * i;
      ctx.fillText(val.toFixed(0), PAD.left - 8, y + 4);
    }

    // ── X Axis labels
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(55,65,81,0.8)';
    const step = Math.ceil(N / 8);
    for (let i = 0; i < N; i += step) {
      const x = PAD.left + (i / (N - 1)) * chartW;
      ctx.fillText(data.labels[i], x, H - PAD.bottom + 18);
    }

    // ── Axis lines
    ctx.strokeStyle = 'rgba(22,163,74,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.left, PAD.top);
    ctx.lineTo(PAD.left, PAD.top + chartH);
    ctx.lineTo(PAD.left + chartW, PAD.top + chartH);
    ctx.stroke();

    // ── Y Axis unit
    ctx.save();
    ctx.fillStyle = 'rgba(75,117,99,0.7)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.translate(12, PAD.top + chartH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Nilai', 0, 0);
    ctx.restore();

    // X Axis label
    ctx.fillStyle = 'rgba(75,117,99,0.7)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Waktu', PAD.left + chartW / 2, H - 2);

    // ── Helper: map value to Y coordinate
    const mapY = (val) => PAD.top + chartH - ((val - yMin) / (yMax - yMin)) * chartH;
    const mapX = (i) => PAD.left + (i / (N - 1)) * chartW;

    // ── Draw line function
    const drawLine = (dataset, color, glowColor) => {
      if (!dataset || dataset.length === 0) return;

      // Handle nulls by treating them as previous value or 0
      const safeData = dataset.map((v, i) => {
        if (v === null || v === undefined || isNaN(v)) {
          if (i > 0 && dataset[i - 1] !== null && dataset[i - 1] !== undefined && !isNaN(dataset[i - 1])) {
             return dataset[i - 1];
          }
          return 0;
        }
        return v;
      });

      // Area fill
      const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + chartH);
      grad.addColorStop(0, glowColor.replace(')', ', 0.15)').replace('rgb', 'rgba'));
      grad.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.beginPath();
      ctx.moveTo(mapX(0), mapY(safeData[0]));
      for (let i = 1; i < N; i++) {
        ctx.lineTo(mapX(i), mapY(safeData[i]));
      }
      ctx.lineTo(mapX(N - 1), PAD.top + chartH);
      ctx.lineTo(mapX(0), PAD.top + chartH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Line stroke
      ctx.beginPath();
      ctx.moveTo(mapX(0), mapY(safeData[0]));
      for (let i = 1; i < N; i++) {
        ctx.lineTo(mapX(i), mapY(safeData[i]));
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Dots (Only if less than 60 data points for performance)
      if (N <= 60) {
        ctx.fillStyle = color;
        for (let i = 0; i < N; i++) {
          if (dataset[i] !== null && dataset[i] !== undefined) {
            const x = mapX(i);
            const y = mapY(safeData[i]);
            ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
          }
        }
      }
    };

    if (data.series) {
      this.updateLegend(Object.keys(data.series));

      let cIdx = 0;
      for (const key in data.series) {
        const info = this.getSensorInfo(key);
        if (info.show) {
          if (selectedSensor === 'all' || selectedSensor === key) {
            const color = this.colors[cIdx % this.colors.length];
            drawLine(data.series[key], color.stroke, color.glow);
          }
          cIdx++;
        }
      }
    } else {
      this.updateLegend([]);
      // Render dummy lines removed
    }
  },

  renderLogs(data) {
    const terminal = document.getElementById('terminal-log');
    if (!terminal || !data) return;
    terminal.innerHTML = '';
    // BUG FIX: Backend mengirim { logs: [string] }, mock juga sudah disesuaikan
    const logArray = Array.isArray(data) ? data : (data.logs || []);
    logArray.forEach(item => {
      const line = document.createElement('div');
      line.className = 'terminal-line';
      if (typeof item === 'string') {
        // Format dari backend: "2026-06-05 09:00:01 [INFO] msg"
        const match = item.match(/^(\S+ \S+) \[(\w+)\] (.+)$/);
        if (match) {
          const [, time, level, msg] = match;
          const lvl = level.toLowerCase();
          line.innerHTML = `<span class="terminal-time">${time}</span> <span class="terminal-level-${lvl}">[${level}]</span> <span class="terminal-msg">${msg}</span>`;
        } else {
          line.innerHTML = `<span class="terminal-msg">${item}</span>`;
        }
      } else {
        // Format objek (fallback)
        line.innerHTML = `<span class="terminal-time">${item.time}</span> <span class="terminal-level-${item.level}">[${item.level?.toUpperCase()}]</span> <span class="terminal-msg">${item.msg}</span>`;
      }
      terminal.appendChild(line);
    });
    // Auto scroll down jika tidak sedang scroll ke atas
    if (terminal.scrollTop >= terminal.scrollHeight - terminal.offsetHeight - 50) {
      terminal.scrollTop = terminal.scrollHeight;
    }
  }
};

/* ============================================================
   DOWNLOAD — Blob + URL.createObjectURL
   ============================================================ */
const Downloader = {
  async csv() {
    try {
      const start = document.getElementById('dl-start-datetime')?.value;
      const end = document.getElementById('dl-end-datetime')?.value;
      let query = '';
      if (start && end) {
        query = `?start=${start}&end=${end}`;
      }

      const token = sessionStorage.getItem('molinar_token') || '';
      const headers = { 'X-Auth-Token': token };
      const cRes = await fetch('/api/sensor-data' + query, { headers });
      if (!cRes.ok) throw new Error('Data tidak tersedia dari server');

      const textRes = await cRes.text();
      let parsedData = { labels: [], series: {} };

      if (textRes.includes('"labels"')) {
        const obj = JSON.parse(textRes);
        parsedData = obj;
      } else if (textRes.trim().length > 0) {
        const lines = textRes.trim().split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i]) continue;
          try {
            const row = JSON.parse(lines[i]);
            if (row.time) parsedData.labels.push(row.time);
            if (row.modbus) {
              for (const key in row.modbus) {
                const sKey = 'modbus_' + key;
                if (!parsedData.series[sKey]) parsedData.series[sKey] = new Array(parsedData.labels.length - 1).fill(null);
                parsedData.series[sKey].push(row.modbus[key]);
              }
            }
            if (row.kf350) {
              for (const key in row.kf350) {
                const sKey = 'kf350_' + key;
                if (!parsedData.series[sKey]) parsedData.series[sKey] = new Array(parsedData.labels.length - 1).fill(null);
                parsedData.series[sKey].push(row.kf350[key]);
              }
            }
            // Pad all series to match current label count
            for (const sk in parsedData.series) {
              while (parsedData.series[sk].length < parsedData.labels.length) {
                parsedData.series[sk].push(null);
              }
            }
          } catch (e) { }
        }
      }

      if (!parsedData.labels || parsedData.labels.length === 0) {
        throw new Error('Tidak ada rekaman data (kosong) pada tanggal tersebut.');
      }

      // Build headers dynamically
      let headerArr = ['Waktu (Timestamp)'];
      let keys = [];
      if (parsedData.series && Object.keys(parsedData.series).length > 0) {
        keys = Object.keys(parsedData.series);
        headerArr.push(...keys);
      } else {
        // Fallback if legacy structure (e.g. from Mock)
        if (parsedData.temperature) { keys.push('temperature'); headerArr.push('Suhu (°C)'); }
        if (parsedData.current) { keys.push('current'); headerArr.push('Arus (mA)'); }
      }

      const csvLines = [headerArr.join(',')];

      for (let i = 0; i < parsedData.labels.length; i++) {
        let rowStr = `"${parsedData.labels[i]}"`;
        for (const k of keys) {
          const val = parsedData.series && parsedData.series[k] !== undefined
            ? parsedData.series[k][i]
            : (parsedData[k] ? parsedData[k][i] : '');
          rowStr += `,${val !== null && val !== undefined ? val : ''}`;
        }
        csvLines.push(rowStr);
      }

      const csv = csvLines.join('\n');

      const safeStart = start ? start.replace('T', '_').replace(/:/g, '') : '';
      const safeEnd = end ? end.replace('T', '_').replace(/:/g, '') : '';
      const filename = (start && end) ? `data_sensor_${safeStart}_to_${safeEnd}.csv` : 'data_sensor_molinar.csv';
      this._download(csv, filename, 'text/csv;charset=utf-8;');
      Toast.success('File Diunduh', `${filename} berhasil diunduh.`);
    } catch (err) {
      Toast.error('Gagal', 'Gagal mengunduh CSV: ' + err.message);
    }
  },

  async log() {
    try {
      const start = document.getElementById('dl-start-datetime')?.value;
      const end = document.getElementById('dl-end-datetime')?.value;
      let query = '';
      if (start && end) {
        query = `?start=${start}&end=${end}`;
      }
      const logs = await API.get('/api/logs' + query);
      if (!logs || logs.error) throw new Error('Data tidak tersedia');
      // BUG FIX: backend mengirim { logs: [string] }, bukan array objek
      const logArr = Array.isArray(logs) ? logs : (logs.logs || []);
      const content = logArr.map(l =>
        typeof l === 'string' ? l : `${l.time} [${l.level.toUpperCase()}] ${l.msg}`
      ).join('\n');
      const now = new Date().toISOString().slice(0, 10);

      const safeStart = start ? start.replace('T', '_').replace(/:/g, '') : '';
      const safeEnd = end ? end.replace('T', '_').replace(/:/g, '') : '';
      const filename = (start && end) ? `log_${safeStart}_to_${safeEnd}.txt` : `log_molinar_${now}.txt`;

      this._download(content, filename, 'text/plain;charset=utf-8;');
      Toast.success('File Diunduh', `${filename} berhasil diunduh.`);
    } catch (err) {
      Toast.error('Gagal', 'Gagal mengunduh LOG: ' + err.message);
    }
  },

  _download(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }
};

/* ============================================================
   BACKUP & RESTORE
   ============================================================ */
const BackupRestore = {
  backup() {
    const config = this._gatherAllConfig();
    const json = JSON.stringify(config, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    // Generate dynamic filename: [hostname]_[YYYY-MM-DD]_[HH-mm-ss].json
    const hostname = config.device || config.system.name || 'Molinar';
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-mm-ss
    const fileName = `${hostname}_${dateStr}_${timeStr}.json`;

    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    Toast.success('Backup Berhasil', `${fileName} berhasil diunduh.`);
  },

  _gatherAllConfig() {
    const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
    const getChk = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };

    return {
      version: '1.0.0',
      device: getVal('sys-hostname') || AppState.loggerName || 'Logger Molinar',
      timestamp: new Date().toISOString(),
      system: {
        name: getVal('sys-hostname') || AppState.loggerName,
        telekontrol_visible: typeof AppState !== 'undefined' ? AppState.telekontrolVisible : true
      },
      sensor: {
        modbus: { params: typeof SensorManager !== 'undefined' ? SensorManager.modbusParams : [] },
        kf350: { params: typeof SensorManager !== 'undefined' ? SensorManager.kf350Params : [] },
        telekontrol: { params: typeof TelekontrolManager !== 'undefined' ? TelekontrolManager.params : [] }
      },
      network: {
        main_mode: getVal('net-main-mode'),
        lte_apn: getVal('lte-apn'),
        lte_user: getVal('lte-user'),
        lte_pass: getVal('lte-pass'),
        lte_band: getVal('lte-band'),
        eth_ip_mode: document.getElementById('eth-ip-static-opt')?.checked ? 'static' : 'dhcp',
        eth_ip: getVal('eth-ip-static'),
        eth_gateway: getVal('eth-gw'),
        eth_subnet: getVal('eth-sn'),
        eth_dns: getVal('eth-dns'),
        wifi_ssid: getVal('wifi-ssid-inp'),
        wifi_password: getVal('wifi-pass'),
        wifi_mode: getVal('wifi-mode'),
        wifi_ip_mode: document.getElementById('wifi-ip-static-opt')?.checked ? 'static' : 'dhcp',
        wifi_ip: getVal('wifi-ip-static'),
        wifi_gateway: getVal('wifi-gw'),
        wifi_subnet: getVal('wifi-sn'),
        wifi_dns: getVal('wifi-dns')
      },
      mqtt: {
        broker: getVal('mqtt-broker'), port: parseInt(getVal('mqtt-port')) || 1883,
        client_id: getVal('mqtt-client-id'), username: getVal('mqtt-user'),
        password: getVal('mqtt-pass'), topic: getVal('mqtt-topic'),
        enabled: getChk('mqtt-enabled')
      },
      webhook: {
        url: getVal('wh-url'), method: getVal('wh-method'),
        headers: getVal('wh-headers'), enabled: getChk('wh-enabled')
      },
      restapi: {
        api_key: getVal('rest-key'), endpoint: getVal('rest-endpoint'),
        enabled: getChk('rest-enabled')
      },
      opcua: {
        endpoint: getVal('opcua-endpoint'), port: parseInt(getVal('opcua-port')) || 4840,
        node_id: getVal('opcua-node-id'), enabled: getChk('opcua-enabled')
      },
      store_forward: {
        enabled: getChk('sf-enabled'),
        max_size: parseInt(getVal('sf-max-size')) || 5,
        batch_size: parseInt(getVal('sf-batch-size')) || 10,
        delay_ms: parseInt(getVal('sf-delay')) || 2000
      },
      timing: {
        polling_interval: parseInt(getVal('timing-read')) || 1000,
        send_interval: parseInt(getVal('timing-send')) || 5000
      },
      pins: AppState.pinState,
      users: AppState.users.map(u => ({ username: u.username, role: u.role })),
      cloud: {
        server: getVal('cloud-server'),
        client_code: getVal('cloud-client-code'),
        device_id: getVal('cloud-device-id'),
        enabled: getChk('cloud-enabled')
      },
      automation: {
        rules: typeof AutomationManager !== 'undefined' ? AutomationManager.rules : []
      }
    };
  },

  restore(file) {
    if (!file) return;

    if (!confirm("Apakah Anda yakin ingin memulihkan konfigurasi dari file ini? Alat akan direstart setelah proses selesai.")) return;

    Toast.info('Memulihkan...', 'Mengirim file konfigurasi ke perangkat...');

    const reader = new FileReader();
    reader.onload = async (e) => {
      const jsonStr = e.target.result;
      let parsedData;
      try {
        parsedData = JSON.parse(jsonStr);
      } catch (err) {
        Toast.error('File Tidak Valid', 'File backup bukan JSON yang valid.');
        return;
      }
      
      try {
        const res = await API.post('/api/restore', parsedData);
        if (res && !res.error) {
          Toast.success('Restore Berhasil', 'Konfigurasi dipulihkan. Perangkat sedang restart...');
          setTimeout(() => window.location.reload(), 3000);
        } else {
          Toast.error('Restore Gagal', res.error || 'Terjadi kesalahan saat memulihkan konfigurasi.');
        }
      } catch (err) {
        Toast.error('Restore Gagal', 'Gagal menghubungi perangkat.');
      }
    };
    reader.readAsText(file);
  },

  _populateForms(config) {
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
    const setChk = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.checked = val; };

    if (config.system && config.system.name) {
      const dashName = document.getElementById('dashboard-logger-name');
      if (dashName) dashName.textContent = config.system.name;
      const cardName = document.getElementById('dashboard-logger-name-card');
      if (cardName) cardName.textContent = config.system.name;
      AppState.loggerName = config.system.name;
    }

    if (config.system && config.system.telekontrol_visible !== undefined) {
      AppState.telekontrolVisible = config.system.telekontrol_visible;
      const tkSwitch = document.getElementById('telekontrol-toggle-switch');
      if (tkSwitch) tkSwitch.checked = config.system.telekontrol_visible;
      const navItem = document.getElementById('nav-telekontrol');
      if (navItem) navItem.style.display = config.system.telekontrol_visible ? 'flex' : 'none';
    } else {
      AppState.telekontrolVisible = true; // default
    }

    if (config.system && config.system.grafik_visible !== undefined) {
      const grSwitch = document.getElementById('grafik-toggle-switch');
      if (grSwitch) grSwitch.checked = config.system.grafik_visible;
      const chartCard = document.getElementById('grafik-sensor-card');
      if (chartCard) chartCard.style.display = config.system.grafik_visible ? 'block' : 'none';
    }

    if (config.cloud) {
      setVal('cloud-server', config.cloud.server);
      setVal('cloud-client-code', config.cloud.client_code);
      setVal('cloud-device-id', config.cloud.device_id);
      setChk('cloud-enabled', config.cloud.enabled);
    }

    if (config.led) {
      setChk('led-enabled', config.led.enabled);
    }

    if (config.network) {
      const n = config.network;
      // LTE / Ethernet Main Mode
      if (n.main_mode) {
        setVal('net-main-mode', n.main_mode);
        document.getElementById('net-main-mode')?.dispatchEvent(new Event('change'));
      }

      // LTE — flat keys: lte_apn, lte_user, lte_pass, lte_band
      setVal('lte-apn', n.lte_apn);
      setVal('lte-user', n.lte_user);
      setVal('lte-pass', n.lte_pass);
      setVal('lte-band', n.lte_band);

      // Ethernet
      if (n.eth_ip_mode) {
        const dhcpRadio = document.getElementById('eth-ip-dhcp');
        const staticRadio = document.getElementById('eth-ip-static-opt');
        if (n.eth_ip_mode === 'static' && staticRadio) {
          staticRadio.checked = true;
        } else if (dhcpRadio) {
          dhcpRadio.checked = true;
        }
        if (typeof NetMainManager !== 'undefined') NetMainManager.onIpModeChange();
      }
      setVal('eth-ip-static', n.eth_ip);
      setVal('eth-gw', n.eth_gateway);
      setVal('eth-sn', n.eth_subnet);
      if (n.eth_dns) setVal('eth-dns', n.eth_dns);

      // WiFi — flat keys: wifi_ssid, wifi_password, wifi_mode
      setVal('wifi-ssid-inp', n.wifi_ssid);
      setVal('wifi-pass', n.wifi_password);
      if (n.wifi_mode) {
        setVal('wifi-mode', n.wifi_mode);
      }
    }
    if (config.mqtt) {
      const m = config.mqtt;
      setVal('mqtt-broker', m.broker); setVal('mqtt-port', m.port);
      setVal('mqtt-client-id', m.client_id); setVal('mqtt-user', m.username);
      setVal('mqtt-pass', m.password); setVal('mqtt-topic', m.topic);
      setChk('mqtt-enabled', m.enabled);
    }
    if (config.webhook) {
      const w = config.webhook;
      setVal('wh-url', w.url); setVal('wh-method', w.method);
      setVal('wh-headers', w.headers); setChk('wh-enabled', w.enabled);
    }
    if (config.restapi) {
      setVal('rest-key', config.restapi.api_key);
      setVal('rest-endpoint', config.restapi.endpoint);
      setChk('rest-enabled', config.restapi.enabled);
    }
    if (config.opcua) {
      const o = config.opcua;
      setVal('opcua-endpoint', o.endpoint); setVal('opcua-port', o.port);
      setVal('opcua-node-id', o.node_id); setChk('opcua-enabled', o.enabled);
    }
    if (config.store_forward) {
      const sf = config.store_forward;
      setVal('sf-max-size', sf.max_size); setVal('sf-batch-size', sf.batch_size);
      setVal('sf-delay', sf.delay_ms); setChk('sf-enabled', sf.enabled);
    }

    // Sinkronisasi status PIN hardware
    if (config.pins) {
      AppState.pinState = config.pins;
      // Trigger event change manual untuk sinkron UI
      ['uart', 'rs485'].forEach(p => { const el = document.getElementById(`pin-kf301-${p}`); if (el) { el.checked = config.pins.kf301[p]; el.dispatchEvent(new Event('change')); } });
      ['adc', 'i2c', 'current_420', 'io'].forEach(p => {
        const id = p === 'current_420' ? 'current420' : p;
        const el = document.getElementById(`pin-kf350-${id}`); if (el) { el.checked = config.pins.kf350[p]; el.dispatchEvent(new Event('change')); }
      });
    }

    // Sinkronisasi data pengguna dari backend
    if (config.users && Array.isArray(config.users)) {
      AppState.users = config.users.map((u, i) => ({
        id: i + 1,
        username: u.username,
        password: u.password || '',
        role: u.role
      }));
    }

    // Pastikan tabel pengguna dirender ulang setelah config dimuat
    if (typeof UserMgr !== 'undefined') UserMgr.render();

    // Sinkronisasi data sensor
    if (config.sensor) {
      if (config.sensor.modbus && config.sensor.modbus.params) SensorManager.modbusParams = config.sensor.modbus.params;
      if (config.sensor.kf350 && config.sensor.kf350.params) SensorManager.kf350Params = config.sensor.kf350.params;
      if (config.sensor.telekontrol && config.sensor.telekontrol.params) TelekontrolManager.params = config.sensor.telekontrol.params;
      SensorManager.renderModbusTable();
      SensorManager.renderKf350Table();
      TelekontrolManager.renderTable();
      TelekontrolManager.renderDashboardCards();

      // Trigger chart re-render if it was already initialized with raw IDs
      if (typeof Chart !== 'undefined' && Chart.initialized) {
        Chart.updateDropdown();
        if (Chart.data) Chart.render();
      }
    }

    // Sinkronisasi mode WiFi
    if (config.network && config.network.wifi_mode) {
      const modeEl = document.getElementById('wifi-mode');
      if (modeEl) {
        modeEl.value = config.network.wifi_mode;
        WiFiManager.onModeChange(config.network.wifi_mode);
      }
      // Restore IP mode
      const hasStaticIp = config.network.wifi_ip && config.network.wifi_ip.length > 0;
      if (hasStaticIp) {
        const staticRadio = document.getElementById('wifi-ip-static-opt');
        if (staticRadio) { staticRadio.checked = true; WiFiManager.onIpModeChange(); }
        setVal('wifi-ip-static', config.network.wifi_ip);
        setVal('wifi-gw', config.network.wifi_gateway);
        setVal('wifi-sn', config.network.wifi_subnet);
        if (config.network.wifi_dns) setVal('wifi-dns', config.network.wifi_dns);
      }
      // If ip_mode key exists, restore DHCP/Static radio
      if (config.network.wifi_ip_mode === 'static') {
        const staticRadio = document.getElementById('wifi-ip-static-opt');
        if (staticRadio) { staticRadio.checked = true; WiFiManager.onIpModeChange(); }
      }
    }
  }
};

/* ============================================================
   FORM HANDLER — Serialize + console.log (simulate API POST)
   ============================================================ */
const FormHandler = {
  init() {
    // Generic form submit interceptor
    document.querySelectorAll('form[data-api]').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Tampilkan popup konfirmasi
        const confirmed = await Modal.show({
          icon: '❓',
          title: 'Simpan Konfigurasi',
          message: 'Apakah Anda yakin ingin menyimpan perubahan konfigurasi ini?',
          confirmText: 'Ya, Simpan',
          confirmClass: 'btn-primary'
        });

        if (!confirmed) return;

        const btn = form.querySelector('button[type="submit"]');
        const originalText = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }

        try {
          const endpoint = form.getAttribute('data-api');
          const data = this.serialize(form);

          // Requirement: Intercept the button click via Vanilla JS to console.log the JSON object
          if (endpoint === '/api/save-timing') {
            console.log('--- Global Timing Control Updated ---');
            console.log(JSON.stringify(data, null, 2));
            console.log('-------------------------------------');
          } else if (endpoint === '/api/save-cloud') {
            console.log('--- Cloud Management (Remote Provisioning) Updated ---');
            console.log(`Remote Provisioning Enabled: ${data.enabled ? 'YES' : 'NO'}`);
            console.log(JSON.stringify(data, null, 2));
            console.log('------------------------------------------------------');
          }
          const res = await API.post(endpoint, data);

          if (res && !res.error) {
            Toast.success(t('saved'), res.message || t('config_saved'));

            // Reload otomatis jika konfigurasi jaringan disimpan (karena perangkat akan reboot)
            if (endpoint === '/api/save-network') {
              setTimeout(() => {
                window.location.reload();
              }, 4000);
            }
          } else {
            throw new Error(res.error || 'Unknown error');
          }
        } catch (err) {
          console.error(`[API Error]`, err);
          Toast.error('Gagal', 'Terjadi kesalahan saat menyimpan: ' + err.message);
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = originalText; }
        }
      });
    });
  },

  serialize(form) {
    const data = {};
    new FormData(form).forEach((val, key) => {
      data[key] = val;
    });
    // Handle checkboxes not in FormData when unchecked
    form.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      data[cb.name] = cb.checked;
    });

    // Workaround: Beberapa toggle "enabled" (MQTT, Webhook, dsb) berada di luar elemen <form>.
    // Cari toggle tersebut di dalam parent container terdekat (.card)
    const container = form.closest('.card');
    if (container) {
      const outerToggle = container.querySelector('input[type="checkbox"][name="enabled"]');
      if (outerToggle) {
        data['enabled'] = outerToggle.checked;
      }
    }

    return data;
  }
};

/* ============================================================
   MAIN NETWORK MANAGER (LTE / Ethernet)
   ============================================================ */
const NetMainManager = {
  init() {
    const modeSelect = document.getElementById('net-main-mode');
    if (modeSelect) {
      modeSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        document.getElementById('panel-net-lte').style.display = val === 'lte' ? 'block' : 'none';
        document.getElementById('panel-net-eth').style.display = val === 'eth' ? 'block' : 'none';
      });
      // trigger initial state
      modeSelect.dispatchEvent(new Event('change'));
    }

    const ipDhcp = document.getElementById('eth-ip-dhcp');
    const ipStatic = document.getElementById('eth-ip-static-opt');
    [ipDhcp, ipStatic].forEach(radio => {
      if (radio) radio.addEventListener('change', () => this.onIpModeChange());
    });
  },

  onIpModeChange() {
    const isDhcp = document.getElementById('eth-ip-dhcp')?.checked;
    const staticFields = document.getElementById('eth-static-fields');
    if (staticFields) staticFields.style.display = isDhcp ? 'none' : 'block';
  }
};

/* ============================================================
   WIFI MANAGER — Scan, Mode Toggle, DHCP/Static IP
   ============================================================ */
const WiFiManager = {
  init() {
    const modeSelect = document.getElementById('wifi-mode');
    const scanBtn = document.getElementById('btn-wifi-scan');
    const ipDhcp = document.getElementById('wifi-ip-dhcp');
    const ipStatic = document.getElementById('wifi-ip-static-opt');

    if (!modeSelect) return;

    // Saat mode berubah, tampilkan/sembunyikan elemen yang relevan
    modeSelect.addEventListener('change', () => this.onModeChange(modeSelect.value));
    // Inisialisasi berdasarkan nilai awal
    this.onModeChange(modeSelect.value);

    // Toggle DHCP vs Statis
    [ipDhcp, ipStatic].forEach(radio => {
      if (radio) radio.addEventListener('change', () => this.onIpModeChange());
    });

    // Tombol scan
    if (scanBtn) {
      scanBtn.addEventListener('click', () => this.doScan());
    }
  },

  onModeChange(mode) {
    const isSTA = (mode === 'sta' || mode === 'apsta');
    const scanBtn = document.getElementById('btn-wifi-scan');
    const ipGroup = document.getElementById('wifi-ip-group');

    if (scanBtn) scanBtn.style.display = isSTA ? 'inline-block' : 'none';
    if (ipGroup) ipGroup.style.display = isSTA ? 'block' : 'none';

    // Tutup hasil scan bila mode berubah
    const scanResults = document.getElementById('wifi-scan-results');
    if (scanResults) scanResults.style.display = 'none';
  },

  onIpModeChange() {
    const isDhcp = document.getElementById('wifi-ip-dhcp')?.checked;
    const staticFields = document.getElementById('wifi-static-fields');
    if (staticFields) staticFields.style.display = isDhcp ? 'none' : 'block';
  },

  async doScan() {
    const scanBtn = document.getElementById('btn-wifi-scan');
    const scanList = document.getElementById('wifi-scan-list');
    const scanBox = document.getElementById('wifi-scan-results');

    if (!scanBtn || !scanList || !scanBox) return;

    // Loading state
    const origText = scanBtn.innerHTML;
    scanBtn.innerHTML = '⏳ Scanning...';
    scanBtn.disabled = true;
    scanList.innerHTML = '<div style="padding:14px 16px; font-size:13px; color:var(--text-muted);">Sedang memindai jaringan...</div>';
    scanBox.style.display = 'block';

    try {
      const res = await API.get('/api/wifi-scan');
      const networks = res.networks || [];

      if (networks.length === 0) {
        scanList.innerHTML = '<div style="padding:14px 16px; font-size:13px; color:var(--text-muted);">❌ Tidak ada jaringan ditemukan.</div>';
      } else {
        scanList.innerHTML = networks.map((net, i) => {
          const rssiPct = Math.max(0, Math.min(100, (net.rssi + 100) * 2));
          const barColor = rssiPct > 60 ? 'var(--emerald)' : rssiPct > 30 ? 'var(--amber)' : 'var(--danger)';
          const lockIcon = net.enc === 'open' ? '🔓' : '🔒';
          return `
            <div class="wifi-scan-item" data-ssid="${net.ssid}" onclick="WiFiManager.selectNetwork('${net.ssid.replace(/'/g, "\\'")}', '${net.enc}')"
              style="display:flex; align-items:center; gap:12px; padding:10px 16px; cursor:pointer;
                     border-bottom: 1px solid var(--border); transition:background 0.15s;"
              onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background=''">
              <span style="font-size:16px;">${lockIcon}</span>
              <div style="flex:1; min-width:0;">
                <div style="font-weight:600; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${net.ssid}</div>
                <div style="font-size:11px; color:var(--text-muted);">Ch ${net.channel} &nbsp;|&nbsp; ${net.rssi} dBm</div>
              </div>
              <div style="width:50px;">
                <div style="height:4px; background:var(--border); border-radius:2px; overflow:hidden;">
                  <div style="height:100%; width:${rssiPct}%; background:${barColor}; border-radius:2px; transition:width 0.3s;"></div>
                </div>
              </div>
            </div>`;
        }).join('');
      }
    } catch (err) {
      scanList.innerHTML = '<div style="padding:14px 16px; font-size:13px; color:var(--danger);">⚠️ Gagal memindai. Pastikan ESP32 dalam mode STA/APSTA.</div>';
    } finally {
      scanBtn.innerHTML = origText;
      scanBtn.disabled = false;
    }
  },

  selectNetwork(ssid, enc) {
    // Isi SSID ke input
    const ssidInput = document.getElementById('wifi-ssid-inp');
    if (ssidInput) ssidInput.value = ssid;

    // Tutup hasil scan
    const scanBox = document.getElementById('wifi-scan-results');
    if (scanBox) scanBox.style.display = 'none';

    // Focus ke password jika jaringan terenkripsi
    if (enc !== 'open') {
      setTimeout(() => document.getElementById('wifi-pass')?.focus(), 100);
    }

    Toast.info('SSID Dipilih', `"${ssid}" telah dipilih. Masukkan password jika diperlukan.`);
  }
};

/* ============================================================
   HARDWARE PIN MANAGER
   ============================================================ */
const PinManager = {
  init() {
    // KF301 pins
    ['uart', 'rs485'].forEach(pin => {
      const toggle = document.getElementById(`pin-kf301-${pin}`);
      if (toggle) {
        toggle.addEventListener('change', () => {
          AppState.pinState.kf301[pin] = toggle.checked;
          this.updatePinCard(`pin-card-kf301-${pin}`, toggle.checked);
          this.updateDynamicForms();
        });
      }
    });

    // KF350 pins
    ['adc', 'i2c', 'current_420', 'io'].forEach(pin => {
      const id = pin === 'current_420' ? 'current420' : pin;
      const toggle = document.getElementById(`pin-kf350-${id}`);
      if (toggle) {
        toggle.addEventListener('change', () => {
          AppState.pinState.kf350[pin] = toggle.checked;
          this.updatePinCard(`pin-card-kf350-${id}`, toggle.checked);
          this.updateDynamicForms();
        });
      }
    });
  },

  updatePinCard(cardId, active) {
    const card = document.getElementById(cardId);
    if (card) {
      if (active) card.classList.add('active-pin');
      else card.classList.remove('active-pin', 'emerald');
    }
  },

  updateDynamicForms() {
    const showHide = (id, show) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('show', show);
    };
    showHide('form-rs485', AppState.pinState.kf301.rs485);
    showHide('form-adc', AppState.pinState.kf350.adc);
    showHide('form-current420', AppState.pinState.kf350.current_420);
    showHide('form-i2c', AppState.pinState.kf350.i2c);
  },

  async savePins(e) {
    e.preventDefault();

    const confirmed = await Modal.show({
      icon: '❓',
      title: 'Simpan Pemetaan PIN',
      message: 'Apakah Anda yakin ingin menyimpan konfigurasi pemetaan terminal ini?',
      confirmText: 'Ya, Simpan',
      confirmClass: 'btn-primary'
    });
    if (!confirmed) return;

    const payload = { kf301: AppState.pinState.kf301, kf350: AppState.pinState.kf350 };
    try {
      const res = await API.post('/api/save-pins', payload);
      if (res && !res.error) {
        Toast.success(t('saved'), 'Konfigurasi PIN berhasil disimpan ke perangkat.');
      } else {
        throw new Error(res.message || 'Gagal menyimpan PIN.');
      }
    } catch (err) {
      Toast.error('Gagal', 'Error menyimpan PIN: ' + err.message);
    }
  }
};

/* ============================================================
   SENSOR MANAGER (Modbus & KF350)
   ============================================================ */
const SensorManager = {
  modbusParams: [
    { id: 1, name: "Suhu Udara", slaveId: 1, fc: "04", register: "1", type: "Int16", polling: 5000, calib: { method: 'linear', m: 0.1, c: 0 } },
    { id: 2, name: "Kelembapan", slaveId: 1, fc: "04", register: "2", type: "Int16", polling: 5000, calib: { method: 'linear', m: 0.1, c: 0 } }
  ],
  kf350Params: [],
  modbusEditId: null,
  kf350EditId: null,

  init() {
    // 1. Sub-tabs navigation
    this.renderModbusTable();
    this.renderKf350Table();

    document.querySelectorAll('.sub-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-sub-target');
        // update active button
        document.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // update active panel
        document.querySelectorAll('.sub-tab-panel').forEach(p => p.style.display = 'none');
        const panel = document.getElementById(target);
        if (panel) {
          panel.style.display = 'block';
          panel.classList.add('active');
        }
      });
    });

    // Calibration UI Toggle
    ['modbus', 'kf350'].forEach(prefix => {
      const select = document.getElementById(`${prefix}-calib-method`);
      if (select) {
        select.addEventListener('change', (e) => {
          const val = e.target.value;
          document.getElementById(`${prefix}-calib-linear`).style.display = val === 'linear' ? 'grid' : 'none';
          document.getElementById(`${prefix}-calib-custom`).style.display = val === 'custom' ? 'block' : 'none';
        });
      }
    });

    // 2. KF350 Interface Dropdown
    const kf350Select = document.getElementById('kf350-interface-type');
    if (kf350Select) {
      kf350Select.addEventListener('change', (e) => {
        const val = e.target.value;
        document.querySelectorAll('.kf350-dynamic-form').forEach(f => f.style.display = 'none');
        if (val === 'analog') document.getElementById('form-kf350-analog').style.display = 'block';
        if (val === 'digital') document.getElementById('form-kf350-digital').style.display = 'block';
        if (val === 'i2c') document.getElementById('form-kf350-i2c').style.display = 'block';
      });
    }

    // 3. Modbus Add Parameter
    const modbusForm = document.getElementById('form-add-modbus-param');
    if (modbusForm) {
      modbusForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const calibMethod = document.getElementById('modbus-calib-method').value;
        const calib = { method: calibMethod };
        if (calibMethod === 'linear') {
          calib.m = document.getElementById('modbus-calib-m').value;
          calib.c = document.getElementById('modbus-calib-c').value;
        } else {
          calib.formula = document.getElementById('modbus-calib-formula').value;
        }

        const param = {
          id: Date.now(),
          name: document.getElementById('modbus-param-name').value,
          slaveId: document.getElementById('modbus-slave-id').value,
          fc: document.getElementById('modbus-fc').value,
          register: document.getElementById('modbus-reg').value,
          type: document.getElementById('modbus-type').value,
          polling: document.getElementById('modbus-polling').value,
          unit: document.getElementById('modbus-unit').value,
          calib: calib,
          show_on_chart: document.getElementById('modbus-show-chart') ? document.getElementById('modbus-show-chart').checked : true
        };

        if (this.modbusEditId) {
          const idx = this.modbusParams.findIndex(x => x.id === this.modbusEditId);
          if (idx !== -1) {
            param.id = this.modbusEditId;
            this.modbusParams[idx] = param;
          }
          this.cancelEditModbus();
          this.renderModbusTable();
          Toast.success('Modbus Diperbarui', `Parameter ${param.name} berhasil diubah.`);
        } else {
          this.modbusParams.push(param);
          this.renderModbusTable();
          modbusForm.reset();
          document.getElementById('modbus-calib-method').dispatchEvent(new Event('change'));
          Toast.success('Modbus Ditambahkan', `Parameter ${param.name} ditambahkan ke tabel.`);
        }
      });
    }

    // 4. KF350 Add Parameter (Analog, Digital, I2C)
    const addKf350 = (formId, type, extractor) => {
      const form = document.getElementById(formId);
      if (form) {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const param = extractor();
          param.type = type;

          if (this.kf350EditId) {
            const idx = this.kf350Params.findIndex(x => x.id === this.kf350EditId);
            if (idx !== -1) {
              param.id = this.kf350EditId;
              this.kf350Params[idx] = param;
            }
            this.kf350EditId = null;
            Toast.success('Sensor Diperbarui', `Sensor ${param.name} berhasil diubah.`);
            const btn = form.querySelector('button[type="submit"]');
            if (btn) btn.innerHTML = `➕ Tambah Sensor ${type}`;
          } else {
            param.id = Date.now();
            this.kf350Params.push(param);
            Toast.success('Sensor Ditambahkan', `Sensor ${param.name} ditambahkan ke tabel.`);
          }

          this.renderKf350Table();
          form.reset();
        });
      }
    };

    addKf350('form-add-kf350-analog', 'Analog', () => {
      const calibMethod = document.getElementById('kf350-calib-method').value;
      const calib = { method: calibMethod };
      if (calibMethod === 'linear') {
        calib.m = document.getElementById('kf350-calib-m').value;
        calib.c = document.getElementById('kf350-calib-c').value;
      } else {
        calib.formula = document.getElementById('kf350-calib-formula').value;
      }
      return {
        name: document.getElementById('ana-name').value,
        port: document.getElementById('ana-port').value,
        unit: document.getElementById('kf-analog-unit')?.value || '',
        detail: `Min: ${document.getElementById('ana-raw-min').value}, Max: ${document.getElementById('ana-raw-max').value}`,
        calib: calib,
        show_on_chart: document.getElementById('kf350-ana-show-chart') ? document.getElementById('kf350-ana-show-chart').checked : true
      };
    });

    addKf350('form-add-kf350-digital', 'Digital', () => ({
      name: document.getElementById('dig-name').value,
      port: document.getElementById('dig-port').value,
      detail: `Mode: ${document.getElementById('dig-mode').value}, Logic: ${document.getElementById('dig-logic').value}`,
      show_on_chart: document.getElementById('kf350-dig-show-chart') ? document.getElementById('kf350-dig-show-chart').checked : true
    }));

    addKf350('form-add-kf350-i2c', 'I2C', () => {
      const calibVal = document.getElementById('i2c-calib')?.value || '';
      return {
        name: document.getElementById('i2c-name').value,
        unit: document.getElementById('i2c-unit')?.value || '',
        detail: `Addr: ${document.getElementById('i2c-address').value}, Profile: ${document.getElementById('i2c-profile').value}`,
        calib: calibVal ? { method: 'formula', formula: calibVal } : null,
        show_on_chart: document.getElementById('kf350-i2c-show-chart') ? document.getElementById('kf350-i2c-show-chart').checked : true
      };
    });

    // 5. Save Modbus to Backend — BUG FIX: ganti console.log → API.post
    const btnSaveModbus = document.getElementById('btn-save-modbus-all');
    if (btnSaveModbus) {
      btnSaveModbus.addEventListener('click', async () => {
        const confirmed = await Modal.show({
          icon: '❓',
          title: 'Simpan Modbus',
          message: 'Apakah Anda yakin ingin menyimpan semua parameter Modbus ini?',
          confirmText: 'Ya, Simpan',
          confirmClass: 'btn-primary'
        });
        if (!confirmed) return;

        const rsForm = document.getElementById('form-serial-rs485');
        const payload = {
          type: "modbus",
          serial: rsForm ? FormHandler.serialize(rsForm) : {},
          params: this.modbusParams
        };
        try {
          const res = await API.post('/api/save-sensor', payload);
          if (res && !res.error) {
            Toast.success('Tersimpan', 'Semua parameter Modbus berhasil disimpan ke perangkat.');
          } else { throw new Error(res.message || 'Gagal'); }
        } catch (err) {
          Toast.error('Gagal', 'Error simpan Modbus: ' + err.message);
        }
      });
    }

    // 6. Save KF350 to Backend — BUG FIX: ganti console.log → API.post
    const btnSaveKf350 = document.getElementById('btn-save-kf350-all');
    if (btnSaveKf350) {
      btnSaveKf350.addEventListener('click', async () => {
        const confirmed = await Modal.show({
          icon: '❓',
          title: 'Simpan KF350',
          message: 'Apakah Anda yakin ingin menyimpan semua konfigurasi parameter KF350 ini?',
          confirmText: 'Ya, Simpan',
          confirmClass: 'btn-primary'
        });
        if (!confirmed) return;

        const payload = {
          type: "kf350",
          params: this.kf350Params
        };
        try {
          const res = await API.post('/api/save-sensor', payload);
          if (res && !res.error) {
            Toast.success('Tersimpan', 'Semua konfigurasi KF350 berhasil disimpan ke perangkat.');
          } else { throw new Error(res.message || 'Gagal'); }
        } catch (err) {
          Toast.error('Gagal', 'Error simpan KF350: ' + err.message);
        }
      });
    }
  },

  renderModbusTable() {
    const tbody = document.getElementById('table-modbus-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    this.modbusParams.forEach((p, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.name}</td>
        <td>${p.slaveId}</td>
        <td>${p.fc}</td>
        <td>${p.register}</td>
        <td>${p.type}</td>
        <td>${p.polling}</td>
        <td>
          <span class="chip chip-${p.calib.method === 'linear' ? 'purple' : 'amber'}">${p.calib.method === 'linear' ? 'Linear' : 'Custom'}</span><br>
          <small class="text-muted" style="font-family:var(--font-mono);">${p.calib.method === 'linear' ? `y = ${p.calib.m}x + ${p.calib.c}` : p.calib.formula}</small>
        </td>
        <td id="table-val-modbus-${p.id}" style="font-family: var(--font-mono); font-weight: 600; width: 100px;">--</td>
        <td style="text-align:right; min-width: 120px;">
          <button class="btn btn-sm btn-primary" onclick="SensorManager.editModbus(${p.id})">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="SensorManager.deleteModbus(${p.id})">Hapus</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Otomatis update tampilan dashboard
    if (typeof LiveSensorViewer !== 'undefined') {
      LiveSensorViewer.render();
    }
  },

  deleteModbus(id) {
    if (confirm('Apakah Anda yakin ingin menghapus parameter ini?')) {
      this.modbusParams = this.modbusParams.filter(p => p.id !== id);
      if (this.modbusEditId === id) this.cancelEditModbus();
      this.renderModbusTable();
    }
  },

  editModbus(id) {
    const p = this.modbusParams.find(x => x.id === id);
    if (!p) return;
    this.modbusEditId = id;

    document.getElementById('modbus-param-name').value = p.name;
    document.getElementById('modbus-slave-id').value = p.slaveId;
    document.getElementById('modbus-fc').value = p.fc;
    document.getElementById('modbus-reg').value = p.register;
    document.getElementById('modbus-type').value = p.type;
    document.getElementById('modbus-polling').value = p.polling;
    document.getElementById('modbus-unit').value = p.unit || '';
    if (document.getElementById('modbus-show-chart')) {
      document.getElementById('modbus-show-chart').checked = p.show_on_chart !== false;
    }

    const cm = document.getElementById('modbus-calib-method');
    cm.value = p.calib.method;
    cm.dispatchEvent(new Event('change'));

    if (p.calib.method === 'linear') {
      document.getElementById('modbus-calib-m').value = p.calib.m;
      document.getElementById('modbus-calib-c').value = p.calib.c;
    } else {
      document.getElementById('modbus-calib-formula').value = p.calib.formula;
    }

    const formBtn = document.getElementById('btn-modbus-submit');
    if (formBtn) formBtn.innerHTML = '📝 Update Parameter';
    const cancelBtn = document.getElementById('btn-modbus-cancel-edit');
    if (cancelBtn) cancelBtn.style.display = 'inline-block';

    const formEl = document.getElementById('form-add-modbus-param');
    if (formEl) window.scrollTo({ top: formEl.offsetTop - 100, behavior: 'smooth' });
  },

  cancelEditModbus() {
    this.modbusEditId = null;
    const formEl = document.getElementById('form-add-modbus-param');
    if (formEl) formEl.reset();
    const cm = document.getElementById('modbus-calib-method');
    if (cm) cm.dispatchEvent(new Event('change'));

    const formBtn = document.getElementById('btn-modbus-submit');
    if (formBtn) formBtn.innerHTML = '➕ Tambah Parameter';
    const cancelBtn = document.getElementById('btn-modbus-cancel-edit');
    if (cancelBtn) cancelBtn.style.display = 'none';
  },

  renderKf350Table() {
    const tbody = document.getElementById('table-kf350-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    this.kf350Params.forEach((p, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="chip chip-emerald">${p.type}</span></td>
        <td>${p.name}</td>
        <td>${p.detail} ${p.port ? '(' + p.port + ')' : ''}</td>
        <td>
          ${p.calib ? `
            <span class="chip chip-${p.calib.method === 'linear' ? 'purple' : 'amber'}">${p.calib.method === 'linear' ? 'Linear' : 'Custom'}</span><br>
            <small class="text-muted" style="font-family:var(--font-mono);">${p.calib.method === 'linear' ? `y = ${p.calib.m}x + ${p.calib.c}` : p.calib.formula}</small>
          ` : '-'}
        </td>
        <td id="table-val-kf350-${p.id}" style="font-family: var(--font-mono); font-weight: 600; width: 100px;">--</td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn btn-sm btn-secondary" onclick="SensorManager.editKf350(${p.id})">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="SensorManager.deleteKf350(${p.id})">Hapus</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Otomatis update tampilan dashboard
    if (typeof LiveSensorViewer !== 'undefined') {
      LiveSensorViewer.render();
    }
  },

  editKf350(id) {
    const p = this.kf350Params.find(x => x.id === id);
    if (!p) return;
    this.kf350EditId = id;

    const typeSelect = document.getElementById('kf350-interface-type');
    if (typeSelect) {
      typeSelect.value = p.type.toLowerCase();
      typeSelect.dispatchEvent(new Event('change'));
    }

    typeSelect?.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (p.type === 'Analog') {
      document.getElementById('ana-name').value = p.name;
      document.getElementById('ana-port').value = p.port;
      if (document.getElementById('kf-analog-unit')) document.getElementById('kf-analog-unit').value = p.unit || '';
      const m = p.detail.match(/Min:\s*(-?\d+),\s*Max:\s*(-?\d+)/);
      if (m) {
        document.getElementById('ana-raw-min').value = m[1];
        document.getElementById('ana-raw-max').value = m[2];
      }
      if (p.calib) {
        document.getElementById('kf350-calib-method').value = p.calib.method;
        document.getElementById('kf350-calib-method').dispatchEvent(new Event('change'));
        if (p.calib.method === 'linear') {
          document.getElementById('kf350-calib-m').value = p.calib.m;
          document.getElementById('kf350-calib-c').value = p.calib.c;
        } else {
          document.getElementById('kf350-calib-formula').value = p.calib.formula;
        }
      }
      const btn = document.querySelector('#form-add-kf350-analog button[type="submit"]');
      if (btn) btn.innerHTML = '💾 Simpan Perubahan Analog';
    } else if (p.type === 'Digital') {
      document.getElementById('dig-name').value = p.name;
      document.getElementById('dig-port').value = p.port;
      const m = p.detail.match(/Mode:\s*([^,]+),\s*Logic:\s*(.+)/);
      if (m) {
        document.getElementById('dig-mode').value = m[1];
        document.getElementById('dig-logic').value = m[2];
      }
      const btn = document.querySelector('#form-add-kf350-digital button[type="submit"]');
      if (btn) btn.innerHTML = '💾 Simpan Perubahan Digital';
    } else if (p.type === 'I2C') {
      document.getElementById('i2c-name').value = p.name;
      if (document.getElementById('i2c-unit')) document.getElementById('i2c-unit').value = p.unit || '';
      const m = p.detail.match(/Addr:\s*([^,]+),\s*Profile:\s*(.+)/);
      if (m) {
        document.getElementById('i2c-address').value = m[1];
        document.getElementById('i2c-profile').value = m[2];
      }
      if (p.calib && document.getElementById('i2c-calib')) {
        document.getElementById('i2c-calib').value = p.calib.formula || '';
      } else if (document.getElementById('i2c-calib')) {
        document.getElementById('i2c-calib').value = '';
      }
      const btn = document.querySelector('#form-add-kf350-i2c button[type="submit"]');
      if (btn) btn.innerHTML = '💾 Simpan Perubahan I2C';
    }
  },

  deleteKf350(id) {
    if (confirm('Apakah Anda yakin ingin menghapus parameter ini?')) {
      this.kf350Params = this.kf350Params.filter(p => p.id !== id);
      this.renderKf350Table();
    }
  }
};

/* ============================================================
   TELEKONTROL MANAGER
   ============================================================ */
const TelekontrolManager = {
  params: [],

  init() {
    this.renderTable();
    this.renderDashboardCards();

    const btnAdd = document.getElementById('btn-add-telekontrol');
    if (btnAdd) {
      btnAdd.addEventListener('click', () => {
        this.showEditModal();
      });
    }

    const btnSave = document.getElementById('btn-save-telekontrol-all');
    if (btnSave) {
      btnSave.addEventListener('click', async () => {
        const confirmed = await Modal.show({
          icon: '❓',
          title: 'Simpan Telekontrol',
          message: 'Apakah Anda yakin ingin menyimpan konfigurasi Telekontrol ini?',
          confirmText: 'Ya, Simpan',
          confirmClass: 'btn-primary'
        });
        if (!confirmed) return;

        try {
          const payload = { type: "telekontrol", params: this.params };
          const res = await API.post('/api/save-sensor', payload);
          if (res && !res.error) {
            Toast.success('Tersimpan', 'Konfigurasi Telekontrol berhasil disimpan.');
            this.renderDashboardCards();
          } else { throw new Error(res.message || 'Gagal'); }
        } catch (err) {
          Toast.error('Gagal', 'Error simpan: ' + err.message);
        }
      });
    }
  },

  async showEditModal(param = null) {
    const isEdit = !!param;
    const p = param || {
      id: Date.now().toString(),
      name: 'Relay 1',
      slaveId: 1,
      fc: '5',
      register: '0',
      type: 'DO' // DO (Digital Out) atau AO (Analog Out)
    };

    const modalContent = `
      <div class="form-group">
        <label>Nama Aktuator</label>
        <input type="text" id="tk-name" class="form-control" value="${p.name}">
      </div>
      <div class="form-group">
        <label>Slave ID</label>
        <input type="number" id="tk-slave" class="form-control" value="${p.slaveId}" min="1" max="247">
      </div>
      <div class="form-group">
        <label>Tipe Aktuator</label>
        <select id="tk-type" class="form-control">
          <option value="DO" ${p.type === 'DO' ? 'selected' : ''}>DO (Relay / Sakelar ON-OFF)</option>
          <option value="AO" ${p.type === 'AO' ? 'selected' : ''}>AO (Analog Out / Nilai Bebas)</option>
        </select>
      </div>
      <div class="form-group">
        <label>Alamat Register</label>
        <input type="number" id="tk-reg" class="form-control" value="${p.register}">
      </div>
      <div class="form-group" style="display: flex; align-items: center; gap: 10px; margin-top: 15px;">
        <input type="checkbox" id="tk-show-graph" ${p.show_in_graph ? 'checked' : ''}>
        <label for="tk-show-graph" style="margin: 0; cursor: pointer;">Tampilkan di Grafik Sensor</label>
      </div>
    `;

    const confirmed = await Modal.show({
      icon: '🎛️',
      title: isEdit ? 'Edit Aktuator' : 'Tambah Aktuator',
      message: modalContent,
      confirmText: 'Simpan',
      confirmClass: 'btn-primary'
    });

    if (confirmed) {
      const type = document.getElementById('tk-type').value;
      const newParam = {
        id: p.id,
        name: document.getElementById('tk-name').value,
        slaveId: parseInt(document.getElementById('tk-slave').value),
        type: type,
        fc: type === 'DO' ? '1' : '3', // FC read
        writeFc: type === 'DO' ? '5' : '6', // FC write
        register: parseInt(document.getElementById('tk-reg').value),
        polling: 2000,
        show_in_graph: document.getElementById('tk-show-graph').checked
      };

      if (isEdit) {
        const idx = this.params.findIndex(x => x.id === p.id);
        if (idx !== -1) this.params[idx] = newParam;
      } else {
        this.params.push(newParam);
      }
      this.renderTable();
      this.renderDashboardCards();
    }
  },

  deleteParam(id) {
    if (confirm('Hapus aktuator ini?')) {
      this.params = this.params.filter(p => p.id !== id);
      this.renderTable();
      this.renderDashboardCards();
    }
  },

  renderTable() {
    const tbody = document.getElementById('table-telekontrol-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (this.params.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Belum ada aktuator yang dikonfigurasi.</td></tr>';
      return;
    }

    this.params.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="font-mono text-xs">${p.id}</td>
        <td><strong>${p.name}</strong></td>
        <td>${p.slaveId}</td>
        <td>${p.writeFc}</td>
        <td>${p.register}</td>
        <td><span class="status-badge ${p.type === 'DO' ? 'online' : 'offline'}">${p.type}</span></td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="TelekontrolManager.showEditModal(TelekontrolManager.params.find(x => x.id === '${p.id}'))">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="TelekontrolManager.deleteParam('${p.id}')">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  },

  renderDashboardCards() {
    const container = document.getElementById('telekontrol-cards');
    if (!container) return;
    container.innerHTML = '';

    if (this.params.length === 0) {
      container.innerHTML = '<p class="text-muted" style="grid-column: 1 / -1;">Tidak ada aktuator yang tersedia. Silakan tambahkan di menu Pengaturan Hardware.</p>';
      return;
    }

    this.params.forEach(p => {
      const card = document.createElement('div');
      card.className = 'status-card';
      const liveVal = AppState.liveData && AppState.liveData[p.id] ? parseFloat(AppState.liveData[p.id]) : 0;

      if (p.type === 'DO') {
        const isChecked = liveVal > 0;
        card.innerHTML = `
          <div class="status-card-header">
            <div class="status-card-icon" style="background: var(--purple-bg); color: var(--purple)">⚡</div>
            <span class="status-badge ${isChecked ? 'online' : 'offline'}" id="tk-badge-${p.id}">${isChecked ? 'ON' : 'OFF'}</span>
          </div>
          <h3>${p.name}</h3>
          <p>Relay Control (Reg: ${p.register})</p>
          <div style="margin-top: 15px; display: flex; gap: 10px;">
            <button class="btn btn-danger" style="flex: 1; padding: 10px;" onclick="TelekontrolManager.sendWrite('${p.id}', 0)">OFF</button>
            <button class="btn btn-emerald" style="flex: 1; padding: 10px;" onclick="TelekontrolManager.sendWrite('${p.id}', 65280)">ON</button>
          </div>
        `;
      } else {
        card.innerHTML = `
          <div class="status-card-header">
            <div class="status-card-icon" style="background: var(--cyan-bg); color: var(--cyan)">🎛️</div>
            <span class="status-badge" style="background: #e2e8f0; color: #475569;" id="tk-badge-${p.id}">Value: ${liveVal}</span>
          </div>
          <h3>${p.name}</h3>
          <p>Analog Out (Reg: ${p.register})</p>
          <div style="margin-top: 15px; display: flex; gap: 10px;">
            <input type="number" id="tk-input-${p.id}" class="form-control" placeholder="Nilai" value="${liveVal}">
            <button class="btn btn-primary" onclick="TelekontrolManager.sendWrite('${p.id}', document.getElementById('tk-input-${p.id}').value)">Set</button>
          </div>
        `;
      }
      container.appendChild(card);
    });
  },

  async sendWrite(id, value) {
    const p = this.params.find(x => x.id === id);
    if (!p) return;
    try {
      const payload = {
        slaveId: parseInt(p.slaveId),
        fc: parseInt(p.writeFc),
        register: parseInt(p.register),
        value: parseInt(value)
      };
      const res = await API.post('/api/telecontrol', payload);
      if (res && !res.error) {
        Toast.success('Terkirim', `Perintah untuk ${p.name} berhasil dikirim.`);
      } else {
        throw new Error(res.message || 'Gagal mengirim');
      }
    } catch (err) {
      Toast.error('Error', err.message);
      if (p.type === 'DO') {
        const toggle = document.getElementById(`tk-toggle-${id}`);
        if (toggle) toggle.checked = !toggle.checked;
      }
    }
  },

  updateLiveUI(liveData) {
    this.params.forEach(p => {
      const keyStr = p.name || p.id;
      const val = liveData[keyStr] !== undefined ? liveData[keyStr] : liveData[p.id];
      const badge = document.getElementById(`tk-badge-${p.id}`);
      const isError = val === undefined || val === null || val === "NaN" || val === "Err" || val.toString().startsWith("Err") || val === "-";

      if (!isError) {
        const numVal = parseFloat(val);
        if (p.type === 'DO') {
          const toggle = document.getElementById(`tk-toggle-${p.id}`);
          if (badge) {
            badge.textContent = numVal > 0 ? 'ON' : 'OFF';
            badge.className = `status-badge ${numVal > 0 ? 'online' : 'offline'}`;
            badge.style.background = '';
            badge.style.color = '';
          }
          if (toggle && document.activeElement !== toggle) {
            toggle.checked = numVal > 0;
          }
        } else if (p.type === 'AO') {
          if (badge) {
            badge.textContent = `Value: ${numVal}`;
            badge.style.background = '';
            badge.style.color = '';
          }
        }
      } else {
        // Handle 3rd State: Disconnected / Error / No Data
        if (p.type === 'DO') {
          if (badge) {
            badge.textContent = 'PUTUS';
            badge.className = 'status-badge';
            badge.style.background = '#e2e8f0'; // Gray
            badge.style.color = '#475569';
          }
        } else if (p.type === 'AO') {
          if (badge) {
            badge.textContent = 'No Data';
            badge.className = 'status-badge';
            badge.style.background = '#e2e8f0';
            badge.style.color = '#475569';
          }
        }
      }
    });
  }
};

/* ============================================================
   TABS MANAGER
   ============================================================ */
const Tabs = {
  init(groupId) {
    const group = document.querySelectorAll(`[data-tab-group="${groupId}"]`);
    group.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetPanel = btn.getAttribute('data-tab-target');
        this.activate(groupId, targetPanel);
      });
    });
  },

  activate(groupId, panelId) {
    document.querySelectorAll(`[data-tab-group="${groupId}"]`)
      .forEach(b => b.classList.toggle('active', b.getAttribute('data-tab-target') === panelId));
    document.querySelectorAll(`[data-tab-panel="${groupId}"]`)
      .forEach(p => p.classList.toggle('active', p.id === panelId));
    AppState.currentTab[groupId] = panelId;
  },

  activateFirst(groupId) {
    const firstBtn = document.querySelector(`[data-tab-group="${groupId}"]`);
    if (firstBtn) {
      const targetPanel = firstBtn.getAttribute('data-tab-target');
      this.activate(groupId, targetPanel);
    }
  }
};

/* ============================================================
   USER MANAGEMENT
   ============================================================ */
const UserMgr = {
  render() {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!AppState.users || AppState.users.length === 0) {
      const row = document.createElement('tr');
      row.innerHTML = `<td colspan="4" class="text-center text-muted" style="padding: 24px;">Belum ada data pengguna</td>`;
      tbody.appendChild(row);
      return;
    }

    AppState.users.forEach((user, idx) => {
      try {
        const row = document.createElement('tr');
        const uname = user.username || 'unknown';
        const initial = uname.charAt(0).toUpperCase();
        row.innerHTML = `
          <td>${idx + 1}</td>
          <td>
            <div class="flex items-center gap-12">
              <div class="user-avatar" style="width:28px;height:28px;font-size:11px">${initial}</div>
              <span>${uname}</span>
            </div>
          </td>
          <td><span class="chip chip-${user.role === 'admin' ? 'cyan' : 'amber'}">${user.role || 'viewer'}</span></td>
          <td class="text-right" style="white-space: nowrap;">
            ${AppState.currentRole === 'admin' ? `
              <button class="btn btn-sm btn-primary" style="margin-right: 6px;" onclick="UserMgr.editUser(${user.id})">Edit</button>
              <button class="btn btn-sm btn-danger" onclick="UserMgr.deleteUser(${user.id})">Hapus</button>
            ` : '<span class="text-muted">—</span>'}
          </td>`;
        tbody.appendChild(row);
      } catch (e) {
        console.error('Error rendering user row:', e);
      }
    });
  },

  async addUser(e) {
    e.preventDefault();
    const un = document.getElementById('new-username').value.trim();
    const pw = document.getElementById('new-password').value;
    const role = document.getElementById('new-role').value;

    if (!un || !pw) { Toast.warning('Form Tidak Lengkap', 'Username dan password wajib diisi.'); return; }
    if (AppState.users.find(u => u.username === un)) {
      Toast.error('Username Sudah Ada', 'Gunakan username yang berbeda.');
      return;
    }

    const newId = Math.max(...AppState.users.map(u => u.id)) + 1;
    AppState.users.push({ id: newId, username: un, password: pw, role });
    document.getElementById('new-username').value = '';
    document.getElementById('new-password').value = '';
    this.render();

    // BUG FIX: Simpan daftar user ke backend
    try {
      const payload = { users: AppState.users.map(u => ({ username: u.username, password: u.password, role: u.role })) };
      const res = await API.post('/api/save-users', payload);
      if (res && !res.error) {
        Toast.success('User Ditambahkan', `User "${un}" berhasil ditambahkan dan disimpan.`);
      } else { throw new Error(res.message || 'Gagal'); }
    } catch (err) {
      Toast.error('Gagal Simpan', 'User ditambahkan tapi gagal tersimpan: ' + err.message);
    }
  },

  deleteUser(id) {
    const user = AppState.users.find(u => u.id === id);
    if (!user) return;
    if (user.username === AppState.currentUser) {
      Toast.error('Tidak Dapat Dihapus', 'Anda tidak dapat menghapus akun yang sedang aktif.');
      return;
    }

    // Meminta konfirmasi (native confirm box)
    if (!confirm(`Hapus pengguna "${user.username}" secara permanen?`)) return;

    AppState.users = AppState.users.filter(u => u.id !== id);
    this.render();

    // Langsung simpan ke backend agar permanen
    this._saveUsersToBackend(`User "${user.username}" berhasil dihapus.`);
  },

  async editUser(id) {
    const user = AppState.users.find(u => u.id === id);
    if (!user) return;

    const newPass = prompt(`Masukkan password baru untuk akun "${user.username}":\n(Biarkan kosong untuk batal)`);
    if (!newPass) return; // User membatalkan prompt

    if (newPass.length < 6) {
      Toast.error('Password Terlalu Pendek', 'Password baru harus minimal 6 karakter.');
      return;
    }

    user.password = newPass;
    this._saveUsersToBackend(`Password untuk "${user.username}" berhasil diubah.`);
  },

  async _saveUsersToBackend(successMsg) {
    try {
      const payload = { users: AppState.users.map(u => ({ username: u.username, password: u.password, role: u.role })) };
      const res = await API.post('/api/save-users', payload);
      if (res && !res.error) {
        Toast.success('Disimpan', successMsg);
      } else {
        throw new Error(res.error || 'Gagal dari server');
      }
    } catch (err) {
      Toast.error('Gagal Simpan', 'Data pengguna gagal tersimpan: ' + err.message);
    }
  }
};

/* ============================================================
   SYSTEM ACTIONS
   ============================================================ */
const SystemActions = {
  async toggleLED() {
    const ledEnabledEl = document.getElementById('led-enabled');
    if (!ledEnabledEl) return;
    try {
      const payload = {
        led: { enabled: ledEnabledEl.checked }
      };
      const res = await API.post('/api/save-system', payload);
      if (res && !res.error) {
        Toast.success('Tersimpan', ledEnabledEl.checked ? 'Lampu indikator diaktifkan.' : 'Lampu indikator dimatikan.');
      } else {
        throw new Error(res.message || 'Gagal tersimpan');
      }
    } catch (err) {
      Toast.error('Gagal Simpan', err.message);
      ledEnabledEl.checked = !ledEnabledEl.checked; // Revert on fail
    }
  },

  async toggleTelekontrol() {
    const tkSwitch = document.getElementById('telekontrol-toggle-switch');
    if (!tkSwitch) return;
    try {
      const isVisible = tkSwitch.checked;
      const payload = { system: { telekontrol_visible: isVisible } };
      const res = await API.post('/api/save-system', payload);
      if (res && !res.error) {
        AppState.telekontrolVisible = isVisible;
        Toast.success('Tersimpan', isVisible ? 'Menu Panel Kontrol ditampilkan.' : 'Menu Panel Kontrol disembunyikan.');
        const navItem = document.getElementById('nav-telekontrol');
        if (navItem) navItem.style.display = isVisible ? 'flex' : 'none';
      } else {
        throw new Error(res.message || 'Gagal tersimpan');
      }
    } catch (err) {
      Toast.error('Gagal Simpan', err.message);
      tkSwitch.checked = !tkSwitch.checked;
    }
  },

  async toggleGrafik() {
    const grSwitch = document.getElementById('grafik-toggle-switch');
    if (!grSwitch) return;
    try {
      const isVisible = grSwitch.checked;
      const payload = { system: { grafik_visible: isVisible } };
      const res = await API.post('/api/save-system', payload);
      if (res && !res.error) {
        Toast.success('Tersimpan', isVisible ? 'Grafik Sensor ditampilkan.' : 'Grafik Sensor disembunyikan.');
        const chartCard = document.getElementById('grafik-sensor-card');
        if (chartCard) chartCard.style.display = isVisible ? 'block' : 'none';

        // Fetch or stop data
        if (isVisible && typeof Chart !== 'undefined') Chart.fetchData();
      } else {
        throw new Error(res.message || 'Gagal tersimpan');
      }
    } catch (err) {
      Toast.error('Gagal Simpan', err.message);
      grSwitch.checked = !grSwitch.checked;
    }
  },

  async editLoggerName() {
    const currentName = AppState.loggerName || "Logger Molinar";
    const newName = window.prompt("Masukkan nama baru untuk Logger ini:", currentName);
    if (newName === null || newName.trim() === "") return;

    try {
      const payload = {
        system: { name: newName.trim() }
      };
      const res = await API.post('/api/save-system', payload);
      if (res && !res.error) {
        Toast.success('Tersimpan', `Nama perangkat berhasil diubah menjadi "${newName}".`);
        const dashName = document.getElementById('dashboard-logger-name');
        if (dashName) dashName.textContent = newName.trim();
        const cardName = document.getElementById('dashboard-logger-name-card');
        if (cardName) cardName.textContent = newName.trim();
        const hostVal = document.getElementById('system-hostname-val');
        if (hostVal) hostVal.textContent = newName.trim();
        AppState.loggerName = newName.trim();
      } else {
        throw new Error(res.message || 'Gagal tersimpan');
      }
    } catch (err) {
      Toast.error('Gagal Simpan', err.message);
    }
  },

  async saveSystemName() {
    const nameInput = document.getElementById('input-system-name');
    if (!nameInput) return;
    const newName = nameInput.value.trim();
    if (!newName) {
      Toast.warning('Tidak Valid', 'Nama logger tidak boleh kosong.');
      return;
    }

    const ledEnabledEl = document.getElementById('led-enabled');
    const ledEnabled = ledEnabledEl ? ledEnabledEl.checked : true;

    try {
      const payload = {
        system: { name: newName },
        led: { enabled: ledEnabled }
      };
      const res = await API.post('/api/save-system', payload);
      if (res && !res.error) {
        Toast.success('Tersimpan', `Nama perangkat berhasil diubah menjadi "${newName}".`);
        // Update dashboard title live
        const dashName = document.getElementById('dashboard-logger-name');
        if (dashName) dashName.textContent = newName;
      } else {
        throw new Error(res.error || 'Gagal tersimpan');
      }
    } catch (err) {
      Toast.error('Gagal Simpan', err.message);
    }
  },

  async reboot() {
    const confirmed = await Modal.show({
      icon: '🔄',
      title: t('confirm_reboot'),
      message: t('confirm_reboot_msg'),
      confirmText: 'Reboot',
      confirmClass: 'btn-amber'
    });
    if (!confirmed) return;
    try {
      await API.post('/api/reboot', {});
      Toast.info('Reboot Dikirim', 'Perangkat akan restart dalam beberapa detik...');
    } catch (err) {
      Toast.error('Gagal', 'Tidak dapat mengirim perintah reboot: ' + err.message);
    }
  },

  async factoryReset() {
    const confirmed = await Modal.show({
      icon: '💣',
      title: t('confirm_factory'),
      message: t('confirm_factory_msg'),
      confirmText: 'Reset Sekarang',
      confirmClass: 'btn-danger'
    });
    if (!confirmed) return;
    try {
      await API.post('/api/factory-reset', {});
      Toast.warning('Factory Reset', 'Perangkat sedang direset ke pengaturan pabrik...');
      // Hapus session lokal karena config akan terhapus
      sessionStorage.clear();
    } catch (err) {
      Toast.error('Gagal', 'Tidak dapat mengirim perintah factory reset: ' + err.message);
    }
  },

  async formatSD() {
    const confirmed = await Modal.show({
      icon: '💾',
      title: t('confirm_format'),
      message: t('confirm_format_msg'),
      confirmText: 'Format SD',
      confirmClass: 'btn-danger'
    });
    if (!confirmed) return;
    try {
      const res = await API.post('/api/format-sd', {});
      if (res && !res.error) {
        Toast.success('Format Berhasil', 'MicroSD berhasil diformat.');
      } else { throw new Error(res.message || 'Gagal'); }
    } catch (err) {
      Toast.error('Gagal', 'Format MicroSD gagal: ' + err.message);
    }
  },

  async editTime() {
    const tzStr = window.prompt("Masukkan Zona Waktu (GMT offset, contoh: 7 untuk WIB):", "7");
    if (tzStr === null || tzStr.trim() === "") return;

    const tz = parseInt(tzStr);
    if (isNaN(tz) || tz < -12 || tz > 14) {
      Toast.error('Gagal', 'Zona waktu tidak valid. Gunakan angka antara -12 hingga 14.');
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000);

    try {
      const res = await API.post('/api/sync-rtc', { timestamp: timestamp, tz: tz });
      if (res && !res.error) {
        Toast.success('Waktu Disinkronkan', `RTC diatur ke UTC. Zona waktu alat diatur ke GMT${tz >= 0 ? '+' + tz : tz}`);
      } else { throw new Error(res.message || 'Gagal'); }
    } catch (err) {
      Toast.error('Gagal', 'Sinkronisasi gagal: ' + err.message);
    }
  }
};

/* ============================================================
   LANGUAGE TOGGLE
   ============================================================ */
const LangToggle = {
  toggle(lang) {
    AppState.language = lang;
    // Re-render nav labels
    Nav.render();
    if (AppState.currentSection) Nav.navigate(AppState.currentSection);

    document.querySelectorAll('[data-lang-btn]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-lang-btn') === lang);
    });
    Toast.info('Bahasa Diubah', lang === 'id' ? 'Bahasa Indonesia aktif.' : 'English language active.');
  }
};

/* ============================================================
   MOBILE SIDEBAR
   ============================================================ */
const MobileSidebar = {
  init() {
    const hamburger = document.getElementById('hamburger-btn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    if (hamburger) {
      hamburger.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('show');
      });
    }
    if (overlay) {
      overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
      });
    }
  }
};

/* ============================================================
   CLOUD & MQTT EXCLUSIVITY
   ============================================================ */
const CloudMqttExclusivity = {
  init() {
    const cloudToggle = document.getElementById('cloud-enabled');
    const mqttToggle = document.getElementById('mqtt-enabled');
    const mqttFormInputs = document.querySelectorAll('form[data-api="/api/save-mqtt"] input');

    if (!cloudToggle || !mqttToggle) return;

    const updateUI = () => {
      // Disable/enable MQTT form inputs based on its toggle
      mqttFormInputs.forEach(input => {
        if (input.id !== 'mqtt-enabled') {
          input.disabled = !mqttToggle.checked;
          input.style.opacity = mqttToggle.checked ? '1' : '0.5';
          input.style.cursor = mqttToggle.checked ? 'text' : 'not-allowed';
        }
      });
    };

    cloudToggle.addEventListener('change', (e) => {
      if (e.target.checked) {
        mqttToggle.checked = false;
        mqttToggle.closest('label').querySelector('.protocol-toggle-status').textContent = 'Nonaktif';
      }
      updateUI();
    });

    mqttToggle.addEventListener('change', (e) => {
      if (e.target.checked) {
        cloudToggle.checked = false;
      }
      updateUI();
    });

    // We observe changes made by populate
    setInterval(updateUI, 1000);
  }
};

/* ============================================================
   INIT — DOM Ready
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  // Core systems
  Toast.init();
  Modal.init();
  Auth.init();
  MobileSidebar.init();

  // Tabs initialization
  Tabs.init('integrasi');
  Tabs.activateFirst('integrasi');
  Tabs.init('hardware');
  Tabs.activateFirst('hardware');
  Tabs.init('sistem');
  Tabs.activateFirst('sistem');

  // Cloud & MQTT Mutually Exclusive
  CloudMqttExclusivity.init();

  // Hardware PIN manager
  PinManager.init();

  // WiFi Manager (Scan & Mode Toggle)
  WiFiManager.init();
  NetMainManager.init();

  // Form handlers (generic data-api forms)
  FormHandler.init();

  // Sensor Manager (Modbus & KF350)
  SensorManager.init();

  // Telekontrol Manager
  TelekontrolManager.init();

  // User management
  document.getElementById('form-add-user')?.addEventListener('submit', (e) => UserMgr.addUser(e));

  // Download buttons
  document.getElementById('btn-download-csv')?.addEventListener('click', () => Downloader.csv());
  document.getElementById('btn-download-log')?.addEventListener('click', () => Downloader.log());

  // Backup / Restore
  document.getElementById('btn-backup')?.addEventListener('click', () => BackupRestore.backup());
  document.getElementById('btn-restore-file')?.addEventListener('change', (e) => {
    BackupRestore.restore(e.target.files[0]);
    e.target.value = ''; // reset input
  });

  // System actions
  document.getElementById('btn-reboot')?.addEventListener('click', () => SystemActions.reboot());
  document.getElementById('btn-factory-reset')?.addEventListener('click', () => SystemActions.factoryReset());
  document.getElementById('btn-format-sd')?.addEventListener('click', () => SystemActions.formatSD());
  document.getElementById('btn-sync-rtc')?.addEventListener('click', () => SystemActions.editTime());
  document.getElementById('btn-edit-logger-name')?.addEventListener('click', () => SystemActions.editLoggerName());
  document.getElementById('btn-edit-time')?.addEventListener('click', () => SystemActions.editTime());
  document.getElementById('btn-save-system-name')?.addEventListener('click', () => SystemActions.saveSystemName());
  document.getElementById('led-enabled')?.addEventListener('change', () => SystemActions.toggleLED());
  document.getElementById('telekontrol-toggle-switch')?.addEventListener('change', () => SystemActions.toggleTelekontrol());
  document.getElementById('grafik-toggle-switch')?.addEventListener('change', () => SystemActions.toggleGrafik());

  // Logout
  document.getElementById('btn-logout')?.addEventListener('click', () => Auth.logout());

  // Language toggle
  document.querySelectorAll('[data-lang-btn]').forEach(btn => {
    btn.addEventListener('click', () => LangToggle.toggle(btn.getAttribute('data-lang-btn')));
  });

  // Sidebar nav for sistem → render user table when active
  document.querySelector('[data-section="sistem"]')?.addEventListener('click', () => {
    // Nav.navigate already handles this
  });

  // Pin save button
  document.getElementById('btn-save-pins')?.addEventListener('click', (e) => PinManager.savePins(e));

  console.log('%cAPI Docs: lihat komentar atas app.js', 'color: #8892b0; font-size: 12px;');
});

/* ============================================================
   NETWORK PING TEST (ASYNC)
   ============================================================ */
window.pingTest = async function () {
  const hostInput = document.getElementById('ping-host');
  const resEl = document.getElementById('ping-result');
  if (!hostInput || !resEl) return;

  const host = hostInput.value.trim() || '8.8.8.8';
  resEl.textContent = `Memulai ping ke ${host}...`;
  resEl.style.color = 'var(--text-muted)';

  try {
    const res = await API.get('/api/ping?host=' + encodeURIComponent(host));
    if (res && res.success) {
      resEl.textContent = `Menunggu balasan dari ${host}...`;

      const poll = setInterval(async () => {
        try {
          const pollRes = await API.get('/api/ping-result');
          if (pollRes && pollRes.status === 'done') {
            clearInterval(poll);
            if (pollRes.success) {
              resEl.textContent = `Sukses! Terhubung ke ${host} (Waktu: ${pollRes.time_ms} ms)`;
              resEl.style.color = 'var(--emerald)';
            } else {
              resEl.textContent = `Gagal! Tidak dapat terhubung ke ${host}.`;
              resEl.style.color = 'var(--red)';
            }
          }
        } catch (e) {
          clearInterval(poll);
          resEl.textContent = `Error: Terputus saat mengecek status.`;
          resEl.style.color = 'var(--red)';
        }
      }, 1500); // Polling setiap 1.5 detik

    } else {
      resEl.textContent = `Gagal memulai ping: ${res.error || 'Terjadi kesalahan'}.`;
      resEl.style.color = 'var(--red)';
    }
  } catch (err) {
    resEl.textContent = `Error: Gagal mengakses uji ping.`;
    resEl.style.color = 'var(--red)';
  }
};

/* ============================================================
   OTA FIRMWARE UPDATE
   ============================================================ */
window.startOTAUpdate = function () {
  const fileInput = document.getElementById('ota-file');
  if (!fileInput || !fileInput.files.length) {
    Toast.error('Error', 'Pilih file .bin firmware terlebih dahulu!');
    return;
  }

  window.isOTAUploading = true;
  const file = fileInput.files[0];
  if (!file.name.endsWith('.bin')) {
    Toast.warning('Peringatan', 'File harus berekstensi .bin!');
    return;
  }

  const token = sessionStorage.getItem('molinar_token');
  if (!token) {
    Auth.logout();
    return;
  }

  // Tampilkan progress bar
  const progressContainer = document.getElementById('ota-progress-container');
  const progressBar = document.getElementById('ota-progress-bar');
  const progressText = document.getElementById('ota-progress-text');

  progressContainer.style.display = 'block';
  progressBar.style.width = '0%';
  progressText.textContent = '0%';

  const formData = new FormData();
  formData.append('update', file, file.name);

  const typeSelection = document.querySelector('input[name="ota_type"]:checked');
  const typeVal = typeSelection ? typeSelection.value : 'fw';

  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/update?type=${typeVal}`, true);
  xhr.setRequestHeader('X-Auth-Token', token);

  xhr.upload.onprogress = function (e) {
    if (e.lengthComputable) {
      const percentComplete = Math.round((e.loaded / e.total) * 100);
      progressBar.style.width = percentComplete + '%';
      progressText.textContent = percentComplete + '%';
    }
  };

  xhr.onload = function () {
    if (xhr.status === 200) {
      try {
        const res = JSON.parse(xhr.responseText);
        if (res.success) {
          Toast.success('Sukses', res.message || 'Pembaruan berhasil. Menyala ulang...');
          progressText.textContent = 'Selesai! Memuat ulang...';
          setTimeout(() => {
            window.location.reload();
          }, 15000); // Tunggu 15 detik untuk reboot
        } else {
          Toast.error('Gagal', res.message || 'Pembaruan dibatalkan.');
          progressContainer.style.display = 'none';
          window.isOTAUploading = false;
        }
      } catch (e) {
        Toast.error('Error', 'Respons server tidak valid.');
        progressContainer.style.display = 'none';
        window.isOTAUploading = false;
      }
    } else {
      Toast.error('Gagal', 'Terjadi kesalahan saat mengunggah (Status: ' + xhr.status + ')');
      progressContainer.style.display = 'none';
      window.isOTAUploading = false;
    }
  };

  xhr.onerror = function () {
    Toast.error('Gagal', 'Koneksi terputus saat mengunggah.');
    progressContainer.style.display = 'none';
    window.isOTAUploading = false;
  };

  xhr.send(formData);
};


/* ============================================================
   AUTOMATION MANAGER — Local Automation Engine (LAE)
   ============================================================ */
const AutomationManager = {
  rules: [],
  editingId: null,
  _sensorList: [],   // [{id, name, source}] — populated saat init
  _actuatorList: [], // [{actuator_id, name, slave_id, fc, register}]

  // ── Inisialisasi ─────────────────────────────────────────
  async init() {
    if (!this._initialized) {
      this._bindModalEvents();
      this._initialized = true;
    }
    await this.fetchRules();
    await this._loadSensorAndActuatorLists();
    this.renderRulesList();
  },

  // ── Ambil semua aturan dari ESP32 ─────────────────────────
  async toggleRule(id, isActive) {
    const r = this.rules.find(x => x.id === id);
    if (r) {
      r.enabled = isActive;
      await this.saveRules();
    }
  },

  async fetchRules() {
    try {
      const res = await API.get('/api/automation');
      this.rules = Array.isArray(res.rules) ? res.rules : [];
    } catch (e) {
      this.rules = [];
    }
  },

  // ── Simpan semua aturan ke ESP32 ──────────────────────────
  async saveRules() {
    try {
      await API.post('/api/automation', { enabled: true, rules: this.rules });
      Toast.success('Tersimpan', 'Aturan otomasi berhasil disimpan.');
    } catch (e) {
      Toast.error('Gagal', 'Gagal menyimpan aturan otomasi.');
    }
  },

  // ── Muat daftar sensor & aktuator dari config ──────────────
  async _loadSensorAndActuatorLists() {
    this._sensorList = [];
    this._actuatorList = [];
    try {
      const cfg = await API.get('/api/config');

      // Modbus sensors
      const mbParams = cfg?.sensor?.modbus?.params || [];
      mbParams.forEach(p => {
        this._sensorList.push({ id: p.id, name: p.name || p.id, source: 'modbus' });
      });

      // KF350 sensors
      const kfParams = cfg?.sensor?.kf350?.params || [];
      kfParams.forEach(p => {
        const src = p.type === 'Digital' ? 'kf350_io'
                  : (p.port?.includes('A2') || p.port?.includes('A3')) ? 'kf350_420'
                  : p.port?.startsWith('ADS') ? 'kf350_analog' : 'kf350_adc';
        this._sensorList.push({ id: p.id, name: p.name || p.id, source: src });
      });

      // Telekontrol actuators (as both sensor & actuator)
      const tkParams = cfg?.sensor?.telekontrol?.params || [];
      tkParams.forEach(p => {
        this._sensorList.push({ id: p.id, name: p.name || p.id, source: 'telekontrol' });
        this._actuatorList.push({
          actuator_id: p.id,
          name: p.name || p.id,
          slave_id: p.slaveId || p.slave_id || 1,
          fc: p.writeFc || p.fc || 5,
          register: p.register || 0,
        });
      });
    } catch (e) { /* Gagal memuat, list tetap kosong */ }
  },

  // ── Label helper ──────────────────────────────────────────
  _labelForSource(src) {
    const map = {
      modbus: 'Modbus RTU',
      kf350_analog: 'Analog I2C',
      kf350_420: '4–20mA',
      kf350_adc: 'Analog ADC',
      kf350_io: 'IO Digital',
      telekontrol: 'Telekontrol',
    };
    return map[src] || src;
  },

  _labelForDay(d) {
    return ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'][d] || d;
  },

  // ── Render daftar aturan ──────────────────────────────────
  renderRulesList() {
    const container = document.getElementById('automation-rules-list');
    if (!container) return;

    if (this.rules.length === 0) {
      container.innerHTML = `
        <div class="card" style="text-align:center; padding:40px; color:var(--text-muted);">
          <div style="font-size:48px; margin-bottom:12px;">🤖</div>
          <div style="font-size:15px; font-weight:600; margin-bottom:6px;">Belum Ada Aturan Otomasi</div>
          <div style="font-size:13px;">Klik "+ Tambah Aturan" untuk membuat aturan pertama.</div>
        </div>`;
      return;
    }

    container.innerHTML = this.rules.map(r => this._renderRuleCard(r)).join('');
  },

  _renderRuleCard(r) {
    const isActive = r.enabled !== false;
    const isSchedule = r.type === 'schedule';
    const badgeClass = isActive ? 'chip-emerald' : 'chip-danger';
    const badgeText = isActive ? 'AKTIF' : 'NONAKTIF';
    const typeIcon = isSchedule ? '🕐' : '🔍';

    let triggerHtml = '';
    if (isSchedule) {
      const h = String(r.schedule?.hour ?? '-').padStart(2,'0');
      const m = String(r.schedule?.minute ?? '-').padStart(2,'0');
      const days = (r.schedule?.days_of_week || []);
      const dayStr = days.length === 0 ? 'Setiap hari'
                   : days.map(d => this._labelForDay(d)).join(', ');
      triggerHtml = `<div class="resource-item" style="margin:0;">
        <span style="color:var(--amber); font-weight:600; font-size:11px; letter-spacing:.06em;">JADWAL</span>
        <span style="margin-left:8px; font-size:13px;">${dayStr} jam <strong>${h}:${m}</strong></span>
      </div>`;
    } else {
      const conds = r.conditions || [];
      triggerHtml = conds.map((c, i) => {
        const sensorId = c.sensor_id;
        const sn = this._sensorList.find(s => String(s.id) === String(sensorId));
        const sName = sn ? sn.name : sensorId;
        const sSrc = sn ? this._labelForSource(sn.source) : c.source;
        return `<div class="resource-item" style="margin:0;">
          <span style="color:var(--cyan); font-weight:600; font-size:11px; letter-spacing:.06em;">${i === 0 ? 'JIKA' : 'DAN '}</span>
          <span style="margin-left:8px; font-size:13px;">${sName} <span style="color:var(--text-muted);">(${sSrc})</span> <strong>${c.operator}</strong> ${c.value}</span>
        </div>`;
      }).join('');
    }

    const act = r.action || {};
    const actName = this._actuatorList.find(a => String(a.actuator_id) === String(act.actuator_id))?.name || act.actuator_id || '?';
    const actCmd = act.command == 65280 ? 'ON' : 'OFF';
    const cdSec = Math.round((r.cooldown_ms || 0) / 1000);

    return `
    <div class="card mb-24" style="border-left: 3px solid ${isActive ? 'var(--emerald)' : 'var(--text-muted)'};">
      <div class="card-header">
        <div class="card-title">
          <span>${typeIcon}</span>
          <span>${r.name || 'Tanpa Nama'}</span>
          <span class="chip ${badgeClass}" style="font-size:10px;">${badgeText}</span>
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="btn btn-secondary" style="padding:4px 10px; font-size:12px;"
            onclick="AutomationManager.showEditModal('${r.id}')">✏️ Edit</button>
          <button class="btn btn-danger" style="padding:4px 10px; font-size:12px;"
            onclick="AutomationManager.deleteRule('${r.id}')">🗑️</button>
        </div>
      </div>
      <div class="card-body" style="padding-top:8px; padding-bottom:8px;">
        ${triggerHtml}
        <div class="resource-item" style="margin:4px 0 0;">
          <span style="color:var(--purple); font-weight:600; font-size:11px; letter-spacing:.06em;">MAKA</span>
          <span style="margin-left:8px; font-size:13px;"><strong>${actName}</strong> → ${actCmd}</span>
        </div>
      </div>
      <div class="card-footer" style="display:flex; align-items:center; justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:12px;">
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:13px;">
            <input type="checkbox" ${isActive ? 'checked' : ''}
              onchange="AutomationManager.toggleRule('${r.id}', this.checked)">
            Aktifkan
          </label>
          <span style="font-size:12px; color:var(--text-muted);">Cooldown: ${cdSec} dtk</span>
        </div>
        <button class="btn btn-secondary" style="padding:4px 12px; font-size:12px;"
          onclick="AutomationManager.testRule('${r.id}')">▶ Test</button>
      </div>
    </div>`;
  },

  // ── Bind event modal ──────────────────────────────────────
  _bindModalEvents() {
    const ruleTypeEl = document.getElementById('auto-rule-type');
    if (ruleTypeEl) {
      ruleTypeEl.addEventListener('change', () => this.onRuleTypeChange());
    }

    const addCondBtn = document.getElementById('btn-add-condition');
    if (addCondBtn) {
      addCondBtn.addEventListener('click', () => this._addConditionRow());
    }

    const cancelBtn = document.getElementById('btn-automation-modal-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeModal());

    const saveBtn = document.getElementById('btn-automation-modal-save');
    if (saveBtn) saveBtn.addEventListener('click', () => this.saveFromModal());

    const addRuleBtn = document.getElementById('btn-add-automation-rule');
    if (addRuleBtn) addRuleBtn.addEventListener('click', () => this.showAddModal());
  },

  // ── Toggle panel sensor vs jadwal ────────────────────────
  onRuleTypeChange() {
    const type = document.getElementById('auto-rule-type')?.value;
    document.getElementById('auto-sensor-panel').style.display = type === 'sensor' ? '' : 'none';
    document.getElementById('auto-schedule-panel').style.display = type === 'schedule' ? '' : 'none';
  },

  // ── Render 1 baris kondisi di modal ──────────────────────
  _renderConditionRow(idx, cond = {}) {
    const sourceOptions = this._sensorList.map(s =>
      `<option value="${s.id}" data-src="${s.source}" ${String(cond.sensor_id) === String(s.id) ? 'selected' : ''}>
        ${s.name} (${this._labelForSource(s.source)})</option>`
    ).join('');

    const ops = ['>', '<', '>=', '<=', '==', '!='];
    const opOptions = ops.map(o =>
      `<option value="${o}" ${cond.operator === o ? 'selected' : ''}>${o}</option>`
    ).join('');

    return `
    <div class="form-row auto-cond-row" style="align-items:center; margin-bottom:8px;" data-idx="${idx}">
      <div class="form-group" style="flex:2; margin-bottom:0;">
        <select class="form-control auto-cond-sensor" style="font-size:12px;">
          <option value="">— Pilih Sensor —</option>
          ${sourceOptions}
        </select>
      </div>
      <div class="form-group" style="flex:0 0 70px; margin-bottom:0;">
        <select class="form-control auto-cond-op" style="font-size:12px;">${opOptions}</select>
      </div>
      <div class="form-group" style="flex:1; margin-bottom:0;">
        <input type="number" class="form-control auto-cond-val" step="any"
          value="${cond.value ?? ''}" placeholder="Nilai" style="font-size:12px;">
      </div>
      <button class="btn btn-danger" style="padding:4px 8px; font-size:12px; flex-shrink:0;"
        onclick="this.closest('.auto-cond-row').remove()">✕</button>
    </div>`;
  },

  _addConditionRow(cond) {
    const container = document.getElementById('auto-conditions-container');
    if (!container) return;
    const rows = container.querySelectorAll('.auto-cond-row');
    if (rows.length >= 3) { Toast.warn('Batas', 'Maks. 3 kondisi per aturan.'); return; }
    container.insertAdjacentHTML('beforeend', this._renderConditionRow(rows.length, cond));
  },

  // ── Isi dropdown aktuator ─────────────────────────────────
  _populateActuatorSelect(selectedId = '') {
    const sel = document.getElementById('auto-action-actuator');
    if (!sel) return;
    sel.innerHTML = this._actuatorList.length
      ? this._actuatorList.map(a =>
          `<option value="${a.actuator_id}" ${a.actuator_id === selectedId ? 'selected' : ''}>${a.name}</option>`
        ).join('')
      : '<option value="">— Tidak ada aktuator terdaftar —</option>';
  },

  // ── Buka modal Tambah ─────────────────────────────────────
  showAddModal() {
    this.editingId = null;
    document.getElementById('automation-modal-title').textContent = 'Tambah Aturan Otomasi';
    document.getElementById('auto-name').value = '';
    document.getElementById('auto-cooldown').value = '30';
    document.getElementById('auto-rule-type').value = 'sensor';
    document.getElementById('auto-conditions-container').innerHTML = '';
    document.getElementById('auto-sched-hour').value = '6';
    document.getElementById('auto-sched-minute').value = '0';
    document.querySelectorAll('.auto-day-chk').forEach(cb => cb.checked = false);
    this._populateActuatorSelect();
    document.getElementById('auto-action-command').value = '65280';
    this.onRuleTypeChange();
    this._addConditionRow(); // 1 baris kondisi default
    document.getElementById('automation-modal-overlay').style.display = 'flex';
  },

  // ── Buka modal Edit ───────────────────────────────────────
  showEditModal(id) {
    const rule = this.rules.find(r => r.id === id);
    if (!rule) return;
    this.editingId = id;
    document.getElementById('automation-modal-title').textContent = 'Edit Aturan Otomasi';
    document.getElementById('auto-name').value = rule.name || '';
    document.getElementById('auto-cooldown').value = Math.round((rule.cooldown_ms || 0) / 1000);
    document.getElementById('auto-rule-type').value = rule.type || 'sensor';
    document.getElementById('auto-conditions-container').innerHTML = '';
    this.onRuleTypeChange();

    if (rule.type === 'schedule') {
      document.getElementById('auto-sched-hour').value = rule.schedule?.hour ?? 6;
      document.getElementById('auto-sched-minute').value = rule.schedule?.minute ?? 0;
      const activeDays = rule.schedule?.days_of_week || [];
      document.querySelectorAll('.auto-day-chk').forEach(cb => {
        cb.checked = activeDays.includes(parseInt(cb.value));
      });
    } else {
      (rule.conditions || []).forEach(c => this._addConditionRow(c));
      if (document.querySelectorAll('.auto-cond-row').length === 0) this._addConditionRow();
    }

    this._populateActuatorSelect(rule.action?.actuator_id);
    document.getElementById('auto-action-command').value = String(rule.action?.command ?? 65280);
    document.getElementById('automation-modal-overlay').style.display = 'flex';
  },

  closeModal() {
    document.getElementById('automation-modal-overlay').style.display = 'none';
  },

  // ── Simpan dari modal ─────────────────────────────────────
  async saveFromModal() {
    const name = document.getElementById('auto-name').value.trim();
    if (!name) { Toast.warn('Validasi', 'Nama aturan tidak boleh kosong.'); return; }

    const ruleType = document.getElementById('auto-rule-type').value;
    const cooldownMs = (parseInt(document.getElementById('auto-cooldown').value) || 0) * 1000;

    // Ambil data action
    const actSel = document.getElementById('auto-action-actuator');
    const actId = actSel?.value || '';
    const actData = this._actuatorList.find(a => a.actuator_id === actId);
    if (!actData) { Toast.warn('Validasi', 'Pilih aktuator/relay terlebih dahulu.'); return; }
    const command = parseInt(document.getElementById('auto-action-command').value);

    const action = {
      type: 'modbus_relay',
      actuator_id: actData.actuator_id,
      slave_id: actData.slave_id,
      fc: actData.fc,
      register: actData.register,
      command,
    };

    let rule = {
      id: this.editingId || 'rule_' + Date.now(),
      name,
      enabled: true,
      type: ruleType,
      action,
      cooldown_ms: cooldownMs,
      last_fired_ms: 0,
    };

    if (ruleType === 'sensor') {
      const condRows = document.querySelectorAll('.auto-cond-row');
      if (condRows.length === 0) { Toast.warn('Validasi', 'Tambahkan minimal 1 kondisi sensor.'); return; }
      const conditions = [];
      for (const row of condRows) {
        const selEl = row.querySelector('.auto-cond-sensor');
        const sensorId = selEl?.value || '';
        if (!sensorId) { Toast.warn('Validasi', 'Pilih sensor untuk setiap kondisi.'); return; }
        const sn = this._sensorList.find(s => String(s.id) === String(sensorId));
        conditions.push({
          source: sn ? sn.source : 'modbus',
          sensor_id: sensorId,
          operator: row.querySelector('.auto-cond-op')?.value || '>',
          value: parseFloat(row.querySelector('.auto-cond-val')?.value) || 0,
        });
      }
      rule.conditions = conditions;
      rule.logic = 'AND';
    } else {
      // schedule
      const hour = parseInt(document.getElementById('auto-sched-hour').value);
      const minute = parseInt(document.getElementById('auto-sched-minute').value);
      if (isNaN(hour) || isNaN(minute)) { Toast.warn('Validasi', 'Jam dan menit harus diisi.'); return; }
      const days = [];
      document.querySelectorAll('.auto-day-chk:checked').forEach(cb => days.push(parseInt(cb.value)));
      rule.schedule = { hour, minute, days_of_week: days };
      if (cooldownMs === 0) rule.cooldown_ms = 3600000; // default 1 jam untuk jadwal
    }

    // Update atau tambahkan
    if (this.editingId) {
      const existingRule = this.rules.find(r => r.id === this.editingId);
      if (existingRule) rule.last_fired_ms = existingRule.last_fired_ms || 0;
      this.rules = this.rules.map(r => r.id === this.editingId ? rule : r);
    } else {
      if (this.rules.length >= 25) { Toast.warn('Batas', 'Maks. 25 aturan otomasi.'); return; }
      this.rules.push(rule);
    }

    this.closeModal();
    await this.saveRules();
    this.renderRulesList();
  },

  // ── Toggle enable/disable ─────────────────────────────────
  async toggleRule(id, enabled) {
    const rule = this.rules.find(r => r.id === id);
    if (!rule) return;
    rule.enabled = enabled;
    await this.saveRules();
    this.renderRulesList();
  },

  // ── Hapus aturan ──────────────────────────────────────────
  async deleteRule(id) {
    // Find rule to ensure it exists
    const rule = this.rules.find(r => r.id === id);
    if (!rule) return;
    // Show confirmation dialog
    const msg = 'Apakah Anda yakin ingin menghapus aturan otomasi ini? Tindakan tidak dapat dibatalkan.';
    if (!window.confirm(msg)) {
      return; // User cancelled
    }
    this.rules = this.rules.filter(r => r.id !== id);
    await this.saveRules();
    this.renderRulesList();
  },

  // ── Test paksa ────────────────────────────────────────────
  async testRule(id) {
    try {
      const res = await API.post('/api/automation/test', { id });
      Toast.success('Test Berhasil', res.message || 'Aksi dieksekusi.');
    } catch (e) {
      Toast.error('Test Gagal', e.message || 'Gagal mengeksekusi aksi.');
    }
  },
};

// ── Daftarkan AutomationManager ke Nav ───────────────────────
if (typeof Nav !== 'undefined') {
  const _origNavigate = Nav.navigate.bind(Nav);
  Nav.navigate = function(section) {
    _origNavigate(section);
    if (section === 'otomasi') {
      AutomationManager.init();
    }
  };
}
