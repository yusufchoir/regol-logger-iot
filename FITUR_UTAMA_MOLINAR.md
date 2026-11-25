# Fitur Utama Molinar Logger: Arsitektur Kelas Industri

Dokumen ini menjelaskan pilar-pilar arsitektur utama di dalam perangkat IoT Molinar Logger. Perangkat ini didesain bukan sekadar sebagai alat pengirim data biasa, melainkan sistem berstandar industri (*Industrial IoT*) yang mengedepankan keamanan data, keandalan jaringan, dan kemudahan manajemen jarak jauh.

Berikut adalah 4 Fitur Utama dari Molinar Logger:

---

## 1. Teknologi "Store & Forward" (Sistem Antrean & Batching)
Ketika memantau lalu lintas data MQTT di *Cloud*, Anda mungkin akan melihat bahwa Molinar Logger terkadang mengirimkan **beberapa data (misalnya 5 data) sekaligus dalam satu waktu/detik yang sama**. Ini **Bukanlah Bug/Error**, melainkan sebuah fitur cerdas.

**Keuntungan:**
- **Sinkronisasi Kecepatan:** ESP32 membaca sensor dengan cepat (misal: tiap 5 detik) untuk resolusi data yang tinggi, namun mengirim ke *Cloud* secara lebih santai (misal: tiap 10 detik) untuk menghemat *bandwidth*.
- **Anti-Hilang Data (*Zero Data Loss*):** Saat sinyal internet terputus, ESP32 tidak membuang data, melainkan menyimpannya di memori sementara (*Queue*). Begitu sinyal kembali, ia melakukan *Catch-up* dengan memborong pengiriman data masa lalunya (maksimal 5 data per siklus) agar *dashboard* kembali *real-time*.
- **Hemat Daya & Kuota (*Burst Transmission*):** Mengumpulkan data dan mengirimnya sekaligus jauh lebih hemat baterai dan kuota internet dibandingkan menghidupkan antena radio jaringan setiap detik.

## 2. Penyimpanan Cadangan Fisik (SD Card Datalogger)
Molinar Logger dilengkapi dengan modul MicroSD. Selain mengirim data ke *Cloud* secara nirkabel, alat ini juga menulis setiap baris data ke dalam SD Card secara lokal.

**Keuntungan:**
- **Keamanan Lapis Ganda:** Jika koneksi internet mati total berhari-hari atau berminggu-minggu (melebihi kapasitas memori RAM antrean ESP32), data Anda tetap aman dan terekam di dalam SD Card. Anda bisa mengambil SD Card tersebut dan memindahkan datanya ke komputer (sebagai berkas CSV/TXT) kapan saja.

## 3. Konfigurasi Jarak Jauh (*Remote Config* via MQTT)
Pengaturan alat IoT tradisional mengharuskan teknisi datang ke lapangan dan mencolokkan kabel USB. Molinar mendobrak batasan ini dengan fitur *Remote Config*.

**Keuntungan:**
- **Pemeliharaan Tanpa Sentuh:** Anda dapat mengubah interval pengiriman, parameter kalibrasi sensor Modbus, atau alamat server/broker MQTT dari mana saja di seluruh dunia langsung melalui antarmuka *Web Dashboard* Cloud Molinar. Perubahan ini dikirim melalui "pesan ghaib" MQTT dan akan langsung diaplikasikan oleh ESP32 tanpa perlu *restart* fisik.

## 4. Portal Web Mandiri (*Captive Portal / Local Web Server*)
Ketika alat baru keluar dari pabrik atau berada di lokasi yang belum ada internetnya sama sekali, alat ini secara otomatis akan memancarkan sinyal Wi-Fi-nya sendiri (berperan sebagai *Access Point* atau Router).

**Keuntungan:**
- **Kemudahan Instalasi (Plug & Play):** Teknisi di lapangan cukup menghubungkan HP/Laptop mereka ke sinyal Wi-Fi milik Molinar (tanpa perlu aplikasi khusus), lalu membuka *browser* untuk melakukan pengaturan awal (memasukkan *password* Wi-Fi gedung, kalibrasi awal, dsb) secara mudah melalui halaman *web* lokal yang cantik dan interaktif.

---

> **Kesimpulan:** 
> Perpaduan antara **Store & Forward**, **SD Card Backup**, **Remote Config**, dan **Portal Web Mandiri** menjadikan Molinar Logger sebagai *hardware* yang tahan banting di segala kondisi cuaca jaringan, memastikan **tidak ada satu pun data sensor yang hilang**, dan sangat ramah untuk dikelola oleh teknisi secara massal (*Fleet Management*).
