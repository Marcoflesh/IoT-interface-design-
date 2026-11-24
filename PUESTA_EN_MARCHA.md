# Puesta en marcha final · ESP32 real, canal nuevo y base limpia

Guía para dejar todo funcionando desde cero con el ESP32 terminado, en Fedora:

- un **canal nuevo y privado** de ThingSpeak,
- una **base de MariaDB nueva y vacía** (sin nada de simulaciones ni pruebas),
- la **página en localhost** leyendo MariaDB y la **página en GitHub Pages** leyendo ThingSpeak,
- la **recepción directa** (ESP32 → API) y el **puente** (ThingSpeak → MariaDB) encendidos a la vez, sin lecturas repetidas.

Los pasos también están en [FEDORA.md](FEDORA.md), Paso 12. Si algo falla, la tabla de problemas está al final.

---

## Cómo queda funcionando

```
ESP32 (esp32-1) ──1. publica──► ThingSpeak (canal privado) ──Read Key──► GitHub Pages
      │                              │
      │                              └──Read Key──► Puente (laptop, cada 60 s) ──┐
      └──2. manda a la API con el número de entrada de ThingSpeak ──────────────►├─► MariaDB ─► localhost:8080
```

Cada 20 s el ESP32 hace dos cosas, en este orden:

1. Publica la lectura en ThingSpeak, y ThingSpeak le devuelve un número de entrada (`entry_id`).
2. Manda la misma lectura a la API de tu laptop **con ese número**.

El puente revisa ThingSpeak cada minuto y solo copia las entradas que **no** están en MariaDB. Así:

- **Ninguna lectura queda dos veces.** La base no permite dos filas con el mismo canal y número de entrada.
- **Nada se mezcla ni se inventa.** Cada fila es una lectura real del ESP32, con la hora en que se midió. La base nunca rellena huecos entre lecturas.
- **La columna `origen` dice por dónde llegó cada lectura:** `api` (directo del ESP32) o `thingspeak` (la copió el puente porque no llegó directo, por ejemplo con la laptop apagada).
- Todo queda en un solo dispositivo, `esp32-1`.

---

## Qué va en cada archivo

### `.env` (en la carpeta del repo, nunca se sube a GitHub)

| Variable | Qué poner | Para qué |
|---|---|---|
| `DB_ROOT_PASSWORD` | La contraseña de root de **tu** MariaDB (la de DBeaver para root). Vacía si `sudo mariadb` te deja entrar | Que los scripts no te la pidan cada vez |
| `DB_NAME` | `calidad_agua` | Nombre de la base |
| `DB_USER` | `agua` | Usuario de la app (solo lee, inserta y actualiza) |
| `DB_PASSWORD` | Una contraseña nueva, sin comillas ni `\` | La usan la API, el puente y DBeaver |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `3306` | Dónde está tu MariaDB |
| `ESP32_API_KEY` | `python3 -c "import secrets; print(secrets.token_hex(16))"` | La llave que manda el ESP32; va igual en `secretos.h` |
| `THINGSPEAK_CHANNEL_ID` | El número del **canal nuevo** | Lo usan el puente y la API (para no duplicar) |
| `THINGSPEAK_READ_KEY` | La **Read API Key** del canal nuevo | El canal es privado: sin ella nadie lo puede leer |
| `THINGSPEAK_WRITE_KEY` | Vacía (o la Write Key, solo para pruebas de escritura) | No la necesitas para que funcione |
| `PUENTE_INTERVALO` | `60` | Cada cuántos segundos revisa ThingSpeak |
| `DB_PUERTO_LOCAL`, `WEB_PUERTO` | Déjalos como vienen | Solo se usan en Windows |

Si tu `.env` viejo tiene `PUENTE_DISPOSITIVO` o `SIM_…`, **borra esas líneas**: ya no existen.

### `esp32/calidad_agua/secretos.h` (en la laptop que programa el ESP32, nunca se sube a GitHub)

| Constante | Qué poner |
|---|---|
| `WIFI_SSID` | `"Tec-IoT"` (o la red donde estén laptop y ESP32) |
| `WIFI_PASSWORD` | La contraseña de esa red |
| `WIFI_EMPRESARIAL` | `false` (Tec-IoT pide solo contraseña) |
| `WIFI_USUARIO` | `""` |
| `TS_WRITE_KEY` | La **Write API Key** del canal nuevo |
| `API_URL` | `"http://IP-DE-TU-LAPTOP:8080/api/lecturas"` (te la da `probar-conexion.sh`) |
| `API_KEY` | Exactamente el mismo valor que `ESP32_API_KEY` del `.env` |

### `docs/js/config.js` (sí se sube: es la página pública)

Lo llena `bash scripts/configurar-pagina.sh` con el Channel ID y la **Read** API Key del `.env`. Nunca pongas ahí la Write Key.

La Read Key queda visible para quien abra la página de GitHub: con ella se pueden **leer** las lecturas, pero no escribir ni borrar. Para una página estática no hay otra forma de leer un canal privado.

### Lo que nunca se sube

`.env`, cualquier `secretos.h`, la carpeta `respaldos/`. Git ya los ignora. Si ves alguno en `git status`, no lo agregues.

---

## Paso a paso

### Paso 0 · Traer la última versión

```bash
cd ~/IoT-interface-design-/IoT-interface-design-
git restore proyecto/          # descarta tus copias locales de handoff/roadmap/traceability
git pull
git log --oneline -1           # debe ser el commit más reciente de GitHub
```

### Paso 1 · Preparar el canal nuevo de ThingSpeak

En https://thingspeak.com → **Channels → My Channels →** tu canal nuevo → **Channel Settings**:

1. Activa y nombra los campos **en este orden** (el firmware y la página los usan así):
   - Field 1: `pH`
   - Field 2: `Turbidez`
   - Field 3: `Conductividad`
   - Field 4: `Temperatura`
2. **Save Channel.**
3. En **Sharing** deja **Keep channel view private**.
4. En **API Keys** copia tres cosas: el **Channel ID** (arriba del canal), la **Write API Key** y la **Read API Key**.

### Paso 2 · Llenar el `.env`

```bash
nano .env
```

Así debe quedar la parte de ThingSpeak, con tus valores:

```
THINGSPEAK_CHANNEL_ID=1234567
THINGSPEAK_READ_KEY=ABCDEFGH12345678
THINGSPEAK_WRITE_KEY=
PUENTE_INTERVALO=60
```

Revisa también que `DB_PASSWORD` y `ESP32_API_KEY` tengan valores reales. Guarda con `Ctrl+O`, `Enter` y `Ctrl+X`.

Comprueba que el canal se puede leer con tu Read Key, sin escribirle nada:

```bash
bash scripts/fedora/probar-thingspeak.sh
```

No uses `--escribir`: eso guarda una lectura de prueba en el canal nuevo y dejaría de estar limpio.

### Paso 3 · Borrar la base vieja y crear una nueva

```bash
bash scripts/fedora/base-nueva.sh
```

El script:

1. te enseña qué hay en la base y te pide escribir `calidad_agua` para confirmar (si escribes otra cosa, no borra nada),
2. apaga la API y el puente si están corriendo,
3. guarda un respaldo en `respaldos/` por si algún día lo necesitas,
4. borra la base y la crea de nuevo: usuario `agua`, permisos mínimos y todas las migraciones.

Al final debe decir `Base nueva 'calidad_agua': 0 lecturas, dispositivo(s): esp32-1`.

Si te pide `Contraseña de root de MariaDB`, es la de root de MariaDB (la de DBeaver), no la de Linux.

### Paso 4 · Levantar la página, la API y el puente

```bash
docker compose -f docker-compose.fedora.yml --profile thingspeak up -d --build --force-recreate
docker compose -f docker-compose.fedora.yml ps
```

Deben aparecer `calidad-agua-web`, `calidad-agua-api` y `calidad-agua-puente` en `running`. Luego:

```bash
bash scripts/fedora/probar-conexion.sh
docker logs calidad-agua-puente
```

- `probar-conexion.sh` no guarda nada; al final te da la línea exacta de `API_URL` para el ESP32.
- En el log del puente debe salir `Puente ThingSpeak → MariaDB · canal 1234567 · dispositivo esp32-1 · cada 60 s`. Si dice `El canal es privado: falta THINGSPEAK_READ_KEY o es incorrecta`, revisa la Read Key del `.env`.

### Paso 5 · Cargar el ESP32

En la laptop que tiene el ESP32 conectado por USB:

1. `git pull` del repo (o copia la carpeta `esp32/calidad_agua/`).
2. Copia `esp32/secretos.example.h` como `esp32/calidad_agua/secretos.h` y llénalo:

   ```cpp
   const char* WIFI_SSID     = "Tec-IoT";
   const char* WIFI_PASSWORD = "contraseña de Tec-IoT";
   const bool  WIFI_EMPRESARIAL = false;
   const char* WIFI_USUARIO     = "";
   const char* TS_WRITE_KEY  = "WRITE KEY DEL CANAL NUEVO";
   const char* API_URL       = "http://IP-QUE-TE-DIO-probar-conexion:8080/api/lecturas";
   const char* API_KEY       = "LA MISMA ESP32_API_KEY DEL .env";
   ```

3. Arduino IDE → abre `esp32/calidad_agua/calidad_agua.ino` → librerías **OneWire** y **DallasTemperature** → placa **ESP32 Dev Module** → **Subir**.
4. **Monitor Serie** a 115200. Cada segundo sale la lectura y cada 20 s:

   ```
   ThingSpeak -> entrada 1
   API -> 201 guardado en MariaDB
   ```

La IP de tu laptop puede cambiar al reconectarte a Tec-IoT. Si el monitor dice `API -> -1`, corre otra vez `probar-conexion.sh` y actualiza `API_URL`.

### Paso 6 · Comprobar en la terminal

```bash
bash scripts/fedora/ver-mariadb.sh --seguir
```

Se actualiza cada 5 s y muestra:

- **ESP32:** `esp32-1` y hace cuántos segundos mandó.
- **Últimas 10 lecturas:** las 4 variables, cuántas están en rango y el color del semáforo.
- **Por origen:** cuántas llegaron directo (`api`) y cuántas copió el puente (`thingspeak`). Con la laptop prendida casi todas deben ser `api`.
- **¿Alguna lectura repetida?:** debe salir **vacío**.

`Ctrl+C` para salir.

### Paso 7 · Comprobar en DBeaver

Conexión (si ya la tenías, basta con **F5** para refrescar; la base se llama igual):

| Campo | Valor |
|---|---|
| Host | `localhost` |
| Puerto | `3306` |
| Base de datos | `calidad_agua` |
| Usuario | `agua` |
| Contraseña | `DB_PASSWORD` del `.env` |

Abre **SQL Editor → New SQL script** y corre:

```sql
-- Últimas lecturas, hora de México
SELECT id, CONVERT_TZ(fecha, '+00:00', '-06:00') AS hora, origen, ts_entry_id,
       ph, turbidez, conductividad, temperatura
FROM lecturas ORDER BY fecha DESC LIMIT 20;

-- Debe salir vacío: ninguna entrada de ThingSpeak guardada dos veces
SELECT ts_canal, ts_entry_id, COUNT(*) AS veces
FROM lecturas WHERE ts_entry_id IS NOT NULL
GROUP BY ts_canal, ts_entry_id HAVING COUNT(*) > 1;

-- Debe salir solo esp32-1
SELECT dispositivo, origen, COUNT(*) FROM lecturas GROUP BY dispositivo, origen;
```

Con el usuario `agua`, DBeaver no deja borrar: así no se pierde nada por accidente. Para borrar o cambiar tablas se entra como root.

### Paso 8 · Página en localhost

1. Abre http://localhost:8080.
2. **Ajustes → Fuente de datos → MariaDB → Guardar.**
3. En **Inicio** ves el semáforo y las 4 tarjetas (pH, turbidez, conductividad y temperatura). En **Historial**, la gráfica de cada una, temperatura incluida.

### Paso 9 · Página en GitHub Pages

```bash
bash scripts/configurar-pagina.sh
git add docs/js/config.js
git commit -m "Página: canal nuevo de ThingSpeak"
git push
```

En 1 o 2 minutos abre https://marcoflesh.github.io/IoT-interface-design-/. Si ese navegador ya tenía guardado el canal viejo en **Ajustes**, escribe ahí el Channel ID y la Read API Key nuevos y **Guardar**. También puedes usar **Restaurar valores**.

---

## El semáforo

| Color | Cuándo |
|---|---|
| Verde | Los 4 parámetros en rango |
| Amarillo | 3 o 2 de los 4 en rango |
| Rojo | 1 o ninguno en rango |
| Gris | Falta alguna de las 4 lecturas, o la última tiene más de 3 minutos |

Rangos por defecto (se cambian en **Ajustes → Umbrales del semáforo**):

| Parámetro | En rango | Referencia |
|---|---|---|
| pH | 6.5 a 8.5 | NOM-127-SSA1-2021 |
| Turbidez | 0 a 4 NTU | NOM-127-SSA1-2021 |
| Conductividad | 50 a 1500 µS/cm | Límite de sólidos disueltos de la NOM-127, convertido |
| Temperatura | 10 a 30 °C | Propuesta del equipo: la NOM-127 no fija temperatura. Ajústenla si su profesor da otro rango |

Mientras falte un sensor (por ejemplo, el TSW-10 de turbidez) el semáforo se queda en **gris**: no puede decir que el agua está bien sin medirla.

---

## Checklist final

- [ ] `git log --oneline -1` igual que GitHub.
- [ ] `.env` con el Channel ID y la Read Key del canal nuevo, sin `PUENTE_DISPOSITIVO` ni `SIM_…`.
- [ ] `base-nueva.sh` terminó con `0 lecturas, dispositivo(s): esp32-1`.
- [ ] `docker compose … ps`: web, api y puente en `running`.
- [ ] `probar-conexion.sh` sin cruces rojas.
- [ ] Monitor serie: `ThingSpeak -> entrada N` y `API -> 201`.
- [ ] `ver-mariadb.sh`: solo `esp32-1`, nada repetido.
- [ ] localhost:8080 con fuente MariaDB muestra las 4 variables.
- [ ] GitHub Pages muestra el canal nuevo.

## Uso diario

```bash
cd ~/IoT-interface-design-/IoT-interface-design-
docker compose -f docker-compose.fedora.yml --profile thingspeak up -d     # prender
bash scripts/fedora/ver-mariadb.sh --seguir                               # ver que llegan
bash scripts/fedora/respaldar.sh                                          # respaldo antes de una demo
docker compose -f docker-compose.fedora.yml --profile thingspeak down     # apagar
```

Si la laptop estuvo apagada, al prender el puente copia de ThingSpeak lo que faltó, con su hora original.

## Problemas comunes

| Síntoma | Causa | Qué hacer |
|---|---|---|
| Monitor serie: `API -> 401` | `API_KEY` de `secretos.h` distinta de `ESP32_API_KEY` | Cópiala igual y vuelve a subir el programa |
| Monitor serie: `API -> -1` | IP vieja, Docker apagado, firewall o red | `probar-conexion.sh`, actualiza `API_URL`, revisa que la laptop siga en Tec-IoT |
| Monitor serie: `API -> 400 … dispositivo` | Firmware viejo | Sube `calidad_agua.ino` v1.2.0 o más nuevo |
| Monitor serie: `ThingSpeak -> entrada 0` | Mandó antes de 15 s | Normal si pasa una vez; el firmware manda cada 20 s |
| Log del puente: `El canal es privado: falta THINGSPEAK_READ_KEY…` | Falta la Read Key o es de otro canal | Corrige `THINGSPEAK_READ_KEY` y `docker compose … --profile thingspeak up -d --force-recreate puente` |
| GitHub Pages: "Canal no encontrado o Read API Key incorrecta" | `config.js` o Ajustes con el canal viejo | Paso 9 |
| Semáforo gris con lecturas recientes | Falta un sensor (sale en la descripción) | Conéctalo, o espera a tenerlo |
| `ver-mariadb.sh` no muestra la columna de distancia | Ya no existe | Normal: se quitó |
| `base-nueva.sh`: `Access denied for user 'root'` (1045) | Contraseña de root de MariaDB incorrecta | FEDORA.md, "Olvidé la contraseña de root de MariaDB" |
