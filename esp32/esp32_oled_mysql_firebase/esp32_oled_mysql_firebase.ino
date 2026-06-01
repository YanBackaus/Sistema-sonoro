#if defined(ESP8266)
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#elif defined(ESP32)
#include <WiFi.h>
#include <HTTPClient.h>
#else
#error "Plataforma nao suportada. Use ESP8266 ou ESP32."
#endif

#include <Wire.h>
#include <time.h>
#include <sys/time.h>
#include <EEPROM.h>
#include <string.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

static const char* WIFI_SSID = "Archer_Home_EXT";
static const char* WIFI_PASSWORD = "semsenha";
//static const char* WIFI_SSID = "Schenkel";
//static const char* WIFI_PASSWORD = "00133200";
static const char* API_BASE_URL = "http://192.168.0.114:3000";
//static const char* API_BASE_URL = "http://10.149.130.251:3000";
static const char* API_KEY = "d1mini_scheduler_2026_01";
static const char* DEVICE_ID = "d1mini_02";
static const char* FIRMWARE_VERSION = "1.0.0";
   
static const int SCREEN_WIDTH = 128;
static const int SCREEN_HEIGHT = 64;
static const int OLED_RESET = -1;
static const uint8_t OLED_PRIMARY_ADDRESS = 0x3C;
static const uint8_t OLED_SECONDARY_ADDRESS = 0x3D;
static const int EEPROM_SIZE = 2048;
static const uint8_t EEPROM_MAGIC = 0x42;
static const uint32_t OFFLINE_CACHE_MAGIC = 0x53434844;
static const uint16_t OFFLINE_CACHE_VERSION = 2;
static const int MAX_SCHEDULES = 12;
static const int EEPROM_CACHE_OFFSET = 32;
static const unsigned long WIFI_RETRY_MS = 15000;
static const unsigned long HEARTBEAT_FALLBACK_MS = 60000;
static const unsigned long UI_REFRESH_MS = 250;
static const unsigned long NETWORK_QUIET_WINDOW_SECONDS = 90;
static const uint16_t API_HTTP_TIMEOUT_MS = 3500;
static const uint32_t OFFLINE_CACHE_TIME_SAVE_INTERVAL_SECONDS = 1800;
static const time_t MIN_VALID_UNIX_TIME = 1700000000;

#if defined(ESP8266)
static const char* BOARD_NAME = "LOLIN D1 mini";
static const uint8_t OLED_SCL_PIN = D1;
static const uint8_t OLED_SDA_PIN = D2;
static const uint8_t BUZZER_PIN = D5;
static const uint8_t ALERT_LED_PIN = LED_BUILTIN;
static const bool ALERT_LED_ACTIVE_LOW = true;
static const uint8_t ENC_A_PIN = D6;
static const uint8_t ENC_B_PIN = D7;
static const uint8_t ENC_SW_PIN = D3;
#else
static const char* BOARD_NAME = "ESP32";
static const uint8_t OLED_SCL_PIN = 22;
static const uint8_t OLED_SDA_PIN = 21;
static const uint8_t BUZZER_PIN = 25;
static const uint8_t ALERT_LED_PIN = 2;
static const bool ALERT_LED_ACTIVE_LOW = false;
static const uint8_t ENC_A_PIN = 32;
static const uint8_t ENC_B_PIN = 33;
static const uint8_t ENC_SW_PIN = 26;
#endif

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

enum UiState {
  UI_HOME,
  UI_MENU,
  UI_SCHEDULES,
  UI_WIFI
};

enum AlertOutputMode {
  ALERT_OUTPUT_NONE,
  ALERT_OUTPUT_BUZZER,
  ALERT_OUTPUT_LED
};

struct LocalSettings {
  uint8_t magic;
  uint8_t soundEnabled;
};

struct DeviceConfig {
  char name[32];
  char menuTitle[32];
  bool soundEnabledFromApi;
  int utcOffsetMinutes;
  unsigned int pollIntervalSeconds;
};

struct DeviceSchedule {
  bool active;
  int id;
  char label[32];
  uint8_t hour;
  uint8_t minute;
  bool days[7];
  uint16_t toneHz;
  uint16_t toneMs;
  uint8_t repeatCount;
  uint16_t repeatGapMs;
  bool enabled;
};

struct PersistedDeviceConfig {
  char name[32];
  char menuTitle[32];
  uint8_t soundEnabledFromApi;
  int32_t utcOffsetMinutes;
  uint32_t pollIntervalSeconds;
};

struct PersistedSchedule {
  uint8_t active;
  int32_t id;
  char label[32];
  uint8_t hour;
  uint8_t minute;
  uint8_t daysMask;
  uint16_t toneHz;
  uint16_t toneMs;
  uint8_t repeatCount;
  uint16_t repeatGapMs;
  uint8_t enabled;
};

struct PersistedCache {
  uint32_t magic;
  uint16_t version;
  uint16_t scheduleCount;
  uint32_t cachedUtcEpoch;
  PersistedDeviceConfig deviceConfig;
  PersistedSchedule schedules[MAX_SCHEDULES];
};

LocalSettings localSettings = {EEPROM_MAGIC, 1};
DeviceConfig deviceConfig = {"D1 mini", "Agenda", true, -180, 60};
DeviceSchedule schedules[MAX_SCHEDULES];

UiState currentUi = UI_HOME;
int menuOption = 0;
int selectedSchedule = 0;
int encoderLastAState = HIGH;
int lastButtonState = HIGH;
unsigned long lastButtonAt = 0;
unsigned long lastWiFiAttemptAt = 0;
unsigned long lastApiAttemptAt = 0;
unsigned long lastHeartbeatAt = 0;
unsigned long lastUiRefreshAt = 0;
int lastTriggeredDay[MAX_SCHEDULES];
int lastTriggeredMinuteOfDay[MAX_SCHEDULES];
int scheduleCount = 0;
bool apiOnline = false;
bool ntpReady = false;
bool oledReady = false;
bool offlineCacheAvailable = false;
uint8_t oledAddress = 0;
time_t cachedOfflineEpoch = 0;
String lastSyncMessage = "Boot";

bool loadOfflineCache();
bool saveOfflineCache(bool force = false);
void startWiFiReconnect();
bool applyDeviceConfigFromJson(JsonObject device);
bool loadSchedulesFromJson(JsonArray array);
time_t findNextScheduledAlarm(time_t now, const DeviceSchedule** bestSchedule);
bool shouldProtectUpcomingAlarm();
void buildPersistedCache(PersistedCache& cache, uint32_t cachedUtcEpoch);
void applyPersistedSchedule(const PersistedSchedule& persisted, DeviceSchedule& schedule);
uint8_t buildDaysMask(const DeviceSchedule& schedule);
int findScheduleIndexById(const DeviceSchedule* sourceSchedules, int sourceCount, int scheduleId);
bool schedulesMatch(
  const DeviceSchedule* leftSchedules,
  int leftCount,
  const DeviceSchedule* rightSchedules,
  int rightCount
);
bool schedulesEqual(const DeviceSchedule& left, const DeviceSchedule& right);
void copyRuntimeText(const char* source, char* target, size_t targetSize);
void copyPersistedText(const char* source, char* target, size_t targetSize, const char* fallback);
bool shouldPersistCachedTime(uint32_t previousEpoch, uint32_t currentEpoch);
bool restoreCachedTimeFromCache();
bool applyServerTimeFromJson(JsonVariant value);
bool parseUtcIso8601(const char* value, time_t* result);
int64_t daysFromCivil(int year, unsigned month, unsigned day);

void setup() {
  Serial.begin(115200);
  delay(300);

  for (int index = 0; index < MAX_SCHEDULES; index++) {
    lastTriggeredDay[index] = -1;
    lastTriggeredMinuteOfDay[index] = -1;
    clearSchedule(index);
  }

  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(ALERT_LED_PIN, OUTPUT);
  pinMode(ENC_A_PIN, INPUT_PULLUP);
  pinMode(ENC_B_PIN, INPUT_PULLUP);
  pinMode(ENC_SW_PIN, INPUT_PULLUP);
  setAlertLed(false);

  EEPROM.begin(EEPROM_SIZE);
  loadLocalSettings();
  offlineCacheAvailable = loadOfflineCache();

  Wire.begin(OLED_SDA_PIN, OLED_SCL_PIN);
  oledReady = initDisplay();
  if (!oledReady) {
    Serial.println("Falha ao iniciar OLED SSD1306");
  }

  showBootScreen();
  connectWiFi(true);
  applyTimeZone();
  if (!ntpReady) {
    restoreCachedTimeFromCache();
  }
  syncWithApi("boot");
}

void loop() {
  handleEncoder();
  checkSchedules();
  ensureWiFiConnected();
  maybeSyncWithApi();

  if (millis() - lastUiRefreshAt >= UI_REFRESH_MS) {
    drawCurrentScreen();
    lastUiRefreshAt = millis();
  }

  delay(20);
}

void loadLocalSettings() {
  EEPROM.get(0, localSettings);

  if (localSettings.magic != EEPROM_MAGIC) {
    localSettings.magic = EEPROM_MAGIC;
    localSettings.soundEnabled = 1;
    saveLocalSettings();
  }
}

void saveLocalSettings() {
  EEPROM.put(0, localSettings);
  EEPROM.commit();
}

bool loadOfflineCache() {
  PersistedCache cache;
  memset(&cache, 0, sizeof(cache));
  EEPROM.get(EEPROM_CACHE_OFFSET, cache);

  if (cache.magic != OFFLINE_CACHE_MAGIC || cache.version != OFFLINE_CACHE_VERSION) {
    return false;
  }

  if (cache.scheduleCount > MAX_SCHEDULES) {
    return false;
  }

  cachedOfflineEpoch = cache.cachedUtcEpoch >= MIN_VALID_UNIX_TIME
    ? static_cast<time_t>(cache.cachedUtcEpoch)
    : 0;

  copyPersistedText(cache.deviceConfig.name, deviceConfig.name, sizeof(deviceConfig.name), deviceConfig.name);
  copyPersistedText(cache.deviceConfig.menuTitle, deviceConfig.menuTitle, sizeof(deviceConfig.menuTitle), deviceConfig.menuTitle);
  deviceConfig.soundEnabledFromApi = cache.deviceConfig.soundEnabledFromApi == 1;
  deviceConfig.utcOffsetMinutes = cache.deviceConfig.utcOffsetMinutes;
  if (deviceConfig.utcOffsetMinutes < -720 || deviceConfig.utcOffsetMinutes > 840) {
    deviceConfig.utcOffsetMinutes = -180;
  }

  deviceConfig.pollIntervalSeconds = cache.deviceConfig.pollIntervalSeconds;
  if (deviceConfig.pollIntervalSeconds < 15 || deviceConfig.pollIntervalSeconds > 3600) {
    deviceConfig.pollIntervalSeconds = 60;
  }

  scheduleCount = 0;
  for (int index = 0; index < MAX_SCHEDULES; index++) {
    clearSchedule(index);
    lastTriggeredDay[index] = -1;
    lastTriggeredMinuteOfDay[index] = -1;
  }

  for (int index = 0; index < cache.scheduleCount; index++) {
    applyPersistedSchedule(cache.schedules[index], schedules[index]);
    scheduleCount++;
  }

  lastSyncMessage = scheduleCount > 0 ? "Modo offline" : "Cache local";
  return true;
}

bool saveOfflineCache(bool force) {
  PersistedCache currentCache;
  PersistedCache previousCache;
  memset(&previousCache, 0, sizeof(previousCache));
  EEPROM.get(EEPROM_CACHE_OFFSET, previousCache);
  if (previousCache.magic != OFFLINE_CACHE_MAGIC ||
      previousCache.version != OFFLINE_CACHE_VERSION ||
      previousCache.scheduleCount > MAX_SCHEDULES) {
    memset(&previousCache, 0, sizeof(previousCache));
  }

  uint32_t previousEpoch = previousCache.cachedUtcEpoch;
  uint32_t currentEpoch = timeReady() ? static_cast<uint32_t>(time(nullptr)) : 0;
  buildPersistedCache(currentCache, previousEpoch);

  PersistedCache coreComparison = currentCache;
  coreComparison.cachedUtcEpoch = previousEpoch;
  bool coreChanged = memcmp(&coreComparison, &previousCache, sizeof(PersistedCache)) != 0;
  bool persistTime = shouldPersistCachedTime(previousEpoch, currentEpoch);

  if (!coreChanged && !force && !persistTime) {
    return false;
  }

  currentCache.cachedUtcEpoch =
    ((force && currentEpoch >= MIN_VALID_UNIX_TIME) || persistTime) ? currentEpoch : previousEpoch;

  if (memcmp(&currentCache, &previousCache, sizeof(PersistedCache)) == 0) {
    return false;
  }

  EEPROM.put(EEPROM_CACHE_OFFSET, currentCache);
  EEPROM.commit();
  offlineCacheAvailable = true;
  cachedOfflineEpoch = currentCache.cachedUtcEpoch >= MIN_VALID_UNIX_TIME
    ? static_cast<time_t>(currentCache.cachedUtcEpoch)
    : cachedOfflineEpoch;
  return true;
}

void connectWiFi(bool showStatus) {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWiFiAttemptAt = millis();

  if (showStatus) {
    showCenteredMessage("Conectando WiFi", WIFI_SSID);
  }

  unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < 12000) {
    delay(300);
  }

  if (WiFi.status() == WL_CONNECTED) {
    lastSyncMessage = "WiFi conectado";
  } else {
    lastSyncMessage = scheduleCount > 0 ? "Modo offline" : "WiFi offline";
  }
}

void startWiFiReconnect() {
  if (shouldProtectUpcomingAlarm()) {
    return;
  }

  WiFi.disconnect();
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWiFiAttemptAt = millis();
  lastSyncMessage = scheduleCount > 0 ? "Tentando WiFi" : "Reconectando";
}

void ensureWiFiConnected() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  if (millis() - lastWiFiAttemptAt < WIFI_RETRY_MS) {
    return;
  }

  startWiFiReconnect();
}

void applyTimeZone() {
  configTime(deviceConfig.utcOffsetMinutes * 60, 0, "pool.ntp.org", "time.nist.gov", "time.google.com");

  time_t now = time(nullptr);
  int retries = 0;
  while (now < MIN_VALID_UNIX_TIME && retries < 20) {
    delay(250);
    now = time(nullptr);
    retries++;
  }

  ntpReady = now >= MIN_VALID_UNIX_TIME;
}

void maybeSyncWithApi() {
  unsigned long intervalMs = max(
    HEARTBEAT_FALLBACK_MS,
    deviceConfig.pollIntervalSeconds * 1000UL
  );

  if (shouldProtectUpcomingAlarm()) {
    return;
  }

  if (millis() - lastApiAttemptAt >= intervalMs) {
    syncWithApi("heartbeat");
  }
}

bool initDisplay() {
  oledAddress = detectOledAddress();

  if (oledAddress == 0) {
    Serial.println("Nenhum OLED encontrado em 0x3C ou 0x3D");
    printI2cHints();
    return false;
  }

  Serial.print("OLED encontrado em 0x");
  Serial.println(oledAddress, HEX);

  if (!display.begin(SSD1306_SWITCHCAPVCC, oledAddress)) {
    Serial.println("display.begin falhou para o endereco detectado");
    printI2cHints();
    return false;
  }

  display.clearDisplay();
  display.display();
  return true;
}

uint8_t detectOledAddress() {
  if (i2cDevicePresent(OLED_PRIMARY_ADDRESS)) {
    return OLED_PRIMARY_ADDRESS;
  }

  if (i2cDevicePresent(OLED_SECONDARY_ADDRESS)) {
    return OLED_SECONDARY_ADDRESS;
  }

  return 0;
}

bool i2cDevicePresent(uint8_t address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

void printI2cHints() {
  Serial.println("Dica: essa placa da foto costuma usar 0x3C ou 0x3D.");
  Serial.println("Na serigrafia dela, 0x78 = 0x3C e 0x7A = 0x3D no Arduino.");
  Serial.println("Se ainda nao funcionar, ela pode ser SH1106 em vez de SSD1306.");
}

bool syncWithApi(const char* reason) {
  if (strcmp(reason, "boot") != 0 && shouldProtectUpcomingAlarm()) {
    lastSyncMessage = "Perto do toque";
    return false;
  }

  lastApiAttemptAt = millis();

  if (WiFi.status() != WL_CONNECTED) {
    apiOnline = false;
    lastSyncMessage = scheduleCount > 0 ? "Modo offline" : "API sem WiFi";
    return false;
  }

  WiFiClient client;
  HTTPClient http;
  String url = String(API_BASE_URL) + "/api/devices/" + DEVICE_ID + "/heartbeat";

  if (!http.begin(client, url)) {
    apiOnline = false;
    lastSyncMessage = scheduleCount > 0 ? "Modo offline" : "Falha HTTP";
    return false;
  }

  http.setTimeout(API_HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-KEY", API_KEY);

  String payload = buildHeartbeatPayload(reason);
  int httpCode = http.POST(payload);
  String response = http.getString();
  http.end();

  if (httpCode < 200 || httpCode >= 300) {
    apiOnline = false;
    lastSyncMessage = scheduleCount > 0 ? "Modo offline" : "API HTTP " + String(httpCode);
    Serial.println(response);
    return false;
  }

  DynamicJsonDocument doc(8192);
  DeserializationError error = deserializeJson(doc, response);
  if (error) {
    apiOnline = false;
    lastSyncMessage = scheduleCount > 0 ? "Modo offline" : "JSON invalido";
    return false;
  }

  applyServerTimeFromJson(doc["server_time"]);
  bool configChanged = applyDeviceConfigFromJson(doc["device"].as<JsonObject>());
  bool schedulesChanged = loadSchedulesFromJson(doc["schedules"].as<JsonArray>());
  saveOfflineCache(configChanged || schedulesChanged || !offlineCacheAvailable);

  apiOnline = true;
  lastHeartbeatAt = millis();
  lastSyncMessage = "Sync OK";
  return true;
}

String buildHeartbeatPayload(const char* reason) {
  StaticJsonDocument<384> doc;
  doc["firmware_version"] = FIRMWARE_VERSION;
  doc["wifi_rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
  doc["ip_address"] = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "";
  doc["current_screen"] = currentUiName();
  doc["current_menu"] = currentMenuLabel();
  doc["local_sound_enabled"] = localSettings.soundEnabled == 1;
  doc["reason"] = reason;

  String payload;
  serializeJson(doc, payload);
  return payload;
}

bool applyDeviceConfigFromJson(JsonObject device) {
  if (device.isNull()) {
    return false;
  }

  DeviceConfig previousConfig = deviceConfig;
  int previousOffset = deviceConfig.utcOffsetMinutes;

  copyJsonText(device["name"], deviceConfig.name, sizeof(deviceConfig.name), DEVICE_ID);
  copyJsonText(device["menu_title"], deviceConfig.menuTitle, sizeof(deviceConfig.menuTitle), deviceConfig.name);
  deviceConfig.soundEnabledFromApi = device["sound_enabled"] | true;
  deviceConfig.utcOffsetMinutes = device["utc_offset_minutes"] | deviceConfig.utcOffsetMinutes;
  deviceConfig.pollIntervalSeconds = device["poll_interval_seconds"] | deviceConfig.pollIntervalSeconds;

  if (!ntpReady || previousOffset != deviceConfig.utcOffsetMinutes) {
    applyTimeZone();
  }

  return strcmp(previousConfig.name, deviceConfig.name) != 0 ||
         strcmp(previousConfig.menuTitle, deviceConfig.menuTitle) != 0 ||
         previousConfig.soundEnabledFromApi != deviceConfig.soundEnabledFromApi ||
         previousConfig.utcOffsetMinutes != deviceConfig.utcOffsetMinutes ||
         previousConfig.pollIntervalSeconds != deviceConfig.pollIntervalSeconds;
}

bool loadSchedulesFromJson(JsonArray array) {
  DeviceSchedule previousSchedules[MAX_SCHEDULES];
  int previousTriggeredDay[MAX_SCHEDULES];
  int previousTriggeredMinuteOfDay[MAX_SCHEDULES];
  int previousCount = scheduleCount;

  for (int index = 0; index < MAX_SCHEDULES; index++) {
    previousSchedules[index] = schedules[index];
    previousTriggeredDay[index] = lastTriggeredDay[index];
    previousTriggeredMinuteOfDay[index] = lastTriggeredMinuteOfDay[index];
  }

  scheduleCount = 0;

  for (int index = 0; index < MAX_SCHEDULES; index++) {
    clearSchedule(index);
    lastTriggeredDay[index] = -1;
    lastTriggeredMinuteOfDay[index] = -1;
  }

  for (JsonObject scheduleObject : array) {
    if (scheduleCount >= MAX_SCHEDULES) {
      break;
    }

    DeviceSchedule& schedule = schedules[scheduleCount];
    schedule.active = true;
    schedule.id = scheduleObject["id"] | 0;
    copyJsonText(scheduleObject["label"], schedule.label, sizeof(schedule.label), "Horario");
    schedule.hour = scheduleObject["hour"] | 0;
    schedule.minute = scheduleObject["minute"] | 0;
    schedule.toneHz = scheduleObject["tone_hz"] | 2400;
    schedule.toneMs = scheduleObject["tone_ms"] | 600;
    schedule.repeatCount = scheduleObject["repeat_count"] | 1;
    schedule.repeatGapMs = scheduleObject["repeat_gap_ms"] | 250;
    schedule.enabled = scheduleObject["enabled"] | true;

    for (int dayIndex = 0; dayIndex < 7; dayIndex++) {
      schedule.days[dayIndex] = false;
    }

    JsonArray days = scheduleObject["days_of_week"].as<JsonArray>();
    for (JsonVariant dayValue : days) {
      int dayIndex = dayValue.as<int>();
      if (dayIndex >= 0 && dayIndex < 7) {
        schedule.days[dayIndex] = true;
      }
    }

    int previousIndex = findScheduleIndexById(previousSchedules, previousCount, schedule.id);
    if (previousIndex >= 0) {
      lastTriggeredDay[scheduleCount] = previousTriggeredDay[previousIndex];
      lastTriggeredMinuteOfDay[scheduleCount] = previousTriggeredMinuteOfDay[previousIndex];
    }

    scheduleCount++;
  }

  if (selectedSchedule >= scheduleCount) {
    selectedSchedule = max(0, scheduleCount - 1);
  }

  return !schedulesMatch(previousSchedules, previousCount, schedules, scheduleCount);
}

void clearSchedule(int index) {
  schedules[index].active = false;
  schedules[index].id = 0;
  schedules[index].label[0] = '\0';
  schedules[index].hour = 0;
  schedules[index].minute = 0;
  schedules[index].toneHz = 2400;
  schedules[index].toneMs = 600;
  schedules[index].repeatCount = 1;
  schedules[index].repeatGapMs = 250;
  schedules[index].enabled = false;

  for (int dayIndex = 0; dayIndex < 7; dayIndex++) {
    schedules[index].days[dayIndex] = false;
  }
}

void checkSchedules() {
  if (!timeReady()) {
    return;
  }

  time_t now = time(nullptr);
  struct tm nowInfo;
  localtime_r(&now, &nowInfo);
  int currentMinuteOfDay = nowInfo.tm_hour * 60 + nowInfo.tm_min;

  for (int index = 0; index < scheduleCount; index++) {
    DeviceSchedule& schedule = schedules[index];

    if (!schedule.active || !schedule.enabled || !schedule.days[nowInfo.tm_wday]) {
      continue;
    }

    if (schedule.hour != nowInfo.tm_hour || schedule.minute != nowInfo.tm_min) {
      continue;
    }

    if (lastTriggeredDay[index] == nowInfo.tm_yday &&
        lastTriggeredMinuteOfDay[index] == currentMinuteOfDay) {
      continue;
    }

    lastTriggeredDay[index] = nowInfo.tm_yday;
    lastTriggeredMinuteOfDay[index] = currentMinuteOfDay;
    playScheduleTone(schedule);
  }
}

void playScheduleTone(const DeviceSchedule& schedule) {
  AlertOutputMode outputMode = playAlertPattern(schedule, false);
  if (outputMode == ALERT_OUTPUT_NONE) {
    lastSyncMessage = "Som bloqueado";
    return;
  }

  lastSyncMessage = outputMode == ALERT_OUTPUT_LED
    ? "LED " + String(schedule.label)
    : "Tocou " + String(schedule.label);
  sendEvent("alarm_triggered", schedule.label, schedule.id);
}

void playTestTone() {
  DeviceSchedule sample;
  memset(&sample, 0, sizeof(sample));
  sample.toneHz = 2400;
  sample.toneMs = 200;
  sample.repeatCount = 2;
  sample.repeatGapMs = 120;
  strcpy(sample.label, "Teste");

  AlertOutputMode outputMode = playAlertPattern(sample, true);
  lastSyncMessage = outputMode == ALERT_OUTPUT_LED ? "Teste no LED" : "Teste no buzzer";
  sendEvent(
    "manual_test",
    outputMode == ALERT_OUTPUT_LED ? "Teste manual no LED interno" : "Teste manual do buzzer",
    0
  );
}

void sendEvent(const char* eventType, const char* message, int scheduleId) {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  WiFiClient client;
  HTTPClient http;
  String url = String(API_BASE_URL) + "/api/devices/" + DEVICE_ID + "/events";

  if (!http.begin(client, url)) {
    return;
  }

  http.setTimeout(API_HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-KEY", API_KEY);

  StaticJsonDocument<384> doc;
  doc["event_type"] = eventType;
  doc["message"] = message;
  doc["occurred_at"] = currentTimestampIso();

  JsonObject payload = doc.createNestedObject("payload");
  payload["schedule_id"] = scheduleId;
  payload["current_screen"] = currentUiName();
  payload["wifi_rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;

  String body;
  serializeJson(doc, body);
  http.POST(body);
  http.end();
}

void handleEncoder() {
  int currentA = digitalRead(ENC_A_PIN);

  if (currentA != encoderLastAState && currentA == HIGH) {
    bool clockwise = digitalRead(ENC_B_PIN) != currentA;
    onEncoderRotate(clockwise ? 1 : -1);
  }
  encoderLastAState = currentA;

  int buttonState = digitalRead(ENC_SW_PIN);
  if (buttonState == LOW && lastButtonState == HIGH && millis() - lastButtonAt > 250) {
    lastButtonAt = millis();
    onEncoderClick();
  }
  lastButtonState = buttonState;
}

void onEncoderRotate(int delta) {
  if (currentUi == UI_MENU) {
    menuOption = wrapValue(menuOption + delta, 0, 5);
  } else if (currentUi == UI_SCHEDULES && scheduleCount > 0) {
    selectedSchedule = wrapValue(selectedSchedule + delta, 0, scheduleCount - 1);
  }
}

void onEncoderClick() {
  if (currentUi == UI_HOME) {
    currentUi = UI_MENU;
    return;
  }

  if (currentUi == UI_MENU) {
    executeMenuAction();
    return;
  }

  currentUi = UI_MENU;
}

void executeMenuAction() {
  switch (menuOption) {
    case 0:
      currentUi = UI_HOME;
      break;

    case 1:
      localSettings.soundEnabled = localSettings.soundEnabled == 1 ? 0 : 1;
      saveLocalSettings();
      lastSyncMessage = localSettings.soundEnabled ? "Som local ON" : "Som local OFF";
      break;

    case 2:
      playTestTone();
      break;

    case 3:
      currentUi = UI_SCHEDULES;
      break;

    case 4:
      currentUi = UI_WIFI;
      break;

    case 5:
      syncWithApi("manual_sync");
      currentUi = UI_HOME;
      break;
  }
}

void drawCurrentScreen() {
  if (!oledReady) {
    return;
  }

  switch (currentUi) {
    case UI_HOME:
      drawHome();
      break;
    case UI_MENU:
      drawMenu();
      break;
    case UI_SCHEDULES:
      drawSchedules();
      break;
    case UI_WIFI:
      drawWiFi();
      break;
  }
}

void drawHome() {
  char clockBuffer[16];
  char nextAlarmBuffer[28];

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print(deviceConfig.menuTitle[0] ? deviceConfig.menuTitle : DEVICE_ID);

  display.setCursor(96, 0);
  display.print(apiOnline ? "API" : (offlineCacheAvailable ? "LOC" : "OFF"));

  if (buildClockText(clockBuffer, sizeof(clockBuffer))) {
    display.setTextSize(2);
    display.setCursor(8, 16);
    display.print(clockBuffer);
  } else {
    display.setTextSize(1);
    display.setCursor(10, 20);
    display.print("Aguardando hora");
  }

  display.setTextSize(1);
  display.setCursor(0, 42);
  display.print("Som: ");
  display.print(localSettings.soundEnabled ? "ON" : "OFF");
  display.print(deviceConfig.soundEnabledFromApi ? "" : " (API OFF)");

  display.setCursor(0, 52);
  display.print("Prox: ");
  buildNextAlarmText(nextAlarmBuffer, sizeof(nextAlarmBuffer));
  display.print(nextAlarmBuffer);

  display.display();
}

void drawMenu() {
  static const char* items[] = {
    "Voltar",
    "Som local",
    "Teste sonoro",
    "Horarios",
    "WiFi/API",
    "Sincronizar"
  };

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print("Menu");

  for (int index = 0; index < 6; index++) {
    display.setCursor(0, 12 + (index * 9));
    display.print(index == menuOption ? "> " : "  ");
    display.print(items[index]);

    if (index == 1) {
      display.print(":");
      display.print(localSettings.soundEnabled ? "ON" : "OFF");
    }
  }

  display.display();
}

void drawSchedules() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print("Horarios");

  if (scheduleCount == 0) {
    display.setCursor(0, 20);
    display.print("Nenhum horario");
    display.setCursor(0, 32);
    display.print("na API");
    display.display();
    return;
  }

  DeviceSchedule& schedule = schedules[selectedSchedule];
  char timeBuffer[8];
  char daysBuffer[40];
  snprintf(timeBuffer, sizeof(timeBuffer), "%02u:%02u", schedule.hour, schedule.minute);
  buildDaysText(schedule, daysBuffer, sizeof(daysBuffer));

  display.setCursor(0, 14);
  display.print(selectedSchedule + 1);
  display.print("/");
  display.print(scheduleCount);

  display.setCursor(0, 26);
  display.print(schedule.label);

  display.setTextSize(2);
  display.setCursor(0, 38);
  display.print(timeBuffer);

  display.setTextSize(1);
  display.setCursor(74, 40);
  display.print(schedule.enabled ? "ON" : "OFF");
  display.setCursor(0, 56);
  display.print(daysBuffer);
  display.display();
}

void drawWiFi() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print("WiFi/API");

  display.setCursor(0, 14);
  display.print("WiFi: ");
  display.print(WiFi.status() == WL_CONNECTED ? "OK" : "OFF");

  display.setCursor(0, 24);
  display.print("IP: ");
  if (WiFi.status() == WL_CONNECTED) {
    display.print(WiFi.localIP());
  } else {
    display.print("--");
  }

  display.setCursor(0, 34);
  display.print("RSSI: ");
  display.print(WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0);

  display.setCursor(0, 44);
  display.print("API: ");
  display.print(apiOnline ? "OK" : (offlineCacheAvailable ? "OFFLINE" : "OFF"));

  display.setCursor(0, 54);
  display.print(lastSyncMessage.substring(0, 20));
  display.display();
}

void showBootScreen() {
  if (!oledReady) {
    return;
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 10);
  display.print(BOARD_NAME);
  display.setCursor(0, 24);
  display.print("Agenda sonora");
  display.setCursor(0, 38);
  display.print(DEVICE_ID);
  display.display();
}

void showCenteredMessage(const String& line1, const String& line2) {
  if (!oledReady) {
    return;
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 16);
  display.print(line1);
  display.setCursor(0, 32);
  display.print(line2);
  display.display();
}

bool buildClockText(char* buffer, size_t size) {
  if (!timeReady()) {
    snprintf(buffer, size, "--:--");
    return false;
  }

  time_t now = time(nullptr);
  struct tm nowInfo;
  localtime_r(&now, &nowInfo);
  strftime(buffer, size, "%H:%M:%S", &nowInfo);
  return true;
}

bool timeReady() {
  time_t now = time(nullptr);
  return now >= MIN_VALID_UNIX_TIME;
}

void buildNextAlarmText(char* buffer, size_t size) {
  if (!timeReady() || scheduleCount == 0) {
    snprintf(buffer, size, "sem agenda");
    return;
  }

  time_t now = time(nullptr);
  const DeviceSchedule* bestSchedule = nullptr;
  time_t bestTime = findNextScheduledAlarm(now, &bestSchedule);

  if (bestSchedule == nullptr || bestTime == 0) {
    snprintf(buffer, size, "sem proximo");
    return;
  }

  struct tm bestInfo;
  localtime_r(&bestTime, &bestInfo);
  char timeBuffer[8];
  strftime(timeBuffer, sizeof(timeBuffer), "%H:%M", &bestInfo);
  snprintf(buffer, size, "%s %s", timeBuffer, bestSchedule->label);
}

void buildDaysText(const DeviceSchedule& schedule, char* buffer, size_t size) {
  static const char* dayNames[] = {"Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"};
  buffer[0] = '\0';

  for (int index = 0; index < 7; index++) {
    if (!schedule.days[index]) {
      continue;
    }

    if (strlen(buffer) > 0) {
      strncat(buffer, " ", size - strlen(buffer) - 1);
    }

    strncat(buffer, dayNames[index], size - strlen(buffer) - 1);
  }

  if (buffer[0] == '\0') {
    snprintf(buffer, size, "sem dias");
  }
}

AlertOutputMode playAlertPattern(const DeviceSchedule& schedule, bool ignoreApiSoundFlag) {
  if (!ignoreApiSoundFlag && !deviceConfig.soundEnabledFromApi) {
    return ALERT_OUTPUT_NONE;
  }

  if (localSettings.soundEnabled == 1) {
    playBuzzerPattern(schedule);
    return ALERT_OUTPUT_BUZZER;
  }

  playLedPattern(schedule);
  return ALERT_OUTPUT_LED;
}

void playBuzzerPattern(const DeviceSchedule& schedule) {
  setAlertLed(false);

  for (int repeatIndex = 0; repeatIndex < schedule.repeatCount; repeatIndex++) {
    tone(BUZZER_PIN, schedule.toneHz);
    delay(schedule.toneMs);
    noTone(BUZZER_PIN);

    if (repeatIndex + 1 < schedule.repeatCount) {
      delay(schedule.repeatGapMs);
    }
  }
}

void playLedPattern(const DeviceSchedule& schedule) {
  noTone(BUZZER_PIN);

  for (int repeatIndex = 0; repeatIndex < schedule.repeatCount; repeatIndex++) {
    setAlertLed(true);
    delay(schedule.toneMs);
    setAlertLed(false);

    if (repeatIndex + 1 < schedule.repeatCount) {
      delay(schedule.repeatGapMs);
    }
  }
}

void setAlertLed(bool enabled) {
  digitalWrite(
    ALERT_LED_PIN,
    enabled
      ? (ALERT_LED_ACTIVE_LOW ? LOW : HIGH)
      : (ALERT_LED_ACTIVE_LOW ? HIGH : LOW)
  );
}

time_t findNextScheduledAlarm(time_t now, const DeviceSchedule** bestSchedule) {
  time_t bestTime = 0;

  if (bestSchedule != nullptr) {
    *bestSchedule = nullptr;
  }

  for (int index = 0; index < scheduleCount; index++) {
    const DeviceSchedule& schedule = schedules[index];
    if (!schedule.active || !schedule.enabled) {
      continue;
    }

    for (int daysAhead = 0; daysAhead < 7; daysAhead++) {
      time_t candidateBase = now + (daysAhead * 86400);
      struct tm candidateInfo;
      localtime_r(&candidateBase, &candidateInfo);

      if (!schedule.days[candidateInfo.tm_wday]) {
        continue;
      }

      candidateInfo.tm_hour = schedule.hour;
      candidateInfo.tm_min = schedule.minute;
      candidateInfo.tm_sec = 0;

      time_t candidate = mktime(&candidateInfo);
      if (candidate <= now) {
        continue;
      }

      if (bestTime == 0 || candidate < bestTime) {
        bestTime = candidate;

        if (bestSchedule != nullptr) {
          *bestSchedule = &schedule;
        }
      }
    }
  }

  return bestTime;
}

bool shouldProtectUpcomingAlarm() {
  if (!timeReady() || scheduleCount == 0) {
    return false;
  }

  time_t now = time(nullptr);
  time_t nextAlarm = findNextScheduledAlarm(now, nullptr);
  if (nextAlarm == 0) {
    return false;
  }

  return static_cast<unsigned long>(nextAlarm - now) <= NETWORK_QUIET_WINDOW_SECONDS;
}

void buildPersistedCache(PersistedCache& cache, uint32_t cachedUtcEpoch) {
  memset(&cache, 0, sizeof(cache));
  cache.magic = OFFLINE_CACHE_MAGIC;
  cache.version = OFFLINE_CACHE_VERSION;
  cache.scheduleCount = scheduleCount;
  cache.cachedUtcEpoch = cachedUtcEpoch;

  copyRuntimeText(deviceConfig.name, cache.deviceConfig.name, sizeof(cache.deviceConfig.name));
  copyRuntimeText(deviceConfig.menuTitle, cache.deviceConfig.menuTitle, sizeof(cache.deviceConfig.menuTitle));
  cache.deviceConfig.soundEnabledFromApi = deviceConfig.soundEnabledFromApi ? 1 : 0;
  cache.deviceConfig.utcOffsetMinutes = deviceConfig.utcOffsetMinutes;
  cache.deviceConfig.pollIntervalSeconds = deviceConfig.pollIntervalSeconds;

  for (int index = 0; index < scheduleCount && index < MAX_SCHEDULES; index++) {
    cache.schedules[index].active = schedules[index].active ? 1 : 0;
    cache.schedules[index].id = schedules[index].id;
    copyRuntimeText(schedules[index].label, cache.schedules[index].label, sizeof(cache.schedules[index].label));
    cache.schedules[index].hour = schedules[index].hour;
    cache.schedules[index].minute = schedules[index].minute;
    cache.schedules[index].daysMask = buildDaysMask(schedules[index]);
    cache.schedules[index].toneHz = schedules[index].toneHz;
    cache.schedules[index].toneMs = schedules[index].toneMs;
    cache.schedules[index].repeatCount = schedules[index].repeatCount;
    cache.schedules[index].repeatGapMs = schedules[index].repeatGapMs;
    cache.schedules[index].enabled = schedules[index].enabled ? 1 : 0;
  }
}

void applyPersistedSchedule(const PersistedSchedule& persisted, DeviceSchedule& schedule) {
  memset(&schedule, 0, sizeof(schedule));
  schedule.toneHz = 2400;
  schedule.toneMs = 600;
  schedule.repeatCount = 1;
  schedule.repeatGapMs = 250;

  schedule.active = persisted.active == 1;
  schedule.id = persisted.id;
  copyPersistedText(persisted.label, schedule.label, sizeof(schedule.label), "Horario");
  schedule.hour = persisted.hour;
  schedule.minute = persisted.minute;
  schedule.toneHz = persisted.toneHz;
  schedule.toneMs = persisted.toneMs;
  schedule.repeatCount = persisted.repeatCount;
  schedule.repeatGapMs = persisted.repeatGapMs;
  schedule.enabled = persisted.enabled == 1;

  if (schedule.toneHz < 100 || schedule.toneHz > 6000) {
    schedule.toneHz = 2400;
  }

  if (schedule.toneMs < 50 || schedule.toneMs > 10000) {
    schedule.toneMs = 600;
  }

  if (schedule.repeatCount < 1 || schedule.repeatCount > 10) {
    schedule.repeatCount = 1;
  }

  if (schedule.repeatGapMs > 10000) {
    schedule.repeatGapMs = 250;
  }

  for (int dayIndex = 0; dayIndex < 7; dayIndex++) {
    schedule.days[dayIndex] = (persisted.daysMask & (1 << dayIndex)) != 0;
  }
}

uint8_t buildDaysMask(const DeviceSchedule& schedule) {
  uint8_t mask = 0;

  for (int dayIndex = 0; dayIndex < 7; dayIndex++) {
    if (schedule.days[dayIndex]) {
      mask |= (1 << dayIndex);
    }
  }

  return mask;
}

int findScheduleIndexById(const DeviceSchedule* sourceSchedules, int sourceCount, int scheduleId) {
  for (int index = 0; index < sourceCount; index++) {
    if (sourceSchedules[index].active && sourceSchedules[index].id == scheduleId) {
      return index;
    }
  }

  return -1;
}

bool schedulesMatch(
  const DeviceSchedule* leftSchedules,
  int leftCount,
  const DeviceSchedule* rightSchedules,
  int rightCount
) {
  if (leftCount != rightCount) {
    return false;
  }

  for (int index = 0; index < leftCount; index++) {
    if (!schedulesEqual(leftSchedules[index], rightSchedules[index])) {
      return false;
    }
  }

  return true;
}

bool schedulesEqual(const DeviceSchedule& left, const DeviceSchedule& right) {
  if (left.active != right.active ||
      left.id != right.id ||
      strcmp(left.label, right.label) != 0 ||
      left.hour != right.hour ||
      left.minute != right.minute ||
      left.toneHz != right.toneHz ||
      left.toneMs != right.toneMs ||
      left.repeatCount != right.repeatCount ||
      left.repeatGapMs != right.repeatGapMs ||
      left.enabled != right.enabled) {
    return false;
  }

  for (int dayIndex = 0; dayIndex < 7; dayIndex++) {
    if (left.days[dayIndex] != right.days[dayIndex]) {
      return false;
    }
  }

  return true;
}

void copyRuntimeText(const char* source, char* target, size_t targetSize) {
  strncpy(target, source, targetSize - 1);
  target[targetSize - 1] = '\0';
}

void copyPersistedText(const char* source, char* target, size_t targetSize, const char* fallback) {
  if (source == nullptr || source[0] == '\0') {
    copyRuntimeText(fallback, target, targetSize);
    return;
  }

  copyRuntimeText(source, target, targetSize);
}

bool shouldPersistCachedTime(uint32_t previousEpoch, uint32_t currentEpoch) {
  if (currentEpoch < MIN_VALID_UNIX_TIME) {
    return false;
  }

  if (previousEpoch < MIN_VALID_UNIX_TIME) {
    return true;
  }

  if (currentEpoch < previousEpoch) {
    return true;
  }

  return currentEpoch - previousEpoch >= OFFLINE_CACHE_TIME_SAVE_INTERVAL_SECONDS;
}

bool restoreCachedTimeFromCache() {
  if (cachedOfflineEpoch < MIN_VALID_UNIX_TIME) {
    return false;
  }

  struct timeval restoredTime;
  restoredTime.tv_sec = cachedOfflineEpoch;
  restoredTime.tv_usec = 0;
  settimeofday(&restoredTime, nullptr);

  ntpReady = timeReady();
  if (!ntpReady) {
    return false;
  }

  Serial.println("Hora restaurada do cache offline");
  lastSyncMessage = scheduleCount > 0 ? "Hora do cache" : "Cache local";
  return true;
}

bool applyServerTimeFromJson(JsonVariant value) {
  const char* serverTime = value.is<const char*>() ? value.as<const char*>() : nullptr;
  time_t parsedTime = 0;

  if (!parseUtcIso8601(serverTime, &parsedTime)) {
    return false;
  }

  struct timeval syncedTime;
  syncedTime.tv_sec = parsedTime;
  syncedTime.tv_usec = 0;
  settimeofday(&syncedTime, nullptr);
  ntpReady = timeReady();
  return ntpReady;
}

bool parseUtcIso8601(const char* value, time_t* result) {
  if (value == nullptr || result == nullptr) {
    return false;
  }

  if (strchr(value, 'Z') == nullptr) {
    return false;
  }

  int year = 0;
  int month = 0;
  int day = 0;
  int hour = 0;
  int minute = 0;
  int second = 0;
  if (sscanf(value, "%d-%d-%dT%d:%d:%d", &year, &month, &day, &hour, &minute, &second) != 6) {
    return false;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 ||
      hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 60) {
    return false;
  }

  int64_t epoch = daysFromCivil(year, static_cast<unsigned>(month), static_cast<unsigned>(day));
  epoch = (epoch * 86400LL) + (hour * 3600LL) + (minute * 60LL) + second;
  if (epoch < MIN_VALID_UNIX_TIME) {
    return false;
  }

  *result = static_cast<time_t>(epoch);
  return true;
}

int64_t daysFromCivil(int year, unsigned month, unsigned day) {
  year -= month <= 2 ? 1 : 0;
  const int era = (year >= 0 ? year : year - 399) / 400;
  const unsigned yearOfEra = static_cast<unsigned>(year - era * 400);
  const unsigned dayOfYear = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1;
  const unsigned dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear;
  return static_cast<int64_t>(era) * 146097LL + static_cast<int64_t>(dayOfEra) - 719468LL;
}

const char* currentUiName() {
  switch (currentUi) {
    case UI_HOME:
      return "home";
    case UI_MENU:
      return "menu";
    case UI_SCHEDULES:
      return "schedules";
    case UI_WIFI:
      return "wifi";
  }

  return "unknown";
}

const char* currentMenuLabel() {
  switch (currentUi) {
    case UI_HOME:
      return "home";
    case UI_MENU:
      return "menu";
    case UI_SCHEDULES:
      return "schedule_view";
    case UI_WIFI:
      return "wifi_info";
  }

  return "unknown";
}

int wrapValue(int value, int minValue, int maxValue) {
  if (value < minValue) {
    return maxValue;
  }

  if (value > maxValue) {
    return minValue;
  }

  return value;
}

void copyJsonText(JsonVariant value, char* target, size_t targetSize, const char* fallback) {
  const char* text = value.is<const char*>() ? value.as<const char*>() : fallback;
  strncpy(target, text, targetSize - 1);
  target[targetSize - 1] = '\0';
}

String currentTimestampIso() {
  if (!timeReady()) {
    return "";
  }

  time_t now = time(nullptr);
  struct tm timeInfo;
  gmtime_r(&now, &timeInfo);

  char buffer[25];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &timeInfo);
  return String(buffer);
}
