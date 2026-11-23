// Copia este archivo como secretos.h (está en .gitignore) y llena tus datos.
// En la carpeta prueba_red/ también va una copia de secretos.h.
#pragma once

// ---------- WiFi ----------
// El ESP32 solo ve redes de 2.4 GHz. En el hotspot del iPhone activen "Maximizar compatibilidad".
const char* WIFI_SSID     = "TU_RED";
const char* WIFI_PASSWORD = "TU_CLAVE";

// Red con usuario + contraseña (WPA2-Enterprise, como la del Tec): pongan true
// y llenen WIFI_USUARIO con lo mismo que escriben en la laptop para entrar a esa red.
// Con una red normal (casa, hotspot) déjenlo en false y WIFI_USUARIO vacío.
const bool  WIFI_EMPRESARIAL = false;
const char* WIFI_USUARIO     = "";

// ---------- ThingSpeak ----------
// Write API Key del canal (pestaña API Keys)
const char* TS_WRITE_KEY  = "PEGAR_WRITE_API_KEY";

// ---------- API propia (MariaDB en la laptop) ----------
// IP de la laptop que corre Docker, en la MISMA red que el ESP32.
// Fedora: hostname -I  ·  Windows: ipconfig (Dirección IPv4 del adaptador Wi-Fi)
// Hotspot de la laptop: Fedora 10.42.0.1 · Windows 192.168.137.1
const char* API_URL       = "http://192.168.1.50:8080/api/lecturas";
const char* API_KEY       = "LA_MISMA_ESP32_API_KEY_DEL_ARCHIVO_.env";
