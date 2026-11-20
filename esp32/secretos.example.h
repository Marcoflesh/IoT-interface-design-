// Copia este archivo como secretos.h (está en .gitignore) y llena tus datos.
#pragma once

const char* WIFI_SSID     = "TU_RED";
const char* WIFI_PASSWORD = "TU_CLAVE";

// ThingSpeak: Write API Key del canal (pestaña API Keys)
const char* TS_WRITE_KEY  = "PEGAR_WRITE_API_KEY";

// API propia (MariaDB). IP de la laptop que corre Docker, en la misma red WiFi.
// Windows: ipconfig  ·  Mac: ipconfig getifaddr en0  ·  Linux: hostname -I
const char* API_URL       = "http://192.168.1.50:8080/api/lecturas";
const char* API_KEY       = "LA_MISMA_ESP32_API_KEY_DEL_ARCHIVO_.env";
