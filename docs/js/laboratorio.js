/*
 * laboratorio.js
 * Página oculta: ESP32 virtual con sensores simulados.
 * Se desbloquea con el código Konami (↑ ↑ ↓ ↓ ← → ← → B A), con 5 toques
 * en la gota del logo, o entrando a #laboratorio.
 *
 * Expone window.Laboratorio para que app.js lo use como fuente de datos "simulador".
 */
(function () {
  "use strict";

  var CLAVE_LS = "calidadAgua.lab.v1";
  var CLAVE_KEY = "calidadAgua.lab.apiKey";
  var KONAMI = ["arrowup", "arrowup", "arrowdown", "arrowdown", "arrowleft", "arrowright", "arrowleft", "arrowright", "b", "a"];
  var SENSORES = [
    { clave: "ph", nombre: "pH", falla: "ph", modulo: "PH-4502C · GPIO34", dec: 2, unidad: "" },
    { clave: "turbidez", nombre: "Turbidez", falla: "turbidez", modulo: "SEN0189 · GPIO35", dec: 1, unidad: "NTU" },
    { clave: "conductividad", nombre: "Conductividad", falla: "conductividad", modulo: "Gravity TDS · GPIO32", dec: 0, unidad: "µS/cm" },
    { clave: "temperatura", nombre: "Temperatura", falla: "temperatura", modulo: "DS18B20 · GPIO4", dec: 2, unidad: "°C" }
  ];
  var FALLAS = [
    { id: "wifi", texto: "WiFi" },
    { id: "ph", texto: "Desconectar pH" },
    { id: "turbidez", texto: "Desconectar turbidez" },
    { id: "conductividad", texto: "Desconectar TDS" },
    { id: "temperatura", texto: "Desconectar DS18B20" },
    { id: "fueraDelAgua", texto: "Sacar sondas del agua" },
    { id: "sinCapacitor", texto: "Quitar capacitor del ADC" }
  ];

  var esp = null;
  var lecturas = [];
  var velocidad = 1;
  var pausado = false;
  var temporizador = null;
  var suscriptores = [];
  var envios = { total: 0, api: "apagado", ultimoTs: "–" };
  var api = { activo: false, llave: "" };
  var colaSerie = [];
  var ultimaCal = "";

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  // ---------- Desbloqueo ----------

  function leerEstado() {
    try { return JSON.parse(localStorage.getItem(CLAVE_LS) || "{}"); } catch (e) { return {}; }
  }
  function guardarEstado(e) {
    try { localStorage.setItem(CLAVE_LS, JSON.stringify(e)); } catch (err) { /* sin almacenamiento */ }
  }
  function desbloqueado() { return !!leerEstado().desbloqueado; }

  function aviso(texto) {
    var t = $("#toast");
    if (!t) return;
    t.textContent = texto;
    t.hidden = false;
    t.classList.remove("toast--salir");
    clearTimeout(aviso._t);
    aviso._t = setTimeout(function () {
      t.classList.add("toast--salir");
      setTimeout(function () { t.hidden = true; }, 250);
    }, 3200);
  }

  function desbloquear(origen) {
    var yaEstaba = desbloqueado();
    guardarEstado({ desbloqueado: true });
    mostrarAccesos();
    if (!yaEstaba) aviso("Laboratorio desbloqueado: encontraste el ESP32 virtual.");
    if (origen !== "url" && location.hash !== "#laboratorio") location.hash = "#laboratorio";
  }

  function bloquear() {
    guardarEstado({});
    detener();
    document.dispatchEvent(new CustomEvent("lab:fuente", { detail: { usar: false } }));
    mostrarAccesos();
    location.hash = "#inicio";
    aviso("Laboratorio oculto otra vez. Ya sabes cómo volver.");
  }

  function mostrarAccesos() {
    var si = desbloqueado();
    var nav = $("#nav-lab");
    if (nav) nav.hidden = !si;
    $$("[data-solo-lab]").forEach(function (el) { el.hidden = !si; });
  }

  function escucharDesbloqueo() {
    var progreso = 0;
    document.addEventListener("keydown", function (ev) {
      var tag = (ev.target && ev.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      var tecla = (ev.key || "").toLowerCase();
      progreso = tecla === KONAMI[progreso] ? progreso + 1 : (tecla === KONAMI[0] ? 1 : 0);
      if (progreso === KONAMI.length) { progreso = 0; desbloquear("konami"); }
    });

    var toques = [];
    var logo = $(".marca__logo");
    if (logo) {
      logo.addEventListener("click", function () {
        var ahora = Date.now();
        toques = toques.filter(function (t) { return ahora - t < 2500; });
        toques.push(ahora);
        if (toques.length >= 5) { toques = []; desbloquear("logo"); }
      });
    }
  }

  // ---------- Simulación ----------

  function iniciar() {
    if (esp) return;
    esp = SimESP32.crear({ semilla: (Date.now() % 9973) + 1, dispositivo: "esp32-sim", alLog: function (l) { colaSerie.push(l); if (colaSerie.length > 300) colaSerie.shift(); } });
    lecturas = SimESP32.precargar(esp, 60, null, Date.now());
    colaSerie.push("[" + "--:--:--.---" + "] (historial previo: " + lecturas.length + " lecturas de la última hora)");
    try { api.llave = sessionStorage.getItem(CLAVE_KEY) || ""; } catch (e) { api.llave = ""; }
    temporizador = setInterval(tick, 250);
  }

  function detener() {
    clearInterval(temporizador);
    temporizador = null;
    esp = null;
    lecturas = [];
  }

  function tick() {
    if (!esp || pausado) return;
    var nuevas = esp.avanzar(0.25 * velocidad);
    nuevas.forEach(function (r) {
      if (!r.listoParaEnviar) return;
      var l = Object.assign({}, r.lectura, { fecha: new Date(), id: (lecturas.length ? lecturas[lecturas.length - 1].id || 0 : 0) + 1 });
      lecturas.push(l);
      if (lecturas.length > 600) lecturas.shift();
      envios.total++;
      envios.ultimoTs = esp.thingSpeakSimulado();
      if (api.activo && api.llave) enviarAPI(l);
      else esp.log("ThingSpeak entry_id: " + envios.ultimoTs + " (simulado) · API: " + (api.activo ? "falta la llave" : "apagada"));
      suscriptores.forEach(function (fn) { fn(); });
    });
    if (location.hash.indexOf("#laboratorio") === 0) render();
  }

  function urlAPI() {
    var base = (window.APP_CONFIG && APP_CONFIG.api && APP_CONFIG.api.url ? APP_CONFIG.api.url : "").replace(/\/$/, "");
    return base + "/api/lecturas";
  }

  function enviarAPI(lectura) {
    fetch(urlAPI(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": api.llave },
      body: JSON.stringify(SimESP32.cuerpoAPI(lectura))
    }).then(function (r) {
      envios.api = r.status === 201 ? "201 guardado en MariaDB"
        : r.status === 401 ? "401 llave incorrecta"
        : r.status === 404 || r.status === 405 ? r.status + " no hay API aquí (solo localhost con Docker)"
        : String(r.status);
      if (esp) esp.log("ThingSpeak entry_id: " + envios.ultimoTs + " (simulado) · API HTTP: " + r.status);
    }).catch(function () {
      envios.api = "sin conexión con la API";
      if (esp) esp.log("ThingSpeak entry_id: " + envios.ultimoTs + " (simulado) · API HTTP: -1");
    });
  }

  function leer(n) {
    iniciar();
    return Promise.resolve({ canal: "ESP32 virtual", lecturas: lecturas.slice(-n) });
  }

  // ---------- Render ----------

  var fmt = {};
  function num(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return "–";
    if (!fmt[d]) fmt[d] = new Intl.NumberFormat("es-MX", { minimumFractionDigits: d, maximumFractionDigits: d });
    return fmt[d].format(v);
  }
  function reloj(seg) {
    var h = Math.floor(seg / 3600), m = Math.floor(seg / 60) % 60, s = Math.floor(seg) % 60;
    return h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }
  function mezclar(a, b, t) {
    function rgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16); }); }
    var x = rgb(a), y = rgb(b);
    return "rgb(" + x.map(function (v, i) { return Math.round(v + (y[i] - v) * t); }).join(",") + ")";
  }

  function construir() {
    var cont = $("#lab-muestras");
    if (!cont || cont.childElementCount) return;
    Object.keys(SimESP32.MUESTRAS).forEach(function (id) {
      var m = SimESP32.MUESTRAS[id];
      var b = document.createElement("button");
      b.type = "button";
      b.className = "lab-muestra";
      b.setAttribute("data-muestra", id);
      b.innerHTML = '<span class="lab-muestra__gota" style="background:' + m.color + '"></span><span>' + m.nombre +
        '</span><span class="lab-muestra__datos">pH ' + m.ph + " · " + m.ntu + " NTU · " + m.ec25 + " µS/cm</span>";
      b.addEventListener("click", function () { esp.cambiarMuestra(id); render(); });
      cont.appendChild(b);
    });

    $("#lab-senal").innerHTML = SENSORES.map(function (s) {
      return '<tr data-sensor="' + s.clave + '"><th scope="row">' + s.nombre + '<span class="lab-modulo">' + s.modulo + "</span></th>" +
        "<td data-c='real'></td><td data-c='v'></td><td data-c='adc'></td><td data-c='fw'></td><td data-c='err'></td></tr>";
    }).join("");

    var cf = $("#lab-fallas");
    FALLAS.forEach(function (f) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "lab-falla";
      b.setAttribute("data-falla", f.id);
      b.textContent = f.texto;
      b.addEventListener("click", function () {
        if (f.id === "wifi") esp.wifi(!esp.wifi().conectado);
        else esp.falla(f.id, !esp.fallas()[f.id]);
        render();
      });
      cf.appendChild(b);
    });

    $("#lab-reiniciar").addEventListener("click", function () { esp.reiniciar(); render(); });
    $("#lab-cal-ph").addEventListener("click", function () {
      var r = esp.calibrarPH();
      ultimaCal = "pH: " + num(r.mvPorPh, 1) + " mV/pH (" + num(r.eficiencia, 1) + " % del ideal), offset " + num(r.offsetMv, 1) + " mV.";
      render();
    });
    $("#lab-cal-tds").addEventListener("click", function () {
      var r = esp.calibrarTDS();
      ultimaCal = "Conductividad: K = " + num(r.k, 4) + ".";
      render();
    });
    $("#lab-cal-turb").addEventListener("click", function () {
      var r = esp.calibrarTurbidez();
      ultimaCal = "Turbidez: corrección de " + num(r.offsetV * 1000, 1) + " mV respecto a 4.200 V.";
      render();
    });
    $("#lab-fabrica").addEventListener("click", function () {
      esp.valoresFabrica();
      ultimaCal = "Valores de fábrica: observa cómo la turbidez deja de distinguir agua turbia.";
      render();
    });
    $$("[data-velocidad]").forEach(function (b) {
      b.addEventListener("click", function () { velocidad = +b.getAttribute("data-velocidad"); render(); });
    });
    $("#lab-pausar").addEventListener("click", function () { pausado = !pausado; render(); });
    $("#lab-limpiar").addEventListener("click", function () { $("#lab-serie").textContent = ""; });

    $("#lab-usar").addEventListener("change", function (ev) {
      document.dispatchEvent(new CustomEvent("lab:fuente", { detail: { usar: ev.target.checked } }));
    });
    $("#lab-api").addEventListener("change", function (ev) {
      api.activo = ev.target.checked;
      if (api.activo) { velocidad = 1; envios.api = api.llave ? "esperando el siguiente envío" : "falta la llave"; }
      else envios.api = "apagado";
      render();
    });
    $("#lab-llave").value = api.llave;
    $("#lab-llave").addEventListener("input", function (ev) {
      api.llave = ev.target.value.trim();
      try { sessionStorage.setItem(CLAVE_KEY, api.llave); } catch (e) { /* sin almacenamiento */ }
    });
    $("#lab-ocultar").addEventListener("click", bloquear);
  }

  function render() {
    if (!esp) return;
    construir();
    var v = esp.verdad(), u = esp.ultimo(), w = esp.wifi(), f = esp.fallas(), cal = esp.calibracion();
    var muestra = SimESP32.MUESTRAS[esp.muestra()];

    // Estado
    $("#lab-chip-wifi").textContent = w.conectado ? "WiFi " + w.rssi + " dBm" : "WiFi sin conexión";
    $("#lab-chip-wifi").className = "chip " + (w.conectado ? "chip--ok" : "chip--critico");
    $("#lab-chip-uptime").textContent = "Encendido " + reloj(esp.uptime());
    $("#lab-chip-envio").textContent = pausado ? "En pausa" : "Próximo envío en " + Math.ceil(esp.proximoEnvio() / velocidad) + " s";
    $("#lab-chip-ciclo").textContent = "Ciclo #" + esp.ciclo() + " · " + envios.total + " envíos";
    $("#lab-chip-cal").textContent = cal.fabrica ? "Sin calibrar" : "Calibrado";
    $("#lab-chip-cal").className = "chip " + (cal.fabrica ? "chip--fuera" : "chip--ok");

    // Vaso
    var turb = Math.min(1, v.turbidez / 40);
    $("#lab-agua").setAttribute("fill", mezclar(muestra.color.length === 7 ? muestra.color : "#E2EFF8", "#8E6B3E", turb));
    $("#lab-sedimento").setAttribute("opacity", muestra.sedimenta ? String(0.25 + 0.5 * (1 - Math.min(1, v.turbidez / muestra.ntu))) : "0");
    $$("#lab-particulas circle").forEach(function (c, i) { c.setAttribute("opacity", i < Math.round(turb * 14) ? "0.55" : "0"); });
    $("#lab-sondas").setAttribute("transform", f.fueraDelAgua ? "translate(0,-58)" : "translate(0,0)");
    SENSORES.forEach(function (s) {
      var g = document.getElementById("lab-sonda-" + s.clave);
      if (g) g.classList.toggle("lab-sonda--off", !!f[s.falla]);
    });
    $("#lab-vaso-titulo").textContent = muestra.nombre;
    $("#lab-vaso-real").textContent = "En el vaso: pH " + (v.ph === null ? "–" : num(v.ph, 2)) + " · " + num(v.turbidez, 1) + " NTU · " +
      num(v.conductividad, 0) + " µS/cm · " + num(v.temperatura, 1) + " °C";
    $$("[data-muestra]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-muestra") === esp.muestra())); });

    // Cadena de la señal
    if (u) {
      SENSORES.forEach(function (s) {
        var fila = document.querySelector('[data-sensor="' + s.clave + '"]');
        var c = u.crudo[s.clave];
        var real = s.clave === "ph" ? v.ph : s.clave === "turbidez" ? v.turbidez : s.clave === "conductividad" ? v.conductividad : v.temperatura;
        var calc = s.clave === "temperatura" ? c.calculado : u.lectura[s.clave];
        fila.querySelector("[data-c='real']").textContent = real === null ? "–" : num(real, s.dec) + (s.unidad ? " " + s.unidad : "");
        fila.querySelector("[data-c='v']").textContent = s.clave === "temperatura" ? "digital" : num(c.vSensor, 3) + " V";
        fila.querySelector("[data-c='adc']").innerHTML = s.clave === "temperatura" ? "OneWire"
          : Math.round(c.mv) + ' mV<span class="lab-sub">' + c.cuentas + " cuentas</span>";
        fila.querySelector("[data-c='fw']").textContent = calc === null || calc === undefined ? "null" : num(calc, s.dec) + (s.unidad ? " " + s.unidad : "");
        var err = calc === null || calc === undefined || real === null ? null : calc - real;
        var celda = fila.querySelector("[data-c='err']");
        celda.textContent = err === null ? "–" : (err >= 0 ? "+" : "") + num(err, s.dec);
        if (c.nota) {
          var nota = document.createElement("span");
          nota.className = "lab-sub";
          nota.textContent = c.nota;
          celda.appendChild(nota);
        }
        celda.classList.toggle("fuera", calc === null || calc === undefined);
      });
    }

    // Fallas
    $$("[data-falla]").forEach(function (b) {
      var id = b.getAttribute("data-falla");
      var activo = id === "wifi" ? !w.conectado : f[id];
      b.setAttribute("aria-pressed", String(!!activo));
      b.textContent = id === "wifi" ? (w.conectado ? "Cortar WiFi" : "Reconectar WiFi") : FALLAS.filter(function (x) { return x.id === id; })[0].texto;
    });

    // Calibración y velocidad
    $("#lab-cal-resultado").textContent = ultimaCal || "pH " + num(cal.phPendiente25 / 3 * 1000, 1) + " mV/pH · K " + num(cal.tdsK, 3) +
      " · turbidez " + num(cal.turbOffsetV * 1000, 1) + " mV" + (cal.fabrica ? " (fábrica)" : "");
    $$("[data-velocidad]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(+b.getAttribute("data-velocidad") === velocidad));
      b.disabled = api.activo && b.getAttribute("data-velocidad") !== "1";
    });
    $("#lab-pausar").textContent = pausado ? "Continuar" : "Pausar";

    // Monitor serie
    if (colaSerie.length) {
      var pre = $("#lab-serie");
      var abajo = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 30;
      pre.textContent += colaSerie.join("\n") + "\n";
      colaSerie = [];
      var lineas = pre.textContent.split("\n");
      if (lineas.length > 300) pre.textContent = lineas.slice(-300).join("\n");
      if (abajo) pre.scrollTop = pre.scrollHeight;
    }

    // Envío a la API
    $("#lab-api-estado").textContent = api.activo ? envios.api : "Apagado: las lecturas solo viven en esta pestaña.";
    $("#lab-usar").checked = !!(window.APP_FUENTE_ACTUAL && window.APP_FUENTE_ACTUAL() === "simulador");
  }

  window.Laboratorio = {
    desbloqueado: desbloqueado,
    desbloquear: desbloquear,
    iniciar: iniciar,
    leer: leer,
    render: function () { iniciar(); render(); },
    alNuevaLectura: function (fn) { suscriptores.push(fn); },
    mostrarAccesos: mostrarAccesos
  };

  escucharDesbloqueo();
  mostrarAccesos();
})();
