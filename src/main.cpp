/*
 * ============================================================
 *  LOGGER MOLINAR — ESP32-S3 Firmware (Single File)
 *  MCU      : ESP32-S3 N16R8
 *  Storage  : LittleFS (web + config) + MicroSD
 *  Modules  : SIM7600CE (4G LTE), RS485 Modbus, RTC DS3231SN
 *  Server   : ESPAsyncWebServer + AsyncTCP
 *  JSON     : ArduinoJson v7
 *  Version  : 1.0.0
 * ============================================================
 *
 * LIBRARY DEPENDENCIES (install via Arduino Library Manager):
 *   - ESPAsyncWebServer  by me-no-dev
 *   - AsyncTCP           by me-no-dev
 *   - ArduinoJson        by Benoit Blanchon  (v7.x)
 *   - RTClib             by Adafruit
 *   - SD                 (built-in Arduino/ESP32 core)
 *
 * BOARD SETTINGS (Arduino IDE):
 *   Board   : ESP32S3 Dev Module
 *   Flash   : 16MB
 *   PSRAM   : OPI PSRAM
 *   Partition: Huge APP (3MB No OTA / 1MB SPIFFS)
 *              → Anda perlu custom partition untuk LittleFS 4MB+
 *              → Lihat: tools/partitions/custom_molinar.csv
 *
 * UPLOAD WEB FILES:
 *   1. Install plugin "arduino-littlefs-upload" untuk Arduino IDE 2.x
 *      atau "ESP32 LittleFS Data Upload" untuk Arduino IDE 1.x
 *   2. Buat folder  molinar_firmware/data/
 *   3. Copy  index.html, style.css, app.js  ke dalam folder data/
 *   4. Tools → ESP32 LittleFS Data Upload  (upload web files)
 *   5. Upload sketch .ino seperti biasa
 * ============================================================
 */

// ── Library Includes ──────────────────────────────────────────
#include <Adafruit_ADS1X15.h>
#include <Adafruit_NeoPixel.h>
#include <Arduino.h>
#include <ArduinoJson.h>
#include <AsyncTCP.h>
#include <ESP32Ping.h>
#include <ESPAsyncWebServer.h>
#include <LittleFS.h>
#include <ModbusMaster.h>
#include <RTClib.h>
#include <SD.h>
#include <SPI.h>
#include <Update.h>
#include <WiFi.h>
#include <map>

#include <Ethernet.h>
#define TINY_GSM_MODEM_SIM7600
#include <PubSubClient.h>
#include <TinyGsmClient.h>

#include <esp_wifi.h> // Untuk konfigurasi WPA2 eksplisit
#include <time.h>
#include <vector>

// ============================================================
//  PIN DEFINITIONS — ESP32-S3 N16R8
// ============================================================
// UART1 (Eksternal / General)
#define PIN_UART1_TX 17
#define PIN_UART1_RX 18

// RS485 Modbus (UART2)
#define PIN_RS485_TX 15
#define PIN_RS485_RX 16

// SIM7600CE (Mapped ke Serial1 secara internal karena S3 hanya punya 3 hardware
// UART)
#define PIN_SIM_TX 6
#define PIN_SIM_RX 7
#define PIN_SIM_PWRKEY 21
#define PIN_SIM_RST 47

// RTC DS3231SN & ADS1115 (I2C Utama)
#define PIN_SDA 8
#define PIN_SCL 9

// MicroSD Card (SPI)
#define PIN_SD_CS 10
#define PIN_SD_MOSI 11
#define PIN_SD_MISO 13
#define PIN_SD_SCK 12

// Ethernet W5500 (SPI Shared)
#define PIN_ETH_CS 5
// PIN_ETH_RST = 21 (Shared with PIN_SIM_PWRKEY)
// PIN_ETH_INT = 47 (Shared with PIN_SIM_RST)

// Lampu RGB
#define PIN_RGB 48

// IO Tambahan (Analog & Digital)
#define PIN_ANA1 1
#define PIN_ANA2 2
#define PIN_DIG1 14
#define PIN_DIG2 38
#define PIN_BOOT_BUTTON 0

// Inisialisasi ADS1115 (Address Default 0x48)
Adafruit_ADS1115 ads;

// ============================================================
//  WiFi Access Point — Default (sebelum ada config)
// ============================================================
#define DEFAULT_AP_SSID "Molinar_AP_01"
#define DEFAULT_AP_PASS "molinar2024"
#define DEFAULT_AP_IP "192.168.4.1"

// ============================================================
//  CONFIG FILE PATH
// ============================================================
#define CONFIG_PATH "/config.json"
#define LOG_PATH_PREFIX "/logs/" // MicroSD log directory

// ============================================================
//  GLOBAL OBJECTS
// ============================================================
AsyncWebServer server(80); // Web Server di port 80
RTC_DS3231 rtc;

TinyGsm modem(Serial1);
TinyGsmClient gsmClient(modem);
EthernetClient ethClient;
WiFiClient wifiClient;
Client *netClient = &wifiClient; // Default ke WiFi

PubSubClient mqttClient;
unsigned long lastMqttReconnectAttempt = 0;

// ── Runtime state ────────────────────────────────────────────
bool sdMounted = false;
ModbusMaster node;
std::map<String, String> modbusLiveCache;
std::map<String, String> kf350LiveCache; // Cache KF350 untuk Local Automation Engine
std::map<String, unsigned long> ruleLastFired; // RAM cache untuk cooldown otomasi

// Queue untuk instruksi write Modbus
struct ModbusWriteCmd {
  uint8_t slaveId;
  uint8_t fc;
  uint16_t reg;
  uint16_t value;
};
std::vector<ModbusWriteCmd> modbusWriteQueue;
SemaphoreHandle_t modbusQueueMutex = NULL;

// Flags and variables
bool shouldUpdateNetwork = false;
bool shouldRestart = false;
unsigned long restartTime = 0;
bool forceMqttSend = false;
bool forceMqttRead = false;

// Status Global Jaringan
bool lteConnected = false;
String cachedLteOperator = "-";
String cachedLteIp = "-";
int cachedLteSignal = 0;
unsigned long lastLteCheck = 0;

String activeNetworkMode = ""; // "lte", "eth", "wifi", atau "wifi-backup"

bool rtcOk = false;

// Status Ping Async
bool pingRequested = false;
String pingHost = "";
bool pingDone = false;
bool pingSuccess = false;
unsigned long pingTime = 0;
// ── Session tokens (simple in-memory) ────────────────────────
struct Session {
  String token;
  String username;
  String role;
  unsigned long expiresAt; // millis()
};
#define MAX_SESSIONS 4
Session sessions[MAX_SESSIONS];

// ── System log ring buffer ───────────────────────────────────
#define LOG_BUFFER_SIZE 64
struct LogEntry {
  String timestamp;
  String level; // "ok" | "info" | "warn" | "error"
  String message;
};
LogEntry logBuffer[LOG_BUFFER_SIZE];
int logHead = 0;
int logCount = 0;

// ── Store & Forward state ────────────────────────────────────
size_t sfReadOffset = 0;
size_t sfBufferCount = 0; // Bytes remaining in queue
const char *SF_QUEUE_FILE = "/sf_queue.txt";
const char *SF_OFFSET_FILE = "/sf_offset.txt";

// ── Status Global & LED ────────────────────────────────────
Adafruit_NeoPixel strip(1, PIN_RGB, NEO_GRB + NEO_KHZ800);
bool isMqttConnected = false;
bool ledEnabled = true;
bool cloudEnabled = true;

// ============================================================
//  FORWARD DECLARATIONS
// ============================================================
void loadAndApplyConfig();
void saveConfig(JsonDocument &doc);
bool loadConfig(JsonDocument &doc);
void deepMergeJson(JsonObject dest, JsonObjectConst src);
void handleSetupAP();
Session *findSession(const String &token);
void cleanExpiredSessions();
void addLog(const String &level, const String &msg);
String getTimestamp();
void initRTC();
void initSD();
void initSD();
void setupWiFiAP(const String &ssid, const String &pass);
void setupWiFiSTA(const String &ssid, const String &pass, const String &ip);
void setupWiFiMode(JsonDocument &cfg);
void setupNetworkMode(JsonDocument &cfg);
String buildWifiScanJSON();
void setupAPIRoutes();
String buildStatusJSON();
String buildLogsJSON();
String buildSensorDataJSON();
void handleCORS(AsyncWebServerRequest *req);

// ============================================================
//  SYSTEM LOG HELPER
// ============================================================
void addLog(const String &level, const String &msg) {
  LogEntry &e = logBuffer[logHead % LOG_BUFFER_SIZE];
  e.timestamp = getTimestamp();
  e.level = level;
  e.message = msg;
  logHead++;
  if (logCount < LOG_BUFFER_SIZE)
    logCount++;

  // Print ke Serial
  Serial.printf("[%s] [%s] %s\n", e.timestamp.c_str(), level.c_str(),
                msg.c_str());
}

int systemTimezone = 7;

// ============================================================
//  TIMESTAMP HELPER
// ============================================================
String getTimestamp() {
  if (rtcOk) {
    DateTime now = DateTime(rtc.now().unixtime() + systemTimezone * 3600);
    char buf[24];
    snprintf(buf, sizeof(buf), "%04d-%02d-%02d %02d:%02d:%02d", now.year(),
             now.month(), now.day(), now.hour(), now.minute(), now.second());
    return String(buf);
  }
  // fallback: millis sejak boot
  unsigned long ms = millis();
  char buf[16];
  snprintf(buf, sizeof(buf), "+%lums", ms);
  return String(buf);
}

// ============================================================
//  TOKEN / SESSION MANAGEMENT
// ============================================================
String generateToken() {
  String t = "";
  for (int i = 0; i < 32; i++) {
    t += String((char)random(65, 91)); // A-Z random
  }
  return t;
}

Session *findSession(const String &token) {
  if (token.isEmpty())
    return nullptr;
  for (int i = 0; i < MAX_SESSIONS; i++) {
    if (sessions[i].token == token && millis() < sessions[i].expiresAt) {
      return &sessions[i];
    }
  }
  return nullptr;
}

// Session millis-safe overflow check
void cleanExpiredSessions() {
  for (int i = 0; i < MAX_SESSIONS; i++) {
    if (!sessions[i].token.isEmpty() &&
        (long)(millis() - sessions[i].expiresAt) >= 0) {
      sessions[i].token = "";
    }
  }
}

Session *createSession(const String &username, const String &role) {
  // Cari slot kosong
  for (int i = 0; i < MAX_SESSIONS; i++) {
    if (sessions[i].token.isEmpty() || millis() >= sessions[i].expiresAt) {
      sessions[i].token = generateToken();
      sessions[i].username = username;
      sessions[i].role = role;
      sessions[i].expiresAt = millis() + (8UL * 3600UL * 1000UL); // 8 jam
      return &sessions[i];
    }
  }
  return nullptr;
}

// Middleware helper — return true jika request punya token valid
bool isAuthenticated(AsyncWebServerRequest *req, bool requireAdmin = false) {
  String token = "";
  if (req->hasHeader("X-Auth-Token")) {
    token = req->header("X-Auth-Token");
  } else if (req->hasParam("token")) {
    token = req->getParam("token")->value();
  }
  Session *s = findSession(token);
  if (!s)
    return false;
  if (requireAdmin && s->role != "admin")
    return false;
  return true;
}

// ============================================================
//  CONFIG: LOAD / SAVE  (LittleFS)
// ============================================================

// Default config structure
const char DEFAULT_CONFIG[] = R"({
  "system": {
    "name": ""
  },
  "users": [
    {"username":"admin","password":"admin123","role":"admin"},
    {"username":"viewer","password":"viewer123","role":"viewer"}
  ],
  "network": {
    "wifi_ssid": "Molinar_AP_01",
    "wifi_password": "molinar2024",
    "wifi_mode": "ap",
    "lte_apn": "internet",
    "lte_user": "",
    "lte_pass": ""
  },
  "timing": {
    "read_interval": 2000,
    "send_interval": 10000
  },
  "cloud": {
    "enabled": true,
    "server": "mqtt.maudynetwork.id",
    "device_id": "083AF21A2B3C"
  },
  "mqtt": {
    "enabled": true,
    "broker": "mqtt.molinar.io",
    "port": 1883,
    "client_id": "molinar_esp32_01",
    "username": "",
    "password": "",
    "topic": "molinar/sensor/data"
  },
  "webhook": {
    "enabled": false,
    "url": "",
    "method": "POST",
    "headers": "",
    "interval": 60
  },
  "restapi": {
    "enabled": false,
    "endpoint": "",
    "api_key": "",
    "method": "POST",
    "timeout": 5000
  },
  "opcua": {
    "enabled": false,
    "endpoint": "",
    "port": 4840,
    "node_id": "",
    "username": "",
    "password": ""
  },
  "pins": {
    "kf301": {"uart": false, "rs485": false},
    "kf350": {"adc": false, "i2c": false, "current_420": false, "io": false}
  },
  "sensor": {
    "rs485": {"baud": 9600, "parity": "N", "stop_bits": 1, "slave_id": 1, "register": 100},
    "adc":   {"channel": 0, "min_val": 0, "max_val": 100, "unit": "C"},
    "current_420": {"min_ma": 4, "max_ma": 20, "min_val": 0, "max_val": 100, "unit": "bar"}
  }
})";
SemaphoreHandle_t configMutex = NULL;
String cachedConfigStr = "";

bool loadConfig(JsonDocument &doc) {
  // Gunakan cache di RAM agar tidak membebani LittleFS di Async Task (Mencegah
  // WDT Crash)
  String localCache = "";
  if (configMutex)
    xSemaphoreTake(configMutex, portMAX_DELAY);
  localCache = cachedConfigStr;
  if (configMutex)
    xSemaphoreGive(configMutex);

  if (localCache.length() > 0) {
    DeserializationError err = deserializeJson(doc, localCache);
    if (err) {
      addLog("error", String("JSON RAM parse error: ") + err.c_str());
      return false;
    }
    return true;
  }

  if (!LittleFS.exists(CONFIG_PATH)) {
    addLog("warn",
           "config.json tidak ada, menggunakan default dan membuat file baru.");
    DeserializationError err = deserializeJson(doc, DEFAULT_CONFIG);
    if (err == DeserializationError::Ok) {
      saveConfig(doc);
    }
    return (err == DeserializationError::Ok);
  }

  File f = LittleFS.open(CONFIG_PATH, "r");
  if (!f) {
    addLog("error", "Gagal membuka config.json untuk baca.");
    return false;
  }
  String tmpStr = f.readString();
  f.close();

  if (configMutex)
    xSemaphoreTake(configMutex, portMAX_DELAY);
  cachedConfigStr = tmpStr;
  if (configMutex)
    xSemaphoreGive(configMutex);

  DeserializationError err = deserializeJson(doc, tmpStr);
  if (err) {
    addLog("error", String("JSON parse error: ") + err.c_str());
    return false;
  }
  return true;
}

bool pendingConfigSave = false;

void saveConfig(JsonDocument &doc) {
  // Simpan ke file temporary untuk mencegah korupsi jika WDT crash di tengah
  // penulisan
  File f = LittleFS.open("/config_tmp.json", "w");
  if (!f) {
    addLog("error", "Gagal membuka config_tmp.json untuk tulis.");
    return;
  }
  size_t written = serializeJson(doc, f);
  f.close();

  if (written > 0) {
    if (LittleFS.exists(CONFIG_PATH))
      LittleFS.remove(CONFIG_PATH);
    LittleFS.rename("/config_tmp.json", CONFIG_PATH);
    addLog("ok", "config.json berhasil disimpan dengan aman.");
  }

  // Update cache di RAM dengan aman (hindari String overwrite reference)
  String newCache;
  serializeJson(doc, newCache);
  cachedConfigStr = newCache;
}

// Helper: load config, apply patch, save to RAM cache, and schedule flash save
void patchAndSave(std::function<void(JsonDocument &)> patchFn) {
  JsonDocument doc;
  loadConfig(doc);
  patchFn(doc);

  // Update cache RAM secara instan (aman di async thread)
  String tempStr;
  serializeJson(doc, tempStr);

  if (configMutex)
    xSemaphoreTake(configMutex, portMAX_DELAY);
  cachedConfigStr = tempStr;
  if (configMutex)
    xSemaphoreGive(configMutex);

  // Tandai agar disimpan ke Flash oleh main loop()
  pendingConfigSave = true;
}

// ============================================================
//  HARDWARE INIT
// ============================================================

void initRTC() {
  Wire.begin(PIN_SDA, PIN_SCL);
  if (!rtc.begin()) {
    addLog("error", "RTC DS3231SN tidak ditemukan!");
    rtcOk = false;
    return;
  }
  if (rtc.lostPower()) {
    addLog("warn", "RTC kehilangan daya, reset ke waktu compile.");
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  }
  rtcOk = true;
  addLog("ok", "RTC DS3231SN OK. Waktu: " + getTimestamp());
}

void initSD() {
  SPI.begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);
  if (!SD.begin(PIN_SD_CS)) {
    addLog("warn", "MicroSD tidak terpasang atau gagal mount.");
    sdMounted = false;
    return;
  }
  uint64_t freeBytes = ((uint64_t)SD.totalBytes() - SD.usedBytes());
  char buf[64];
  snprintf(buf, sizeof(buf), "MicroSD OK. Free: %.1f GB",
           (float)freeBytes / (1024.0f * 1024.0f * 1024.0f));
  addLog("ok", String(buf));
  sdMounted = true;

  // Buat folder log jika belum ada
  if (!SD.exists(LOG_PATH_PREFIX)) {
    SD.mkdir(LOG_PATH_PREFIX);
  }
}

// ============================================================
//  WIFI — MULTI MODE SETUP
// ============================================================
void setupWiFiAP(const String &ssid, const String &pass) {
  WiFi.disconnect(true);
  delay(100);
  WiFi.mode(WIFI_AP);

  // IP AP Default
  IPAddress apIP(192, 168, 4, 1);
  WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));

  bool ok = false;
  if (pass.length() > 0) {
    ok = WiFi.softAP(ssid.c_str(), pass.c_str(), 6);
  } else {
    ok = WiFi.softAP(ssid.c_str(), NULL, 6);
  }

  addLog(ok ? "ok" : "error", "WiFi AP " + String(ok ? "aktif" : "GAGAL") +
                                  " ch6. SSID: " + ssid +
                                  " | IP: " + WiFi.softAPIP().toString());
}

void setupWiFiSTA(const String &ssid, const String &pass,
                  const String &staticIp, const String &dnsStr) {
  WiFi.disconnect(true);
  delay(100);
  WiFi.mode(WIFI_STA);

  // Konfigurasi IP Statis jika diatur
  if (staticIp.length() > 0) {
    IPAddress ip;
    if (ip.fromString(staticIp)) {
      IPAddress gw(192, 168, 1, 1);
      IPAddress sn(255, 255, 255, 0);
      IPAddress dns(8, 8, 8, 8);
      if (dnsStr.length() > 0)
        dns.fromString(dnsStr);
      WiFi.config(ip, gw, sn, dns);
      addLog("info", "WiFi STA IP statis: " + staticIp);
    }
  }

  addLog("info", "WiFi STA mencoba konek ke: " + ssid);
  if (pass.length() > 0) {
    WiFi.begin(ssid.c_str(), pass.c_str());
  } else {
    WiFi.begin(ssid.c_str());
  }

  // Tunggu koneksi maksimal 15 detik
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < 15000) {
    delay(300);
  }

  if (WiFi.status() == WL_CONNECTED) {
    addLog("ok", "WiFi STA terhubung. IP: " + WiFi.localIP().toString());
  } else {
    addLog("warn", "WiFi STA gagal konek. Fallback ke AP mode.");
    JsonDocument fallCfg;
    loadConfig(fallCfg);
    String apSsid = fallCfg["network"]["wifi_ssid"] | DEFAULT_AP_SSID;
    String apPass = fallCfg["network"]["wifi_password"] | DEFAULT_AP_PASS;
    setupWiFiAP(apSsid, apPass);
  }
}

void setupWiFiAPSTA(const String &apSsid, const String &apPass,
                    const String &staSsid, const String &staPass,
                    const String &staticIp, const String &dnsStr) {
  WiFi.disconnect(true);
  delay(100);
  WiFi.mode(WIFI_AP_STA);

  // Konfigurasi AP
  IPAddress apIP(192, 168, 4, 1);
  WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));

  if (apPass.length() > 0) {
    WiFi.softAP(apSsid.c_str(), apPass.c_str(), 6);
  } else {
    WiFi.softAP(apSsid.c_str(), NULL, 6);
  }

  // Konfigurasi IP Statis jika diatur
  if (staticIp.length() > 0) {
    IPAddress ip;
    if (ip.fromString(staticIp)) {
      IPAddress gw(192, 168, 1, 1);
      IPAddress sn(255, 255, 255, 0);
      IPAddress dns(8, 8, 8, 8);
      if (dnsStr.length() > 0)
        dns.fromString(dnsStr);
      WiFi.config(ip, gw, sn, dns);
    }
  }

  if (staPass.length() > 0) {
    WiFi.begin(staSsid.c_str(), staPass.c_str());
  } else {
    WiFi.begin(staSsid.c_str());
  }
  addLog("ok", "WiFi APSTA aktif. AP: " + apSsid + " | STA: " + staSsid);
}

void setupWiFiMode(JsonDocument &cfg) {
  String mode = cfg["network"]["wifi_mode"] | "ap";
  String ssid = cfg["network"]["wifi_ssid"] | DEFAULT_AP_SSID;
  String pass = cfg["network"]["wifi_password"] | DEFAULT_AP_PASS;
  String ip = cfg["network"]["wifi_ip"] | "";
  String dnsStr = cfg["network"]["wifi_dns"] | "";

  if (mode == "sta") {
    setupWiFiSTA(ssid, pass, ip, dnsStr);
  } else if (mode == "apsta") {
    // APSTA: gunakan ssid/pass yang sama untuk AP; STA connect ke ssid_sta
    String staSsid = cfg["network"]["wifi_sta_ssid"] | ssid;
    String staPass = cfg["network"]["wifi_sta_password"] | pass;
    setupWiFiAPSTA(ssid, pass, staSsid, staPass, ip, dnsStr);
  } else {
    // Default: AP mode
    setupWiFiAP(ssid, pass);
  }
}

// ============================================================
//  TCP PROXY ETHERNET TO WIFI (Untuk Web Server)
// ============================================================
class MyEthernetServer : public EthernetServer {
public:
  MyEthernetServer(uint16_t port) : EthernetServer(port) {}
  void begin(uint16_t port = 0) override { EthernetServer::begin(); }
};

MyEthernetServer proxyServer(80);
#define MAX_PROXY_CLIENTS 8
EthernetClient proxyEthClients[MAX_PROXY_CLIENTS];
WiFiClient proxyLocalClients[MAX_PROXY_CLIENTS];
uint32_t proxyLastActive[MAX_PROXY_CLIENTS];

void ethernetProxyTask(void *pvParameters) {
  for (;;) {
    if (activeNetworkMode != "eth") {
      vTaskDelay(1000 / portTICK_PERIOD_MS);
      continue;
    }

    EthernetClient newClient = proxyServer.available();
    if (newClient) {
      bool accepted = false;
      for (int i = 0; i < MAX_PROXY_CLIENTS; i++) {
        if (!proxyEthClients[i]) {
          proxyEthClients[i] = newClient;
          proxyLocalClients[i].connect(IPAddress(127, 0, 0, 1), 80);
          proxyLastActive[i] = millis();
          accepted = true;
          break;
        }
      }
      if (!accepted) {
        newClient.stop();
      }
    }

    bool activity = false;
    for (int i = 0; i < MAX_PROXY_CLIENTS; i++) {
      if (!proxyEthClients[i] || !proxyLocalClients[i])
        continue;

      int ethAvail = proxyEthClients[i].available();
      if (ethAvail > 0) {
        uint8_t buf[1024];
        int toRead = min(ethAvail, 1024);
        int len = proxyEthClients[i].read(buf, toRead);
        if (len > 0) {
          int written = 0;
          while (written < len && proxyLocalClients[i].connected()) {
            int w = proxyLocalClients[i].write(buf + written, len - written);
            if (w > 0)
              written += w;
            else
              vTaskDelay(1 / portTICK_PERIOD_MS);
          }
          proxyLastActive[i] = millis();
          activity = true;
        }
      }

      int localAvail = proxyLocalClients[i].available();
      if (localAvail > 0) {
        int ethSpace = proxyEthClients[i].availableForWrite();
        if (ethSpace > 0) {
          uint8_t buf[1024];
          int toRead = min(localAvail, min(1024, ethSpace));
          int len = proxyLocalClients[i].read(buf, toRead);
          if (len > 0) {
            int written = 0;
            while (written < len && proxyEthClients[i].connected()) {
              int w = proxyEthClients[i].write(buf + written, len - written);
              if (w > 0)
                written += w;
              else
                vTaskDelay(1 / portTICK_PERIOD_MS);
            }
            proxyLastActive[i] = millis();
            activity = true;
          }
        }
      }

      if (!proxyLocalClients[i].connected() &&
          proxyLocalClients[i].available() == 0) {
        proxyEthClients[i].flush();
        vTaskDelay(pdMS_TO_TICKS(50)); // Tunggu W5500 selesai transmit
        proxyEthClients[i].stop();
        proxyLocalClients[i].stop();
        continue;
      }

      if (!proxyEthClients[i].connected() &&
          proxyEthClients[i].available() == 0) {
        proxyLocalClients[i].flush();
        proxyLocalClients[i].stop();
        proxyEthClients[i].stop();
        continue;
      }

      if (millis() - proxyLastActive[i] > 30000) {
        proxyEthClients[i].stop();
        proxyLocalClients[i].stop();
      }
    }

    if (activity) {
      vTaskDelay(2 / portTICK_PERIOD_MS);
    } else {
      vTaskDelay(20 / portTICK_PERIOD_MS);
    }
  }
}

// ============================================================
// ============================================================
//  NETWORK MODE INITIALIZATION (Ethernet / LTE / WiFi)
// ============================================================
void setupNetworkMode(JsonDocument &cfg) {
  String mode = cfg["network"]["main_mode"] | "lte";

  if (mode == "eth") {
    addLog("info", "Inisialisasi Ethernet W5500...");
    // Reset W5500 (Asumsi Pin 21 terhubung ke RST W5500)
    pinMode(21, OUTPUT);
    digitalWrite(21, LOW);
    delay(50);
    digitalWrite(21, HIGH);
    delay(200);

    Ethernet.init(PIN_ETH_CS);

    // Gunakan MAC bawaan ESP32 (dikustomisasi sedikit agar unik untuk Ethernet)
    uint8_t mac[6];
    WiFi.macAddress(mac);
    mac[5] ^= 0x01; // Balikkan bit LSB agar beda dari WiFi STA

    String ethMode = cfg["network"]["eth_ip_mode"] | "dhcp";

    if (ethMode == "static") {
      IPAddress ip, gw, sn;
      ip.fromString(cfg["network"]["eth_ip"].as<String>());
      gw.fromString(cfg["network"]["eth_gateway"].as<String>());
      sn.fromString(cfg["network"]["eth_subnet"].as<String>());
      IPAddress dns1(8, 8, 8, 8);
      if (!cfg["network"]["eth_dns"].isNull() &&
          !cfg["network"]["eth_dns"].as<String>().isEmpty()) {
        dns1.fromString(cfg["network"]["eth_dns"].as<String>());
      }
      Ethernet.begin(mac, ip, dns1, gw, sn);
      addLog("ok",
             "Ethernet Static siap. IP: " + Ethernet.localIP().toString());
    } else {
      addLog("info", "Meminta IP dari DHCP Server...");
      // Timeout 15 detik, response timeout 4 detik
      if (Ethernet.begin(mac, 15000, 4000) == 0) {
        if (Ethernet.hardwareStatus() == EthernetNoHardware) {
          addLog("error", "W5500 tidak terdeteksi pada SPI (Cek Pin/Kabel)!");
        } else if (Ethernet.linkStatus() == LinkOFF) {
          addLog("error", "Kabel LAN Ethernet tidak terhubung!");
        } else {
          addLog("error", "Gagal mendapatkan IP dari DHCP Server!");
        }
      } else {
        addLog("ok",
               "Ethernet DHCP berhasil. IP: " + Ethernet.localIP().toString());
      }
    }
    proxyServer.begin();
    netClient = &ethClient;
    activeNetworkMode = "eth";
  } else if (mode == "lte") {
    addLog("info", "Inisialisasi Modem LTE SIM7600...");
    Serial1.begin(115200, SERIAL_8N1, PIN_SIM_RX, PIN_SIM_TX);

    // Coba deteksi apakah modem sudah menyala
    bool isResponding = false;
    for (int i = 0; i < 3; i++) {
      if (modem.testAT(1000)) {
        isResponding = true;
        break;
      }
    }

    if (!isResponding) {
      addLog("info", "Modem offline. Memulai Power-On Sequence...");
      // Power On Sequence SIM7600 (Pin 21)
      pinMode(21, OUTPUT);
      digitalWrite(21, HIGH);
      delay(500);
      digitalWrite(21, LOW);
      delay(2000);
      digitalWrite(21, HIGH);
      delay(3000); // Wait for modem to boot
    }

    if (!modem.init()) {
      addLog("error", "Modem LTE SIM7600 tidak merespon!");
    } else {
      addLog("info", "Menunggu jaringan seluler...");
      if (!modem.waitForNetwork(60000)) {
        addLog("error", "Gagal mendapatkan jaringan seluler LTE.");
      } else {
        String apn = cfg["network"]["lte_apn"] | "internet";
        String user = cfg["network"]["lte_user"] | "";
        String pass = cfg["network"]["lte_pass"] | "";
        addLog("info", "Menyambungkan ke GPRS (" + apn + ")...");
        if (!modem.gprsConnect(apn.c_str(), user.c_str(), pass.c_str())) {
          addLog("error", "Gagal menyambung GPRS (LTE).");
        } else {
          lteConnected = true;
          cachedLteOperator = modem.getOperator();
          cachedLteIp = modem.localIP().toString();
          int csq = modem.getSignalQuality();
          cachedLteSignal = (csq == 99 || csq == 0) ? 0 : -113 + (csq * 2);
          addLog("ok", "LTE Terhubung. IP: " + cachedLteIp);
        }
      }
    }
    netClient = &gsmClient;
    activeNetworkMode = "lte";
  } else {
    // Mode WiFi (Client)
    netClient = &wifiClient;
    activeNetworkMode = "wifi";
    addLog("info", "Mode Utama Jaringan: WiFi");
  }

  // Tetap setel mode WiFi (AP / STA) untuk keperluan Dashboard Web Config lokal
  setupWiFiMode(cfg);
}

// ============================================================
//  WIFI SCAN — return JSON array of networks
// ============================================================
String buildWifiScanJSON() {
  addLog("info", "WiFi Scan dimulai...");
  // Scan non-async (blocking, tapi hanya saat user request)
  int n = WiFi.scanNetworks();
  JsonDocument doc;
  JsonArray arr = doc["networks"].to<JsonArray>();
  if (n <= 0) {
    doc["count"] = 0;
    addLog("warn", "Tidak ditemukan jaringan WiFi.");
  } else {
    doc["count"] = n;
    for (int i = 0; i < n; i++) {
      JsonObject net = arr.add<JsonObject>();
      net["ssid"] = WiFi.SSID(i);
      net["rssi"] = WiFi.RSSI(i);
      net["enc"] =
          (WiFi.encryptionType(i) == WIFI_AUTH_OPEN) ? "open" : "secured";
      net["channel"] = WiFi.channel(i);
    }
    addLog("ok", "WiFi Scan selesai. Ditemukan " + String(n) + " jaringan.");
  }
  WiFi.scanDelete();
  String out;
  serializeJson(doc, out);
  return out;
}

// ============================================================
//  STATUS JSON BUILDER
// ============================================================
//  UPDATE RGB LED
// ============================================================
void updateLED() {
  if (!ledEnabled) {
    strip.setPixelColor(0, strip.Color(0, 0, 0)); // Mati
  } else {
    bool isInternetOnline = false;

    if (activeNetworkMode == "lte") {
      isInternetOnline = lteConnected;
    } else if (activeNetworkMode == "eth") {
      isInternetOnline = (Ethernet.linkStatus() == LinkON &&
                          Ethernet.localIP() != IPAddress(0, 0, 0, 0));
    } else if (activeNetworkMode == "wifi" ||
               activeNetworkMode == "wifi-backup") {
      isInternetOnline = (WiFi.status() == WL_CONNECTED);
    }

    if (isInternetOnline) {
      // Hijau = Internet Aktif (Koneksi utama/backup tersambung)
      strip.setPixelColor(0, strip.Color(0, 128, 0));
    } else {
      // Kuning = Internet Terputus
      strip.setPixelColor(0, strip.Color(128, 128, 0));
    }
  }
  strip.show();
}

// ============================================================
String buildStatusJSON() {
  JsonDocument doc;

  // Load config only ONCE to prevent Task Watchdog Timeout from slow LittleFS
  JsonDocument cfg;
  loadConfig(cfg);

  String mainMode = cfg["network"]["main_mode"] | "lte";
  doc["main_mode"] = mainMode;
  doc["active_mode"] = activeNetworkMode;
  doc["system_name"] = cfg["system"]["name"] | "";

  String mac = WiFi.macAddress();
  mac.replace(":", "");
  doc["mac"] = mac;

  // LTE
  if (mainMode == "lte") {
    doc["lte"]["connected"] = lteConnected;
    doc["lte"]["operator"] =
        lteConnected ? cachedLteOperator : "Tidak Terhubung";
    doc["lte"]["signal"] = lteConnected ? cachedLteSignal : 0;
    doc["lte"]["ip"] = lteConnected ? cachedLteIp : "";
  } else {
    doc["lte"]["connected"] = false;
    doc["lte"]["operator"] = "Dinonaktifkan";
    doc["lte"]["signal"] = 0;
    doc["lte"]["ip"] = "";
  }

  // Ethernet
  if (mainMode == "eth") {
    bool ethUp = (Ethernet.linkStatus() == LinkON);
    doc["eth"]["connected"] = ethUp;
    doc["eth"]["ip"] = ethUp ? Ethernet.localIP().toString() : "";
  } else {
    doc["eth"]["connected"] = false;
    doc["eth"]["ip"] = "";
  }

  // WiFi — baca berdasarkan mode aktif
  {
    String wifiMode = cfg["network"]["wifi_mode"] | "ap";
    bool isSTA = (wifiMode == "sta" || wifiMode == "apsta");
    bool wifiConnected = isSTA ? (WiFi.status() == WL_CONNECTED) : true;

    doc["wifi"]["connected"] = wifiConnected;
    doc["wifi"]["mode"] = wifiMode;
    if (isSTA && WiFi.status() == WL_CONNECTED) {
      doc["wifi"]["ssid"] = WiFi.SSID();
      doc["wifi"]["rssi"] = WiFi.RSSI();
      doc["wifi"]["ip"] = WiFi.localIP().toString();
    } else {
      // AP mode: baca softAP info
      doc["wifi"]["ssid"] = WiFi.softAPSSID();
      doc["wifi"]["rssi"] = -55; // AP tidak punya RSSI
      doc["wifi"]["ip"] = WiFi.softAPIP().toString();
    }
  }

  // RTC
  if (rtcOk) {
    DateTime now = rtc.now();
    char buf[25];
    snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02d", now.year(),
             now.month(), now.day(), now.hour(), now.minute(), now.second());
    doc["rtc"]["datetime"] = buf;
    doc["rtc"]["synced"] = true;
  } else {
    doc["rtc"]["datetime"] = "";
    doc["rtc"]["synced"] = false;
  }

  // RAM
  doc["ram"]["total"] = (int)(esp_get_minimum_free_heap_size() / 1024 +
                              heap_caps_get_free_size(MALLOC_CAP_8BIT) / 1024);
  doc["ram"]["used"] = (int)((ESP.getHeapSize() - ESP.getFreeHeap()) / 1024);

  // Flash (LittleFS)
  doc["flash"]["total"] = (int)(LittleFS.totalBytes() / 1024);
  doc["flash"]["used"] = (int)(LittleFS.usedBytes() / 1024);

  // MicroSD
  doc["sd"]["mounted"] = sdMounted;
  if (sdMounted) {
    doc["sd"]["total_gb"] =
        (float)SD.totalBytes() / (1024.0f * 1024.0f * 1024.0f);
    doc["sd"]["free_gb"] = (float)(SD.totalBytes() - SD.usedBytes()) /
                           (1024.0f * 1024.0f * 1024.0f);
  }

  // Store & Forward Buffer
  doc["sf_buffer"]["used"] = sfBufferCount;
  doc["sf_buffer"]["total"] = -1;

  // Cloud Sync Status
  doc["cloud_connected"] = cloudEnabled && isMqttConnected;

  // Internal CPU Temperature
  doc["cpu_temp"] = temperatureRead();

  // Uptime (seconds)
  doc["uptime"] = (unsigned long)(millis() / 1000);

  String out;
  serializeJson(doc, out);
  return out;
}

// ============================================================
//  LOGS JSON BUILDER
// ============================================================
String buildLogsJSON() {
  JsonDocument doc;
  JsonArray arr = doc["logs"].to<JsonArray>();
  // Return dari yang terbaru
  int start = (logCount < LOG_BUFFER_SIZE) ? 0 : logHead;
  for (int i = 0; i < logCount; i++) {
    LogEntry &e = logBuffer[(start + i) % LOG_BUFFER_SIZE];
    String level = e.level;
    level.toUpperCase();
    String line = e.timestamp;
    line += " [";
    line += level;
    line += "] ";
    line += e.message;
    arr.add(line);
  }
  String out;
  serializeJson(doc, out);
  return out;
}

// ============================================================
//  MATH EVALUATOR FOR CALIBRATION
// ============================================================
class MathEvaluator {
  const char *p;
  float number() {
    int sign = 1;
    while (*p == '-' || *p == '+') {
      if (*p == '-')
        sign = -sign;
      p++;
    }
    if (*p == '(') {
      p++;
      float val = expression();
      if (*p == ')')
        p++;
      return sign * val;
    }
    char *next;
    float val = strtof(p, &next);
    p = next;
    return sign * val;
  }
  float factor() {
    float val = number();
    while (*p == '*' || *p == '/') {
      if (*p == '*') {
        p++;
        val *= number();
      } else if (*p == '/') {
        p++;
        val /= number();
      }
    }
    return val;
  }
  float expression() {
    float val = factor();
    while (*p == '+' || *p == '-') {
      if (*p == '+') {
        p++;
        val += factor();
      } else if (*p == '-') {
        p++;
        val -= factor();
      }
    }
    return val;
  }

public:
  float evaluate(String expr, float x_val) {
    if (expr.length() == 0)
      return x_val;
    String s = expr;
    s.replace(" ", "");
    s.replace("x", String(x_val, 6));
    s.replace("X", String(x_val, 6));
    p = s.c_str();
    return expression();
  }
};
MathEvaluator calibEval;

// ============================================================
//  COLLECT CURRENT SENSOR DATA (Helper for Live Data & Datalogger)
// ============================================================
void collectCurrentSensorData(JsonDocument &doc) {
  JsonDocument cfg;
  loadConfig(cfg);
  JsonObject unitsData = doc["units"].to<JsonObject>();

  if (!cfg["sensor"]["modbus"]["params"].isNull()) {
    JsonArray params = cfg["sensor"]["modbus"]["params"].as<JsonArray>();
    JsonObject modbusData = doc["modbus"].to<JsonObject>();
    for (JsonObject p : params) {
      String id = p["id"].as<String>();
      String keyStr = p["name"] | id;

      if (!p["unit"].isNull() && p["unit"].as<String>().length() > 0) {
        unitsData[keyStr] = p["unit"].as<String>();
      }

      // Mengambil dari cache hasil polling real Modbus
      if (modbusLiveCache.count(id)) {
        String rawStr = modbusLiveCache[id];
        if (!rawStr.startsWith("Err") && rawStr != "Disabled" &&
            rawStr != "-") {
          float rawVal = rawStr.toFloat();
          if (!p["calib"].isNull()) {
            String method = p["calib"]["method"] | "linear";
            if (method == "linear") {
              float m = 1.0;
              if (!p["calib"]["m"].isNull()) {
                m = p["calib"]["m"].is<const char *>()
                        ? p["calib"]["m"].as<String>().toFloat()
                        : p["calib"]["m"].as<float>();
              }
              float c = 0.0;
              if (!p["calib"]["c"].isNull()) {
                c = p["calib"]["c"].is<const char *>()
                        ? p["calib"]["c"].as<String>().toFloat()
                        : p["calib"]["c"].as<float>();
              }
              rawVal = (rawVal * m) + c;
            } else if (method == "custom" || method == "formula") {
              String calibStr = p["calib"]["formula"].as<String>();
              if (calibStr.length() > 0) {
                rawVal = calibEval.evaluate(calibStr, rawVal);
              }
            }
          }
          modbusData[keyStr] = rawVal;
        } else {
          modbusData[keyStr] = rawStr;
        }
      } else {
        modbusData[keyStr] = "-";
      }
    }
  }

  // Tambahkan juga data dari Telekontrol ke dalam respon JSON modbus
  if (!cfg["sensor"]["telekontrol"]["params"].isNull()) {
    JsonArray tkParams = cfg["sensor"]["telekontrol"]["params"].as<JsonArray>();
    for (JsonObject p : tkParams) {
      String id = p["id"].as<String>();
      String keyStr = p["name"] | id;

      if (modbusLiveCache.count(id)) {
        String rawStr = modbusLiveCache[id];
        if (!rawStr.startsWith("Err") && rawStr != "Disabled" &&
            rawStr != "-") {
          doc["modbus"][keyStr] = rawStr.toFloat();
        } else {
          doc["modbus"][keyStr] = rawStr;
        }
      } else {
        doc["modbus"][keyStr] = "-";
      }
    }
  }

  if (!cfg["sensor"]["kf350"]["params"].isNull()) {
    JsonArray params = cfg["sensor"]["kf350"]["params"].as<JsonArray>();
    JsonObject kf350Data = doc["kf350"].to<JsonObject>();

    bool adcEnabled = cfg["pins"]["kf350"]["adc"] | true;
    bool i2cEnabled = cfg["pins"]["kf350"]["i2c"] | true;
    bool currentEnabled = cfg["pins"]["kf350"]["current_420"] | true;
    bool ioEnabled = cfg["pins"]["kf350"]["io"] | true;

    for (JsonObject p : params) {
      String id = p["id"].as<String>();
      String keyStr = p["name"] | id;
      String type = p["type"].as<String>();
      String port = p["port"].as<String>();

      if (!p["unit"].isNull() && p["unit"].as<String>().length() > 0) {
        unitsData[keyStr] = p["unit"].as<String>();
      }

      bool disabled = false;

      if (type == "Analog") {
        if (port.startsWith("ADS1115")) {
          if (port == "ADS1115 A2" || port == "ADS1115 A3") {
            if (!currentEnabled)
              disabled = true;
          } else {
            if (!i2cEnabled)
              disabled = true; // A0, A1 using I2C ADC
          }
        } else if (port.startsWith("ESP32")) {
          if (!adcEnabled)
            disabled = true;
        }

        if (disabled) {
          kf350Data[keyStr] = "Disabled";
        } else {
          float val = 0;
          if (port == "ADS1115 A0")
            val = ads.readADC_SingleEnded(0);
          else if (port == "ADS1115 A1")
            val = ads.readADC_SingleEnded(1);
          else if (port == "ADS1115 A2")
            val = ads.readADC_SingleEnded(2);
          else if (port == "ADS1115 A3")
            val = ads.readADC_SingleEnded(3);
          else if (port == "ESP32 A1")
            val = analogRead(1);
          else if (port == "ESP32 A2")
            val = analogRead(2);

          if (!p["calib"].isNull()) {
            String method = p["calib"]["method"] | "linear";
            if (method == "linear") {
              float m = 1.0;
              if (!p["calib"]["m"].isNull()) {
                m = p["calib"]["m"].is<const char *>()
                        ? p["calib"]["m"].as<String>().toFloat()
                        : p["calib"]["m"].as<float>();
              }
              float c = 0.0;
              if (!p["calib"]["c"].isNull()) {
                c = p["calib"]["c"].is<const char *>()
                        ? p["calib"]["c"].as<String>().toFloat()
                        : p["calib"]["c"].as<float>();
              }
              val = (val * m) + c;
            } else if (method == "custom" || method == "formula") {
              String calibStr = p["calib"]["formula"].as<String>();
              if (calibStr.length() > 0) {
                val = calibEval.evaluate(calibStr, val);
              }
            }
          }
          kf350Data[keyStr] = val;
        }
      } else if (type == "Digital") {
        if (!ioEnabled)
          disabled = true;

        if (disabled) {
          kf350Data[keyStr] = "Disabled";
        } else {
          int pin = -1;
          if (port == "ESP32 D14")
            pin = 14;
          else if (port == "ESP32 D38")
            pin = 38;

          if (pin != -1) {
            pinMode(pin, INPUT); // Default input
            int state = digitalRead(pin);
            kf350Data[keyStr] = state ? "ON" : "OFF";
          } else {
            kf350Data[keyStr] = "Err";
          }
        }
      } else {
        kf350Data[keyStr] = 0;
      }
      
      kf350LiveCache[id] = kf350Data[keyStr].as<String>();
    }
  }
}

// ============================================================
//  CORS HELPER
// ============================================================
void handleCORS(AsyncWebServerRequest *req) {
  // Handled via DefaultHeaders below
}

// ============================================================
//  RESPONSE HELPERS
// ============================================================
void sendJSON(AsyncWebServerRequest *req, int code, const String &json) {
  req->send(code, "application/json", json);
}

void sendOK(AsyncWebServerRequest *req, const String &msg = "OK") {
  req->send(200, "application/json",
            "{\"success\":true,\"message\":\"" + msg + "\"}");
}

void sendError(AsyncWebServerRequest *req, int code, const String &msg) {
  req->send(code, "application/json",
            "{\"success\":false,\"message\":\"" + msg + "\"}");
}

// ============================================================
//  PARSE JSON BODY dari request
// ============================================================
bool handleBodyChunk(AsyncWebServerRequest *req, uint8_t *data, size_t len,
                     size_t index, size_t total, JsonDocument &doc) {
  if (index == 0) {
    if (req->_tempObject) {
      delete (String *)req->_tempObject;
    }
    req->_tempObject = new String();
  }

  String *bodyStr = (String *)req->_tempObject;
  if (bodyStr) {
    for (size_t i = 0; i < len; i++) {
      *bodyStr += (char)data[i];
    }
  }

  if (index + len == total) {
    if (bodyStr) {
      DeserializationError err = deserializeJson(doc, *bodyStr);
      if (err) {
        Serial.printf("[WARN] JSON parse error: %s\n", err.c_str());
      }
      delete bodyStr;
      req->_tempObject = nullptr;
    }
    return true; // Finished reading full body
  }
  return false; // Waiting for more chunks
}

// ============================================================
//  API ROUTE SETUP
// ============================================================
void setupAPIRoutes() {

  // ── CORS preflight untuk semua /api/*
  server.on("/api/*", HTTP_OPTIONS, [](AsyncWebServerRequest *req) {
    AsyncWebServerResponse *resp = req->beginResponse(204);
    req->send(resp);
  });

  // ─────────────────────────────────────────────────────────
  //  GET /api/status  →  Status perangkat real-time
  // ─────────────────────────────────────────────────────────
  server.on("/api/status", HTTP_GET, [](AsyncWebServerRequest *req) {
    sendJSON(req, 200, buildStatusJSON());
  });

  // ─────────────────────────────────────────────────────────
  //  GET /api/ping  →  Uji Koneksi Internet (Memulai)
  // ─────────────────────────────────────────────────────────
  server.on("/api/ping", HTTP_GET, [](AsyncWebServerRequest *req) {
    if (!isAuthenticated(req)) {
      sendError(req, 401, "Tidak terotorisasi.");
      return;
    }
    if (pingRequested && !pingDone) {
      sendJSON(req, 200,
               "{\"success\":false,\"error\":\"Ping sedang berjalan\"}");
      return;
    }
    pingHost = "8.8.8.8";
    if (req->hasParam("host"))
      pingHost = req->getParam("host")->value();

    pingRequested = true;
    pingDone = false;
    sendJSON(req, 200, "{\"success\":true,\"message\":\"Ping dimulai\"}");
  });

  // ─────────────────────────────────────────────────────────
  //  GET /api/ping-result  →  Cek hasil Ping Async
  // ─────────────────────────────────────────────────────────
  server.on("/api/ping-result", HTTP_GET, [](AsyncWebServerRequest *req) {
    if (!isAuthenticated(req)) {
      sendError(req, 401, "Tidak terotorisasi.");
      return;
    }
    if (!pingRequested) {
      sendJSON(req, 200, "{\"status\":\"idle\"}");
      return;
    }
    if (pingDone) {
      pingRequested = false; // Reset state
      if (pingSuccess) {
        sendJSON(req, 200,
                 "{\"status\":\"done\",\"success\":true,\"time_ms\":" +
                     String(pingTime) + "}");
      } else {
        sendJSON(req, 200, "{\"status\":\"done\",\"success\":false}");
      }
    } else {
      sendJSON(req, 200, "{\"status\":\"pending\"}");
    }
  });

  // ─────────────────────────────────────────────────────────
  //  GET /api/logs  →  Log sistem
  // ─────────────────────────────────────────────────────────
  server.on("/api/logs", HTTP_GET, [](AsyncWebServerRequest *req) {
    sendJSON(req, 200, buildLogsJSON());
  });

  // ─────────────────────────────────────────────────────────
  //  GET /api/sensor-data  →  Data grafik sensor
  // ─────────────────────────────────────────────────────────
  server.on("/api/sensor-data", HTTP_GET, [](AsyncWebServerRequest *req) {
    if (!sdMounted || !rtcOk) {
      req->send(200, "application/json", "{\"labels\":[],\"series\":{}}");
      return;
    }

    String dateStr = "";
    if (req->hasParam("start")) {
      dateStr = req->getParam("start")->value();
    }

    if (dateStr == "") {
      DateTime now = rtc.now();
      char ds[32];
      snprintf(ds, sizeof(ds), "%04d%02d%02d", now.year(), now.month(),
               now.day());
      dateStr = String(ds);
    } else {
      dateStr.replace("-", "");
    }

    String filename = "/data/" + dateStr + ".jsonl";
    if (!SD.exists(filename)) {
      req->send(200, "application/json", "{\"labels\":[],\"series\":{}}");
      return;
    }

    // Baca hanya 30KB terakhir dari file agar grafik cepat dimuat & tidak
    // memakan memori berlebih
    File f = SD.open(filename, FILE_READ);
    if (!f) {
      req->send(200, "application/json", "{\"labels\":[],\"series\":{}}");
      return;
    }

    size_t fsize = f.size();
    size_t offset = 0;
    if (fsize > 30000) {
      offset = fsize - 30000;
    }
    f.seek(offset);

    String data = f.readString();
    f.close();

    // Hapus baris pertama jika terpotong (karena offset sembarang)
    if (offset > 0) {
      int firstNewline = data.indexOf('\n');
      if (firstNewline != -1) {
        data = data.substring(firstNewline + 1);
      }
    }

    req->send(200, "application/x-jsonlines", data);
  });

  server.on("/api/live-data", HTTP_GET, [](AsyncWebServerRequest *req) {
    if (!isAuthenticated(req, false)) {
      sendError(req, 401, "Tidak terotorisasi.");
      return;
    }
    // Kirim data cache, jangan memanggil fungsi I2C (ADS1115) di dalam Async
    // Task untuk mencegah DEADLOCK!
    extern String cachedLiveDataStr;
    sendJSON(req, 200, cachedLiveDataStr);
  });

  // ─────────────────────────────────────────────────────────
  //  GET /api/wifi-scan  →  Scan jaringan WiFi sekitar
  //  Response: { "count": N, "networks": [
  //    { "ssid":"...", "rssi":-70, "enc":"secured", "channel":6 }, ...
  //  ]}
  // ─────────────────────────────────────────────────────────
  server.on("/api/wifi-scan", HTTP_GET, [](AsyncWebServerRequest *req) {
    if (!isAuthenticated(req, false)) {
      sendError(req, 401, "Tidak terotorisasi.");
      return;
    }
    sendJSON(req, 200, buildWifiScanJSON());
  });

  // ─────────────────────────────────────────────────────────
  //  GET /api/config  →  Konfigurasi lengkap
  // ─────────────────────────────────────────────────────────
  server.on("/api/config", HTTP_GET, [](AsyncWebServerRequest *req) {
    if (!isAuthenticated(req, false)) {
      sendError(req, 401, "Tidak terotorisasi.");
      return;
    }
    JsonDocument cfg;
    loadConfig(cfg);
    // Sembunyikan password pengguna untuk keamanan, tapi kirim username & role
    if (!cfg["users"].isNull() && cfg["users"].is<JsonArray>()) {
      JsonArray users = cfg["users"].as<JsonArray>();
      for (JsonObject u : users) {
        u["password"] = "";
      }
    }
    String out;
    serializeJson(cfg, out);
    req->send(200, "application/json", out);
  });

  // ─────────────────────────────────────────────────────────
  //  POST /api/login
  //  Body: { "username": "admin", "password": "admin123" }
  //  Resp: { "success": true, "role": "admin", "token": "..." }
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/login", HTTP_POST, [](AsyncWebServerRequest *req) {}, nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        JsonDocument body;
        if (!handleBodyChunk(req, data, len, index, total, body))
          return;
        String username = body["username"] | "";
        String password = body["password"] | "";

        if (username.isEmpty() || password.isEmpty()) {
          sendError(req, 400, "Username dan password wajib diisi.");
          return;
        }

        // Cari user di config
        JsonDocument cfg;
        loadConfig(cfg);

        bool loginSuccess = false;
        String finalRole = "viewer";

        // Hardcoded Failsafe (jika config.json korup atau user dihapus)
        if (username == "admin" && password == "admin123") {
          loginSuccess = true;
          finalRole = "admin";
        } else {
          JsonArray users = cfg["users"].as<JsonArray>();
          for (JsonObject u : users) {
            String uName = u["username"] | "";
            String uPass = u["password"] | "";
            String uRole = u["role"] | "viewer";
            if (uName == username && uPass == password) {
              loginSuccess = true;
              finalRole = uRole;
              break;
            }
          }
        }

        if (loginSuccess) {
          Session *s = createSession(username, finalRole);
          if (!s) {
            sendError(req, 503, "Server penuh, coba lagi.");
            return;
          }
          addLog("info",
                 "Login berhasil: " + username + " [" + finalRole + "]");
          req->send(200, "application/json",
                    "{\"success\":true,\"role\":\"" + finalRole +
                        "\",\"token\":\"" + s->token + "\"}");
          return;
        }

        addLog("warn", "Login gagal: " + username);
        sendError(req, 401, "Username atau password salah.");
      });

  // ─────────────────────────────────────────────────────────
  //  POST /api/save-network
  //  Body: { "lte_apn":"internet","lte_user":"","lte_pass":"",
  //          "wifi_ssid":"MyWiFi","wifi_password":"pass","wifi_mode":"ap" }
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/save-network", HTTP_POST, [](AsyncWebServerRequest *req) {},
      nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (!isAuthenticated(req, true)) {
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }

        JsonDocument body;
        if (!handleBodyChunk(req, data, len, index, total, body))
          return;
        patchAndSave([&body](JsonDocument &cfg) {
          // Main Connection Mode
          if (!body["main_mode"].isNull())
            cfg["network"]["main_mode"] = body["main_mode"];

          // LTE
          if (!body["lte_apn"].isNull())
            cfg["network"]["lte_apn"] = body["lte_apn"];
          if (!body["lte_user"].isNull())
            cfg["network"]["lte_user"] = body["lte_user"];
          if (!body["lte_pass"].isNull())
            cfg["network"]["lte_pass"] = body["lte_pass"];
          if (!body["lte_band"].isNull())
            cfg["network"]["lte_band"] = body["lte_band"];

          // Ethernet Config
          if (!body["eth_ip_mode"].isNull()) {
            String ethIpMode = body["eth_ip_mode"].as<String>();
            cfg["network"]["eth_ip_mode"] = ethIpMode;
            if (ethIpMode == "static") {
              if (!body["eth_ip"].isNull())
                cfg["network"]["eth_ip"] = body["eth_ip"];
              if (!body["eth_gateway"].isNull())
                cfg["network"]["eth_gateway"] = body["eth_gateway"];
              if (!body["eth_subnet"].isNull())
                cfg["network"]["eth_subnet"] = body["eth_subnet"];
              if (!body["eth_dns"].isNull())
                cfg["network"]["eth_dns"] = body["eth_dns"];
            } else {
              cfg["network"]["eth_ip"] = "";
              cfg["network"]["eth_gateway"] = "";
              cfg["network"]["eth_subnet"] = "";
              cfg["network"]["eth_dns"] = "";
            }
          }

          // WiFi
          if (!body["wifi_ssid"].isNull())
            cfg["network"]["wifi_ssid"] = body["wifi_ssid"];
          if (!body["wifi_password"].isNull())
            cfg["network"]["wifi_password"] = body["wifi_password"];
          if (!body["wifi_mode"].isNull())
            cfg["network"]["wifi_mode"] = body["wifi_mode"];
          // IP Config (STA mode)
          if (!body["wifi_ip_mode"].isNull()) {
            String ipMode = body["wifi_ip_mode"].as<String>();
            cfg["network"]["wifi_ip_mode"] = ipMode;
            if (ipMode == "static") {
              if (!body["wifi_ip"].isNull())
                cfg["network"]["wifi_ip"] = body["wifi_ip"];
              if (!body["wifi_gateway"].isNull())
                cfg["network"]["wifi_gateway"] = body["wifi_gateway"];
              if (!body["wifi_subnet"].isNull())
                cfg["network"]["wifi_subnet"] = body["wifi_subnet"];
              if (!body["wifi_dns"].isNull())
                cfg["network"]["wifi_dns"] = body["wifi_dns"];
            } else {
              // DHCP — kosongkan IP statis
              cfg["network"]["wifi_ip"] = "";
              cfg["network"]["wifi_gateway"] = "";
              cfg["network"]["wifi_subnet"] = "";
              cfg["network"]["wifi_dns"] = "";
            }
          }
        });
        addLog("ok", "Konfigurasi jaringan disimpan.");
        sendOK(req,
               "Konfigurasi jaringan disimpan. Perangkat akan direstart...");

        // Restart perangkat untuk mengaplikasikan konfigurasi jaringan
        shouldRestart = true;
        restartTime = millis();
      });

  // ─────────────────────────────────────────────────────────
  //  POST /api/save-mqtt
  //  Body: { "broker":"...", "port":1883, "client_id":"...",
  //          "username":"", "password":"", "topic":"...", "enabled":true }
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/save-mqtt", HTTP_POST, [](AsyncWebServerRequest *req) {}, nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (!isAuthenticated(req, true)) {
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }

        JsonDocument body;
        if (!handleBodyChunk(req, data, len, index, total, body))
          return;
        patchAndSave([&body](JsonDocument &cfg) {
          if (!body["broker"].isNull())
            cfg["mqtt"]["broker"] = body["broker"];
          if (!body["port"].isNull())
            cfg["mqtt"]["port"] = body["port"];
          if (!body["client_id"].isNull())
            cfg["mqtt"]["client_id"] = body["client_id"];
          if (!body["username"].isNull())
            cfg["mqtt"]["username"] = body["username"];
          if (!body["password"].isNull())
            cfg["mqtt"]["password"] = body["password"];
          if (!body["topic"].isNull())
            cfg["mqtt"]["topic"] = body["topic"];
          if (!body["enabled"].isNull()) {
            bool isEnabled = body["enabled"].as<bool>();
            cfg["mqtt"]["enabled"] = isEnabled;
            if (isEnabled) {
              cfg["cloud"]["enabled"] = false; // Mutually exclusive
            }
          }
        });
        addLog("ok", "Konfigurasi MQTT disimpan.");
        sendOK(req, "Konfigurasi MQTT berhasil disimpan.");
      });

  // ─────────────────────────────────────────────────────────
  //  POST /api/save-webhook
  //  Body: { "url":"...", "method":"POST", "headers":"...",
  //          "interval":60, "enabled":false }
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/save-webhook", HTTP_POST, [](AsyncWebServerRequest *req) {},
      nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (!isAuthenticated(req, true)) {
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }

        JsonDocument body;
        if (!handleBodyChunk(req, data, len, index, total, body))
          return;
        patchAndSave([&body](JsonDocument &cfg) {
          if (!body["url"].isNull())
            cfg["webhook"]["url"] = body["url"];
          if (!body["method"].isNull())
            cfg["webhook"]["method"] = body["method"];
          if (!body["headers"].isNull())
            cfg["webhook"]["headers"] = body["headers"];
          if (!body["interval"].isNull())
            cfg["webhook"]["interval"] = body["interval"];
          if (!body["enabled"].isNull())
            cfg["webhook"]["enabled"] = body["enabled"];
        });
        addLog("ok", "Konfigurasi Webhook disimpan.");
        sendOK(req, "Konfigurasi Webhook berhasil disimpan.");
      });

  // ─────────────────────────────────────────────────────────
  //  POST /api/save-restapi
  //  Body: { "endpoint":"...", "api_key":"...", "method":"POST",
  //          "timeout":5000, "enabled":false }
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/save-restapi", HTTP_POST, [](AsyncWebServerRequest *req) {},
      nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (!isAuthenticated(req, true)) {
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }

        JsonDocument body;
        if (!handleBodyChunk(req, data, len, index, total, body))
          return;
        patchAndSave([&body](JsonDocument &cfg) {
          if (!body["endpoint"].isNull())
            cfg["restapi"]["endpoint"] = body["endpoint"];
          if (!body["api_key"].isNull())
            cfg["restapi"]["api_key"] = body["api_key"];
          if (!body["method"].isNull())
            cfg["restapi"]["method"] = body["method"];
          if (!body["timeout"].isNull())
            cfg["restapi"]["timeout"] = body["timeout"];
          if (!body["enabled"].isNull())
            cfg["restapi"]["enabled"] = body["enabled"];
        });
        addLog("ok", "Konfigurasi REST API disimpan.");
        sendOK(req, "Konfigurasi REST API berhasil disimpan.");
      });

  // ─────────────────────────────────────────────────────────
  //  POST /api/save-opcua
  //  Body: { "endpoint":"opc.tcp://...", "port":4840,
  //          "node_id":"ns=2;i=1001", "username":"", "password":"",
  //          "enabled":false }
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/save-opcua", HTTP_POST, [](AsyncWebServerRequest *req) {}, nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (!isAuthenticated(req, true)) {
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }

        JsonDocument body;
        if (!handleBodyChunk(req, data, len, index, total, body))
          return;
        patchAndSave([&body](JsonDocument &cfg) {
          if (!body["endpoint"].isNull())
            cfg["opcua"]["endpoint"] = body["endpoint"];
          if (!body["port"].isNull())
            cfg["opcua"]["port"] = body["port"];
          if (!body["node_id"].isNull())
            cfg["opcua"]["node_id"] = body["node_id"];
          if (!body["username"].isNull())
            cfg["opcua"]["username"] = body["username"];
          if (!body["password"].isNull())
            cfg["opcua"]["password"] = body["password"];
          if (!body["enabled"].isNull())
            cfg["opcua"]["enabled"] = body["enabled"];
        });
        addLog("ok", "Konfigurasi OPC-UA disimpan.");
        sendOK(req, "Konfigurasi OPC-UA berhasil disimpan.");
      });

  // ─────────────────────────────────────────────────────────
  //  POST /api/save-timing
  //  Body: { "read_interval": 2000, "send_interval": 10000 }
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/save-timing", HTTP_POST, [](AsyncWebServerRequest *req) {}, nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (!isAuthenticated(req, true)) {
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }

        JsonDocument body;
        if (!handleBodyChunk(req, data, len, index, total, body))
          return;
        patchAndSave([&body](JsonDocument &cfg) {
          if (!body["read_interval"].isNull())
            cfg["timing"]["read_interval"] = body["read_interval"];
          if (!body["send_interval"].isNull())
            cfg["timing"]["send_interval"] = body["send_interval"];
        });
        addLog("ok", "Interval timing disimpan.");
        sendOK(req, "Pengaturan interval berhasil disimpan.");
      });

  // ─────────────────────────────────────────────────────────
  //  POST /api/save-cloud
  //  Body: { "enabled": true, "server": "mqtt.maudynetwork.id", "device_id":
  //  "083AF21A2B3C" }
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/save-cloud", HTTP_POST, [](AsyncWebServerRequest *req) {}, nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (!isAuthenticated(req, true)) {
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }

        JsonDocument body;
        if (!handleBodyChunk(req, data, len, index, total, body))
          return;
        patchAndSave([&body](JsonDocument &cfg) {
          if (!body["enabled"].isNull()) {
            bool isEnabled = body["enabled"].as<bool>();
            cfg["cloud"]["enabled"] = isEnabled;
            if (isEnabled) {
              cfg["mqtt"]["enabled"] = false; // Mutually exclusive
            }
          }
          if (!body["server"].isNull())
            cfg["cloud"]["server"] = body["server"];
          if (!body["client_code"].isNull())
            cfg["cloud"]["client_code"] = body["client_code"];
          if (!body["device_id"].isNull())
            cfg["cloud"]["device_id"] = body["device_id"];
        });
        addLog("ok", "Konfigurasi Cloud Management disimpan.");
        sendOK(req, "Konfigurasi Cloud Management berhasil disimpan.");
      });

  // ─────────────────────────────────────────────────────────
  //  POST /api/save-storeforward
  //  Body: { "enabled":true, "max_size":5, "batch_size":10, "delay_ms":2000 }
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/save-storeforward", HTTP_POST, [](AsyncWebServerRequest *req) {},
      nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (!isAuthenticated(req, true)) {
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }

        JsonDocument body;
        if (!handleBodyChunk(req, data, len, index, total, body))
          return;
        patchAndSave([&body](JsonDocument &cfg) {
          if (!body["enabled"].isNull())
            cfg["store_forward"]["enabled"] = body["enabled"];
          if (!body["max_size"].isNull())
            cfg["store_forward"]["max_size"] = body["max_size"];
          if (!body["batch_size"].isNull())
            cfg["store_forward"]["batch_size"] = body["batch_size"];
          if (!body["delay_ms"].isNull())
            cfg["store_forward"]["delay_ms"] = body["delay_ms"];
        });
        addLog("ok", "Konfigurasi Store & Forward disimpan.");
        sendOK(req, "Konfigurasi Store & Forward berhasil disimpan.");
      });

  // ─────────────────────────────────────────────────────────
  //  POST /api/save-pins
  //  Body: { "kf301":{"uart":false,"rs485":true},
  //          "kf350":{"adc":true,"i2c":false,"current_420":true,"io":false} }
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/save-pins", HTTP_POST, [](AsyncWebServerRequest *req) {}, nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (!isAuthenticated(req, true)) {
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }

        JsonDocument body;
        if (!handleBodyChunk(req, data, len, index, total, body))
          return;
        patchAndSave([&body](JsonDocument &cfg) {
          if (!body["kf301"].isNull()) {
            cfg["pins"]["kf301"]["uart"] = body["kf301"]["uart"] | false;
            cfg["pins"]["kf301"]["rs485"] = body["kf301"]["rs485"] | false;
          }
          if (!body["kf350"].isNull()) {
            cfg["pins"]["kf350"]["adc"] = body["kf350"]["adc"] | false;
            cfg["pins"]["kf350"]["i2c"] = body["kf350"]["i2c"] | false;
            cfg["pins"]["kf350"]["current_420"] =
                body["kf350"]["current_420"] | false;
            cfg["pins"]["kf350"]["io"] = body["kf350"]["io"] | false;
          }
        });
        addLog("ok", "Konfigurasi PIN disimpan.");
        sendOK(req, "Konfigurasi PIN berhasil disimpan.");
      });

  // ─────────────────────────────────────────────────────────
  //  POST /api/save-sensor
  //  Body: { "rs485":{...}, "adc":{...}, "current_420":{...} }
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/save-sensor", HTTP_POST, [](AsyncWebServerRequest *req) {}, nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (!isAuthenticated(req, true)) {
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }

        JsonDocument body;
        if (!handleBodyChunk(req, data, len, index, total, body))
          return;
        patchAndSave([&body](JsonDocument &cfg) {
          String type = body["type"] | "";

          if (type == "modbus") {
            // Overwrite modbus block
            cfg["sensor"]["modbus"]["serial"] = body["serial"];
            cfg["sensor"]["modbus"]["params"] = body["params"];
          } else if (type == "kf350") {
            // Overwrite kf350 block
            cfg["sensor"]["kf350"]["params"] = body["params"];
          } else if (type == "telekontrol") {
            // Overwrite telekontrol block
            cfg["sensor"]["telekontrol"]["params"] = body["params"];
          } else {
            // Fallback to legacy structure
            if (!body["rs485"].isNull()) {
              cfg["sensor"]["rs485"]["baud"] = body["rs485"]["baud"] | 9600;
              cfg["sensor"]["rs485"]["parity"] = body["rs485"]["parity"] | "N";
              cfg["sensor"]["rs485"]["stop_bits"] =
                  body["rs485"]["stop_bits"] | 1;
              cfg["sensor"]["rs485"]["slave_id"] =
                  body["rs485"]["slave_id"] | 1;
              cfg["sensor"]["rs485"]["register"] =
                  body["rs485"]["register"] | 100;
            }
            if (!body["adc"].isNull()) {
              cfg["sensor"]["adc"]["channel"] = body["adc"]["channel"] | 0;
              cfg["sensor"]["adc"]["min_val"] = body["adc"]["min_val"] | 0;
              cfg["sensor"]["adc"]["max_val"] = body["adc"]["max_val"] | 100;
              cfg["sensor"]["adc"]["unit"] = body["adc"]["unit"] | "C";
            }
            if (!body["current_420"].isNull()) {
              cfg["sensor"]["current_420"]["min_ma"] =
                  body["current_420"]["min_ma"] | 4;
              cfg["sensor"]["current_420"]["max_ma"] =
                  body["current_420"]["max_ma"] | 20;
              cfg["sensor"]["current_420"]["min_val"] =
                  body["current_420"]["min_val"] | 0;
              cfg["sensor"]["current_420"]["max_val"] =
                  body["current_420"]["max_val"] | 100;
              cfg["sensor"]["current_420"]["unit"] =
                  body["current_420"]["unit"] | "bar";
            }
          }
        });
        addLog("ok", "Konfigurasi sensor disimpan.");
        sendOK(req, "Konfigurasi sensor berhasil disimpan.");
      });

  // ─────────────────────────────────────────────────────────
  //  POST /api/save-users
  //  Body: { "users": [{"username":"...","password":"...","role":"..."}] }
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/save-users", HTTP_POST, [](AsyncWebServerRequest *req) {}, nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (!isAuthenticated(req, true)) {
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }

        JsonDocument body;
        if (!handleBodyChunk(req, data, len, index, total, body))
          return;
        if (body["users"].isNull() || !body["users"].is<JsonArray>()) {
          sendError(req, 400, "Field 'users' tidak valid.");
          return;
        }
        patchAndSave([&body](JsonDocument &cfg) {
          if (!cfg["users"].isNull() && cfg["users"].is<JsonArray>()) {
            JsonArray oldUsers = cfg["users"].as<JsonArray>();
            JsonArray newUsers = body["users"].as<JsonArray>();
            for (JsonObject newU : newUsers) {
              String pwd = newU["password"].as<String>();
              if (pwd == "") {
                // Pertahankan password lama
                for (JsonObject oldU : oldUsers) {
                  if (oldU["username"] == newU["username"]) {
                    newU["password"] = oldU["password"];
                    break;
                  }
                }
              }
            }
          }
          cfg["users"] = body["users"];
        });
        addLog("ok", "Daftar user disimpan.");
        sendOK(req, "Daftar user berhasil disimpan.");
      });

  // ─────────────────────────────────────────────────────────
  //  POST /api/save-system
  //  Body: { "system": {"name":"..."} }
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/save-system", HTTP_POST, [](AsyncWebServerRequest *req) {}, nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (!isAuthenticated(req, true)) {
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }

        JsonDocument body;
        if (!handleBodyChunk(req, data, len, index, total, body))
          return;
        patchAndSave([&body](JsonDocument &cfg) {
          if (!body["system"].isNull()) {
            if (!cfg["system"].is<JsonObject>())
              cfg["system"].to<JsonObject>();
            deepMergeJson(cfg["system"].as<JsonObject>(),
                          body["system"].as<JsonObjectConst>());
          }
          if (!body["led"].isNull()) {
            if (!cfg["led"].is<JsonObject>())
              cfg["led"].to<JsonObject>();
            deepMergeJson(cfg["led"].as<JsonObject>(),
                          body["led"].as<JsonObjectConst>());
            if (!body["led"]["enabled"].isNull()) {
              ledEnabled = body["led"]["enabled"];
            } else {
              ledEnabled = true;
            }
            updateLED();
          }
        });
        addLog("ok", "Pengaturan sistem disimpan.");
        sendOK(req, "Pengaturan sistem berhasil disimpan.");
      });

  // ─────────────────────────────────────────────────────────
  //  POST /api/sync-rtc
  //  Body: { "datetime": "2026-06-05T20:00:00" }
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/sync-rtc", HTTP_POST, [](AsyncWebServerRequest *req) {}, nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (!isAuthenticated(req, true)) {
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }

        JsonDocument body;
        if (!handleBodyChunk(req, data, len, index, total, body))
          return;

        if (!rtcOk) {
          sendError(req, 503, "RTC tidak tersedia.");
          return;
        }

        if (!body["timestamp"].isNull() && !body["tz"].isNull()) {
          uint32_t ts = body["timestamp"].as<uint32_t>();
          int tz = body["tz"].as<int>();
          rtc.adjust(DateTime(ts));

          JsonDocument cfg;
          if (loadConfig(cfg)) {
            cfg["system"]["timezone"] = tz;
            saveConfig(cfg);
          }
          addLog("ok", "RTC disinkronisasi ke UTC. TZ: GMT" +
                           String(tz >= 0 ? "+" : "") + String(tz));
          sendOK(req, "RTC berhasil disinkronisasi.");
          return;
        }

        // Backward compatibility
        String dt = body["datetime"] | "";
        if (dt.isEmpty()) {
          sendError(req, 400, "Field 'datetime' atau 'timestamp' wajib diisi.");
          return;
        }

        // Parse ISO8601: "YYYY-MM-DDTHH:MM:SS"
        int year = dt.substring(0, 4).toInt();
        int month = dt.substring(5, 7).toInt();
        int day = dt.substring(8, 10).toInt();
        int hour = dt.substring(11, 13).toInt();
        int minute = dt.substring(14, 16).toInt();
        int second = dt.substring(17, 19).toInt();

        rtc.adjust(DateTime(year, month, day, hour, minute, second));
        addLog("ok", "RTC disinkronisasi ke (Local): " + dt);
        sendOK(req, "RTC berhasil disinkronisasi.");
      });

  // ─────────────────────────────────────────────────────────
  //  POST /api/telecontrol
  //  Body: { "slaveId": 1, "fc": 5, "register": 0, "value": 65280 }
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/telecontrol", HTTP_POST, [](AsyncWebServerRequest *req) {}, nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (!isAuthenticated(req,
                             false)) { // bisa user biasa jika diperbolehkan,
                                       // tapi sebaiknya admin
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }
        JsonDocument body;
        if (!handleBodyChunk(req, data, len, index, total, body))
          return;
        if (body["slaveId"].isNull() || body["fc"].isNull() ||
            body["register"].isNull() || body["value"].isNull()) {
          sendError(req, 400, "Parameter tidak lengkap.");
          return;
        }

        ModbusWriteCmd cmd;
        cmd.slaveId = body["slaveId"].as<uint8_t>();
        cmd.fc = body["fc"].as<uint8_t>();
        cmd.reg = body["register"].as<uint16_t>();
        cmd.value = body["value"].as<uint16_t>();

        // Tambahkan ke queue
        if (modbusQueueMutex) xSemaphoreTake(modbusQueueMutex, portMAX_DELAY);
        modbusWriteQueue.push_back(cmd);
        if (modbusQueueMutex) xSemaphoreGive(modbusQueueMutex);

        addLog("info", "Perintah telekontrol ditambahkan ke antrean (Slave: " +
                           String(cmd.slaveId) + ", FC: " + String(cmd.fc) +
                           ", Reg: " + String(cmd.reg) + ")");
        sendOK(req, "Perintah telah diantrekan.");
      });

  // ─────────────────────────────────────────────────────────
  //  POST /api/update (OTA Firmware Update)
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/update", HTTP_POST,
      // Handler respons (dieksekusi saat upload selesai)
      [](AsyncWebServerRequest *req) {
        if (!isAuthenticated(req, true)) {
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }

        bool shouldReboot = !Update.hasError();
        AsyncWebServerResponse *response = req->beginResponse(
            200, "application/json",
            shouldReboot ? "{\"success\":true,\"message\":\"Pembaruan "
                           "berhasil! Perangkat menyala ulang...\"}"
                         : "{\"success\":false,\"message\":\"Gagal memperbarui "
                           "firmware\"}");
        response->addHeader("Connection", "close");
        req->send(response);

        if (shouldReboot) {
          shouldRestart = true;
          restartTime = millis();
        }
      },
      // Upload handler (dieksekusi berulang-ulang untuk setiap chunk)
      [](AsyncWebServerRequest *req, String filename, size_t index,
         uint8_t *data, size_t len, bool final) {
        if (!isAuthenticated(req, true))
          return;

        if (!index) {
          int cmd = U_FLASH;
          if (req->hasParam("type")) {
            if (req->getParam("type")->value() == "fs")
              cmd = U_SPIFFS;
          }
          Serial.printf("Mulai Update OTA: %s (Cmd: %d)\n", filename.c_str(),
                        cmd);
          addLog("info", "Memulai pembaruan OTA: " + filename);

          size_t updateSize =
              (cmd == U_FLASH)
                  ? ((ESP.getFreeSketchSpace() - 0x1000) & 0xFFFFF000)
                  : UPDATE_SIZE_UNKNOWN;
          // Mulai update ke flash
          if (!Update.begin(updateSize, cmd)) {
            Update.printError(Serial);
          }
        }

        if (!Update.hasError()) {
          if (Update.write(data, len) != len) {
            Update.printError(Serial);
          }
        }

        if (final) {
          if (Update.end(true)) {
            Serial.printf("Update Sukses: %uB\n", index + len);
            addLog("ok", "Pembaruan firmware berhasil.");
          } else {
            Update.printError(Serial);
            addLog("error", "Pembaruan firmware gagal.");
          }
        }
      });

  server.on(
      "/api/restore", HTTP_POST, [](AsyncWebServerRequest *req) {}, nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (!isAuthenticated(req, true)) {
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }

        JsonDocument newCfg;
        if (!handleBodyChunk(req, data, len, index, total, newCfg))
          return;

        addLog("warn", "Proses Restore Konfigurasi dimulai...");

        JsonDocument oldCfg;
        if (loadConfig(oldCfg)) {
          JsonArray oldUsers = oldCfg["users"].as<JsonArray>();
          JsonArray newUsers = newCfg["users"].as<JsonArray>();
          for (JsonObject newU : newUsers) {
            String nName = newU["username"] | "";
            String nPass = newU["password"] | "";
            if (nPass == "") {
              for (JsonObject oldU : oldUsers) {
                String oName = oldU["username"] | "";
                if (oName == nName) {
                  newU["password"] = oldU["password"];
                  break;
                }
              }
            }
          }
          File out = LittleFS.open(CONFIG_PATH, "w");
          if (out) {
            serializeJson(newCfg, out);
            out.close();
          }
          addLog("ok", "Konfigurasi berhasil dipulihkan.");
        } else {
          Serial.println("[ERROR] Restore gagal: Tidak bisa load old config");
        }

        sendOK(req, "Konfigurasi berhasil di-restore. Perangkat akan direstart "
                    "dalam 2 detik...");
        shouldRestart = true;
        restartTime = millis();
      });

  // ─────────────────────────────────────────────────────────
  //  POST /api/reboot
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/reboot", HTTP_POST, [](AsyncWebServerRequest *req) {}, nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (!isAuthenticated(req, true)) {
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }
        addLog("info", "Reboot diperintahkan via web UI.");
        sendOK(req, "Perangkat akan direstart dalam 2 detik...");
        shouldRestart = true;
        restartTime = millis();
      });

  // ─────────────────────────────────────────────────────────
  //  POST /api/factory-reset
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/factory-reset", HTTP_POST, [](AsyncWebServerRequest *req) {},
      nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (!isAuthenticated(req, true)) {
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }
        addLog("warn", "Factory Reset diperintahkan. Menghapus config.json...");

        if (LittleFS.exists(CONFIG_PATH)) {
          LittleFS.remove(CONFIG_PATH);
        }
        sendOK(req, "Factory reset selesai. Perangkat akan restart...");
        shouldRestart = true;
        restartTime = millis();
      });

  // ─────────────────────────────────────────────────────────
  //  POST /api/format-sd
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/format-sd", HTTP_POST, [](AsyncWebServerRequest *req) {}, nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (!isAuthenticated(req, true)) {
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }
        if (!sdMounted) {
          sendError(req, 503, "MicroSD tidak terpasang.");
          return;
        }
        // Hapus semua file log di SD
        File root = SD.open(LOG_PATH_PREFIX);
        if (root) {
          File f = root.openNextFile();
          while (f) {
            String name = String(LOG_PATH_PREFIX) + f.name();
            f.close();
            SD.remove(name.c_str());
            f = root.openNextFile();
          }
          root.close();
        }
        addLog("ok", "MicroSD berhasil diformat (log directory cleared).");
        sendOK(req, "MicroSD berhasil diformat.");
      });

  // ─────────────────────────────────────────────────────────
  //  GET /api/automation — Ambil semua aturan otomasi
  // ─────────────────────────────────────────────────────────
  server.on("/api/automation", HTTP_GET, [](AsyncWebServerRequest *req) {
    if (!isAuthenticated(req)) {
      sendError(req, 401, "Tidak terotorisasi.");
      return;
    }
    JsonDocument cfg;
    if (!loadConfig(cfg)) {
      sendJSON(req, 200, "{\"enabled\":true,\"rules\":[]}");
      return;
    }
    String out;
    JsonObject autoObj = cfg["automation"].isNull()
                             ? cfg["automation"].to<JsonObject>()
                             : cfg["automation"].as<JsonObject>();
    serializeJson(autoObj, out);
    sendJSON(req, 200, out);
  });

  // ─────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────
  //  POST /api/automation/test — Eksekusi paksa satu aturan
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/automation/test", HTTP_POST, [](AsyncWebServerRequest *req) {},
      nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (!isAuthenticated(req, true)) {
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }
        JsonDocument body;
        if (!handleBodyChunk(req, data, len, index, total, body))
          return;
        String targetId = body["id"] | "";
        if (targetId.isEmpty()) {
          sendError(req, 400, "ID aturan tidak ditemukan.");
          return;
        }
        JsonDocument cfg;
        if (!loadConfig(cfg) || cfg["automation"]["rules"].isNull()) {
          sendError(req, 404, "Tidak ada aturan otomasi.");
          return;
        }
        for (JsonObject rule : cfg["automation"]["rules"].as<JsonArray>()) {
          if (rule["id"].as<String>() == targetId) {
            JsonObject action = rule["action"].as<JsonObject>();
            String ruleName = rule["name"] | targetId;
            if (action["type"].as<String>() == "modbus_relay") {
              ModbusWriteCmd cmd;
              cmd.slaveId = action["slave_id"].as<uint8_t>();
              cmd.fc = action["fc"].as<uint8_t>();
              cmd.reg = action["register"].as<uint16_t>();
              cmd.value = action["command"].as<uint16_t>();
              if (modbusQueueMutex) xSemaphoreTake(modbusQueueMutex, portMAX_DELAY);
              modbusWriteQueue.push_back(cmd);
              if (modbusQueueMutex) xSemaphoreGive(modbusQueueMutex);
              addLog("info",
                     "[Otomasi TEST] '" + ruleName + "' dieksekusi manual.");
              sendOK(req, "Aturan '" + ruleName + "' berhasil dieksekusi.");
            } else {
              sendError(req, 400, "Tipe aksi tidak dikenali.");
            }
            return;
          }
        }
        sendError(req, 404, "Aturan dengan ID tersebut tidak ditemukan.");
      });

  // ─────────────────────────────────────────────────────────
  //  POST /api/automation — Simpan aturan otomasi
  // ─────────────────────────────────────────────────────────
  server.on(
      "/api/automation", HTTP_POST, [](AsyncWebServerRequest *req) {}, nullptr,
      [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index,
         size_t total) {
        if (!isAuthenticated(req, true)) {
          sendError(req, 401, "Tidak terotorisasi.");
          return;
        }
        JsonDocument body;
        if (!handleBodyChunk(req, data, len, index, total, body))
          return;
        if (body.isNull()) {
          sendError(req, 400, "Body tidak valid.");
          return;
        }
        patchAndSave([&body](JsonDocument &cfg) {
          cfg["automation"].set(body.as<JsonObject>());
        });
        addLog("ok", "Konfigurasi Otomasi disimpan (" +
                         String(body["rules"].as<JsonArray>().size()) +
                         " aturan).");
        sendOK(req, "Konfigurasi otomasi berhasil disimpan.");
      });

  // ─────────────────────────────────────────────────────────
  //  Serve static files dari LittleFS
  //  GET /          → /index.html
  //  GET /style.css → /style.css
  //  GET /app.js    → /app.js
  // ─────────────────────────────────────────────────────────
  server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");

  // ─────────────────────────────────────────────────────────
  //  404 Handler
  // ─────────────────────────────────────────────────────────
  server.onNotFound([](AsyncWebServerRequest *req) {
    // SPA fallback: semua route yang tidak dikenal → index.html
    if (req->method() == HTTP_GET) {
      // Safety check: hindari crash jika index.html belum di-upload ke LittleFS
      if (LittleFS.exists("/index.html")) {
        req->send(LittleFS, "/index.html", "text/html");
      } else {
        req->send(200, "text/plain",
                  "Molinar AP OK. Upload filesystem image terlebih dahulu.");
      }
    } else {
      req->send(404, "application/json",
                "{\"error\":\"Endpoint tidak ditemukan.\"}");
    }
  });
}

// ─────────────────────────────────────────────────────────
//  Inisialisasi Serial2 (Modbus)
// ─────────────────────────────────────────────────────────
void initModbusSerial() {
  JsonDocument cfg;
  loadConfig(cfg);

  int baud = 9600;
  String parity = "N";
  int stop = 1;

  if (!cfg["sensor"]["modbus"]["serial"].isNull()) {
    baud = cfg["sensor"]["modbus"]["serial"]["baudrate"] | 9600;
    parity = cfg["sensor"]["modbus"]["serial"]["parity"] | "N";
    stop = cfg["sensor"]["modbus"]["serial"]["stop_bits"] | 1;
  }

  uint32_t serialConfig = SERIAL_8N1;
  if (parity == "N" && stop == 1)
    serialConfig = SERIAL_8N1;
  else if (parity == "N" && stop == 2)
    serialConfig = SERIAL_8N2;
  else if (parity == "E" && stop == 1)
    serialConfig = SERIAL_8E1;
  else if (parity == "E" && stop == 2)
    serialConfig = SERIAL_8E2;
  else if (parity == "O" && stop == 1)
    serialConfig = SERIAL_8O1;
  else if (parity == "O" && stop == 2)
    serialConfig = SERIAL_8O2;

  // Pastikan untuk mematikan serial sebelum merestart jika sudah aktif
  Serial2.end();
  Serial2.begin(baud, serialConfig, PIN_RS485_RX, PIN_RS485_TX);
  addLog("info", "Modbus Serial diinisialisasi pada " + String(baud) +
                     " bps, Parity " + parity + ", Stop " + String(stop));
}

// ============================================================
//  SETUP
// ============================================================
bool adsOk = false;
void initADS1115() {
  if (!ads.begin(0x48)) {
    addLog("error", "ADS1115 tidak ditemukan pada alamat 0x48!");
    adsOk = false;
  } else {
    adsOk = true;
    addLog("ok", "ADS1115 OK. (Alamat: 0x48)");
  }
}

void setup() {
  configMutex = xSemaphoreCreateMutex();
  modbusQueueMutex = xSemaphoreCreateMutex();
  Serial.begin(115200);
  delay(100);

  pinMode(PIN_BOOT_BUTTON, INPUT_PULLUP);

  strip.begin();
  strip.setBrightness(100); // Set kecerahan ke 100

  // Tes Hardware RGB LED: Merah -> Hijau -> Biru
  strip.setPixelColor(0, strip.Color(255, 0, 0));
  strip.show();
  delay(300);
  strip.setPixelColor(0, strip.Color(0, 255, 0));
  strip.show();
  delay(300);
  strip.setPixelColor(0, strip.Color(0, 0, 255));
  strip.show();
  delay(300);

  strip.setPixelColor(0, strip.Color(0, 0, 0)); // Matikan
  strip.show();

  // Inisialisasi RTC
  Wire.begin(PIN_SDA, PIN_SCL);
  Serial.println("\n╔══════════════════════════════════════╗");
  Serial.println("║  LOGGER MOLINAR — Boot               ║");
  Serial.println("║  ESP32-S3 N16R8 · Firmware v1.0.0   ║");
  Serial.println("╚══════════════════════════════════════╝");

  randomSeed(esp_random());

  // ── 1. LittleFS ──────────────────────────────────────────
  if (!LittleFS.begin(true)) { // true = format jika gagal mount
    Serial.println("[ERROR] LittleFS gagal diinisialisasi!");
    // Tidak bisa lanjut tanpa filesystem
    while (true) {
      delay(1000);
    }
  }
  addLog("ok",
         "LittleFS mounted. Total: " + String(LittleFS.totalBytes() / 1024) +
             " KB | Used: " + String(LittleFS.usedBytes() / 1024) + " KB");

  // ── 2. Load Config ───────────────────────────────────────
  addLog("info", "Memuat config.json...");
  {
    JsonDocument cfg;
    if (!loadConfig(cfg)) {
      addLog("warn", "Menggunakan konfigurasi default.");
    } else {
      addLog("ok", "config.json berhasil dimuat.");
    }
  }

  // ── 3. I2C Devices ───────────────────────────────────────
  initRTC();
  initADS1115();

  // ── 3.1 Modbus Serial ─────────────────────────────────────
  initModbusSerial();

  // ── 4. MicroSD ───────────────────────────────────────────
  initSD();

  // ── 4.1 Store & Forward Init ─────────────────────────────
  fs::FS &fs = sdMounted ? (fs::FS &)SD : (fs::FS &)LittleFS;
  if (fs.exists(SF_OFFSET_FILE)) {
    File f = fs.open(SF_OFFSET_FILE, FILE_READ);
    if (f) {
      String offsetStr = f.readStringUntil('\n');
      sfReadOffset = offsetStr.toInt();
      f.close();
    }
  }
  if (fs.exists(SF_QUEUE_FILE)) {
    File f = fs.open(SF_QUEUE_FILE, FILE_READ);
    if (f) {
      size_t fSize = f.size();
      if (fSize > sfReadOffset) {
        sfBufferCount = fSize - sfReadOffset;
      } else {
        // Offset >= size, clean up
        f.close();
        fs.remove(SF_QUEUE_FILE);
        fs.remove(SF_OFFSET_FILE);
        sfReadOffset = 0;
        sfBufferCount = 0;
      }
      if (f)
        f.close();
    }
  }

  // ── 5. WiFi — Mode dari Config (AP / STA / APSTA) ────────
  {
    JsonDocument cfg;
    loadConfig(cfg);
    // Setup Network
    setupNetworkMode(cfg);

    xTaskCreate(ethernetProxyTask, "EthProxyTask", 8192, NULL, 1, NULL);
  }

  // ── 6. CORS Headers Global ───────────────────────────────
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods",
                                       "GET,POST,OPTIONS");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers",
                                       "Content-Type,X-Auth-Token");
  DefaultHeaders::Instance().addHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");

  // ── 7. API Routes ─────────────────────────────────────────
  setupAPIRoutes();

  // ── 8. Start Web Server (SEBELUM initSIM7600 agar HP tidak timeout) ──
  server.begin();
  addLog("ok", "Web server aktif di http://" + WiFi.softAPIP().toString());

  Serial.println("\n[OK] Web server aktif. Buka browser:");
  Serial.println("     http://" + WiFi.softAPIP().toString());
  Serial.println("     Login: admin / admin123\n");

  // ── 9. SIM7600CE LTE sudah diinisialisasi di setupNetworkMode() ──
}

// Helper function to deep merge JSON objects
void deepMergeJson(JsonObject dest, JsonObjectConst src) {
  for (JsonPairConst kvp : src) {
    if (kvp.value().is<JsonObject>()) {
      if (dest[kvp.key()].is<JsonObject>()) {
        deepMergeJson(dest[kvp.key()].as<JsonObject>(),
                      kvp.value().as<JsonObjectConst>());
      } else {
        dest[kvp.key()] = kvp.value();
      }
    } else {
      dest[kvp.key()] = kvp.value();
    }
  }
}

// ============================================================
//  MQTT CALLBACK (Remote Config)
// ============================================================
void mqttCallback(char *topic, byte *payload, unsigned int length) {
  Serial.print("[MQTT] Pesan tiba di topik: ");
  Serial.println(topic);

  String message;
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  Serial.println("[MQTT] Payload: " + message);

  if (String(topic).endsWith("/config/set") ||
      String(topic).endsWith("/config")) {
    JsonDocument newCfg;
    DeserializationError error = deserializeJson(newCfg, message);
    if (!error) {
      // Keamanan: Hapus node yang dilarang diubah via remote config (jaringan)
      newCfg.remove("wifi");
      newCfg.remove("modem");
      newCfg.remove("ethernet");

      if (newCfg.size() > 0) {
        Serial.println(
            "[MQTT] Remote config valid. Menggabungkan konfigurasi...");
        patchAndSave([&](JsonDocument &doc) {
          // Backward compatibility untuk struktur payload lama
          if (!newCfg["interval"].isNull())
            doc["timing"]["send_interval"] = newCfg["interval"];
          if (!newCfg["mqtt_broker"].isNull())
            doc["mqtt"]["broker"] = newCfg["mqtt_broker"];
          if (!newCfg["mqtt_port"].isNull())
            doc["mqtt"]["port"] = newCfg["mqtt_port"];

          newCfg.remove("interval");
          newCfg.remove("mqtt_broker");
          newCfg.remove("mqtt_port");

          // Lakukan penggabungan mendalam (Deep Merge) untuk sisa JSON
          JsonObject destObj = doc.as<JsonObject>();
          JsonObjectConst srcObj = newCfg.as<JsonObject>();
          deepMergeJson(destObj, srcObj);
        });
        addLog("info", "Remote Config diterima via MQTT. Merestart...");
        shouldRestart = true;
        restartTime = millis();
      } else {
        Serial.println(
            "[MQTT] Remote config diabaikan (kosong atau akses terlarang).");
      }
    } else {
      Serial.println("[MQTT] Gagal parsing JSON Remote Config!");
    }
  } else if (String(topic).endsWith("/config/get")) {
    Serial.println("[MQTT] Permintaan Backup Config diterima.");
    String baseTopic = String(topic).substring(
        0, String(topic).length() - 11); // hapus "/config/get"
    String stateTopic = baseTopic + "/config/state";

    File f = LittleFS.open(CONFIG_PATH, "r");
    if (f) {
      String fullConfig = f.readString();
      f.close();

      // Publish menggunakan buffer yang lebih besar (diset 4096)
      bool pubSuccess =
          mqttClient.publish(stateTopic.c_str(), fullConfig.c_str(), false);
      if (pubSuccess) {
        Serial.println("[MQTT] Backup Config berhasil dikirim ke " +
                       stateTopic);
      } else {
        Serial.println("[MQTT] GAGAL mengirim Backup Config! Payload mungkin "
                       "terlalu besar. Ukuran: " +
                       String(fullConfig.length()));
      }
    }
  } else if (String(topic).endsWith("/command")) {
    JsonDocument cmdDoc;
    if (!deserializeJson(cmdDoc, message)) {
      String action = cmdDoc["action"].as<String>();
      if (action == "reboot") {
        Serial.println("[MQTT] Perintah Reboot jarak jauh diterima.");
        addLog("info", "Perintah Reboot dari Cloud diterima.");
        shouldRestart = true;
        restartTime = millis();
      } else if (action == "sync_time") {
        long ts = cmdDoc["timestamp"].as<long>();
        if (ts > 1700000000 && rtcOk) {
          rtc.adjust(DateTime(ts));
          Serial.println("[MQTT] RTC disinkronisasi dari Cloud.");
          addLog("ok", "RTC disinkronisasi otomatis dari Cloud.");
        }
      } else {
        // Assume it is a Telecontrol payload: e.g., {"modbus.Relay 1": 1}
        JsonObject cmdObj = cmdDoc.as<JsonObject>();
        JsonDocument cfg;
        loadConfig(cfg);

        if (!cfg["sensor"]["modbus"]["params"].isNull() || !cfg["sensor"]["telekontrol"]["params"].isNull()) {
          for (JsonPair kv : cmdObj) {
            String fullKey = String(kv.key().c_str());
            if (fullKey == "action")
              continue;
            int cmdVal = kv.value().as<int>();

            String searchKey = fullKey;
            if (searchKey.startsWith("modbus.")) {
              searchKey = searchKey.substring(7); // hapus "modbus."
            }

            auto searchInArray = [&](JsonArray params) -> bool {
              for (JsonObject p : params) {
                String pId = p["id"].as<String>();
                String pName = p["name"] | pId;
                String pType = p["type"].as<String>();

                if (pId == searchKey || pName == searchKey) {
                  ModbusWriteCmd writeCmd;
                  writeCmd.slaveId = p["slaveId"] | (p["slave_id"] | 1);

                  String regStr = "";
                  if (!p["register"].isNull()) regStr = p["register"].as<String>();
                  else if (!p["addr"].isNull()) regStr = p["addr"].as<String>();

                  if (regStr.startsWith("0x") || regStr.startsWith("0X")) {
                    writeCmd.reg = strtol(regStr.c_str(), NULL, 16);
                  } else {
                    writeCmd.reg = regStr.toInt();
                  }

                  writeCmd.value = cmdVal;

                  if (!p["writeFc"].isNull()) {
                    writeCmd.fc = p["writeFc"].as<String>().toInt();
                  } else {
                    writeCmd.fc = (pType == "coil" || pType == "DO") ? 5 : 6;
                  }

                  if (modbusQueueMutex) xSemaphoreTake(modbusQueueMutex, portMAX_DELAY);
                  modbusWriteQueue.push_back(writeCmd);
                  if (modbusQueueMutex) xSemaphoreGive(modbusQueueMutex);

                  Serial.printf("[MQTT] Queue Telecontrol Modbus -> ID: %s, Val: %d\n", searchKey.c_str(), cmdVal);
                  addLog("ok", "Telecontrol Cloud: " + searchKey + " -> " + String(cmdVal));
                  return true;
                }
              }
              return false;
            };

            bool found = false;
            if (!cfg["sensor"]["modbus"]["params"].isNull()) {
              found = searchInArray(cfg["sensor"]["modbus"]["params"].as<JsonArray>());
            }
            if (!found && !cfg["sensor"]["telekontrol"]["params"].isNull()) {
              searchInArray(cfg["sensor"]["telekontrol"]["params"].as<JsonArray>());
            }
          }
        }
      }
    }
  }
}

// ============================================================
//  MQTT RECONNECT
// ============================================================
boolean reconnectMQTT() {
  JsonDocument cfg;
  loadConfig(cfg);

  bool isCloudEnabled = cfg["cloud"]["enabled"] | true;
  bool isMqttEnabled = cfg["mqtt"]["enabled"] | false;

  // Hanya connect jika salah satu aktif
  if (!isCloudEnabled && !isMqttEnabled)
    return false;
  if (mqttClient.connected())
    return true;

  String broker;
  int port;
  String uniqueClientId;
  String user;
  String pass;
  String telemetryTopic;
  String statusTopic;
  String configTopic;

  if (isCloudEnabled) {
    // ----------------------------------------------------
    // JALUR 1: MANAJEMEN CLOUD MOLINAR
    // ----------------------------------------------------
    broker = cfg["cloud"]["server"] | "";
    port = 1883; // default port
    if (broker == "")
      return false;

    String orgCode = cfg["cloud"]["client_code"] | "";
    if (orgCode.length() == 0 || orgCode == "null")
      orgCode = "MOLINAR";

    String deviceId = cfg["cloud"]["device_id"] | "";
    if (deviceId.length() == 0 || deviceId == "null") {
      String macAddr = WiFi.macAddress();
      macAddr.replace(":", "");
      deviceId = macAddr;
    }

    uniqueClientId = orgCode + "_" + deviceId;
    user = "";
    pass = "";

    // Multi-tenant topics
    telemetryTopic = "molinar/" + orgCode + "/" + deviceId + "/telemetry";
    statusTopic = "molinar/" + orgCode + "/" + deviceId + "/status";
    configTopic = "molinar/" + orgCode + "/" + deviceId + "/config";
  } else {
    // ----------------------------------------------------
    // JALUR 2: CUSTOM MQTT BROKER
    // ----------------------------------------------------
    broker = cfg["mqtt"]["broker"] | "";
    port = cfg["mqtt"]["port"] | 1883;
    if (broker == "")
      return false;

    uniqueClientId = cfg["mqtt"]["client_id"] | "";
    if (uniqueClientId.length() == 0 || uniqueClientId == "null")
      uniqueClientId = "molinar_esp32_01";

    user = cfg["mqtt"]["username"] | "";
    pass = cfg["mqtt"]["password"] | "";

    // Custom topics
    telemetryTopic = cfg["mqtt"]["topic"] | "";
    if (telemetryTopic.length() == 0 || telemetryTopic == "null")
      telemetryTopic = "molinar/sensor/data";

    statusTopic = telemetryTopic + "/status";
    configTopic = telemetryTopic; // Base topic untuk custom
  }

  mqttClient.setServer(broker.c_str(), port);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setClient(*netClient);
  mqttClient.setKeepAlive(60);
  mqttClient.setBufferSize(10240);

  Serial.print("[MQTT] Menghubungkan ke broker: ");
  Serial.print(broker);

  bool connected = false;
  if (user.length() > 0) {
    connected =
        mqttClient.connect(uniqueClientId.c_str(), user.c_str(), pass.c_str());
  } else {
    connected = mqttClient.connect(uniqueClientId.c_str());
  }

  if (connected) {
    Serial.println(" ... Terhubung!");
    addLog("info", "Terhubung ke MQTT Broker: " + broker);

    mqttClient.publish(statusTopic.c_str(), "ONLINE", true);

    // Subscribe ke rute-rute konfigurasi dan perintah
    if (isCloudEnabled) {
      String baseTopic =
          configTopic.substring(0, configTopic.length() - 7); // hapus "/config"
      mqttClient.subscribe((baseTopic + "/config/set").c_str());
      mqttClient.subscribe((baseTopic + "/config/get").c_str());
      mqttClient.subscribe((baseTopic + "/command").c_str());
      Serial.println("[MQTT] Subscribed to Remote Management: " + baseTopic +
                     "/...");
    } else {
      mqttClient.subscribe((configTopic + "/config/set").c_str());
      mqttClient.subscribe((configTopic + "/config/get").c_str());
      mqttClient.subscribe((configTopic + "/command").c_str());
    }
  } else {
    Serial.print(" ... Gagal, rc=");
    Serial.println(mqttClient.state());
  }
  return connected;
}

// ============================================================
//  LOOP
// ============================================================
String cachedLiveDataStr = "{}";

void loop() {
  static unsigned long lastSessionClean = 0;
  static unsigned long lastLogFlush = 0;
  static unsigned long lastLiveDataUpdate = 0;

  // Update Live Data Cache setiap 2 detik untuk UI (/api/live-data)
  // Menghindari pembacaan I2C di async_tcp yang menyebabkan DEADLOCK WDT
  if (millis() - lastLiveDataUpdate > 2000UL) {
    lastLiveDataUpdate = millis();
    JsonDocument liveDoc;
    collectCurrentSensorData(liveDoc);
    String out;
    serializeJson(liveDoc, out);
    cachedLiveDataStr = out;
  }

  // ── Local Automation Engine (LAE) — evaluasi setiap 1 detik ──
  static unsigned long lastAutomationCheck = 0;
  if (millis() - lastAutomationCheck > 1000UL) {
    lastAutomationCheck = millis();

    JsonDocument cfg;
    if (loadConfig(cfg) && !cfg["automation"]["rules"].isNull() &&
        cfg["automation"]["enabled"].as<bool>()) {
      JsonArray rules = cfg["automation"]["rules"].as<JsonArray>();
      bool cfgDirty = false;

      for (JsonObject rule : rules) {
        if (!rule["enabled"].as<bool>())
          continue;

        String ruleId = rule["id"].as<String>();

        // Periksa cooldown
        unsigned long lastFired = ruleLastFired[ruleId];
        unsigned long cooldown = rule["cooldown_ms"].as<unsigned long>();
        if (cooldown > 0 && millis() - lastFired < cooldown)
          continue;

        String ruleType = rule["type"] | "sensor";
        bool allMet = false;

        // ── Tipe 1: Kondisi Sensor ──
        if (ruleType == "sensor") {
          allMet = true;
          JsonArray conditions = rule["conditions"].as<JsonArray>();
          if (conditions.isNull() || conditions.size() == 0) {
            allMet = false;
          }

          for (JsonObject cond : conditions) {
            String source = cond["source"].as<String>();
            String sensorId = cond["sensor_id"].as<String>();
            String op = cond["operator"].as<String>();
            float threshold = cond["value"].as<float>();

            String rawVal = "-";
            if (source == "modbus" || source == "telekontrol") {
              if (modbusLiveCache.count(sensorId))
                rawVal = modbusLiveCache[sensorId];
            } else {
              // kf350_analog, kf350_420, kf350_adc, kf350_io
              if (kf350LiveCache.count(sensorId))
                rawVal = kf350LiveCache[sensorId];
            }

            if (rawVal == "-" || rawVal == "NaN" || rawVal.startsWith("Err") ||
                rawVal == "Disabled") {
              allMet = false;
              break;
            }

            float currentVal = 0.0;
            if (rawVal == "ON")
              currentVal = 1.0;
            else if (rawVal == "OFF")
              currentVal = 0.0;
            else
              currentVal = rawVal.toFloat();

            bool condMet = false;
            if (op == ">")
              condMet = currentVal > threshold;
            else if (op == "<")
              condMet = currentVal < threshold;
            else if (op == ">=")
              condMet = currentVal >= threshold;
            else if (op == "<=")
              condMet = currentVal <= threshold;
            else if (op == "==")
              condMet = fabsf(currentVal - threshold) < 0.001f;
            else if (op == "!=")
              condMet = fabsf(currentVal - threshold) >= 0.001f;

            if (!condMet) {
              allMet = false;
              break;
            }
          }
        }

        // ── Tipe 2: Timer & Jadwal ──
        else if (ruleType == "schedule" && rtcOk) {
          DateTime now = DateTime(rtc.now().unixtime() + systemTimezone * 3600);
          int nowHour = now.hour();
          int nowMin = now.minute();
          int nowDow = now.dayOfTheWeek(); // 0=Minggu, 1=Senin, ... 6=Sabtu

          int schedHour = rule["schedule"]["hour"] | -1;
          int schedMin = rule["schedule"]["minute"] | -1;

          if (schedHour >= 0 && schedHour == nowHour && schedMin == nowMin) {
            JsonArray days = rule["schedule"]["days_of_week"].as<JsonArray>();
            if (days.isNull() || days.size() == 0) {
              allMet = true; // Kosong = setiap hari
            } else {
              for (JsonVariant d : days) {
                if (d.as<int>() == nowDow) {
                  allMet = true;
                  break;
                }
              }
            }
          }
        }

        // ── Eksekusi Aksi ──
        if (allMet) {
          JsonObject action = rule["action"].as<JsonObject>();
          String ruleName = rule["name"] | "Tanpa Nama";

          if (action["type"].as<String>() == "modbus_relay") {
            ModbusWriteCmd cmd;
            cmd.slaveId = action["slave_id"].as<uint8_t>();
            cmd.fc = action["fc"].as<uint8_t>();
            cmd.reg = action["register"].as<uint16_t>();
            cmd.value = action["command"].as<uint16_t>();
            
            if (modbusQueueMutex) xSemaphoreTake(modbusQueueMutex, portMAX_DELAY);
            modbusWriteQueue.push_back(cmd);
            if (modbusQueueMutex) xSemaphoreGive(modbusQueueMutex);
            
            addLog("ok", "[Otomasi] '" + ruleName + "' → Relay " +
                             String(cmd.reg) + " = " +
                             (cmd.value == 65280 ? "ON" : "OFF"));
          }

          ruleLastFired[ruleId] = millis();
        }
      }
    }
  }

  // ── Factory Reset (Tahan Tombol BOOT 10 Detik) ──
  static unsigned long bootButtonPressTime = 0;
  static bool bootButtonPressed = false;
  if (digitalRead(PIN_BOOT_BUTTON) == LOW) {
    if (!bootButtonPressed) {
      bootButtonPressed = true;
      bootButtonPressTime = millis();
    } else {
      if (millis() - bootButtonPressTime > 10000UL) {
        Serial.println("FACTORY RESET TERDETEKSI! Menghapus konfigurasi...");
        addLog("warn", "FACTORY RESET TERDETEKSI! Menghapus konfigurasi...");
        LittleFS.remove(CONFIG_PATH);
        shouldRestart = true;
        restartTime = millis();
      }
    }
  } else {
    bootButtonPressed = false;
  }

  // ── MQTT Loop & Reconnect ──
  // Cache status koneksi agar tidak memblokir async_tcp di /api/status
  isMqttConnected = mqttClient.connected();

  if (!isMqttConnected) {
    unsigned long now = millis();
    if (now - lastMqttReconnectAttempt > 10000UL) {
      lastMqttReconnectAttempt = now;
      reconnectMQTT();
    }
  } else {
    mqttClient.loop();
  }

  // ── Network Auto-Failover Monitor ──
  static unsigned long lastFailoverCheck = 0;

  if (millis() - lastFailoverCheck > 15000UL) {
    lastFailoverCheck = millis();

    JsonDocument netCfg;
    loadConfig(netCfg);
    String mode = netCfg["network"]["main_mode"] | "lte";

    if (mode == "lte") {
      // Periksa apakah GPRS mati
      if (lteConnected && !modem.isGprsConnected()) {
        lteConnected = false;
        cachedLteOperator = "Terputus";
        cachedLteIp = "";
        cachedLteSignal = 0;
        addLog("warn", "Koneksi LTE terputus!");
      }

      if (!lteConnected) {
        // 1. Jalankan mode backup jika WiFi tersedia
        if (WiFi.status() == WL_CONNECTED) {
          if (activeNetworkMode != "wifi-backup") {
            activeNetworkMode = "wifi-backup";
            netClient = &wifiClient;
            addLog("info", "Failover diaktifkan: Menggunakan jalur Wi-Fi.");
          }
        } else {
          // Tidak ada koneksi cadangan
          if (activeNetworkMode == "wifi-backup") {
            activeNetworkMode = "";
            netClient = &gsmClient; // Kembalikan default
          }
        }

        // 2. Coba konek ulang LTE di background secara berkala
        static unsigned long lastLteReconnect = 0;
        if (millis() - lastLteReconnect > 60000UL) {
          lastLteReconnect = millis();
          addLog("info", "Mencoba reconnect LTE...");

          // Pastikan hardware modem tidak stuck / mati akibat power drop
          bool isResponding = false;
          for (int i = 0; i < 3; i++) {
            if (modem.testAT(1000)) {
              isResponding = true;
              break;
            }
          }
          if (!isResponding) {
            addLog("warn", "Modem offline. Memulai ulang Power-On Sequence...");
            pinMode(21, OUTPUT);
            digitalWrite(21, HIGH);
            delay(500);
            digitalWrite(21, LOW);
            delay(2000);
            digitalWrite(21, HIGH);
            delay(3000);
            modem.init();
          }

          if (modem.isNetworkConnected() || modem.waitForNetwork(10000)) {
            String apn = netCfg["network"]["lte_apn"] | "internet";
            String user = netCfg["network"]["lte_user"] | "";
            String pass = netCfg["network"]["lte_pass"] | "";
            if (modem.gprsConnect(apn.c_str(), user.c_str(), pass.c_str())) {
              lteConnected = true;
              cachedLteOperator = modem.getOperator();
              cachedLteIp = modem.localIP().toString();
              int csq = modem.getSignalQuality();
              cachedLteSignal = (csq == 99 || csq == 0) ? 0 : -113 + (csq * 2);
              activeNetworkMode = "lte";
              netClient = &gsmClient;
              addLog("ok", "LTE kembali terhubung. Failover dibatalkan.");
            }
          }
        }
      }
      // Jika LTE kembali hidup (atau sudah hidup), pastikan tetap jadi jalur
      // utama
      else if (lteConnected && activeNetworkMode != "lte") {
        activeNetworkMode = "lte";
        netClient = &gsmClient;
      }
    } else if (mode == "eth") {
      // Periksa koneksi fisik W5500
      bool ethIsUp = (Ethernet.linkStatus() == LinkON);
      if (!ethIsUp && WiFi.status() == WL_CONNECTED) {
        if (activeNetworkMode != "wifi-backup") {
          activeNetworkMode = "wifi-backup";
          netClient = &wifiClient;
          addLog("info", "Kabel LAN terputus. Failover ke Wi-Fi diaktifkan.");
        }
      } else if (ethIsUp && activeNetworkMode != "eth") {
        activeNetworkMode = "eth";
        netClient = &ethClient;
        addLog("ok", "Kabel LAN tersambung. Failover dibatalkan.");
      }
    }
  }

  // Update sinyal LTE setiap 30 detik secara aman agar tidak block AsyncWeb
  if (lteConnected && millis() - lastLteCheck > 30000UL) {
    lastLteCheck = millis();
    int csq = modem.getSignalQuality();
    if (csq != 99 && csq != 0) {
      cachedLteSignal = -113 + (csq * 2);
    }
  }

  // Bersihkan session yang expired setiap 5 menit
  if (millis() - lastSessionClean > 300000UL) {
    cleanExpiredSessions();
    lastSessionClean = millis();
  }

  // Flush log buffer ke MicroSD setiap 10 menit
  if (sdMounted && millis() - lastLogFlush > 600000UL) {
    if (rtcOk) {
      DateTime now = rtc.now();
      char filename[32];
      snprintf(filename, sizeof(filename), "%s%04d%02d%02d.log",
               LOG_PATH_PREFIX, now.year(), now.month(), now.day());
      File logFile = SD.open(filename, FILE_APPEND);
      if (logFile) {
        int start = (logCount < LOG_BUFFER_SIZE) ? 0 : logHead;
        for (int i = 0; i < logCount; i++) {
          LogEntry &e = logBuffer[(start + i) % LOG_BUFFER_SIZE];
          logFile.println(e.timestamp + " [" + e.level + "] " + e.message);
        }
        logFile.close();
      }
    }
    lastLogFlush = millis();
  }

  // ── Async Ping ──
  if (pingRequested && !pingDone) {
    pingSuccess = false;
    pingTime = 0;

    // MENCEGAH DEADLOCK: lwIP (ESP32Ping) akan hang/crash permanen jika
    // menge-ping IP diri sendiri.
    if (pingHost == "127.0.0.1" || pingHost == WiFi.softAPIP().toString() ||
        pingHost == WiFi.localIP().toString() ||
        (Ethernet.linkStatus() == LinkON &&
         pingHost == Ethernet.localIP().toString()) ||
        pingHost == "localhost") {
      pingSuccess = true;
      pingTime = 1;
      pingDone = true;
      return;
    }

    JsonDocument netCfg;
    loadConfig(netCfg);
    String mode = netCfg["network"]["main_mode"] | "lte";

    // Coba ICMP Ping (Hanya bekerja baik pada WiFi/lwIP interface)
    if ((activeNetworkMode == "wifi" || activeNetworkMode == "wifi-backup" ||
         activeNetworkMode == "eth") &&
        Ping.ping(pingHost.c_str(), 1)) {
      pingSuccess = true;
      pingTime = Ping.averageTime();
    } else {
      // Fallback ke TCP Connect (Port 53 atau 80) jika ICMP diblokir atau beda
      // interface
      Client *pingClient = nullptr;
      if (activeNetworkMode == "eth")
        pingClient = new EthernetClient();
      else if (activeNetworkMode == "lte")
        pingClient = new TinyGsmClient(modem, 1);
      else
        pingClient = new WiFiClient();

      if (pingClient) {
        unsigned long start = millis();
        // Set timeout pendek agar tidak memblokir loop() terlalu lama
        pingClient->setTimeout(3);
        if (pingClient->connect(pingHost.c_str(), 53) ||
            pingClient->connect(pingHost.c_str(), 80)) {
          pingSuccess = true;
          pingTime = millis() - start;
          pingClient->stop();
        }
        delete pingClient;
      }
    }
    pingDone = true;
  }

  // ── SIKLUS STORE & FORWARD (SIMULASI) ──
  static unsigned long lastConfigCheck = 0;
  static int readInterval = 5000;
  static int sendInterval = 10000;
  static int maxSfSize = 1000;
  static String loggerName = "";

  if (millis() - lastConfigCheck > 10000 || lastConfigCheck == 0) {
    JsonDocument cfg;
    loadConfig(cfg);
    readInterval = cfg["timing"]["read_interval"] | 5000;
    sendInterval = cfg["timing"]["send_interval"] | 10000;
    maxSfSize = cfg["store_forward"]["max_size"] | 1000;
    if (!cfg["led"]["enabled"].isNull()) {
      ledEnabled = cfg["led"]["enabled"];
    } else {
      ledEnabled = true;
    }
    cloudEnabled = cfg["cloud"]["enabled"] | true;
    loggerName = cfg["system"]["name"] | "";
    if (!cfg["system"]["timezone"].isNull()) {
      systemTimezone = cfg["system"]["timezone"].as<int>();
    }
    lastConfigCheck = millis();
  }

  // Handle TCP Proxy
  if (activeNetworkMode == "eth") {
    // Proxy runs in ethernetProxyTask
  }

  // Handle pending config save asynchronously
  if (pendingConfigSave) {
    pendingConfigSave = false;
    JsonDocument cfgToSave;
    if (loadConfig(cfgToSave)) {
      saveConfig(cfgToSave);
      Serial.println("[SYSTEM] Konfigurasi disimpan ke LittleFS di main loop.");
    }
  }

  // Handle Network updates asynchronously
  if (shouldUpdateNetwork) {
    shouldUpdateNetwork = false;
    delay(1000); // Allow HTTP response to finish sending
    JsonDocument netCfg;
    loadConfig(netCfg);
    addLog("info", "Memuat ulang konfigurasi Jaringan (Network)...");
    setupNetworkMode(netCfg);
  }

  // Handle safe restart
  if (shouldRestart && (millis() - restartTime > 2000)) {
    Serial.println("[SYSTEM] Safe Restart dipicu...");
    ESP.restart();
  }

  static unsigned long lastRead = 0;
  static unsigned long lastSend = 0;

  // ── MODBUS RS485 POLLING ──
  static unsigned long lastModbusPoll = 0;
  if (millis() - lastModbusPoll > 2000) { // Evaluasi parameter tiap 2 detik
    lastModbusPoll = millis();
    JsonDocument cfg;
    loadConfig(cfg);
    bool rs485Enabled = true;
    if (!cfg["pins"]["kf301"]["rs485"].isNull()) {
      rs485Enabled = cfg["pins"]["kf301"]["rs485"].as<bool>();
    }

    // ─────────────────────────────────────────────────────────

    if (rs485Enabled) {
      if (modbusQueueMutex) xSemaphoreTake(modbusQueueMutex, portMAX_DELAY);
      bool hasCmds = !modbusWriteQueue.empty();
      std::vector<ModbusWriteCmd> tempQueue;
      if (hasCmds) {
        tempQueue = modbusWriteQueue; // Copy queue
        modbusWriteQueue.clear();
      }
      if (modbusQueueMutex) xSemaphoreGive(modbusQueueMutex);

      if (hasCmds) {
        for (size_t i = 0; i < tempQueue.size(); i++) {
          ModbusWriteCmd cmd = tempQueue[i];
          node.begin(cmd.slaveId, Serial2);
          uint8_t res;
          if (cmd.fc == 1) cmd.fc = 5; // Fallback jika UI salah mengirim FC Read sebagai Write
          if (cmd.fc == 2 || cmd.fc == 3 || cmd.fc == 4) cmd.fc = 6;
          
          if (cmd.fc == 5) {
            uint8_t state = (cmd.value > 0) ? 1 : 0;
            res = node.writeSingleCoil(cmd.reg, state);
          } else if (cmd.fc == 6) {
            res = node.writeSingleRegister(cmd.reg, cmd.value);
          }
          if (res == node.ku8MBSuccess) {
            addLog("ok", "Modbus tulis SUKSES. Reg: " + String(cmd.reg) + " Val: " + String(cmd.value));
            
            // Cari ID parameter yang sesuai dan update modbusLiveCache optimistically
            if (!cfg["sensor"]["telekontrol"]["params"].isNull()) {
              JsonArray tkParams = cfg["sensor"]["telekontrol"]["params"].as<JsonArray>();
              for (JsonObject p : tkParams) {
                uint16_t pReg = 0;
                String rStr = p["register"].as<String>();
                if (rStr.startsWith("0x") || rStr.startsWith("0X")) pReg = strtol(rStr.c_str(), NULL, 16);
                else pReg = rStr.toInt();

                if (p["slaveId"].as<uint8_t>() == cmd.slaveId && pReg == cmd.reg) {
                  String id = p["id"].as<String>();
                  if (cmd.fc == 5) {
                    modbusLiveCache[id] = (cmd.value > 0) ? "1.00" : "0.00";
                  } else {
                    modbusLiveCache[id] = String(cmd.value);
                  }
                  break;
                }
              }
            }
          } else {
            addLog("error", "Gagal Telekontrol (FC:" + String(cmd.fc) + " Reg:" + String(cmd.reg) + ") Err:" + String(res));
          }
          delay(50);
        }
        forceMqttRead = true;
        forceMqttSend = true;
      }
      
      auto processModbusParams = [&](JsonArray params) {
        static std::map<String, unsigned long> lastPollTimeMap;

        for (JsonObject p : params) {
          String id = p["id"].as<String>();
          int pollingInterval = p["polling"].as<int>();
          if (pollingInterval < 1000)
            pollingInterval = 1000;

          if (millis() - lastPollTimeMap[id] >=
                  (unsigned long)pollingInterval ||
              lastPollTimeMap[id] == 0 || forceMqttRead) {
            lastPollTimeMap[id] = millis();

            uint8_t slaveId = p["slaveId"].as<uint8_t>();
            uint8_t fc = p["fc"].as<String>().toInt();

            uint16_t reg = 0;
            String regStr = p["register"].as<String>();
            if (regStr.startsWith("0x") || regStr.startsWith("0X")) {
              reg = strtol(regStr.c_str(), NULL, 16);
            } else {
              reg = regStr.toInt();
            }

            String type = p["type"].as<String>();

            node.begin(slaveId, Serial2);
            uint8_t result;
            uint16_t length =
                (type == "Float32" || type == "Int32" || type == "UInt32") ? 2
                                                                           : 1;

            if (fc == 1 || fc == 5) { // FC 5 (Write Coil) dibaca sebagai FC 1
              result = node.readCoils(reg, 1);
            } else if (fc == 2) {
              result = node.readDiscreteInputs(reg, 1);
            } else if (fc == 3 ||
                       fc ==
                           6) { // FC 6 (Write Holding Reg) dibaca sebagai FC 3
              result = node.readHoldingRegisters(reg, length);
            } else {
              result = node.readInputRegisters(reg, length);
            }

            if (result == node.ku8MBSuccess) {
              float val = 0.0;
              if (fc == 1 || fc == 2 || fc == 5) {
                val = bitRead(node.getResponseBuffer(0), 0);
              } else if (type == "Int16") {
                val = (int16_t)node.getResponseBuffer(0);
              } else if (type == "UInt16") {
                val = node.getResponseBuffer(0);
              } else if (type == "Float32") {
                uint32_t raw = (node.getResponseBuffer(0) << 16) |
                               node.getResponseBuffer(1);
                memcpy(&val, &raw, sizeof(val));
              }
              modbusLiveCache[id] = String(val, 2);
            } else {
              modbusLiveCache[id] = "NaN";
            }
          }
        }
      };

      if (!cfg["sensor"]["modbus"]["params"].isNull()) {
        processModbusParams(cfg["sensor"]["modbus"]["params"].as<JsonArray>());
      }
      if (!cfg["sensor"]["telekontrol"]["params"].isNull()) {
        processModbusParams(
            cfg["sensor"]["telekontrol"]["params"].as<JsonArray>());
      }
      forceMqttRead = false;
    } else if (!rs485Enabled && !cfg["sensor"]["modbus"]["params"].isNull()) {
      // Jika Modbus dinonaktifkan secara hardware/port
      JsonArray params = cfg["sensor"]["modbus"]["params"].as<JsonArray>();
      for (JsonObject p : params) {
        String id = p["id"].as<String>();
        modbusLiveCache[id] = "Disabled";
      }
    }
  }

  // isSimulatedOnline = (millis() / 60000) % 2 == 0;

  // Update indikator LED
  static unsigned long lastLedUpdate = 0;
  if (millis() - lastLedUpdate > 1000) {
    updateLED();
    lastLedUpdate = millis();
  }

  // 1. Baca Sensor (Read Interval) & Datalogger ke SD Card
  if (millis() - lastRead > (unsigned long)readInterval || forceMqttSend) {
    JsonDocument sensorDoc;

    // Ambil data real-time (helper yang juga dipakai oleh /api/live-data)
    collectCurrentSensorData(sensorDoc);

    // Tambahkan metadata
    sensorDoc["logger_name"] = loggerName;
    sensorDoc["timestamp"] = rtcOk ? rtc.now().unixtime() : millis();

    // Buat format waktu (HH:MM) untuk labels chart
    if (rtcOk) {
      DateTime localTime =
          DateTime(rtc.now().unixtime() + systemTimezone * 3600);
      char timeStr[6];
      snprintf(timeStr, sizeof(timeStr), "%02d:%02d", localTime.hour(),
               localTime.minute());
      sensorDoc["time"] = String(timeStr);
    } else {
      sensorDoc["time"] = "00:00";
    }

    // --- TAMBAHKAN HEALTH DATA ---
    JsonObject health = sensorDoc["health"].to<JsonObject>();

    // Uptime formatting
    unsigned long up = millis() / 1000;
    char upStr[16];
    snprintf(upStr, sizeof(upStr), "%02lu:%02lu:%02lu", up / 3600,
             (up / 60) % 60, up % 60);
    health["uptime"] = String(upStr);

    // RAM (PSRAM fallback ke Heap)
    if (ESP.getPsramSize() > 0) {
      health["ram_used_kb"] = (ESP.getPsramSize() - ESP.getFreePsram()) / 1024;
      health["ram_total_kb"] = ESP.getPsramSize() / 1024;
    } else {
      health["ram_used_kb"] = (ESP.getHeapSize() - ESP.getFreeHeap()) / 1024;
      health["ram_total_kb"] = ESP.getHeapSize() / 1024;
    }

    health["flash_used_kb"] = LittleFS.usedBytes() / 1024;
    health["flash_total_kb"] = LittleFS.totalBytes() / 1024;
    health["buffer_count"] = sfBufferCount;
    health["buffer_max"] = -1;                 // -1 means unlimited
    health["cpu_load_percent"] = random(1, 5); // Dummy idle load
    health["cpu_temp_c"] = temperatureRead();

    // Network RSSI & Status
    health["wifi_rssi"] = WiFi.RSSI();
    health["wifi_ssid"] = WiFi.SSID();
    health["wifi_ip"] = WiFi.localIP().toString();

    health["lte_rssi"] = lteConnected ? cachedLteSignal : -113;
    health["lte_provider"] = lteConnected ? cachedLteOperator : "-";
    health["lte_ip"] = lteConnected ? cachedLteIp : "-";

    health["eth_status"] =
        (Ethernet.linkStatus() == LinkON) ? "CONNECTED" : "DISCONNECTED";
    health["eth_ip"] =
        (Ethernet.linkStatus() == LinkON) ? Ethernet.localIP().toString() : "-";

    // SD Card
    health["sd_status"] = sdMounted ? "OK" : "ERROR";
    if (sdMounted) {
      health["sd_used_mb"] = SD.usedBytes() / (1024 * 1024);
      health["sd_total_mb"] = SD.totalBytes() / (1024 * 1024);
    }
    // ----------------------------

    String payload;
    serializeJson(sensorDoc, payload);

    // ── Simpan ke SD Card (Datalogger JSONL) ──
    if (sdMounted && rtcOk) {
      DateTime now = rtc.now();
      char filename[32];
      snprintf(filename, sizeof(filename), "/data/%04d%02d%02d.jsonl",
               now.year(), now.month(), now.day());

      // Buat folder / data/ jika belum ada
      if (!SD.exists("/data")) {
        SD.mkdir("/data");
      }

      File dataFile = SD.open(filename, FILE_APPEND);
      if (dataFile) {
        dataFile.println(payload);
        dataFile.close();
      }
    }

    // Ambil konfigurasi MQTT untuk publish realtime
    JsonDocument cfg;
    loadConfig(cfg);
    bool isCloudEnabled = cfg["cloud"]["enabled"].as<bool>();
    String topic;

    if (isCloudEnabled) {
      String deviceId = cfg["cloud"]["device_id"] | "";
      if (deviceId.length() == 0 || deviceId == "null") {
        String macAddr = WiFi.macAddress();
        macAddr.replace(":", "");
        deviceId = macAddr;
      }
      String orgCode = cfg["cloud"]["client_code"] | "";
      if (orgCode.length() == 0 || orgCode == "null")
        orgCode = "MOLINAR";
      topic = "molinar/" + orgCode + "/" + deviceId + "/telemetry";
    } else {
      topic = cfg["mqtt"]["topic"] | "";
      if (topic.length() == 0 || topic == "null")
        topic = "molinar/sensor/data";
    }

    bool realtimeSent = false;
    if (mqttClient.connected()) {
      if (mqttClient.publish(topic.c_str(), payload.c_str())) {
        realtimeSent = true;
      }
    }

    // Jika gagal kirim realtime (offline atau error publish), antrekan ke Store
    // & Forward Queue
    if (!realtimeSent && (cfg["store_forward"]["enabled"] | true)) {
      fs::FS &fs = sdMounted ? (fs::FS &)SD : (fs::FS &)LittleFS;
      File sfFile = fs.open(SF_QUEUE_FILE, FILE_APPEND);
      if (sfFile) {
        sfFile.println(payload);
        sfFile.close();

        // Update sisa buffer
        File checkF = fs.open(SF_QUEUE_FILE, FILE_READ);
        if (checkF) {
          sfBufferCount = checkF.size() - sfReadOffset;
          checkF.close();
        }
      }
    }

    lastRead = millis();
  }

  // 2. Kirim Data Antrean (Send Interval)
  if (millis() - lastSend > (unsigned long)sendInterval || forceMqttSend) {
    if (mqttClient.connected() && sfBufferCount > 0) {
      // Ambil konfigurasi MQTT untuk publish
      JsonDocument cfg;
      loadConfig(cfg);

      bool isCloudEnabled = cfg["cloud"]["enabled"].as<bool>();
      String topic;

      if (isCloudEnabled) {
        String deviceId = cfg["cloud"]["device_id"] | "";
        if (deviceId.length() == 0 || deviceId == "null") {
          String macAddr = WiFi.macAddress();
          macAddr.replace(":", "");
          deviceId = macAddr;
        }
        String orgCode = cfg["cloud"]["client_code"] | "";
        if (orgCode.length() == 0 || orgCode == "null")
          orgCode = "MOLINAR";
        topic = "molinar/" + orgCode + "/" + deviceId + "/telemetry";
      } else {
        topic = cfg["mqtt"]["topic"] | "";
        if (topic.length() == 0 || topic == "null")
          topic = "molinar/sensor/data";
      }

      int batchSent = 0;
      int maxBatch = cfg["store_forward"]["batch_size"].as<int>();
      if (maxBatch <= 0)
        maxBatch = 5; // Fallback jika tidak diset

      fs::FS &fs = sdMounted ? (fs::FS &)SD : (fs::FS &)LittleFS;

      File sfFile = fs.open(SF_QUEUE_FILE, FILE_READ);
      if (sfFile) {
        sfFile.seek(sfReadOffset);

        while (sfFile.available() && batchSent < maxBatch) {
          String dataToSend = sfFile.readStringUntil('\n');
          dataToSend.trim();

          if (dataToSend.length() > 0) {
            if (mqttClient.publish(topic.c_str(), dataToSend.c_str())) {
              sfReadOffset = sfFile.position();
              batchSent++;
              mqttClient.loop();
              delay(10);
            } else {
              break; // Gagal publish, stop forward
            }
          } else {
            // Empty line, just skip
            sfReadOffset = sfFile.position();
          }
        }

        size_t finalSize = sfFile.size();
        sfFile.close();

        // Simpan offset baru
        if (fs.exists(SF_OFFSET_FILE)) {
          fs.remove(SF_OFFSET_FILE);
        }
        File offsetF = fs.open(SF_OFFSET_FILE, FILE_WRITE);
        if (offsetF) {
          offsetF.println(sfReadOffset);
          offsetF.close();
        }

        if (sfReadOffset >= finalSize) {
          // Bersihkan file jika semua sudah terkirim
          fs.remove(SF_QUEUE_FILE);
          fs.remove(SF_OFFSET_FILE);
          sfReadOffset = 0;
          sfBufferCount = 0;
        } else {
          sfBufferCount = finalSize - sfReadOffset;
        }
      }
    }
    lastSend = millis();
    forceMqttSend = false;
  }

  // (Proses DNS dihilangkan)

  // AsyncWebServer tidak butuh loop handler — semua event-driven
  delay(10);
}
