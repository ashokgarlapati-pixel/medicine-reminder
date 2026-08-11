/*
 * ESP32 Medicine Reminder Appliance Firmware
 *
 * Hardware Configuration:
 * - ESP32 Development Board
 * - Active Buzzer: GPIO 23
 * - Alert LED: GPIO 22
 * - Push Button (Acknowledge): GPIO 19 (Internal Pull-Up enabled)
 * - SSD1306 OLED Display (Optional): I2C SDA=21, SCL=22
 *
 * Workflow:
 * 1. Connects to Wi-Fi network.
 * 2. Sends heartbeat to server (/api/devices/heartbeat) every 30 seconds.
 * 3. Syncs reminder schedule from server (/api/devices/sync/<DEVICE_ID>) every 60 seconds.
 * 4. Compares local RTC time with medicine schedule.
 * 5. Triggers Buzzer + LED + OLED display when alarm matches.
 * 6. Sends 'taken' acknowledgement (/api/devices/acknowledge) when physical button is pressed.
 * 7. Automatically handles reconnection.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <Wire.h>

// WiFi Configuration
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Server API Configuration
const char* DEVICE_ID     = "ESP32-MED-01";
const char* SERVER_URL    = "http://192.168.1.100:5000/api/devices"; // Replace with server IP

// Hardware Pins
const int BUZZER_PIN = 23;
const int LED_PIN    = 22;
const int BUTTON_PIN = 19;

// Timing variables
unsigned long lastHeartbeatTime = 0;
unsigned long lastSyncTime      = 0;
const unsigned long HEARTBEAT_INTERVAL = 30000; // 30s
const unsigned long SYNC_INTERVAL      = 60000; // 60s

// State Tracking
bool isAlarmActive = false;
String activeMedicineId = "";
String activeMedicineName = "";

void setup() {
  Serial.begin(115200);
  
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_PIN, LOW);

  connectWiFi();
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  unsigned long currentMillis = millis();

  // Send Heartbeat
  if (currentMillis - lastHeartbeatTime >= HEARTBEAT_INTERVAL) {
    lastHeartbeatTime = currentMillis;
    sendHeartbeat();
  }

  // Sync Schedule
  if (currentMillis - lastSyncTime >= SYNC_INTERVAL) {
    lastSyncTime = currentMillis;
    syncSchedule();
  }

  // Handle Alarm Audio/LED ringing
  if (isAlarmActive) {
    digitalWrite(LED_PIN, (millis() / 500) % 2); // Blink LED
    tone(BUZZER_PIN, 1000, 200);                 // Beep Buzzer

    // Check Physical Button Press to Acknowledge
    if (digitalRead(BUTTON_PIN) == LOW) { // Pressed (Active Low)
      delay(50); // Debounce
      if (digitalRead(BUTTON_PIN) == LOW) {
        Serial.println("[ESP32] Button Pressed! Marking Medicine as TAKEN...");
        sendAcknowledgement(activeMedicineId, "taken");
        stopAlarm();
      }
    }
  }
}

void connectWiFi() {
  Serial.print("[ESP32] Connecting to Wi-Fi: ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[ESP32] Wi-Fi Connected!");
    Serial.print("[ESP32] IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[ESP32] Wi-Fi Connection Failed. Will retry...");
  }
}

void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(SERVER_URL) + "/heartbeat";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<128> doc;
  doc["deviceId"] = DEVICE_ID;
  String jsonBody;
  serializeJson(doc, jsonBody);

  int httpCode = http.POST(jsonBody);
  if (httpCode > 0) {
    Serial.printf("[ESP32] Heartbeat sent (%d)\n", httpCode);
  } else {
    Serial.printf("[ESP32] Heartbeat error: %s\n", http.errorToString(httpCode).c_str());
  }
  http.end();
}

void syncSchedule() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(SERVER_URL) + "/sync/" + String(DEVICE_ID);
  http.begin(url);

  int httpCode = http.GET();
  if (httpCode == HTTP_CODE_OK) {
    String payload = http.getString();
    DynamicJsonDocument doc(4096);
    DeserializationError error = deserializeJson(doc, payload);

    if (!error) {
      JsonArray schedule = doc["schedule"].as<JsonArray>();
      checkScheduleAlarms(schedule);
    }
  }
  http.end();
}

void checkScheduleAlarms(JsonArray schedule) {
  time_t nowSec = time(nullptr);
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) return;

  char currentTimeStr[6];
  snprintf(currentTimeStr, sizeof(currentTimeStr), "%02d:%02d", timeinfo.tm_hour, timeinfo.tm_min);

  for (JsonObject item : schedule) {
    String medId   = item["id"].as<String>();
    String medName = item["name"].as<String>();
    String medTime = item["time"].as<String>();
    String status  = item["status"].as<String>();

    if (medTime == String(currentTimeStr) && status == "pending") {
      if (!isAlarmActive) {
        startAlarm(medId, medName);
      }
    }
  }
}

void startAlarm(String medId, String medName) {
  isAlarmActive = true;
  activeMedicineId = medId;
  activeMedicineName = medName;
  Serial.printf("[ESP32] ALARM TRIGGERED for %s (ID: %s)\n", medName.c_str(), medId.c_str());
}

void stopAlarm() {
  isAlarmActive = false;
  activeMedicineId = "";
  activeMedicineName = "";
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_PIN, LOW);
  noTone(BUZZER_PIN);
  Serial.println("[ESP32] Alarm Stopped.");
}

void sendAcknowledgement(String medId, String statusStr) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String(SERVER_URL) + "/acknowledge";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> doc;
  doc["deviceId"]   = DEVICE_ID;
  doc["medicineId"] = medId;
  doc["status"]     = statusStr;

  String jsonBody;
  serializeJson(doc, jsonBody);

  int httpCode = http.POST(jsonBody);
  if (httpCode > 0) {
    Serial.printf("[ESP32] Acknowledgement sent for %s (%d)\n", medId.c_str(), httpCode);
  }
  http.end();
}
