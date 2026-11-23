/*
 * prueba_red.ino
 * Sketch de diagnóstico: súbanlo ANTES del firmware real para saber si la red sirve.
 * No usa sensores. Abran el Monitor serie a 115200.
 *
 * Revisa, en orden:
 *   1) Que el ESP32 entre al WiFi (normal o con usuario, según secretos.h)
 *   2) Que tenga internet (ThingSpeak)
 *   3) Que vea a la laptop:     GET  http://IP:8080/api/salud      → 200
 *   4) Que la API lo acepte:    POST http://IP:8080/api/lecturas   → 201
 * Y lo repite cada 30 s, para que puedan arreglar el firewall o la IP y ver el cambio sin resubir.
 *
 * Copien ../secretos.h dentro de esta carpeta (prueba_red/secretos.h). Está en .gitignore.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "secretos.h"

// La lectura de prueba se guarda con este dispositivo para no mezclarse con esp32-1.
const char* DISPOSITIVO_PRUEBA = "esp32-prueba-red";
const bool ENVIAR_LECTURA_PRUEBA = true;

String urlSalud() {
  String u = API_URL;
  u.replace("/api/lecturas", "/api/salud");
  return u;
}

bool conectarWiFi(unsigned long esperaMs = 20000) {
  if (WiFi.status() == WL_CONNECTED) return true;

  WiFi.mode(WIFI_STA);
  if (WIFI_EMPRESARIAL) {
    // PEAP + MSCHAPv2, sin certificado. Requiere el core de ESP32 2.0.3 o más nuevo.
    WiFi.begin(WIFI_SSID, WPA2_AUTH_PEAP, WIFI_USUARIO, WIFI_USUARIO, WIFI_PASSWORD);
  } else {
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }

  Serial.printf("Conectando a %s%s", WIFI_SSID, WIFI_EMPRESARIAL ? " (con usuario)" : "");
  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < esperaMs) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  return WiFi.status() == WL_CONNECTED;
}

void probarInternet() {
  WiFiClientSecure cliente;
  cliente.setInsecure();
  cliente.setTimeout(5);
  bool ok = cliente.connect("api.thingspeak.com", 443);
  cliente.stop();
  Serial.printf("[2] Internet (ThingSpeak): %s\n",
                ok ? "OK" : "FALLA · la red no da internet o pide iniciar sesión en una página");
}

bool probarSalud() {
  HTTPClient http;
  http.begin(urlSalud());
  http.setTimeout(5000);
  int codigo = http.GET();
  String cuerpo = codigo > 0 ? http.getString() : "";
  http.end();

  if (codigo == 200) {
    Serial.printf("[3] Laptop: OK · %s\n", cuerpo.c_str());
    return true;
  }
  if (codigo < 0) {
    Serial.printf("[3] Laptop: NO RESPONDE (%s)\n", HTTPClient::errorToString(codigo).c_str());
    Serial.println("    Revisen: IP en API_URL, Docker encendido, puerto 8080 en el firewall,");
    Serial.println("    y que ESP32 y laptop estén en la misma red. Si todo eso está bien, la red");
    Serial.println("    aísla dispositivos: usen el hotspot de un celular o solo ThingSpeak + puente.");
  } else {
    Serial.printf("[3] Laptop respondió %d: %s\n", codigo, cuerpo.c_str());
  }
  return false;
}

void probarLectura() {
  String cuerpo = "{\"dispositivo\":\"";
  cuerpo += DISPOSITIVO_PRUEBA;
  cuerpo += "\",\"ph\":7.00,\"turbidez\":null,\"conductividad\":400.0,\"temperatura\":22.0";
  cuerpo += ",\"rssi\":" + String(WiFi.RSSI());
  cuerpo += ",\"firmware\":\"prueba-red\"}";

  HTTPClient http;
  http.begin(API_URL);
  http.setTimeout(5000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);
  int codigo = http.POST(cuerpo);
  String respuesta = codigo > 0 ? http.getString() : "";
  http.end();

  if (codigo == 201)      Serial.println("[4] API: 201 · lectura de prueba guardada en MariaDB");
  else if (codigo == 401) Serial.println("[4] API: 401 · API_KEY no es igual a ESP32_API_KEY del .env");
  else                    Serial.printf("[4] API: %d %s\n", codigo, respuesta.c_str());
}

void diagnostico() {
  Serial.println("\n========== Prueba de red ==========");
  if (!conectarWiFi()) {
    int estado = WiFi.status();
    Serial.printf("[1] WiFi: FALLA (estado %d)\n", estado);
    if (estado == WL_NO_SSID_AVAIL) {
      Serial.println("    No encuentra la red: revisen el nombre y que sea de 2.4 GHz.");
    } else {
      Serial.println("    Revisen contraseña; si la red pide usuario, WIFI_EMPRESARIAL = true.");
    }
    return;
  }

  Serial.printf("[1] WiFi: OK · red %s\n", WIFI_SSID);
  Serial.printf("    IP del ESP32: %s · puerta de enlace: %s · máscara: %s\n",
                WiFi.localIP().toString().c_str(),
                WiFi.gatewayIP().toString().c_str(),
                WiFi.subnetMask().toString().c_str());
  Serial.printf("    Señal: %d dBm (mejor que -70 está bien) · MAC: %s\n",
                WiFi.RSSI(), WiFi.macAddress().c_str());
  Serial.printf("    Buscando la laptop en: %s\n", urlSalud().c_str());

  probarInternet();
  if (probarSalud() && ENVIAR_LECTURA_PRUEBA) probarLectura();
}

void setup() {
  Serial.begin(115200);
  delay(500);
  diagnostico();
}

void loop() {
  delay(30000);
  diagnostico();
}
