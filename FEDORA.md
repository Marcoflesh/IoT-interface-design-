# Guía para Fedora Linux · MariaDB local + DBeaver + ESP32

Esta guía usa **la MariaDB que ya tienes instalada en Fedora**, la misma que ves en la terminal y en DBeaver. Docker solo corre la página y la API.

```
ESP32 ──HTTP (WiFi)──► http://IP-DE-TU-LAPTOP:8080/api/lecturas
                              │  nginx (Docker, puerto 8080)
                              ▼
                        API Node (Docker, 127.0.0.1:3000)
                              ▼
                     MariaDB de Fedora (127.0.0.1:3306) ◄── terminal y DBeaver
```

- MariaDB **no se abre a la red**: solo la API (dentro de tu laptop) entra a ella.
- El ESP32 solo puede **guardar lecturas** con su llave; no ve la base.
- Los datos viven en tu MariaDB de siempre: si apagas Docker, siguen ahí.

> ¿Prefieres que MariaDB también corra en Docker? Usa `docker-compose.yml` (README). No corras las dos versiones a la vez: ambas usan el puerto 8080.

> **¿Ya tienes el ESP32 terminado y quieres empezar limpio, con un canal nuevo de ThingSpeak y una base vacía?** Ve al [Paso 12](#paso-12--empezar-de-cero-canal-nuevo-y-base-limpia). La explicación completa, con qué va en cada archivo, está en [PUESTA_EN_MARCHA.md](PUESTA_EN_MARCHA.md).

---

## Paso 1 · Instalar Docker en Fedora

Si `docker --version` ya responde con "Docker" (no "podman"), salta al Paso 2.

```bash
sudo dnf config-manager addrepo --from-repofile https://download.docker.com/linux/fedora/docker-ce.repo
sudo dnf install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

Si pide aceptar la llave GPG, la huella debe ser `060A 61C5 1B55 8A7F 742B 77AA C52F EB6B 621E 9F35`.

**Cierra sesión y vuelve a entrar** (o reinicia) para que tu usuario use Docker sin `sudo`.

> Usa este Docker "normal". **No** uses Docker *rootless* ni Docker Desktop: en esos dos la red `host` no es la de tu Fedora, la página no aparece en `localhost:8080` y la API no ve tu MariaDB.
>
> **¿Ya tienes Docker Desktop?** Puede quedarse instalado. Instala igual Docker Engine con los comandos de arriba y elige su contexto: `docker context use default` (compruébalo con `docker context show`). Docker Desktop, al abrirse, cambia el contexto a `desktop-linux`: ciérralo o quita que arranque solo.

Verifica:

```bash
docker run --rm hello-world
docker compose version
```

## Paso 2 · Verificar tu MariaDB

```bash
sudo systemctl enable --now mariadb      # que arranque siempre con la laptop
systemctl status mariadb --no-pager      # debe decir "active (running)"
sudo ss -tlnp | grep 3306                # debe aparecer escuchando en el puerto 3306
```

Si no tienes MariaDB: `sudo dnf install mariadb-server` y repite.

## Paso 3 · Clonar el repo y crear el `.env`

```bash
git clone https://github.com/Marcoflesh/IoT-interface-design-.git
cd IoT-interface-design-
cp .env.example .env
python3 -c "import secrets; print(secrets.token_hex(16))"    # copia el resultado para ESP32_API_KEY
nano .env                                                      # o: gedit .env / code .env
```

Llena así:

```ini
# Contraseña de root de TU MariaDB (la que usas en DBeaver para root). Vacía si root entra con sudo.
DB_ROOT_PASSWORD=la-contraseña-de-root
DB_NAME=calidad_agua
DB_USER=agua
# Contraseña NUEVA para el usuario agua: el script lo crea con esta. Es la que pones en DBeaver.
DB_PASSWORD=una-clave-nueva-sin-comillas-simples
ESP32_API_KEY=el-resultado-del-comando-de-python
```

No crees el usuario `agua` a mano: el script lo crea (o le corrige la contraseña) con `DB_PASSWORD`. Si después cambias `DB_PASSWORD`, vuelve a correr el script.

Son **tres contraseñas distintas**: la de tu usuario de Linux (la pide `sudo`), la de **root de MariaDB** (`DB_ROOT_PASSWORD`, ya la tienes) y la del usuario **agua** que se va a crear (`DB_PASSWORD`, la inventas ahora).

## Paso 4 · Preparar MariaDB (un comando)

```bash
bash scripts/fedora/preparar-mariadb.sh
```

El script:
1. Revisa que MariaDB esté corriendo (si no, lo inicia).
2. Entra como root de MariaDB: con `DB_ROOT_PASSWORD` del `.env` si la pusiste; si no, con `sudo mariadb`; y si eso tampoco funciona, te pide la contraseña de root **una sola vez** (el texto dice "Contraseña de root de MariaDB": no es la de Linux).
3. Crea la base `calidad_agua` y el usuario `agua`, que **solo entra desde tu laptop** y solo puede **leer, insertar y actualizar** (no borra ni cambia tablas).
4. Aplica las migraciones de `api/migraciones/` como administrador: tablas `lecturas`, `dispositivos`, `calibraciones`, `schema_migraciones` y vistas `resumen_diario` y `estado_dispositivos`.
5. Abre el puerto **8080** en firewalld para que el ESP32 llegue.
6. Te imprime los datos para DBeaver y la línea exacta para el ESP32.

### Cómo queda la base

| Tabla o vista | Qué guarda |
|---|---|
| `lecturas` | Cada lectura del ESP32: fecha (UTC), pH, turbidez, conductividad, temperatura, origen (`api` o `thingspeak`), entry_id de ThingSpeak, RSSI y voltajes crudos |
| `dispositivos` | Un solo renglón, `esp32-1` (el ESP32 del equipo): firmware, última conexión e IP |
| `calibraciones` | Historial de calibraciones por sensor (puntos, pendiente, ordenada, notas) |
| `schema_migraciones` | Qué migraciones ya se aplicaron |
| `resumen_diario` (vista) | Promedios, mínimos y máximos por dispositivo y día |
| `estado_dispositivos` (vista) | Cuántos segundos lleva cada ESP32 sin mandar datos |

**Por qué así:** si alguien obtiene la contraseña de la API, no puede borrar datos ni tablas. Todo lo del ESP32, llegue directo o copiado de ThingSpeak, queda en `esp32-1` sin duplicados. Las migraciones numeradas permiten cambiar la base sin perder nada.

Puedes correrlo cuantas veces quieras; si cambias la contraseña en `.env`, vuelve a correrlo y la actualiza.

<details>
<summary>Lo mismo, a mano (por si quieres ver qué hace)</summary>

```bash
mariadb -u root -p          # o: sudo mariadb   (si root entra por socket)
```
```sql
CREATE DATABASE IF NOT EXISTS calidad_agua CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'agua'@'localhost' IDENTIFIED BY 'TU_CLAVE';
CREATE USER IF NOT EXISTS 'agua'@'127.0.0.1' IDENTIFIED BY 'TU_CLAVE';
GRANT SELECT, INSERT, UPDATE, SHOW VIEW ON calidad_agua.* TO 'agua'@'localhost';
GRANT SELECT, INSERT, UPDATE, SHOW VIEW ON calidad_agua.* TO 'agua'@'127.0.0.1';
FLUSH PRIVILEGES;
EXIT;
```
```bash
for f in api/migraciones/*.sql; do mariadb -u root -p calidad_agua < "$f"; done
sudo firewall-cmd --permanent --add-port=8080/tcp && sudo firewall-cmd --reload
```
Se crean dos usuarios (`localhost` y `127.0.0.1`) porque la terminal entra por socket y la API entra por TCP.
</details>

## Paso 5 · Conectarte desde la terminal

```bash
mariadb -h 127.0.0.1 -u agua -p calidad_agua
```
```sql
SHOW TABLES;                                          -- tablas y vistas
SELECT * FROM lecturas ORDER BY id DESC LIMIT 10;     -- últimas lecturas
SELECT * FROM estado_dispositivos;                    -- quién está mandando datos
SELECT * FROM resumen_diario WHERE dispositivo = 'esp32-1';   -- promedios por día del ESP32 real
```

El usuario `agua` sirve para consultar. Para borrar o cambiar tablas entra como administrador: `mariadb -u root -p calidad_agua`.

**Atajo:** `bash scripts/fedora/ver-mariadb.sh` muestra los dispositivos, las últimas 10 lecturas en hora de México con el color del semáforo y el resumen de la última hora. Con `--seguir` se actualiza cada 5 s (Ctrl+C para salir).

> **`SHOW TABLES` no muestra nada o dice "No database selected":** primero elige la base. Entrando con `mariadb -u root -p` escribe `SHOW DATABASES;` (debe aparecer `calidad_agua`), luego `USE calidad_agua;` y ya `SHOW TABLES;`. Si `calidad_agua` no aparece, el Paso 4 no terminó: vuelve a correr el script y lee el mensaje en rojo.

## Paso 6 · Conectarte desde DBeaver

**Opción A, con tu conexión de siempre (root, puede editar y borrar):** clic derecho en la conexión → **Refresh** (F5) → **Databases → calidad_agua → Tables → lecturas** → pestaña **Data**.

**Opción B, conexión propia del proyecto (recomendada para la demo):**
1. **Database → New Database Connection → MariaDB → Next**.
2. Host: `localhost` · Port: `3306` · Database: `calidad_agua`.
3. Username: `agua` · Password: la de `DB_PASSWORD` · marca **Save password**.
4. **Test Connection** (si pide descargar el driver, acepta) → **Finish**.
5. Abre `calidad_agua → Tables → lecturas → Data`. Cuando el ESP32 mande datos, presiona **F5** para ver las filas nuevas.

Con el usuario `agua` DBeaver solo deja consultar e insertar: así no se borra nada por accidente durante la demo.

Para consultas: clic derecho en la conexión → **SQL Editor → New SQL script** y usa las consultas del Paso 5 o las del README (Paso 9).

## Paso 7 · Levantar la página y la API

```bash
docker compose -f docker-compose.fedora.yml up -d --build
docker compose -f docker-compose.fedora.yml ps        # api y web en "running"
```

Abre **http://localhost:8080** (escríbelo con `http://`) → **Ajustes → Fuente: MariaDB → Probar conexión → Guardar**.

**¿No abre?** Corre el diagnóstico; revisa Docker, contenedores, puerto, página, API y SELinux y te dice qué hacer:

```bash
bash scripts/fedora/diagnosticar.sh
```

## Paso 8 · Probar todo antes de tocar el ESP32

```bash
bash scripts/fedora/probar-conexion.sh
```

Revisa contenedores, página, API, MariaDB, que tu `ESP32_API_KEY` sea la buena, que se rechace una llave falsa y que responda por la **IP de tu red**. No guarda ninguna lectura de prueba. Al final te dice el `API_URL` exacto para el ESP32.

Prueba también desde **tu celular conectado a la misma WiFi**: abre `http://IP-DE-TU-LAPTOP:8080/api/salud`. Si ahí carga, el ESP32 también va a llegar.

## Paso 9 · Configurar y cargar el ESP32

1. **Permiso para el puerto USB** (solo una vez, luego cierra sesión y entra de nuevo):
   ```bash
   sudo usermod -aG dialout $USER
   ```
2. Conecta el ESP32 y revisa que aparezca: `ls /dev/ttyUSB* /dev/ttyACM*`.
3. Abre `esp32/calidad_agua/calidad_agua.ino` en Arduino IDE (instala las librerías **OneWire** y **DallasTemperature**). En esa misma carpeta copia `esp32/secretos.example.h` como `secretos.h` y llénalo:
   ```cpp
   const char* WIFI_SSID     = "TU_RED";          // la misma red que la laptop
   const char* WIFI_PASSWORD = "TU_CLAVE";
   const char* TS_WRITE_KEY  = "WRITE_KEY_DE_THINGSPEAK";
   const char* API_URL       = "http://IP-DE-TU-LAPTOP:8080/api/lecturas";   // la que dio el Paso 8
   const char* API_KEY       = "EL_MISMO_ESP32_API_KEY_DEL_.env";
   ```
4. Es el programa del equipo (TDS, DS18B20, HC-SR04T) ya listo para la API: manda la `X-API-Key` y los nombres de campo correctos. Si cambian pines o sensores, hazlo ahí mismo.
5. Arduino IDE → puerto `/dev/ttyUSB0` (o `ttyACM0`) → **Subir**.
6. **Monitor Serie** (115200 baudios). Cada segundo sale la lectura y cada 20 s:
   ```
   API -> 201 guardado en MariaDB
   ThingSpeak -> entrada 57
   ```
7. En DBeaver presiona **F5** sobre `lecturas`: ahí están las filas del ESP32 (`dispositivo = esp32-1`). En la página, el semáforo se actualiza solo.

## Paso 10 · Dejar solo el ESP32 real, `esp32-1` (una sola vez)

La página, la API y la base solo trabajan con el ESP32 del equipo, `esp32-1`. Si usaste el simulador o los scripts de prueba viejos, limpia lo que dejaron:

```bash
git pull
bash scripts/fedora/respaldar.sh                      # respaldo antes de borrar
docker rm -f calidad-agua-simulador 2>/dev/null       # apaga el contenedor viejo si existe
bash scripts/fedora/preparar-mariadb.sh               # migraciones 004 y 006: deja solo esp32-1
docker compose -f docker-compose.fedora.yml up -d --build
bash scripts/fedora/ver-mariadb.sh                    # solo debe aparecer esp32-1
```

Revisa también:

- La migración 006 borra todo lo que no sea `esp32-1` (`esp32-sim`, `esp-32-sim`, `prueba-terminal`, …), pasa a `esp32-1` lo que el puente había copiado como `esp32-1-ts` y quita la columna `distancia`. Desde ahí la API rechaza cualquier otro dispositivo. Si tu `.env` todavía tiene `PUENTE_DISPOSITIVO`, bórralo: ya no se usa.
- Si el simulador publicó en tu canal de ThingSpeak, esas lecturas siguen ahí y GitHub Pages las muestra como reales. Bórralas en ThingSpeak: **Channel Settings → Clear Channel** (borra todo el canal, no se puede deshacer).
- Si en algún navegador marcaste "Usar esta simulación en toda la página", la página vuelve sola a ThingSpeak.

Si después de esto la base queda vacía, es que el ESP32 real todavía no ha mandado nada: revisa [esp32/README.md](esp32/README.md) y corre `prueba_red.ino`.

## Paso 11 · Conectar ThingSpeak con MariaDB (puente)

Hay dos formas de que las lecturas lleguen a tu MariaDB:

| Forma | Cómo | Cuándo conviene |
|---|---|---|
| **A. El ESP32 manda a los dos** | `calidad_agua.ino` publica en ThingSpeak y luego manda a la API con el `entry_id` que le dio ThingSpeak | El ESP32 y la laptop están en la misma red y se ven |
| **B. Puente ThingSpeak → MariaDB** | El ESP32 solo manda a ThingSpeak; un servicio en tu laptop copia las lecturas nuevas a MariaDB cada minuto | La red del Tec no deja que el ESP32 vea tu laptop, o quieres que el ESP32 funcione desde cualquier WiFi |

El puente no duplica (usa el `entry_id` de ThingSpeak), conserva la hora original de cada lectura y, si tu laptop estuvo apagada, al prender trae lo que faltó (hasta las últimas 8000 entradas que guarda el canal). Las lecturas quedan con `origen = 'thingspeak'` y `dispositivo = 'esp32-1'`, el mismo que las directas.

**Puedes usar A y B a la vez sin duplicar nada:** la API guarda el `entry_id` de ThingSpeak que manda el ESP32, y el puente salta las entradas que ya están. Si una lectura no llegó a la API (laptop apagada, red caída), el puente la copia después.

### 11.1 · Crear el canal en ThingSpeak

1. Entra a **thingspeak.mathworks.com** y da **Sign In** con tu cuenta de MathWorks (o crea una; puede ser con tu correo del Tec).
2. **Channels → My Channels → New Channel**.
3. **Name:** `Calidad del agua` · **Description:** opcional.
4. Marca **Field 1 a Field 4** y escribe sus nombres **en este orden** (la página, el puente y el firmware dependen de él):
   - Field 1: `pH`
   - Field 2: `Turbidez`
   - Field 3: `Conductividad`
   - Field 4: `Temperatura`
5. **Save Channel** (abajo).
6. El **Channel ID** es el número que aparece arriba en la página del canal.
7. Pestaña **API Keys**: ahí están la **Write API Key** (para escribir) y la **Read API Key** (para leer).
8. Pestaña **Sharing**: deja **Keep channel view private**. El puente y la página leen el canal con la **Read API Key**.

### 11.2 · Llenar el `.env`

```ini
THINGSPEAK_CHANNEL_ID=2741234
THINGSPEAK_READ_KEY=ABCDEFGH12345678
THINGSPEAK_WRITE_KEY=
PUENTE_INTERVALO=60
```

- `THINGSPEAK_READ_KEY` es obligatoria: el canal es privado.
- `THINGSPEAK_WRITE_KEY` puede ir vacía; solo la usa `probar-thingspeak.sh --escribir`. La del ESP32 va en `secretos.h`.
- `THINGSPEAK_CHANNEL_ID` también lo usa la API: con él enlaza cada lectura directa con su entrada de ThingSpeak. Después de cambiarlo, `docker compose -f docker-compose.fedora.yml up -d --force-recreate api`.

### 11.3 · Probar el canal desde la terminal

```bash
bash scripts/fedora/probar-thingspeak.sh
```

Lee el canal con tu Read Key y revisa que los 4 campos estén en el orden correcto. Con `--escribir` además guarda una lectura de prueba, pero **no lo uses en el canal que vas a presentar**: esa lectura falsa terminaría en la página y en MariaDB.

### 11.4 · Encender el puente

En este orden (la migración 003 necesita a root antes de reiniciar la API):

```bash
cd ~/IoT-interface-design-
git pull
bash scripts/fedora/preparar-mariadb.sh                              # aplica la migración 003
docker compose -f docker-compose.fedora.yml up -d --build            # API con lo nuevo
docker compose -f docker-compose.fedora.yml --profile thingspeak up -d --build
docker logs -f calidad-agua-puente                                   # Ctrl+C para salir del log
```

Debe decir algo como `40 lectura(s) copiadas · último entry_id 40`.

**Míralo en DBeaver o en la terminal:**

```sql
SELECT fecha, ph, turbidez, conductividad, ts_entry_id
FROM lecturas WHERE origen = 'thingspeak' ORDER BY fecha DESC LIMIT 20;
```

En la página: **Ajustes → MariaDB**. Muestra todo `esp32-1`, llegue por la API o por el puente.

### 11.5 · La página de GitHub con tu canal

```bash
bash scripts/configurar-pagina.sh      # pone el Channel ID (y la Read Key si es privado) en docs/js/config.js
git add docs/js/config.js
git commit -m "Página: leer el canal de ThingSpeak"
git push
```

En 1 o 2 minutos https://marcoflesh.github.io/IoT-interface-design-/ arranca leyendo tu canal. Si ya habías guardado otro canal en **Ajustes** de ese navegador, ese tiene prioridad: corrígelo ahí y **Guardar**, o usa **Restaurar valores**. La página ya no tiene modo demo: solo muestra lecturas del ESP32.

## Paso 12 · Empezar de cero: canal nuevo y base limpia

Para cuando el ESP32 está terminado y quieres que la base y el canal solo tengan lecturas reales. Cada paso está explicado en [PUESTA_EN_MARCHA.md](PUESTA_EN_MARCHA.md).

**12.1 · Última versión del repo**

```bash
cd ~/IoT-interface-design-/IoT-interface-design-
git restore proyecto/
git pull
```

**12.2 · Canal nuevo de ThingSpeak:** Field 1 `pH`, Field 2 `Turbidez`, Field 3 `Conductividad`, Field 4 `Temperatura`; **Sharing → Keep channel view private**; copia el Channel ID, la Write Key y la Read Key (como en 11.1).

**12.3 · `.env`** con el canal nuevo (borra `PUENTE_DISPOSITIVO` y cualquier `SIM_…` si siguen ahí):

```ini
THINGSPEAK_CHANNEL_ID=número del canal nuevo
THINGSPEAK_READ_KEY=Read API Key del canal nuevo
THINGSPEAK_WRITE_KEY=
PUENTE_INTERVALO=60
```

```bash
bash scripts/fedora/probar-thingspeak.sh          # sin --escribir: el canal debe seguir vacío
```

**12.4 · Borrar la base vieja y crear una nueva**

```bash
bash scripts/fedora/base-nueva.sh
```

Te enseña lo que hay, pide escribir `calidad_agua` para confirmar, apaga la API y el puente, hace un respaldo en `respaldos/`, borra la base y la crea con todas las migraciones. Debe terminar en `0 lecturas, dispositivo(s): esp32-1`.

**12.5 · Levantar página, API y puente**

```bash
docker compose -f docker-compose.fedora.yml --profile thingspeak up -d --build --force-recreate
bash scripts/fedora/probar-conexion.sh            # te da el API_URL para el ESP32; no guarda nada
docker logs calidad-agua-puente                   # canal nuevo · dispositivo esp32-1 · cada 60 s
```

**12.6 · ESP32:** `esp32/calidad_agua/secretos.h` con `Tec-IoT`, la **Write Key del canal nuevo**, el `API_URL` del paso anterior y `API_KEY` igual a `ESP32_API_KEY` del `.env`. Sube `calidad_agua.ino`; en el monitor serie, cada 20 s: `ThingSpeak -> entrada N` y `API -> 201 guardado en MariaDB`.

**12.7 · Revisar**

```bash
bash scripts/fedora/ver-mariadb.sh --seguir
```

Solo `esp32-1`, la columna `en_rango` y el semáforo de 4 parámetros, y la sección "¿Alguna lectura repetida?" vacía. En DBeaver, **F5** sobre `calidad_agua` (mismas credenciales de siempre).

**12.8 · Páginas:** en http://localhost:8080, **Ajustes → MariaDB → Guardar**. Para GitHub Pages:

```bash
bash scripts/configurar-pagina.sh
git add docs/js/config.js
git commit -m "Página: canal nuevo de ThingSpeak"
git push
```

**Cómo no se mezclan los datos:** cada lectura del ESP32 queda **una sola vez** en `lecturas`. El ESP32 publica en ThingSpeak y le pasa a la API el número de entrada que recibió. El puente solo copia las entradas que no llegaron directo (por ejemplo, si la laptop estaba apagada). La columna `origen` dice por dónde llegó cada una (`api` o `thingspeak`) y la base nunca rellena huecos entre lecturas.

## Respaldos

```bash
bash scripts/fedora/respaldar.sh                                   # crea respaldos/calidad_agua_AAAAMMDD_HHMMSS.sql.gz
bash scripts/fedora/respaldar.sh --restaurar respaldos/<archivo>   # restaura (pide confirmación)
```

Guarda los 14 más recientes. Haz uno antes de cada demo y antes de borrar datos.

## Uso diario

| Para | Comando |
|---|---|
| Encender página y API | `docker compose -f docker-compose.fedora.yml up -d` |
| Apagar | `docker compose -f docker-compose.fedora.yml down` |
| Ver qué llega del ESP32 | `docker logs -f calidad-agua-api` |
| Revisar todo | `bash scripts/fedora/probar-conexion.sh` |
| No abre localhost:8080 | `bash scripts/fedora/diagnosticar.sh` |
| Encender todo con el puente | `docker compose -f docker-compose.fedora.yml --profile thingspeak up -d` |
| Empezar con una base vacía | `bash scripts/fedora/base-nueva.sh` (Paso 12) |
| Respaldar la base | `bash scripts/fedora/respaldar.sh` |
| Ver los datos llegar (sin DBeaver) | `bash scripts/fedora/ver-mariadb.sh --seguir` |
| Saber tu IP actual | `ip -4 route get 1.1.1.1` (el valor después de `src`) |

Con `restart: unless-stopped` y Docker habilitado, la página y la API vuelven solas al reiniciar la laptop.

---

## Olvidé la contraseña de root de MariaDB

Esto reinicia MariaDB sin revisar contraseñas por un momento (solo desde tu laptop) y te deja poner una nueva. **No borra datos.**

```bash
printf '[mysqld]\nskip-grant-tables\nskip-networking\n' | sudo tee /etc/my.cnf.d/zz-recuperar.cnf
sudo systemctl restart mariadb
mariadb -u root
```
```sql
FLUSH PRIVILEGES;
-- root podrá entrar con sudo (sin contraseña) Y con la nueva contraseña:
ALTER USER 'root'@'localhost' IDENTIFIED VIA unix_socket OR mysql_native_password USING PASSWORD('TU-NUEVA-CLAVE');
EXIT;
```
```bash
sudo rm /etc/my.cnf.d/zz-recuperar.cnf          # importante: quitar el modo sin contraseñas
sudo systemctl restart mariadb
mariadb -u root -p -e "SELECT 1"                # prueba con la nueva
```

Actualiza la contraseña de root en DBeaver y en `DB_ROOT_PASSWORD` del `.env`.

> Aunque sí recuerdes tu contraseña, ese `ALTER USER` es útil: deja que root entre tanto con `sudo mariadb` como con contraseña.

## Problemas comunes

| Síntoma | Causa | Solución |
|---|---|---|
| Nadie escucha en 8080 aunque `web` dice "corriendo" y la API repite `ER_GET_CONNECTION_TIMEOUT` | Docker en modo rootless o Docker Desktop: la red `host` queda encerrada y no es la de Fedora | `sudo systemctl enable --now docker`, `systemctl --user disable --now docker docker.socket`, `unset DOCKER_HOST`, `docker context use default`, luego `docker compose -f docker-compose.fedora.yml up -d --build` |
| http://localhost:8080 no abre | Contenedores sin levantar, Docker Desktop/Podman en vez de Docker Engine, puerto 8080 ocupado o SELinux | `bash scripts/fedora/diagnosticar.sh` |
| `ERROR 1045 Access denied for user 'root'@'localhost'` | Contraseña de root de MariaDB incorrecta, o se escribió la de Linux | Pruébala sola con `mariadb -u root -p -e "SELECT 1"`. Si entra, ponla en `.env` como `DB_ROOT_PASSWORD` y repite el Paso 4. Si no la recuerdas: ver abajo |
| Puente: `Falta THINGSPEAK_CHANNEL_ID` o `El canal es privado` | Faltan datos del canal en `.env` | Pon `THINGSPEAK_CHANNEL_ID` y, si es privado, `THINGSPEAK_READ_KEY`; luego `docker compose -f docker-compose.fedora.yml --profile thingspeak up -d --force-recreate puente` |
| DBeaver: `Access denied for user 'agua'@'localhost'` | La contraseña de DBeaver no es igual a `DB_PASSWORD` del `.env` (o el script es anterior al 21 nov y guardó un comentario `# …` como parte de la contraseña) | `git pull` y `bash scripts/fedora/preparar-mariadb.sh`: vuelve a poner la contraseña de `DB_PASSWORD`. En DBeaver usa exactamente ese valor. Luego `docker compose -f docker-compose.fedora.yml up -d --force-recreate api` |
| `SHOW TABLES` vacío / `No database selected` | No elegiste la base, o no se creó | `USE calidad_agua;` antes; si no existe, repite el Paso 4 |
| `permission denied ... docker.sock` | Tu usuario no está en el grupo docker | `sudo usermod -aG docker $USER` y cierra sesión |
| Docker no arranca: `failed to find iptables` | Fedora usa nftables | `sudo alternatives --set iptables /usr/bin/iptables-nft && sudo systemctl restart docker` |
| `docker compose: command not found` | Falta el plugin | `sudo dnf install docker-compose-plugin` |
| La página da **403** o sale en blanco | SELinux bloquea la carpeta | El compose ya usa `:z`; si persiste: `sudo chcon -Rt container_file_t docs nginx.fedora.conf` |
| Logs de la API: `La migración … necesita permisos de administrador` | Hay una migración nueva en `api/migraciones` | `bash scripts/fedora/preparar-mariadb.sh` (la aplica como root) y `docker compose -f docker-compose.fedora.yml restart api` |
| `/api/salud` dice `ok:false` / logs: `Access denied for user 'agua'` | Contraseña distinta entre `.env` y MariaDB | Corre otra vez `bash scripts/fedora/preparar-mariadb.sh` y `docker compose -f docker-compose.fedora.yml up -d --force-recreate api` |
| Logs: `ECONNREFUSED 127.0.0.1:3306` | MariaDB apagado o sin TCP | `sudo systemctl start mariadb`; revisa que no haya `skip-networking` en `/etc/my.cnf.d/` |
| `address already in use` en 8080 | Otro programa usa el puerto | `sudo ss -tlnp \| grep 8080` y ciérralo, o cambia `listen 8080` en `nginx.fedora.conf` (y en el ESP32) |
| Celular/ESP32 no llegan a `http://IP:8080` | Firewall o red | `sudo firewall-cmd --list-ports` debe incluir `8080/tcp`. Las redes del Tec suelen aislar dispositivos: usen el **hotspot de un celular** para laptop y ESP32 |
| ESP32: `API HTTP: 401` | Llaves distintas | `API_KEY` en `secretos.h` = `ESP32_API_KEY` en `.env` (y recrear la API si cambiaste el `.env`) |
| ESP32: `API HTTP: 400` | Dato inválido | Lee el mensaje en el monitor serie; usen `NAN` para sensores caídos, nunca texto |
| El ESP32 no aparece en `/dev/ttyUSB*` | Permisos, cable o brltty | Grupo `dialout`; usa un cable de datos; si el puerto aparece y desaparece y no usas lector braille: `sudo dnf remove brltty` |
| Cambió la IP de la laptop | DHCP | Actualiza `API_URL` en `secretos.h` o reserva la IP en el router/hotspot |
