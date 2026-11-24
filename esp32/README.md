# ESP32 · sensores y conexión a la red

## Pines del firmware actual

| Sensor | Pin |
| --- | --- |
| TDS (Keyestudio TDS V1) | GPIO36 (VP, ADC1) |
| DS18B20 | GPIO4 |
| HC-SR04T trigger | GPIO16 |
| HC-SR04T echo | GPIO17 (a 3.3 V) |
| PH-4502C, TSW-10 | Sin conectar todavía: van como `null` |

## Qué manda a la API

```json
{"dispositivo":"esp32-1","ph":null,"turbidez":null,"conductividad":412.3,"temperatura":22.40,"ts_entry_id":57,"rssi":-61,"firmware":"v1.2.0"}
```

`dispositivo` solo puede ser `esp32-1`: la API rechaza cualquier otro. `ts_entry_id` es la entrada que ThingSpeak le dio a esa misma lectura; con él el puente no la copia otra vez. Va con el header `X-API-Key`. Respuestas: `201` guardado, `400` un dato no tiene sentido (la API dice cuál), `401` falta la llave o no coincide, número negativo = no llegó a la laptop.

## Hardware

| Pieza | Modelo | Variable | Señal | Estado |
| --- | --- | --- | --- | --- |
| Microcontrolador | ESP32-WROOM-32 (DevKit 38 pines) | — | — | Lo tienen |
| pH | PH-4502C | pH | Analógica | Lo tienen |
| Conductividad | Keyestudio TDS V1 | µS/cm | Analógica | Lo tienen |
| Temperatura | DS18B20 | °C | Digital 1-Wire | Lo tienen |
| Nivel | HC-SR04T | cm (distancia a la superficie) | Digital (trigger + echo) | Lo tienen; solo sale en el monitor serie, no se guarda |
| Turbidez | TSW-10 | NTU | Analógica | Falta comprarlo |

Para la PCB:

- Con el WiFi encendido, el ESP32 solo lee analógico en el ADC1 (GPIO32 a GPIO39). pH, TDS y turbidez van ahí.
- El echo del HC-SR04T sale a 5 V; el ESP32 aguanta 3.3 V.
- Sin el TSW-10, manden `turbidez = NAN;`. ThingSpeak omite el field y la API guarda `null`. El semáforo queda en gris porque le falta una variable.

## Archivos

| Archivo | Para qué |
| --- | --- |
| `secretos.example.h` | Plantilla de WiFi y llaves. Cópienla como `secretos.h` (no se sube a GitHub). |
| `prueba_red/prueba_red.ino` | Diagnóstico de red, sin sensores. Súbanlo primero. |
| `calidad_agua/calidad_agua.ino` | El firmware del equipo listo para la API y ThingSpeak: TDS, DS18B20 y HC-SR04T. |

Los dos sketches no se han compilado todavía en un ESP32 real. Usen el core de ESP32 2.0.3 o más nuevo (Arduino IDE → Gestor de tarjetas → esp32 de Espressif).

## Paso a paso: ESP32 → laptop

Para ThingSpeak basta con internet. Para la laptop, ESP32 y laptop deben estar en la **misma red** y la red debe dejar que se vean. El camino seguro es el **hotspot de un celular** en 2.4 GHz (iPhone: "Maximizar compatibilidad").

1. **Prendan la laptop.** Docker como en `FEDORA.md` o `WINDOWS.md`. Abran `http://localhost:8080/api/salud`: debe decir `"ok":true`.
2. **Misma red.** Laptop y ESP32 al mismo WiFi de 2.4 GHz.
3. **IP de la laptop.**
   - Fedora: `hostname -I` (la primera)
   - Windows: `ipconfig` → "Dirección IPv4" del adaptador Wi-Fi
   - Hotspot de la propia laptop: Fedora `10.42.0.1`, Windows `192.168.137.1`
4. **Puerto 8080 abierto.**
   - Fedora: `sudo firewall-cmd --permanent --add-port=8080/tcp && sudo firewall-cmd --reload`
     (con el hotspot de la laptop, revisen `sudo firewall-cmd --get-active-zones` y abran el puerto en la zona de esa interfaz con `--zone=`)
   - Windows, PowerShell como administrador: `powershell -ExecutionPolicy Bypass -File scripts\windows\abrir-firewall.ps1`
5. **Prueba con un celular** en la misma red: `http://IP-DE-LA-LAPTOP:8080/api/salud`. Si el celular la ve, el ESP32 también.
6. **`secretos.h`**: `WIFI_SSID`, `WIFI_PASSWORD`, `API_URL = "http://IP-DE-LA-LAPTOP:8080/api/lecturas"` y `API_KEY` igual a `ESP32_API_KEY` del `.env`.
7. **Suban `prueba_red/prueba_red.ino`** con una copia de `secretos.h` en `prueba_red/`. Monitor serie a 115200. Deben salir los cuatro pasos OK; el [4] revisa la llave sin guardar ninguna lectura. Se repite cada 30 s.
8. **Suban `calidad_agua/calidad_agua.ino`** (con su propio `secretos.h`) y revisen las lecturas con `scripts/fedora/ver-mariadb.sh` o `scripts\windows\ver-mariadb.ps1`.

## Red del Tec

Pide usuario y contraseña (WPA2-Enterprise). En `secretos.h`:

```cpp
const char* WIFI_SSID     = "NOMBRE_DE_LA_RED";
const char* WIFI_PASSWORD = "contraseña de la cuenta";
const bool  WIFI_EMPRESARIAL = true;
const char* WIFI_USUARIO     = "el mismo usuario que usan en la laptop";
```

El firmware usa PEAP + MSCHAPv2 sin certificado, lo más común en universidades. No está confirmada la configuración exacta del Tec: copien lo que usa la laptop para entrar a esa red.

- Es la cuenta personal de alguien del equipo y queda en el ESP32. `secretos.h` nunca va a GitHub.
- Si la prueba dice que hay internet pero la laptop no responde, la red aísla dispositivos. Dejen solo ThingSpeak y prendan el puente (`FEDORA.md`, Paso 11): las lecturas llegan igual a MariaDB.
- Si no entra aunque los datos estén bien, pregunten al profesor si hay una red para dispositivos IoT. La prueba imprime la MAC por si TI la pide.

## Si algo falla

| La prueba dice | Causa probable | Qué hacer |
| --- | --- | --- |
| `[1] WiFi: FALLA`, no encuentra la red | 5 GHz o nombre mal escrito | Hotspot en 2.4 GHz, revisen mayúsculas |
| `[1] WiFi: FALLA` con la red visible | Contraseña, o la red pide usuario | Revisen la clave; si pide usuario, `WIFI_EMPRESARIAL = true` |
| `[2] Internet: FALLA` | Red con página de inicio de sesión, o sin internet | Usen otra red |
| `[3] Laptop: NO RESPONDE` | IP, Docker apagado, firewall o red aislada | Pasos 3 a 5; si el celular tampoco la ve, cambien de red |
| `[4] Llave: MAL` | Llave distinta | `API_KEY` = `ESP32_API_KEY` del `.env`, sin espacios |

La IP de la laptop cambia con cada red. Revísenla antes de cada demo.
