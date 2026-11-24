# Guía para Windows · Docker Desktop + PowerShell + DBeaver + ESP32

Esta guía es la versión para Windows 10/11 de [FEDORA.md](FEDORA.md). La diferencia principal: en Windows **MariaDB también corre dentro de Docker**. Docker en Windows es Docker Desktop, que corre en una máquina virtual (WSL2), y desde ahí los contenedores no se conectan bien a un MariaDB instalado en Windows. Con todo dentro de Docker no hay que configurar nada de red.

```
ESP32 ──HTTP (WiFi)──► http://IP-DE-TU-PC:8080/api/lecturas
                              │  web (nginx)        ┐
                              ▼                     │
                        api (Node)                  │  Docker Desktop
                              ▼                     │  (docker-compose.yml)
                        db (MariaDB) ◄── DBeaver en localhost:3306
                                         Adminer en http://localhost:8081
ThingSpeak ──► puente (opcional) ──► db
```

- Los datos viven en un volumen de Docker (`datos-mariadb`): sobreviven a reinicios y a `docker compose down`.
- MariaDB y Adminer solo se abren para tu PC (`127.0.0.1`), no para la red.
- Todos los comandos son de **PowerShell** (Inicio → escribe "PowerShell").

> **Scripts de PowerShell:** Windows bloquea scripts por defecto. Por eso todos los comandos de esta guía los corren así: `powershell -ExecutionPolicy Bypass -File scripts\windows\<script>.ps1`. No cambia nada permanente en tu PC.

---

## Paso 1 · Instalar lo necesario

Abre PowerShell y corre:

```powershell
winget install --id Git.Git -e
winget install --id Docker.DockerDesktop -e
```

Si `winget` no existe, descarga los instaladores de git-scm.com y docker.com.

1. **Reinicia la PC** después de instalar Docker Desktop.
2. Abre **Docker Desktop** desde Inicio y acepta los términos. Si pide instalar o actualizar **WSL**, acepta (o corre `wsl --install` en PowerShell como administrador y reinicia).
3. Espera a que abajo a la izquierda diga **Engine running**.
4. Verifica en una PowerShell nueva:

```powershell
git --version
docker --version
docker compose version
docker run --rm hello-world
```

**Opcionales:** DBeaver Community (dbeaver.io) para ver la base, Arduino IDE (arduino.cc) para el ESP32.

> Si Docker Desktop dice que la virtualización está desactivada, actívala en el BIOS de tu PC (Intel VT-x o AMD-V / SVM).

## Paso 2 · Clonar el repo y crear el `.env`

```powershell
cd $HOME\Documents
git clone https://github.com/Marcoflesh/IoT-interface-design-.git
cd IoT-interface-design-
Copy-Item .env.example .env
notepad .env
```

Para generar la `ESP32_API_KEY` (32 caracteres aleatorios):

```powershell
$b = New-Object byte[] 16; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join ''
```

Así debe quedar lo importante del `.env` (cada comentario en su propia línea, nunca al final de un valor):

```ini
# En Windows es la contraseña de root de la MariaDB del contenedor: invéntala.
DB_ROOT_PASSWORD=una-clave-para-root
DB_NAME=calidad_agua
DB_USER=agua
# Contraseña del usuario agua: invéntala. Es la que pondrás en DBeaver.
DB_PASSWORD=una-clave-para-agua
# 3307 si ya tienes MariaDB o MySQL instalado en Windows usando el 3306.
DB_PUERTO_LOCAL=3306
# Cámbialo (ej. 8090) solo si Windows dice que el 8080 está reservado.
WEB_PUERTO=8080

ESP32_API_KEY=el-resultado-del-comando-de-arriba
```

`DB_HOST` y `DB_PORT` son solo para Fedora; aquí no importan. Las contraseñas de MariaDB se fijan **la primera vez** que arranca el contenedor; si después las cambias, ve a "Problemas comunes".

## Paso 3 · Levantar todo

```powershell
docker compose up -d --build
docker compose ps
```

`db` debe decir **healthy** y `api`, `web` y `adminer` **running**. La primera vez tarda unos minutos porque descarga las imágenes. La API crea las tablas sola (migraciones 001 a 003).

Abre **http://localhost:8080** (con `http://`). Luego en **Ajustes → Fuente: MariaDB → Probar conexión → Guardar**.

## Paso 4 · Probar que todo responde

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\probar-conexion.ps1
```

Revisa Docker, los contenedores, la página, la API, un POST de prueba igual al del ESP32, que una llave falsa se rechace, que MariaDB responda, tu IP y el firewall. Al final te da el `API_URL` exacto para el ESP32.

## Paso 5 · Ver la base desde PowerShell (sin instalar MariaDB)

Entra a la terminal de MariaDB **dentro** del contenedor:

```powershell
docker exec -it calidad-agua-db mariadb -u agua -p calidad_agua
```

```sql
SHOW TABLES;
SELECT * FROM estado_dispositivos;
SELECT * FROM lecturas ORDER BY id DESC LIMIT 10;
exit
```

**Atajo:** muestra dispositivos, las últimas 10 lecturas en hora de México con el color del semáforo y el resumen de la última hora:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\ver-mariadb.ps1 -Seguir
```

(`-Seguir` la actualiza cada 5 s; Ctrl+C para salir.) Como administrador: `docker exec -it calidad-agua-db mariadb -u root -p` con `DB_ROOT_PASSWORD`.

## Paso 6 · DBeaver (opcional)

1. **Database → New Database Connection → MariaDB → Next**.
2. Host: `localhost` · Port: `3306` (o tu `DB_PUERTO_LOCAL`) · Database: `calidad_agua`.
3. Username: `agua` · Password: tu `DB_PASSWORD` · marca **Save password**.
4. **Test Connection** (acepta descargar el driver) → **Finish**.
5. `calidad_agua → Tables → lecturas → Data`; **F5** para ver filas nuevas.

Sin DBeaver también puedes usar **Adminer** en http://localhost:8081 (sistema MariaDB/MySQL, servidor `db`).

## Paso 7 · Abrir la red para el ESP32

El ESP32 entra a tu PC por el puerto 8080. Windows lo bloquea si tu red está como **Pública** o si no hay una regla de firewall. Abre **PowerShell como administrador** (clic derecho → Ejecutar como administrador), ve a la carpeta del repo y corre:

```powershell
cd $HOME\Documents\IoT-interface-design-
powershell -ExecutionPolicy Bypass -File scripts\windows\abrir-firewall.ps1
```

Si tu red está como Pública, te pregunta si la cambias a **Privada**: hazlo solo en tu casa o en el hotspot de tu celular. Luego crea la regla para el puerto 8080 en redes privadas.

Tu IP: `ipconfig` → "Adaptador de LAN inalámbrica Wi-Fi" → **Dirección IPv4** (el Paso 4 también te la da). Prueba desde tu **celular en la misma WiFi**: `http://TU-IP:8080/api/salud`. Si carga, el ESP32 también va a llegar.

> En la red del Tec los dispositivos suelen no poder verse entre sí. Usa el **hotspot de tu celular** para la PC y el ESP32, o el puente de ThingSpeak (Paso 10), que no necesita que el ESP32 vea tu PC.

## Paso 8 · Configurar y cargar el ESP32

1. Conecta el ESP32 por USB. En **Administrador de dispositivos → Puertos (COM y LPT)** debe aparecer, por ejemplo, `COM5`. Si sale como dispositivo desconocido, instala el driver de su chip USB: **CP210x** (Silicon Labs) o **CH340** (WCH), según tu placa.
2. En Arduino IDE: **Herramientas → Placa → ESP32 Dev Module** (o la tuya) y **Puerto → COM5**.
3. En la carpeta de su sketch, copia `esp32\secretos.example.h` como `secretos.h` y llénalo:

```cpp
const char* WIFI_SSID     = "TU_RED";
const char* WIFI_PASSWORD = "TU_CLAVE";
const char* TS_WRITE_KEY  = "WRITE_KEY_DE_THINGSPEAK";
const char* API_URL       = "http://TU-IP:8080/api/lecturas";
const char* API_KEY       = "LA_MISMA_ESP32_API_KEY_DEL_.env";
```

4. Abre `esp32\calidad_agua\calidad_agua.ino` (librerías **OneWire** y **DallasTemperature**) con ese `secretos.h` en la misma carpeta.
5. **Subir** y abre el **Monitor Serie** (115200). Cada 20 s debe salir `API -> 201 guardado en MariaDB`.

## Paso 9 · Dejar solo el ESP32 real, `esp32-1` (una sola vez)

El simulador se retiró: la página, la API y la base solo trabajan con el ESP32 real. Si alguna vez lo usaste:

```powershell
git pull
powershell -ExecutionPolicy Bypass -File scripts\windows\respaldar.ps1
docker rm -f calidad-agua-simulador
docker compose up -d --build
docker logs calidad-agua-api
```

Al arrancar, la API aplica las migraciones 004 y 006 (en el log sale `Migración aplicada: 006_solo_esp32_1.sql`): borra todo lo que no sea `esp32-1` (simulador, `prueba-terminal`, etc.), pasa a `esp32-1` lo copiado de ThingSpeak y quita la columna `distancia`. El `docker rm` puede decir que el contenedor no existe; no pasa nada.

Si el simulador publicó en tu canal de ThingSpeak, esas lecturas siguen ahí: bórralas en **Channel Settings → Clear Channel** (borra todo el canal, no se puede deshacer).

## Paso 10 · ThingSpeak y el puente ThingSpeak → MariaDB

**10.1 Crear el canal.** En **thingspeak.mathworks.com** entra con tu cuenta de MathWorks → **Channels → My Channels → New Channel** → Name `Calidad del agua` → marca Field 1 a 4 con los nombres `pH`, `Turbidez`, `Conductividad`, `Temperatura` (en ese orden) → **Save Channel**. El **Channel ID** está arriba; las llaves en **API Keys**. En **Sharing** deja el canal privado: el puente y la página lo leen con la **Read API Key**.

**10.2 En el `.env`:**

```ini
THINGSPEAK_CHANNEL_ID=2741234
THINGSPEAK_READ_KEY=ABCDEFGH12345678
THINGSPEAK_WRITE_KEY=
PUENTE_INTERVALO=60
```

**10.3 Probar el canal:**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\probar-thingspeak.ps1
```

Sin `-Escribir`: así no se guarda una lectura de prueba en el canal que van a presentar.

**10.4 Encender el puente** (copia cada minuto las lecturas nuevas del canal a MariaDB, sin duplicar y con su hora original):

```powershell
docker compose --profile thingspeak up -d --build
docker logs -f calidad-agua-puente
```

Debe decir `N lectura(s) copiadas` en cuanto el ESP32 publique en el canal.

**10.5 La página de GitHub con tu canal:**

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\configurar-pagina.ps1
git add docs/js/config.js
git commit -m "Página: leer el canal de ThingSpeak"
git push
```

En 1 o 2 minutos https://marcoflesh.github.io/IoT-interface-design-/ lee tu canal.

## Respaldos

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\respaldar.ps1
powershell -ExecutionPolicy Bypass -File scripts\windows\respaldar.ps1 -Restaurar respaldos\<archivo>.sql.gz
```

Guarda los 14 más recientes en `respaldos\`. Haz uno antes de cada demo.

## Uso diario

| Para | Comando |
|---|---|
| Encender todo | Abre Docker Desktop y `docker compose up -d` |
| Encender con puente | `docker compose --profile thingspeak up -d` |
| Apagar (los datos se quedan) | `docker compose down` |
| Ver logs de la API | `docker logs -f calidad-agua-api` |
| Revisar todo | `powershell -ExecutionPolicy Bypass -File scripts\windows\probar-conexion.ps1` |
| Ver los datos llegar | `powershell -ExecutionPolicy Bypass -File scripts\windows\ver-mariadb.ps1 -Seguir` |
| Respaldar | `powershell -ExecutionPolicy Bypass -File scripts\windows\respaldar.ps1` |
| Traer cambios del repo | `git pull` y luego `docker compose up -d --build` |

Para que arranque solo al prender la PC: Docker Desktop → **Settings → General → Start Docker Desktop when you sign in**. Los contenedores tienen `restart: unless-stopped`, así que vuelven solos.

---

## Problemas comunes

| Síntoma | Causa | Solución |
|---|---|---|
| `... cannot be loaded because running scripts is disabled` | Política de scripts de Windows | Córrelos como dice la guía: `powershell -ExecutionPolicy Bypass -File scripts\windows\...` |
| `error during connect` / `docker: The system cannot find the file specified` | Docker Desktop cerrado | Ábrelo y espera a **Engine running** |
| Docker Desktop: `WSL 2 installation is incomplete` o virtualización desactivada | Falta WSL2 o VT-x/SVM | `wsl --install` como administrador y reinicia; activa la virtualización en el BIOS |
| `Ports are not available: ... 0.0.0.0:8080 ... forbidden by its access permissions` | Windows reservó el 8080 (Hyper-V/WSL) | Pon `WEB_PUERTO=8090` en `.env` y `docker compose up -d`. Usa ese puerto en el navegador y en `API_URL`. Para ver rangos reservados: `netsh interface ipv4 show excludedportrange protocol=tcp` |
| `Bind for 127.0.0.1:3306 failed: port is already allocated` | Ya tienes MariaDB/MySQL en Windows | `DB_PUERTO_LOCAL=3307` en `.env`, `docker compose up -d` y usa 3307 en DBeaver |
| `Access denied for user 'agua'` después de cambiar `DB_PASSWORD` | MariaDB guardó la contraseña del primer arranque | Sin perder datos: `docker exec -it calidad-agua-db mariadb -u root -p` y `ALTER USER 'agua'@'%' IDENTIFIED BY 'la-nueva';` (luego `docker compose up -d --force-recreate api`). O empezar de cero (**borra datos**): `docker compose down -v` y `docker compose up -d` |
| `/api/salud` dice `ok:false` | MariaDB todavía arranca | Espera 30 s; `docker compose ps` (db: healthy) y `docker logs calidad-agua-api` |
| ESP32: `API HTTP: -1` | Firewall, red Pública o red del Tec | Paso 7; prueba `http://TU-IP:8080/api/salud` desde el celular; usa hotspot o el puente (Paso 10) |
| ESP32: `API HTTP: 401` | Llaves distintas | `API_KEY` en `secretos.h` = `ESP32_API_KEY` del `.env`; si cambiaste el `.env`: `docker compose up -d --force-recreate api` |
| El ESP32 no aparece como COM | Driver o cable | Instala CP210x o CH340; usa un cable USB de datos (no solo de carga) |
| Puente: `Falta THINGSPEAK_CHANNEL_ID` / `El canal es privado` | Faltan datos del canal | Llena el `.env` (Paso 10.2) y `docker compose --profile thingspeak up -d --force-recreate puente` |
| La página publicada no cambia | Caché del navegador | Ctrl+F5 |
| `ver-mariadb.ps1` muestra signos raros en vez de acentos | Consola con otra codificación | Usa **Windows Terminal** o PowerShell 7; los datos no se afectan |
