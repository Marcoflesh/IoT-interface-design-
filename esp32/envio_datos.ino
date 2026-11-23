/*
 * envio_datos.ino
 * Fragmento para su firmware: reemplaza el envío a Ubidots.
 * Cada 20 s manda la misma lectura a dos destinos:
 *   1) ThingSpeak  → lo que lee la página en GitHub Pages
 *   2) API propia  → la guarda en MariaDB (Docker en la laptop)
 *
 * Mapeo en ThingSpeak (debe coincidir con docs/js/config.js):
 *   field1 = pH · field2 = Turbidez (NTU) · field3 = Conductividad (µS/cm) · field4 = Temperatura (°C)
 *
 * Llaves y red: copien secretos.example.h como secretos.h.
 *
 * Antes de este firmware, prueben la red con prueba_red/prueba_red.ino (esp32/README.md).
 *
 * ¿La red no deja que el ESP32 vea la laptop? Usen solo enviarThingSpeak(): el puente
 * ThingSpeak → MariaDB (FEDORA.md, Paso 11) copia las lecturas a la base desde la laptop.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "secretos.h"

const unsigned long INTERVALO_ENVIO_MS = 20000;   // ThingSpeak gratis: mínimo 15 s
unsigned long ultimoEnvio = 0;

// ---------- WiFi ----------
// Conecta con red normal (WPA2) o con usuario + contraseña (WPA2-Enterprise, PEAP),
// según WIFI_EMPRESARIAL en secretos.h. Regresa true si obtuvo IP a tiempo.
// Llámenla en setup() y al inicio de cada envío: si el WiFi se cayó, reconecta.
bool conectarWiFi(unsigned long esperaMs = 20000) {
  if (WiFi.status() == WL_CONNECTED) return true;

  WiFi.mode(WIFI_STA);
  if (WIFI_EMPRESARIAL) {
    // PEAP + MSCHAPv2, sin certificado. Requiere el core de ESP32 2.0.3 o más nuevo.
    WiFi.begin(WIFI_SSID, WPA2_AUTH_PEAP, WIFI_USUARIO, WIFI_USUARIO, WIFI_PASSWORD);
  } else {
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }

  Serial.printf("Conectando a %s", WIFI_SSID);
  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < esperaMs) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    if (WiFi.status() == WL_NO_SSID_AVAIL) {
      Serial.println("No encuentra la red: revisen el nombre y que sea de 2.4 GHz.");
    } else {
      Serial.println("No se conectó: revisen contraseña, usuario y WIFI_EMPRESARIAL.");
    }
    return false;
  }
  Serial.printf("WiFi OK · IP %s · RSSI %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  return true;
}

// Convierte una lectura a texto JSON. Si el sensor falló (NaN), manda null.
String jsonNumero(float valor, int decimales) {
  if (isnan(valor)) return "null";
  return String(valor, decimales);
}

// ---------- 1) ThingSpeak ----------
// Regresa el entry_id (> 0) si se guardó; 0 si ThingSpeak lo rechazó por enviar muy seguido.
long enviarThingSpeak(float ph, float turbidez, float conductividad, float temperatura) {
  if (WiFi.status() != WL_CONNECTED) return -1;

  WiFiClientSecure cliente;
  cliente.setInsecure();   // Prototipo: HTTPS sin validar certificado.

  String url = "https://api.thingspeak.com/update?api_key=";
  url += TS_WRITE_KEY;
  if (!isnan(ph))            url += "&field1=" + String(ph, 2);
  if (!isnan(turbidez))      url += "&field2=" + String(turbidez, 1);
  if (!isnan(conductividad)) url += "&field3=" + String(conductividad, 0);
  if (!isnan(temperatura))   url += "&field4=" + String(temperatura, 1);

  HTTPClient http;
  http.begin(cliente, url);
  int codigo = http.GET();
  long entrada = -2;
  if (codigo == 200) entrada = http.getString().toInt();
  http.end();
  return entrada;
}

// ---------- 2) API propia → MariaDB ----------
// Regresa el código HTTP: 201 = guardado, 400 = dato inválido, 401 = llave incorrecta.
int enviarAPI(float ph, float turbidez, float conductividad, float temperatura) {
  if (WiFi.status() != WL_CONNECTED) return -1;

  String cuerpo = "{\"dispositivo\":\"esp32-1\"";
  cuerpo += ",\"ph\":"            + jsonNumero(ph, 2);
  cuerpo += ",\"turbidez\":"      + jsonNumero(turbidez, 1);
  cuerpo += ",\"conductividad\":" + jsonNumero(conductividad, 1);
  cuerpo += ",\"temperatura\":"   + jsonNumero(temperatura, 1);
  cuerpo += ",\"rssi\":"          + String(WiFi.RSSI());     // intensidad WiFi (diagnóstico)
  cuerpo += ",\"firmware\":\"v1.0.0\"";                     // súbanla cuando cambien el código
  // Opcional: voltajes crudos para depurar calibraciones (columnas ph_v, turbidez_v, conductividad_v):
  // cuerpo += ",\"ph_v\":" + jsonNumero(phVoltaje, 3);
  cuerpo += "}";

  HTTPClient http;
  http.begin(API_URL);           // http:// dentro de la red local
  http.setTimeout(5000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);
  int codigo = http.POST(cuerpo);
  if (codigo != 201) {
    Serial.print("API respondió: ");
    Serial.println(http.getString());
  }
  http.end();
  return codigo;
}

/*
 * En su setup():
 *
 *   Serial.begin(115200);
 *   conectarWiFi();
 *
 * En su loop(), después de leer los sensores (en lugar del envío a Ubidots):
 *
 *   if (millis() - ultimoEnvio >= INTERVALO_ENVIO_MS) {
 *     ultimoEnvio = millis();
 *     conectarWiFi();   // no hace nada si ya está conectado
 *
 *     long ts = enviarThingSpeak(ph, turbidez, conductividad, temperatura);
 *     int api = enviarAPI(ph, turbidez, conductividad, temperatura);
 *
 *     Serial.printf("ThingSpeak entry_id: %ld · API HTTP: %d\n", ts, api);
 *   }
 *
 * Si un sensor falla, asígnenle NAN (ej. turbidez = NAN;): ThingSpeak omite ese field
 * y la API guarda null. Nunca manden 0 como "sin dato".
 * Si la laptop está apagada, enviarAPI() falla pero ThingSpeak sigue recibiendo datos.
 */
