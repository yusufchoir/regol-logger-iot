# Panduan Pembaruan Firmware (OTA) - Molinar Logger

Dokumen ini berisi informasi sangat penting mengenai cara kerja fitur Pembaruan OTA (Over-The-Air) pada perangkat Logger Molinar (ESP32-S3). Pembaruan OTA memungkinkan Anda memperbarui sistem secara nirkabel melalui antarmuka web, tanpa perlu mencolokkan kabel USB.

Saat Anda masuk ke menu **Pembaruan Firmware (OTA)**, Anda akan dihadapkan pada dua pilihan utama:
1. `FIRMWARE`
2. `WEB (UI/UX)`

Sangat penting untuk memahami perbedaan keduanya agar Anda tidak kehilangan data konfigurasi (seperti daftar sensor, *password* WiFi, aktuator, dll) secara tidak sengaja.

---

## 1. Pilihan "FIRMWARE" 🔵 (Aman!)
Pilihan ini digunakan ketika Anda mengunggah file `firmware.bin` (yang biasanya dihasilkan dari proses *Build* kode C++ utama di PlatformIO).

* **Apakah pengaturan akan kembali ke default?** **TIDAK.**
* **Penjelasan:** File `firmware.bin` hanya akan menimpa partisi "otak logika" ESP32 (ruang aplikasi utama). Partisi memori penyimpanan data (LittleFS) tempat menyimpan `config.json`, pengaturan WiFi, Modbus, dan file grafik *log* tidak akan disentuh sama sekali.
* **Kesimpulan:** Semuanya akan tetap aman dan persis seperti sebelum di-*update*.

---

## 2. Pilihan "WEB (UI/UX)" ⚪ (Hati-hati, Kembali ke Default!)
Pilihan ini digunakan ketika Anda mengunggah file `littlefs.bin` (yang dihasilkan dari proses *Build Filesystem Image* di PlatformIO).

* **Apakah pengaturan akan kembali ke default?** **YA.**
* **Penjelasan:** File `littlefs.bin` berisi wujud mentah dari folder `data/` di komputer pengembang (yang secara standar hanya berisi susunan file `.html`, `.css`, `.js`, dll). Ketika Anda mengunggahnya, ESP32 akan **memformat ulang seluruh partisi penyimpanannya** dan menimpanya dengan isi folder `data/` bawaan pabrik tersebut.
* **Dampak:** Konfigurasi `config.json` (pengaturan yang Anda simpan) dan file riwayat *datalogger* yang tadinya ada di memori ESP32 akan langsung ikut terhapus. Alat akan kembali ke pengaturan awal (pabrik).

---

## 💡 Tips Aman Melakukan Update "WEB (UI/UX)"
Jika di masa depan ada pembaruan tampilan antarmuka (Web UI) yang mengharuskan Anda mengunggah file `littlefs.bin` lewat OTA, lakukan prosedur keamanan (Backup & Restore) berikut agar Anda tidak perlu mengetik ulang semua pengaturan secara manual:

1. **Backup Data**: Pergi ke menu **Pengaturan Hardware -> Sistem**.
2. Klik tombol **"Backup Konfigurasi"**. Sebuah file `config.json` akan terunduh dan tersimpan ke laptop/HP Anda.
3. **Lakukan Pembaruan**: Lakukan pembaruan **WEB (UI/UX)** di menu OTA dengan mengunggah file `littlefs.bin`. Alat akan melakukan proses unggah, lalu *restart*, dan otomatis kembali ke pengaturan default.
4. **Restore Data**: Setelah alat hidup kembali (dan Anda terhubung lagi), masuk kembali ke menu Pengaturan Hardware -> Sistem.
5. Klik tombol **"Restore Konfigurasi"**, lalu pilih file `config.json` yang tadi Anda unduh pada langkah ke-2.
6. **Selesai!** Seluruh pengaturan sensor, nama alat, WiFi, hingga Aktuator Anda akan kembali pulih 100%.

---
*Dokumen ini dibuat untuk menjaga integritas data Anda selama proses pemeliharaan sistem jarak jauh.*
