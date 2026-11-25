# Fitur Otomasi Lokal — Logger Molinar ESP32-S3

## Latar Belakang

Saat ini Logger Molinar hanya berfungsi sebagai **perekam data** (*data logger*) pasif dan memiliki **kontrol manual** (*telekontrol*).

Fitur ini menambahkan lapisan kecerdasan **"Jika... Maka..."** yang berjalan sepenuhnya di dalam chip ESP32-S3, tanpa bergantung pada internet atau cloud.

---

## Tujuan

Menambahkan menu **"Otomasi"** di bawah "Panel Kontrol" pada sidebar, memungkinkan pengguna membuat aturan otomatis yang menghubungkan sensor (input) ke relay (output).

---

## Open Questions

> [!IMPORTANT]
> Sebelum eksekusi, ada beberapa hal yang perlu dikonfirmasi:
>
> 1. **Jumlah aturan maksimal**: Berapa banyak aturan otomasi yang perlu didukung? Diusulkan **10 aturan** (sesuai keterbatasan RAM).
> 2. **Sumber sensor pemicu**: Apakah otomasi hanya untuk sensor **Modbus** saja, atau juga bisa dipicu oleh sensor **KF350** (Analog/Digital)?
> 3. **Aksi yang didukung**: Apakah aksi hanya **Relay (DO)** saja, atau juga termasuk **Analog Out (AO)**?
> 4. **Kondisi AND/OR**: Apakah cukup dengan **1 kondisi saja** (simple) untuk tahap pertama ini?

---

## Skema Data (config.json)

Aturan otomasi disimpan di dalam `config.json` di LittleFS, sehingga tetap tersimpan meski perangkat di-restart.

```json
"automation": {
  "enabled": true,
  "rules": [
    {
      "id": "rule_1750000000000",
      "name": "Pompa Air Otomatis",
      "enabled": true,
      "trigger": {
        "source":   "modbus",
        "sensor_id": "1781662664083",
        "operator": "<",
        "value":    100.0
      },
      "action": {
        "type":       "relay",
        "actuator_id": "1781663734852",
        "command":    65280
      },
      "cooldown_ms": 30000,
      "last_fired_ms": 0
    }
  ]
}
```

| Field | Keterangan |
|---|---|
| `trigger.source` | `"modbus"` atau `"kf350"` |
| `trigger.sensor_id` | ID unik sensor (sama dengan ID di config sensor) |
| `trigger.operator` | `">"`, `"<"`, `">="`, `"<="`, `"=="`, `"!="` |
| `trigger.value` | Nilai batas (float) |
| `action.type` | `"relay"` (untuk saat ini) |
| `action.actuator_id` | ID unik aktuator Telekontrol |
| `action.command` | `65280` = ON, `0` = OFF |
| `cooldown_ms` | Jeda minimum antar eksekusi (mencegah relay chattering) |

---

## Proposed Changes

### A. `src/main.cpp`

#### [MODIFY] Engine Otomasi di `loop()`

Tambahkan blok pengecekan aturan yang berjalan setiap **1 detik** di dalam `loop()`. Blok ini membaca `modbusLiveCache` (yang sudah ada) dan membandingkan nilainya dengan kondisi aturan.

```
Lokasi penyisipan: Setelah blok "Update Live Data Cache setiap 2 detik" (sekitar baris 2636)

Logika:
static unsigned long lastAutomationCheck = 0;
if (millis() - lastAutomationCheck > 1000UL) {
  lastAutomationCheck = millis();
  
  // Muat aturan dari config
  // Loop semua rules yang enabled
  // Baca nilai sensor dari modbusLiveCache / kf350 live reading
  // Evaluasi operator (>, <, ==, dll)
  // Jika kondisi TRUE dan cooldown sudah lewat:
  //   → Tambahkan ModbusWriteCmd ke modbusWriteQueue (mekanisme yang sudah ada!)
  //   → Catat log: "Aturan 'X' dieksekusi"
  //   → Update last_fired_ms
}
```

> [!NOTE]
> **Tidak perlu mekanisme baru!** Engine otomasi akan menggunakan `modbusWriteQueue` yang sudah ada dan terbukti berjalan dengan benar. Risiko sangat minimal.

#### [MODIFY] Endpoint API Baru

Tambahkan 3 endpoint baru di `setupAPIRoutes()`:

| Method | Endpoint | Fungsi |
|---|---|---|
| `GET` | `/api/automation` | Ambil semua aturan dari config |
| `POST` | `/api/automation` | Simpan semua aturan ke config |
| `POST` | `/api/automation/test/:id` | Eksekusi paksa 1 aturan untuk pengujian |

---

### B. `data/index.html`

#### [MODIFY] Tambah Section Otomasi

Tambahkan section HTML baru **setelah** `section-telekontrol` (baris 1741) dan **sebelum** `section-sistem`.

```html
<!-- SECTION: OTOMASI -->
<section id="section-otomasi" class="section" aria-label="Otomasi">
  <div class="section-header">
    <div class="header-accent" style="background: var(--amber)"></div>
    <h2>⚙️ Otomasi</h2>
    <p>Buat aturan "Jika... Maka..." yang berjalan otomatis di dalam perangkat.</p>
  </div>

  <!-- Tombol Tambah Aturan -->
  <div style="display:flex; justify-content:flex-end; margin-bottom:16px;">
    <button id="btn-add-rule" class="btn btn-emerald">+ Tambah Aturan</button>
  </div>

  <!-- Daftar Aturan (dirender oleh app.js) -->
  <div id="automation-rules-list"></div>
</section>
```

---

### C. `data/app.js`

#### [MODIFY] Tambah Menu Navigasi

Tambahkan 1 item baru ke array `Nav.menus`:

```js
{ id: 'nav-otomasi', icon: '⚙️', key: 'sidebar_otomasi', section: 'otomasi', roles: ['admin'] },
```
Posisi: Setelah `nav-telekontrol`, sebelum `nav-sistem`.

#### [MODIFY] Tambah Terjemahan

Tambahkan key baru ke objek terjemahan `i18n`:
```js
sidebar_otomasi: 'Otomasi',
```

#### [NEW] Objek `AutomationManager`

Tambahkan objek baru `AutomationManager` di akhir `app.js` dengan fungsi-fungsi berikut:

| Fungsi | Keterangan |
|---|---|
| `init()` | Muat aturan dari API, render UI |
| `fetchRules()` | `GET /api/automation` |
| `saveRules()` | `POST /api/automation` |
| `renderRulesList()` | Render kartu aturan secara dinamis |
| `showAddEditModal(id?)` | Tampilkan modal form tambah/edit aturan |
| `deleteRule(id)` | Hapus aturan dari array, simpan |
| `toggleRule(id)` | ON/OFF aturan, simpan |
| `testRule(id)` | `POST /api/automation/test/:id` |

**Tampilan Kartu Aturan:**
```
┌─────────────────────────────────────────────┐
│ 🟢 ON │  Pompa Air Otomatis          [Edit] [🗑️] │
│                                              │
│  JIKA  Water Level TMA  <  100 cm           │
│  MAKA  Relay 1          →  ON               │
│                                             │
│  Cooldown: 30 detik    [▶ Test Sekarang]    │
└─────────────────────────────────────────────┘
```

---

## Verification Plan

### Pengujian Firmware (ESP32)
1. Tambah aturan: *Jika Water Level TMA < 100, Relay 1 ON*
2. Atur nilai sensor Modbus di bawah 100 (atau simulasi)
3. Tunggu maks 1 detik → Relay 1 harus menyala secara otomatis
4. Cek log sistem: harus muncul `[ok] Aturan 'Pompa Air Otomatis' dieksekusi`
5. Uji *cooldown*: pastikan relay tidak berulang kali on/off dalam jeda pendek

### Pengujian Persistensi
1. Tambah aturan → matikan ESP32 → nyalakan kembali
2. Aturan harus tetap ada di halaman Otomasi

### Pengujian UI
1. Tambah aturan → muncul di daftar
2. Edit aturan → form terisi nilai lama
3. Hapus aturan → hilang dari daftar
4. Toggle ON/OFF → status berubah, disimpan ke config

---

## Estimasi Dampak Sumber Daya ESP32-S3

| Sumber Daya | Dampak |
|---|---|
| RAM | +~2 KB (10 aturan × ~200 byte) |
| Flash (kode) | +~4 KB (fungsi C++ baru) |
| CPU Load | +~0.1% (loop 1 detik yang sangat ringan) |
| config.json | +~2 KB per 10 aturan |

**Kesimpulan: Sangat aman dan tidak mengganggu performa yang sudah ada.**
