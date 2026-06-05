#if defined(ESP8266)
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecureBearSSL.h>
using SecureApiClient = BearSSL::WiFiClientSecure;
#elif defined(ESP32)
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
using SecureApiClient = WiFiClientSecure;
#else
#error "Plataforma nao suportada. Use ESP8266 ou ESP32."
#endif

#include <ArduinoJson.h>
#include "secrets.h"

static const char* FIRMWARE_VERSION = "testD1Mini-1.0.0";
static const unsigned long WIFI_RETRY_MS = 15000;
static const unsigned long HEARTBEAT_INTERVAL_MS = 30000;
static const unsigned long CONFIG_INTERVAL_MS = 60000;
static const unsigned long EVENT_INTERVAL_MS = 120000;
static const uint16_t HTTP_TIMEOUT_MS = 5000;
static const int MAX_SCHEDULES = 16;

struct ReceivedDeviceConfig {
  char deviceId[64];
  char name[32];
  char menuTitle[32];
  bool soundEnabled;
  bool localSoundEnabled;
  int utcOffsetMinutes;
  unsigned int pollIntervalSeconds;
  char lastSeenAt[32];
};

struct ReceivedSchedule {
  bool active;
  int id;
  char label[32];
  uint8_t hour;
  uint8_t minute;
  bool enabled;
  uint8_t dayCount;
  uint8_t days[7];
};

struct ReceivedOta {
  bool pending;
  int deploymentId;
  char version[32];
  char channel[24];
  char firmwareUrl[256];
  char sha256[65];
};

unsigned long lastWiFiAttemptAt = 0;
unsigned long lastHeartbeatAt = 0;
unsigned long lastConfigAt = 0;
unsigned long lastEventAt = 0;
ReceivedDeviceConfig receivedConfig = {"", "", "", false, false, -180, 60, ""};
ReceivedSchedule receivedSchedules[MAX_SCHEDULES];
ReceivedOta receivedOta = {false, 0, "", "", "", ""};
int receivedScheduleCount = 0;

bool beginApiRequest(HTTPClient& http, WiFiClient& plainClient, SecureApiClient& secureClient, const String& url);
bool configureSecureApiClient(SecureApiClient& secureClient);
bool connectWiFi(bool waitForConnection);
void copyJsonText(JsonVariant value, char* target, size_t targetSize, const char* fallback);
bool consumeApiPayload(const String& responseBody);
bool fetchHealth();
bool fetchConfig();
void printReceivedState();
bool postHeartbeat(const char* reason);
bool postTestEvent(const char* reason);
bool isSecureApiUrl(const String& url);
String buildHeartbeatPayload(const char* reason);
void clearReceivedOta();
void ensureWiFiConnected();
void resetReceivedSchedules();
void printJsonSummary(const String& responseBody);

void setup() {
  Serial.begin(115200);
  delay(400);

  Serial.println();
  Serial.println("=== testD1Mini ===");
  Serial.print("Device: ");
  Serial.println(DEVICE_ID);
  Serial.print("API: ");
  Serial.println(API_BASE_URL);

  connectWiFi(true);

  if (WiFi.status() == WL_CONNECTED) {
    fetchHealth();
    fetchConfig();
    postHeartbeat("boot");
    postTestEvent("boot_test");
  }
}

void loop() {
  ensureWiFiConnected();

  if (WiFi.status() != WL_CONNECTED) {
    delay(200);
    return;
  }

  const unsigned long now = millis();

  if (now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    postHeartbeat("interval");
  }

  if (now - lastConfigAt >= CONFIG_INTERVAL_MS) {
    fetchConfig();
  }

  if (now - lastEventAt >= EVENT_INTERVAL_MS) {
    postTestEvent("interval_test");
  }

  delay(200);
}

bool connectWiFi(bool waitForConnection) {
  Serial.print("Conectando no Wi-Fi: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWiFiAttemptAt = millis();

  if (!waitForConnection) {
    return false;
  }

  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < 15000) {
    delay(300);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi OK. IP: ");
    Serial.println(WiFi.localIP());
    return true;
  }

  Serial.println("Falha ao conectar no Wi-Fi.");
  return false;
}

void ensureWiFiConnected() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  if (millis() - lastWiFiAttemptAt < WIFI_RETRY_MS) {
    return;
  }

  Serial.println("Wi-Fi offline. Tentando reconectar...");
  connectWiFi(false);
}

bool fetchHealth() {
  WiFiClient plainClient;
  SecureApiClient secureClient;
  HTTPClient http;
  String url = String(API_BASE_URL) + "/health";

  if (!beginApiRequest(http, plainClient, secureClient, url)) {
    Serial.println("Nao foi possivel abrir /health.");
    return false;
  }

  http.setTimeout(HTTP_TIMEOUT_MS);
  int httpCode = http.GET();
  String responseBody = http.getString();
  http.end();

  Serial.print("[GET /health] HTTP ");
  Serial.println(httpCode);
  Serial.println(responseBody);
  return httpCode >= 200 && httpCode < 300;
}

bool fetchConfig() {
  WiFiClient plainClient;
  SecureApiClient secureClient;
  HTTPClient http;
  String url = String(API_BASE_URL) + "/api/devices/" + DEVICE_ID + "/config";

  if (!beginApiRequest(http, plainClient, secureClient, url)) {
    Serial.println("Nao foi possivel abrir /config.");
    return false;
  }

  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("X-DEVICE-KEY", DEVICE_API_KEY);

  int httpCode = http.GET();
  String responseBody = http.getString();
  http.end();
  lastConfigAt = millis();

  Serial.print("[GET /config] HTTP ");
  Serial.println(httpCode);
  if (consumeApiPayload(responseBody)) {
    printReceivedState();
  } else {
    printJsonSummary(responseBody);
  }
  return httpCode >= 200 && httpCode < 300;
}

bool postHeartbeat(const char* reason) {
  WiFiClient plainClient;
  SecureApiClient secureClient;
  HTTPClient http;
  String url = String(API_BASE_URL) + "/api/devices/" + DEVICE_ID + "/heartbeat";

  if (!beginApiRequest(http, plainClient, secureClient, url)) {
    Serial.println("Nao foi possivel abrir /heartbeat.");
    return false;
  }

  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-DEVICE-KEY", DEVICE_API_KEY);

  String payload = buildHeartbeatPayload(reason);
  int httpCode = http.POST(payload);
  String responseBody = http.getString();
  http.end();
  lastHeartbeatAt = millis();

  Serial.print("[POST /heartbeat] HTTP ");
  Serial.println(httpCode);
  Serial.println(payload);
  if (consumeApiPayload(responseBody)) {
    printReceivedState();
  } else {
    printJsonSummary(responseBody);
  }
  return httpCode >= 200 && httpCode < 300;
}

bool postTestEvent(const char* reason) {
  WiFiClient plainClient;
  SecureApiClient secureClient;
  HTTPClient http;
  String url = String(API_BASE_URL) + "/api/devices/" + DEVICE_ID + "/events";

  if (!beginApiRequest(http, plainClient, secureClient, url)) {
    Serial.println("Nao foi possivel abrir /events.");
    return false;
  }

  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-DEVICE-KEY", DEVICE_API_KEY);

  StaticJsonDocument<320> doc;
  doc["event_type"] = "api_test";
  doc["message"] = reason;
  JsonObject payload = doc.createNestedObject("payload");
  payload["firmware_version"] = FIRMWARE_VERSION;
  payload["wifi_rssi"] = WiFi.RSSI();

  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);
  String responseBody = http.getString();
  http.end();
  lastEventAt = millis();

  Serial.print("[POST /events] HTTP ");
  Serial.println(httpCode);
  Serial.println(body);
  Serial.println(responseBody);
  return httpCode >= 200 && httpCode < 300;
}

String buildHeartbeatPayload(const char* reason) {
  StaticJsonDocument<256> doc;
  doc["firmware_version"] = FIRMWARE_VERSION;
  doc["wifi_rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
  doc["ip_address"] = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "";
  doc["current_screen"] = "test";
  doc["current_menu"] = "api";
  doc["local_sound_enabled"] = true;
  doc["reason"] = reason;

  String payload;
  serializeJson(doc, payload);
  return payload;
}

bool consumeApiPayload(const String& responseBody) {
  if (responseBody.length() == 0) {
    return false;
  }

  DynamicJsonDocument doc(8192);
  DeserializationError error = deserializeJson(doc, responseBody);
  if (error) {
    return false;
  }

  JsonObject device = doc["device"].as<JsonObject>();
  if (!device.isNull()) {
    copyJsonText(device["device_id"], receivedConfig.deviceId, sizeof(receivedConfig.deviceId), DEVICE_ID);
    copyJsonText(device["name"], receivedConfig.name, sizeof(receivedConfig.name), DEVICE_ID);
    copyJsonText(device["menu_title"], receivedConfig.menuTitle, sizeof(receivedConfig.menuTitle), receivedConfig.name);
    receivedConfig.soundEnabled = device["sound_enabled"] | false;
    receivedConfig.localSoundEnabled = device["local_sound_enabled"] | false;
    receivedConfig.utcOffsetMinutes = device["utc_offset_minutes"] | -180;
    receivedConfig.pollIntervalSeconds = device["poll_interval_seconds"] | 60;
    copyJsonText(device["last_seen_at"], receivedConfig.lastSeenAt, sizeof(receivedConfig.lastSeenAt), "--");
  }

  resetReceivedSchedules();
  JsonArray schedules = doc["schedules"].as<JsonArray>();
  if (!schedules.isNull()) {
    for (JsonObject scheduleObject : schedules) {
      if (receivedScheduleCount >= MAX_SCHEDULES) {
        break;
      }

      ReceivedSchedule& schedule = receivedSchedules[receivedScheduleCount];
      schedule.active = true;
      schedule.id = scheduleObject["id"] | 0;
      copyJsonText(scheduleObject["label"], schedule.label, sizeof(schedule.label), "Horario");
      schedule.hour = scheduleObject["hour"] | 0;
      schedule.minute = scheduleObject["minute"] | 0;
      schedule.enabled = scheduleObject["enabled"] | false;
      schedule.dayCount = 0;

      JsonArray days = scheduleObject["days_of_week"].as<JsonArray>();
      if (!days.isNull()) {
        for (JsonVariant dayValue : days) {
          if (schedule.dayCount >= 7) {
            break;
          }
          schedule.days[schedule.dayCount++] = dayValue.as<uint8_t>();
        }
      }

      receivedScheduleCount++;
    }
  }

  JsonObject ota = doc["ota"].as<JsonObject>();
  if (!ota.isNull()) {
    receivedOta.pending = true;
    receivedOta.deploymentId = ota["deployment_id"] | 0;
    copyJsonText(ota["version"], receivedOta.version, sizeof(receivedOta.version), "");
    copyJsonText(ota["channel"], receivedOta.channel, sizeof(receivedOta.channel), "stable");
    copyJsonText(ota["firmware_url"], receivedOta.firmwareUrl, sizeof(receivedOta.firmwareUrl), "");
    copyJsonText(ota["sha256"], receivedOta.sha256, sizeof(receivedOta.sha256), "");
  } else {
    clearReceivedOta();
  }

  return true;
}

bool beginApiRequest(HTTPClient& http, WiFiClient& plainClient, SecureApiClient& secureClient, const String& url) {
  if (!isSecureApiUrl(url)) {
    return http.begin(plainClient, url);
  }

  if (!configureSecureApiClient(secureClient)) {
    Serial.println("TLS invalido. Verifique API_ROOT_CA.");
    return false;
  }

  return http.begin(secureClient, url);
}

bool isSecureApiUrl(const String& url) {
  return url.startsWith("https://");
}

bool configureSecureApiClient(SecureApiClient& secureClient) {
  if (DEVICE_ALLOW_INSECURE_TLS) {
    secureClient.setInsecure();
    return true;
  }

  if (strlen(API_ROOT_CA) < 64) {
    return false;
  }

#if defined(ESP8266)
  static BearSSL::X509List trustAnchor(API_ROOT_CA);
  secureClient.setTrustAnchors(&trustAnchor);
#else
  secureClient.setCACert(API_ROOT_CA);
#endif

  return true;
}

void printReceivedState() {
  Serial.println("=== Dados recebidos da API ===");
  Serial.print("ESP: ");
  Serial.println(receivedConfig.deviceId);
  Serial.print("Nome: ");
  Serial.println(receivedConfig.name);
  Serial.print("Menu: ");
  Serial.println(receivedConfig.menuTitle);
  Serial.print("Som remoto: ");
  Serial.println(receivedConfig.soundEnabled ? "ON" : "OFF");
  Serial.print("Som local informado: ");
  Serial.println(receivedConfig.localSoundEnabled ? "ON" : "OFF");
  Serial.print("Fuso: ");
  Serial.println(receivedConfig.utcOffsetMinutes);
  Serial.print("Heartbeat (s): ");
  Serial.println(receivedConfig.pollIntervalSeconds);
  Serial.print("Ultimo contato informado: ");
  Serial.println(receivedConfig.lastSeenAt);
  Serial.print("Horarios recebidos: ");
  Serial.println(receivedScheduleCount);

  for (int index = 0; index < receivedScheduleCount; index++) {
    const ReceivedSchedule& schedule = receivedSchedules[index];
    Serial.print("  - #");
    Serial.print(schedule.id);
    Serial.print(" ");
    Serial.print(schedule.label);
    Serial.print(" ");
    if (schedule.hour < 10) {
      Serial.print("0");
    }
    Serial.print(schedule.hour);
    Serial.print(":");
    if (schedule.minute < 10) {
      Serial.print("0");
    }
    Serial.print(schedule.minute);
    Serial.print(" ");
    Serial.println(schedule.enabled ? "ON" : "OFF");
  }

  if (receivedOta.pending) {
    Serial.println("OTA pendente:");
    Serial.print("  deployment_id: ");
    Serial.println(receivedOta.deploymentId);
    Serial.print("  versao: ");
    Serial.println(receivedOta.version);
    Serial.print("  canal: ");
    Serial.println(receivedOta.channel);
    Serial.print("  url: ");
    Serial.println(receivedOta.firmwareUrl);
  } else {
    Serial.println("OTA: nenhuma");
  }
}

void resetReceivedSchedules() {
  receivedScheduleCount = 0;
  for (int index = 0; index < MAX_SCHEDULES; index++) {
    receivedSchedules[index].active = false;
    receivedSchedules[index].id = 0;
    receivedSchedules[index].label[0] = '\0';
    receivedSchedules[index].hour = 0;
    receivedSchedules[index].minute = 0;
    receivedSchedules[index].enabled = false;
    receivedSchedules[index].dayCount = 0;
    for (int dayIndex = 0; dayIndex < 7; dayIndex++) {
      receivedSchedules[index].days[dayIndex] = 0;
    }
  }
}

void clearReceivedOta() {
  receivedOta.pending = false;
  receivedOta.deploymentId = 0;
  receivedOta.version[0] = '\0';
  receivedOta.channel[0] = '\0';
  receivedOta.firmwareUrl[0] = '\0';
  receivedOta.sha256[0] = '\0';
}

void printJsonSummary(const String& responseBody) {
  if (responseBody.length() == 0) {
    Serial.println("(sem corpo na resposta)");
    return;
  }

  DynamicJsonDocument doc(4096);
  DeserializationError error = deserializeJson(doc, responseBody);
  if (error) {
    Serial.println(responseBody);
    return;
  }

  serializeJsonPretty(doc, Serial);
  Serial.println();
}

void copyJsonText(JsonVariant value, char* target, size_t targetSize, const char* fallback) {
  const char* text = value.is<const char*>() ? value.as<const char*>() : fallback;
  if (!text) {
    text = "";
  }

  strncpy(target, text, targetSize - 1);
  target[targetSize - 1] = '\0';
}
