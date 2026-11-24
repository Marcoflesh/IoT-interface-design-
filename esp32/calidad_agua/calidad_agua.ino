/*
 * calidad_agua.ino · firmware del ESP32 del equipo
 *
 * Es el programa del equipo (TDS, DS18B20 y HC-SR04T) con lo necesario para que
 * las lecturas lleguen a MariaDB (por la API de la laptop) y a ThingSpeak:
 *   - Manda el header X-API-Key. Sin él la API responde 401 y no guarda nada.
 *   - Usa los nombres que entiende la API: conductividad (µS/cm) y temperatura (°C).
 *     pH y turbidez van como null hasta conectar esos sensores.
 *   - Primero publica en ThingSpeak y manda a la API el entry_id que le dio: así el
 *     puente no copia esa lectura otra vez y en MariaDB queda una sola fila en esp32-1.
 *   - La distancia del HC-SR04T solo se muestra en el monitor serie (no se guarda).
 *   - Si un sensor falla manda null, nunca un valor viejo ni 0.
 *   - Envía cada 20 s (ThingSpeak gratis pide mínimo 15 s) e imprime lo que responde la API.
 *   - WiFi y llaves viven en secretos.h, que no se sube a GitHub.
 *
 * Copien ../secretos.example.h como secretos.h DENTRO de esta carpeta y llénenlo.
 * Librerías (Arduino IDE → Gestor de librerías): OneWire y DallasTemperature.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include "secretos.h"

// ---------- CONFIGURACIÓN ----------

const char* DISPOSITIVO = "esp32-1";   // el único dispositivo que acepta la API
const char* FIRMWARE    = "v1.2.0";    // súbanla cuando cambien el código

// Pines
#define TDS_PIN   36    // ADC1 (VP): sigue funcionando con el WiFi encendido
#define TEMP_PIN  4
#define TRIG_PIN  16
#define ECHO_PIN  17    // el echo del HC-SR04T sale a 5 V: bájenlo a 3.3 V en la PCB

#define SCOUNT 30       // muestras de TDS para la mediana

// Intervalos (ms)
#define TDS_SAMPLE_INTERVAL  40
#define READ_INTERVAL        1000    // el DS18B20 tarda hasta 750 ms en convertir
#define SEND_INTERVAL        20000

// ---------- VARIABLES GLOBALES ----------

OneWire oneWire(TEMP_PIN);
DallasTemperature tempSensor(&oneWire);

int analogBuffer[SCOUNT];     // milivolts
int analogBufferIndex = 0;

float temperatura   = NAN;    // °C
float conductividad = NAN;    // µS/cm
float tds           = NAN;    // ppm (conductividad x 0.5)
float distancia     = NAN;    // cm del sensor a la superficie (solo monitor serie)

unsigned long lastTdsSample = 0;
unsigned long lastRead = 0;
unsigned long lastSend = 0;

// ---------- WIFI ----------

void conectarWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.print("Conectando a ");
  Serial.print(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  if (WIFI_EMPRESARIAL) {
    // Red con usuario + contraseña (PEAP). Tec-IoT solo pide contraseña: déjenlo en false.
    WiFi.begin(WIFI_SSID, WPA2_AUTH_PEAP, WIFI_USUARIO, WIFI_USUARIO, WIFI_PASSWORD);
  } else {
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }

  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < 15000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("\nConectado. IP: ");
    Serial.print(WiFi.localIP());
    Serial.print(" · señal ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  } else {
    Serial.println("\nNo se pudo conectar al WiFi");
  }
}

// ---------- ENVÍO ----------

// Número para JSON: null si el sensor falló.
String numeroJSON(float v, int decimales) {
  if (isnan(v)) return "null";
  return String(v, decimales);
}

// API de la laptop → MariaDB. Regresa el código HTTP (201 = guardado).
// entradaTS: entry_id que dio ThingSpeak a esta lectura (0 si no se publicó).
int enviarAPI(long entradaTS) {
  String json = "{\"dispositivo\":\"" + String(DISPOSITIVO) + "\"";
  json += ",\"ph\":null";
  json += ",\"turbidez\":null";
  json += ",\"conductividad\":" + numeroJSON(conductividad, 1);
  json += ",\"temperatura\":" + numeroJSON(temperatura, 2);
  if (entradaTS > 0) json += ",\"ts_entry_id\":" + String(entradaTS);
  json += ",\"rssi\":" + String(WiFi.RSSI());
  json += ",\"firmware\":\"" + String(FIRMWARE) + "\"}";

  HTTPClient http;
  http.begin(API_URL);
  http.setTimeout(5000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);
  int codigo = http.POST(json);

  Serial.print("API -> ");
  Serial.print(codigo);
  if (codigo == 201) {
    Serial.println(" guardado en MariaDB");
  } else if (codigo < 0) {
    Serial.println(" no llega a la laptop: revisen API_URL, Docker, firewall y que estén en la misma red");
  } else {
    Serial.print(" ");
    Serial.println(http.getString());   // la API explica qué estuvo mal
  }
  http.end();
  return codigo;
}

// ThingSpeak → lo que lee la página en GitHub Pages. Se salta si no hay Write Key.
// field3 = conductividad · field4 = temperatura (field1 pH y field2 turbidez cuando los conecten)
// Regresa el entry_id que dio ThingSpeak (0 = rechazada o no enviada).
long enviarThingSpeak() {
  if (strlen(TS_WRITE_KEY) < 10 || strncmp(TS_WRITE_KEY, "PEGAR", 5) == 0) return 0;

  String url = "https://api.thingspeak.com/update?api_key=";
  url += TS_WRITE_KEY;
  if (!isnan(conductividad)) url += "&field3=" + String(conductividad, 0);
  if (!isnan(temperatura))   url += "&field4=" + String(temperatura, 1);

  WiFiClientSecure cliente;
  cliente.setInsecure();   // prototipo: HTTPS sin validar certificado
  HTTPClient http;
  http.begin(cliente, url);
  int codigo = http.GET();
  long entrada = 0;
  Serial.print("ThingSpeak -> ");
  if (codigo == 200) {
    entrada = http.getString().toInt();   // 0 = la rechazó por mandar muy seguido
    Serial.print("entrada ");
    Serial.println(entrada);
  } else {
    Serial.println(codigo);
  }
  http.end();
  return entrada;
}

void enviarDatos() {
  conectarWiFi();
  if (WiFi.status() != WL_CONNECTED) return;
  long entrada = enviarThingSpeak();   // primero ThingSpeak, para mandar su entry_id a la API
  enviarAPI(entrada);
}

// ---------- SENSOR DE TEMPERATURA (DS18B20) ----------

void iniciarTemperatura() {
  tempSensor.begin();
  tempSensor.setWaitForConversion(false);   // no frena el loop mientras convierte
  tempSensor.requestTemperatures();
}

// Lee la conversión anterior y pide la siguiente.
float leerTemperatura() {
  float t = tempSensor.getTempCByIndex(0);
  tempSensor.requestTemperatures();
  if (t == DEVICE_DISCONNECTED_C) {   // -127 = sensor desconectado
    Serial.println("Error: DS18B20 no detectado");
    return NAN;
  }
  return t;
}

// ---------- SENSOR TDS (Keyestudio TDS V1) ----------

void iniciarTDS() {
  pinMode(TDS_PIN, INPUT);
}

// Llamar seguido desde loop(); toma una muestra cada 40 ms.
// analogReadMilliVolts usa la calibración de fábrica del ESP32: más exacto que crudo x 3.3 / 4096.
void muestrearTDS() {
  if (millis() - lastTdsSample >= TDS_SAMPLE_INTERVAL) {
    lastTdsSample = millis();
    analogBuffer[analogBufferIndex] = analogReadMilliVolts(TDS_PIN);
    analogBufferIndex = (analogBufferIndex + 1) % SCOUNT;
  }
}

int getMedianNum(int bArray[], int iFilterLen) {
  int bTab[iFilterLen];
  for (int i = 0; i < iFilterLen; i++) bTab[i] = bArray[i];

  for (int j = 0; j < iFilterLen - 1; j++) {
    for (int i = 0; i < iFilterLen - j - 1; i++) {
      if (bTab[i] > bTab[i + 1]) {
        int tmp = bTab[i];
        bTab[i] = bTab[i + 1];
        bTab[i + 1] = tmp;
      }
    }
  }

  if (iFilterLen & 1) return bTab[(iFilterLen - 1) / 2];
  return (bTab[iFilterLen / 2] + bTab[iFilterLen / 2 - 1]) / 2;
}

// Conductividad en µS/cm (curva del módulo). El TDS en ppm es la mitad.
float leerConductividad(float tempC) {
  int copia[SCOUNT];
  for (int i = 0; i < SCOUNT; i++) copia[i] = analogBuffer[i];

  float voltaje = getMedianNum(copia, SCOUNT) / 1000.0;
  if (isnan(tempC)) tempC = 25.0;               // sin temperatura, se asume 25 °C
  float coef = 1.0 + 0.02 * (tempC - 25.0);     // compensación por temperatura
  float v = voltaje / coef;

  return 133.42 * v * v * v - 255.86 * v * v + 857.39 * v;
}

// ---------- SENSOR ULTRASÓNICO (HC-SR04T) ----------

void iniciarUltrasonico() {
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
}

float leerDistancia() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(5);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duracion = pulseIn(ECHO_PIN, HIGH, 30000);  // timeout 30 ms
  if (duracion == 0) return NAN;                   // sin eco
  return duracion * 0.0343 / 2.0;                  // cm
}

// ---------- SETUP / LOOP ----------

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.printf("\nCalidad del agua · %s · firmware %s\n", DISPOSITIVO, FIRMWARE);

  iniciarTemperatura();
  iniciarTDS();
  iniciarUltrasonico();
  conectarWiFi();
}

void loop() {
  muestrearTDS();

  if (millis() - lastRead >= READ_INTERVAL) {
    lastRead = millis();

    temperatura   = leerTemperatura();
    conductividad = leerConductividad(temperatura);
    tds           = conductividad * 0.5;
    distancia     = leerDistancia();

    Serial.printf("Temp: %.2f C | Cond: %.0f uS/cm (TDS %.0f ppm) | Distancia: %.1f cm\n",
                  temperatura, conductividad, tds, distancia);
  }

  if (millis() - lastSend >= SEND_INTERVAL) {
    lastSend = millis();
    enviarDatos();
  }
}
