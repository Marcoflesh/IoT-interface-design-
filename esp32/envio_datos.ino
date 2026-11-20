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
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "secretos.h"

const unsigned long INTERVALO_ENVIO_MS = 20000;   // ThingSpeak gratis: mínimo 15 s
unsigned long ultimoEnvio = 0;

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
 * En su loop(), después de leer los sensores (en lugar del envío a Ubidots):
 *
 *   if (millis() - ultimoEnvio >= INTERVALO_ENVIO_MS) {
 *     ultimoEnvio = millis();
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
