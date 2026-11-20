/*
 * thingspeak_envio.ino
 * Fragmento para AGREGAR a su firmware actual (el que ya manda a Ubidots).
 * No reemplaza su código: añade una función que publica las mismas lecturas en ThingSpeak.
 *
 * Mapeo de campos (debe coincidir con docs/js/config.js):
 *   field1 = pH
 *   field2 = Turbidez (NTU)
 *   field3 = Conductividad (µS/cm)
 *   field4 = Temperatura (°C)   (opcional)
 *
 * Límite de ThingSpeak gratis: 1 envío cada 15 s por canal. Aquí se usa 20 s.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

// Copien estas dos líneas a un archivo secretos.h (está en .gitignore) para no subir la llave a GitHub.
const char* TS_WRITE_KEY = "PEGAR_WRITE_API_KEY";
const unsigned long TS_INTERVALO_MS = 20000;

unsigned long tsUltimoEnvio = 0;

// Devuelve el entry_id que asignó ThingSpeak (> 0) o 0 / negativo si falló.
long enviarThingSpeak(float ph, float turbidez, float conductividad, float temperatura) {
  if (WiFi.status() != WL_CONNECTED) return -1;

  WiFiClientSecure cliente;
  cliente.setInsecure();   // Simplifica HTTPS en el prototipo (no valida el certificado).

  HTTPClient http;
  String url = "https://api.thingspeak.com/update?api_key=";
  url += TS_WRITE_KEY;
  url += "&field1=" + String(ph, 2);
  url += "&field2=" + String(turbidez, 1);
  url += "&field3=" + String(conductividad, 0);
  url += "&field4=" + String(temperatura, 1);

  http.begin(cliente, url);
  int codigo = http.GET();
  long entrada = -2;
  if (codigo == 200) entrada = http.getString().toInt();   // "0" = rechazado por enviar antes de 15 s
  http.end();
  return entrada;
}

/*
 * En su loop(), después de leer los sensores y de enviar a Ubidots:
 *
 *   if (millis() - tsUltimoEnvio >= TS_INTERVALO_MS) {
 *     tsUltimoEnvio = millis();
 *     long id = enviarThingSpeak(ph, turbidez, conductividad, temperatura);
 *     Serial.print("ThingSpeak entry_id: ");
 *     Serial.println(id);
 *   }
 *
 * Si un sensor falla, NO manden 0: omitan ese field (quiten esa línea de la URL).
 * La página interpreta un field vacío como "sin dato" y pone el semáforo en gris,
 * en lugar de clasificar un 0 falso.
 */
