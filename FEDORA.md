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

**Cierra sesión y vuelve a entrar** (o reinicia) para que tu usuario use Docker sin `sudo`. Verifica:

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
| `lecturas` | Cada envío: fecha (UTC), dispositivo, pH, turbidez, conductividad, temperatura, RSSI y voltajes crudos de cada sensor |
| `dispositivos` | Cada ESP32: `esp32-1` (el real), `esp32-sim` (el simulador), si es simulado, firmware, última conexión e IP |
| `calibraciones` | Historial de calibraciones por sensor (puntos, pendiente, ordenada, notas) |
| `schema_migraciones` | Qué migraciones ya se aplicaron |
| `resumen_diario` (vista) | Promedios, mínimos y máximos por dispositivo y día |
| `estado_dispositivos` (vista) | Cuántos segundos lleva cada ESP32 sin mandar datos |

**Por qué así:** si alguien obtiene la contraseña de la API, no puede borrar datos ni tablas. Los datos simulados se separan de los reales por `dispositivo`. Las migraciones numeradas permiten cambiar la base sin perder nada.

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

Abre http://localhost:8080 → **Ajustes → Fuente: MariaDB → Probar conexión → Guardar**.

## Paso 8 · Probar todo antes de tocar el ESP32

```bash
bash scripts/fedora/probar-conexion.sh
```

Revisa contenedores, página, API, MariaDB, que se rechace una llave falsa y que responda por la **IP de tu red**. Al final te dice el `API_URL` exacto para el ESP32. La lectura de prueba aparece en DBeaver con `dispositivo = prueba-terminal`. Para borrarla (como administrador):

```bash
mariadb -u root -p calidad_agua -e "DELETE FROM lecturas WHERE dispositivo = 'prueba-terminal'"
```

Prueba también desde **tu celular conectado a la misma WiFi**: abre `http://IP-DE-TU-LAPTOP:8080/api/salud`. Si ahí carga, el ESP32 también va a llegar.

## Paso 9 · Configurar y cargar el ESP32

1. **Permiso para el puerto USB** (solo una vez, luego cierra sesión y entra de nuevo):
   ```bash
   sudo usermod -aG dialout $USER
   ```
2. Conecta el ESP32 y revisa que aparezca: `ls /dev/ttyUSB* /dev/ttyACM*`.
3. En la carpeta de su sketch, copia `esp32/secretos.example.h` como `secretos.h` y llénalo:
   ```cpp
   const char* WIFI_SSID     = "TU_RED";          // la misma red que la laptop
   const char* WIFI_PASSWORD = "TU_CLAVE";
   const char* TS_WRITE_KEY  = "WRITE_KEY_DE_THINGSPEAK";
   const char* API_URL       = "http://IP-DE-TU-LAPTOP:8080/api/lecturas";   // la que dio el Paso 8
   const char* API_KEY       = "EL_MISMO_ESP32_API_KEY_DEL_.env";
   ```
4. Copia las funciones de `esp32/envio_datos.ino` a su firmware, **quita el código de Ubidots** y llama a las dos funciones cada 20 s (el ejemplo está al final del archivo).
5. Arduino IDE → puerto `/dev/ttyUSB0` (o `ttyACM0`) → **Subir**.
6. **Monitor Serie** (115200 baudios, o la velocidad de su `Serial.begin`). Debe salir cada 20 s:
   ```
   ThingSpeak entry_id: 57 · API HTTP: 201
   ```
7. En DBeaver presiona **F5** sobre `lecturas`: ahí están las filas del ESP32 (`dispositivo = esp32-1`). En la página, el semáforo se actualiza solo.

## Paso 10 · Mientras llega el hardware: ESP32 virtual

Hay dos formas de simular el ESP32. Las dos usan el mismo modelo físico: curvas reales de los módulos, divisor de la PCB, ruido y no linealidad del ADC del ESP32, calibración y compensación por temperatura.

**A. Simulador de terminal: manda datos reales a tu API y a MariaDB**

```bash
sudo dnf install nodejs                               # si no tienes Node 20+
node simulador/simular-esp32.js                       # usa ESP32_API_KEY del .env
```

O dentro de Docker, para que corra solo:

```bash
docker compose -f docker-compose.fedora.yml --profile simulador up -d
docker attach calidad-agua-simulador                  # ver el monitor serie y escribir comandos (salir: Ctrl+P, Ctrl+Q)
```

Comandos mientras corre: `muestras`, `muestra tierra`, `falla ph on`, `wifi off`, `calibrar ph`, `fabrica`, `estado`, `ayuda`. Con `SIM_GUION=1` en `.env` cambia de muestra cada 5 min (llave, tierra, vinagre…), ideal para dejarlo corriendo en la demo. Si pones `THINGSPEAK_WRITE_KEY` en `.env`, también publica de verdad en ThingSpeak y la versión de GitHub Pages lo muestra.

Sus lecturas llegan como `dispositivo = esp32-sim`. En la página: Ajustes → MariaDB → Dispositivo `esp32-sim`.

**B. Laboratorio oculto en la página (funciona también en GitHub Pages)**

Para entrar: en cualquier pantalla teclea **↑ ↑ ↓ ↓ ← → ← → B A**, o toca **5 veces la gota** del logo, o abre `http://localhost:8080/#laboratorio`.

Ahí puedes cambiar la muestra del vaso, ver la cadena completa (vaso → sensor → ADC → firmware), provocar fallas, calibrar, acelerar el tiempo y marcar **"Usar esta simulación en toda la página"**: Inicio, Historial y Alertas funcionan con el ESP32 virtual y muestran el aviso **Simulación**. En localhost también puede mandar cada lectura a tu API (pega la `ESP32_API_KEY` en la tarjeta "Enviar también a mi API").

**Borrar los datos simulados** antes de medir con el ESP32 real:

```bash
mariadb -u root -p calidad_agua -e "DELETE FROM lecturas WHERE dispositivo = 'esp32-sim'"
```

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
| Simular el ESP32 | `docker compose -f docker-compose.fedora.yml --profile simulador up -d` |
| Respaldar la base | `bash scripts/fedora/respaldar.sh` |
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
| `ERROR 1045 Access denied for user 'root'@'localhost'` | Contraseña de root de MariaDB incorrecta, o se escribió la de Linux | Pruébala sola con `mariadb -u root -p -e "SELECT 1"`. Si entra, ponla en `.env` como `DB_ROOT_PASSWORD` y repite el Paso 4. Si no la recuerdas: ver abajo |
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
