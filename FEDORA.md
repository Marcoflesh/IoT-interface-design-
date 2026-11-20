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

Llena así (`DB_ROOT_PASSWORD` no se usa en esta variante):

```ini
DB_NAME=calidad_agua
DB_USER=agua
DB_PASSWORD=una-clave-tuya-sin-comillas-simples
ESP32_API_KEY=el-resultado-del-comando-de-python
```

## Paso 4 · Preparar MariaDB (un comando)

```bash
bash scripts/fedora/preparar-mariadb.sh
```

El script:
1. Revisa que MariaDB esté corriendo (si no, lo inicia).
2. Entra como root con `sudo mariadb` (en Fedora root usa autenticación por socket; si tu root tiene contraseña, te la pide).
3. Crea la base `calidad_agua` y el usuario `agua` que **solo puede entrar desde tu laptop**.
4. Crea la tabla `lecturas` y la vista `resumen_diario`.
5. Abre el puerto **8080** en firewalld para que el ESP32 llegue.
6. Te imprime los datos para DBeaver y la línea exacta para el ESP32.

Puedes correrlo cuantas veces quieras; si cambias la contraseña en `.env`, vuelve a correrlo y la actualiza.

<details>
<summary>Lo mismo, a mano (por si quieres ver qué hace)</summary>

```bash
sudo mariadb
```
```sql
CREATE DATABASE IF NOT EXISTS calidad_agua CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'agua'@'localhost' IDENTIFIED BY 'TU_CLAVE';
CREATE USER IF NOT EXISTS 'agua'@'127.0.0.1' IDENTIFIED BY 'TU_CLAVE';
GRANT ALL PRIVILEGES ON calidad_agua.* TO 'agua'@'localhost';
GRANT ALL PRIVILEGES ON calidad_agua.* TO 'agua'@'127.0.0.1';
FLUSH PRIVILEGES;
EXIT;
```
```bash
mariadb -h 127.0.0.1 -u agua -p calidad_agua < api/src/esquema.sql
sudo firewall-cmd --permanent --add-port=8080/tcp && sudo firewall-cmd --reload
```
Se crean dos usuarios (`localhost` y `127.0.0.1`) porque la terminal entra por socket y la API entra por TCP.
</details>

## Paso 5 · Conectarte desde la terminal

```bash
mariadb -h 127.0.0.1 -u agua -p calidad_agua
```
```sql
SHOW TABLES;                                          -- lecturas, resumen_diario
SELECT * FROM lecturas ORDER BY id DESC LIMIT 10;     -- últimas lecturas
SELECT * FROM resumen_diario;                         -- promedios por día
```

## Paso 6 · Conectarte desde DBeaver

**Opción A, con tu conexión de siempre (root):** clic derecho en la conexión → **Refresh** (F5) → **Databases → calidad_agua → Tables → lecturas** → pestaña **Data**.

**Opción B, conexión propia del proyecto (recomendada para la demo):**
1. **Database → New Database Connection → MariaDB → Next**.
2. Host: `localhost` · Port: `3306` · Database: `calidad_agua`.
3. Username: `agua` · Password: la de `DB_PASSWORD` · marca **Save password**.
4. **Test Connection** (si pide descargar el driver, acepta) → **Finish**.
5. Abre `calidad_agua → Tables → lecturas → Data`. Cuando el ESP32 mande datos, presiona **F5** para ver las filas nuevas.

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

Revisa contenedores, página, API, MariaDB, que se rechace una llave falsa y que responda por la **IP de tu red**. Al final te dice el `API_URL` exacto para el ESP32. La lectura de prueba aparece en DBeaver con `dispositivo = prueba-terminal`; para borrarla:

```bash
bash scripts/fedora/probar-conexion.sh --limpiar
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

## Uso diario

| Para | Comando |
|---|---|
| Encender página y API | `docker compose -f docker-compose.fedora.yml up -d` |
| Apagar | `docker compose -f docker-compose.fedora.yml down` |
| Ver qué llega del ESP32 | `docker logs -f calidad-agua-api` |
| Revisar todo | `bash scripts/fedora/probar-conexion.sh` |
| Saber tu IP actual | `ip -4 route get 1.1.1.1` (el valor después de `src`) |

Con `restart: unless-stopped` y Docker habilitado, la página y la API vuelven solas al reiniciar la laptop.

---

## Problemas comunes

| Síntoma | Causa | Solución |
|---|---|---|
| `permission denied ... docker.sock` | Tu usuario no está en el grupo docker | `sudo usermod -aG docker $USER` y cierra sesión |
| Docker no arranca: `failed to find iptables` | Fedora usa nftables | `sudo alternatives --set iptables /usr/bin/iptables-nft && sudo systemctl restart docker` |
| `docker compose: command not found` | Falta el plugin | `sudo dnf install docker-compose-plugin` |
| La página da **403** o sale en blanco | SELinux bloquea la carpeta | El compose ya usa `:z`; si persiste: `sudo chcon -Rt container_file_t docs nginx.fedora.conf` |
| `/api/salud` dice `ok:false` / logs: `Access denied for user 'agua'` | Contraseña distinta entre `.env` y MariaDB | Corre otra vez `bash scripts/fedora/preparar-mariadb.sh` y `docker compose -f docker-compose.fedora.yml up -d --force-recreate api` |
| Logs: `ECONNREFUSED 127.0.0.1:3306` | MariaDB apagado o sin TCP | `sudo systemctl start mariadb`; revisa que no haya `skip-networking` en `/etc/my.cnf.d/` |
| `address already in use` en 8080 | Otro programa usa el puerto | `sudo ss -tlnp \| grep 8080` y ciérralo, o cambia `listen 8080` en `nginx.fedora.conf` (y en el ESP32) |
| Celular/ESP32 no llegan a `http://IP:8080` | Firewall o red | `sudo firewall-cmd --list-ports` debe incluir `8080/tcp`. Las redes del Tec suelen aislar dispositivos: usen el **hotspot de un celular** para laptop y ESP32 |
| ESP32: `API HTTP: 401` | Llaves distintas | `API_KEY` en `secretos.h` = `ESP32_API_KEY` en `.env` (y recrear la API si cambiaste el `.env`) |
| ESP32: `API HTTP: 400` | Dato inválido | Lee el mensaje en el monitor serie; usen `NAN` para sensores caídos, nunca texto |
| El ESP32 no aparece en `/dev/ttyUSB*` | Permisos, cable o brltty | Grupo `dialout`; usa un cable de datos; si el puerto aparece y desaparece y no usas lector braille: `sudo dnf remove brltty` |
| Cambió la IP de la laptop | DHCP | Actualiza `API_URL` en `secretos.h` o reserva la IP en el router/hotspot |
