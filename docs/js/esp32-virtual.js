/*
 * esp32-virtual.js
 * ESP32 virtual con sus sensores, lo más cercano posible al hardware real.
 * Lo usan el laboratorio oculto de la página y el simulador de terminal (Node).
 *
 * Cadena que se simula para cada lectura:
 *   agua en el vaso → respuesta de la sonda → voltaje del módulo → divisor de la PCB
 *   → ADC del ESP32 (ruido, no linealidad, 12 bits) → sobremuestreo → firmware
 *   (calibración, compensación por temperatura, validaciones) → lectura que se envía
 *
 * Supuestos (cámbienlos cuando el encargado del ESP32 responda el cuestionario):
 *   pH:        módulo PH-4502C, 2.50 V en pH 7, ganancia x3, divisor 10k/20k (x0.667)
 *   Turbidez:  DFRobot SEN0189, curva NTU = -1120.4 V² + 5742.3 V - 4352.9, divisor 10k/10k (x0.5)
 *   TDS:       DFRobot Gravity TDS, EC = 133.42 V³ - 255.86 V² + 857.39 V, sin divisor (máx 2.3 V)
 *   Temp:      DS18B20, resolución 0.0625 °C, error ±0.5 °C
 *   ADC:       analogReadMilliVolts, atenuación 11 dB, lineal de 150 a 2450 mV
 */
(function (raiz) {
  "use strict";

  // ---------- Utilidades ----------

  function mulberry32(semilla) {
    return function () {
      semilla |= 0; semilla = semilla + 0x6D2B79F5 | 0;
      var t = Math.imul(semilla ^ semilla >>> 15, 1 | semilla);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    var u = 1 - rng(), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function limitar(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function mediana(arr) {
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function redondear(x, d) { var f = Math.pow(10, d); return Math.round(x * f) / f; }
  function pad(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; }
  function relojUptime(seg) {
    var ms = Math.floor(seg * 1000);
    var h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    return pad(h, 2) + ":" + pad(m, 2) + ":" + pad(s, 2) + "." + pad(ms % 1000, 3);
  }

  // ---------- Muestras de agua ----------
  // ph, ntu (turbidez), ec25 (µS/cm a 25 °C), temp (°C). "sedimenta": la tierra se asienta con el tiempo.
  var MUESTRAS = {
    purificada:    { nombre: "Agua purificada",  ph: 6.9, ntu: 0.3,  ec25: 140,   temp: 22.0, color: "#EAF4FB" },
    llave:         { nombre: "Agua de la llave", ph: 7.4, ntu: 0.8,  ec25: 620,  temp: 22.5, color: "#E2EFF8" },
    tierra:        { nombre: "Con tierra",       ph: 7.2, ntu: 18,   ec25: 690,  temp: 22.5, color: "#C9B48E", sedimenta: true },
    sal:           { nombre: "Con sal",          ph: 7.3, ntu: 1.2,  ec25: 2600, temp: 22.5, color: "#E5EEF3" },
    vinagre:       { nombre: "Con vinagre",      ph: 3.3, ntu: 1.0,  ec25: 880,  temp: 22.5, color: "#EEEBD9" },
    tierraVinagre: { nombre: "Tierra + vinagre", ph: 3.6, ntu: 22,   ec25: 1020, temp: 22.5, color: "#B9A27A", sedimenta: true },
    jabonosa:      { nombre: "Agua jabonosa",    ph: 9.4, ntu: 38,   ec25: 1380, temp: 24.0, color: "#D9DEE2" }
  };

  // Guion de la última hora para que Historial y Alertas tengan qué mostrar al abrir.
  var GUION_PRECARGA = [
    { min: 0, muestra: "llave" }, { min: 18, muestra: "tierra" }, { min: 27, muestra: "llave" },
    { min: 35, muestra: "vinagre" }, { min: 41, muestra: "tierraVinagre" }, { min: 46, muestra: "llave" }
  ];

  // ---------- Modelos de los sensores ----------

  var NERNST_25 = 0.05916;                  // V/pH a 25 °C
  var PH = { centro: 2.50, ganancia: 3, divisor: 20 / 30 };
  var TURB = { a: -1120.4, b: 5742.3, c: -4352.9, divisor: 10 / 20 };
  var TURB_VERTICE = -TURB.b / (2 * TURB.a);                                  // 2.5626 V
  var TURB_MAX = TURB.a * TURB_VERTICE * TURB_VERTICE + TURB.b * TURB_VERTICE + TURB.c; // ≈ 3005 NTU
  var TDS = { vmax: 2.3, divisor: 1 };

  function ntuDesdeVoltaje(v) { return TURB.a * v * v + TURB.b * v + TURB.c; }
  function voltajeDesdeNtu(ntu) {
    return TURB_VERTICE + Math.sqrt(Math.max(0, (TURB_MAX - ntu) / -TURB.a));
  }
  function ecDesdeVoltaje(v) { return 133.42 * v * v * v - 255.86 * v * v + 857.39 * v; }
  function voltajeDesdeEc(ec) {
    if (ec <= 0) return 0;
    var lo = 0, hi = TDS.vmax;
    if (ecDesdeVoltaje(hi) <= ec) return hi;            // el módulo se satura
    for (var i = 0; i < 40; i++) {
      var mid = (lo + hi) / 2;
      if (ecDesdeVoltaje(mid) < ec) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ADC del ESP32 con atenuación 11 dB: lineal de 150 a 2450 mV, comprimido fuera de ese rango.
  function adcLeerMilivolts(vPin, rng, ruidoMv) {
    var mv = vPin * 1000, leido;
    if (mv <= 0) leido = 0;
    else if (mv < 150) leido = 150 * Math.pow(mv / 150, 1.6);
    else if (mv <= 2450) leido = mv;
    else leido = 2450 + (mv - 2450) * 0.55;
    leido = leido * 1.004 + 3 + gauss(rng) * ruidoMv;     // error de ganancia/offset + ruido
    var cuentas = limitar(Math.round(leido * 4095 / 3100), 0, 4095);
    return { cuentas: cuentas, mv: cuentas * 3100 / 4095 };
  }
  function sobremuestrear(vPin, n, rng, ruidoMv) {
    var suma = 0, sumaC = 0;
    for (var i = 0; i < n; i++) {
      var r = adcLeerMilivolts(vPin, rng, ruidoMv);
      suma += r.mv; sumaC += r.cuentas;
    }
    return { mv: suma / n, cuentas: Math.round(sumaC / n) };
  }

  // ---------- ESP32 virtual ----------

  function crear(opciones) {
    opciones = opciones || {};
    var rng = mulberry32(opciones.semilla || 502);
    var intervalo = opciones.intervaloSeg || 20;
    var dispositivo = opciones.dispositivo || "esp32-sim";
    var firmware = opciones.firmware || "sim-1.0.0";

    // Defectos fijos de esta "unidad" (cada sensor real tiene los suyos).
    var defectos = {
      phOffsetMv: 9 + gauss(rng) * 3,            // la sonda marca 9 mV de más en pH 7
      phEficiencia: 0.965 + gauss(rng) * 0.01,   // pendiente al 96.5 % del ideal
      turbOffsetV: -0.0006,                      // envejecimiento del LED
      tdsCelda: 1.04,                            // la celda marca 4 % de más sin calibrar
      tempSesgo: 0.18                            // el DS18B20 marca 0.18 °C de más
    };

    function calFabrica() {
      return { phV7: PH.centro, phPendiente25: PH.ganancia * NERNST_25, turbOffsetV: 0, tdsK: 1.0, fecha: null, fabrica: true };
    }
    var cal = calFabrica();

    var muestraId = opciones.muestra && MUESTRAS[opciones.muestra] ? opciones.muestra : "llave";
    var m0 = MUESTRAS[muestraId];
    var verdad = { ph: m0.ph, ntu: m0.ntu, ec25: m0.ec25, temp: m0.temp };   // lo que "sienten" las sondas
    var tDesdeCambio = 999;
    var t = 0;                  // tiempo de simulación (s) desde el encendido
    var uptime = 0;
    var proximo = 3;            // el primer ciclo, 3 s después de encender
    var ciclo = 0;
    var tsEntry = 1000 + Math.floor(rng() * 500);
    var historialTurb = [];
    var wifi = { conectado: true, rssi: -59, reconectaEn: 0 };
    var fallas = { ph: false, turbidez: false, conductividad: false, temperatura: false, fueraDelAgua: false, sinCapacitor: false };
    var ultimo = null;
    var bitacora = [];

    function logBitacora(texto) { return log(texto); }
    function log(texto) {
      var linea = "[" + relojUptime(uptime) + "] " + texto;
      bitacora.push(linea);
      if (bitacora.length > 400) bitacora.shift();
      return linea;
    }

    function arranque() {
      uptime = 0; ciclo = 0; historialTurb = []; proximo = 3;
      log("ets Jun  8 2016 00:22:57 · rst:0x1 (POWERON_RESET)");
      log("Calidad del Agua · firmware " + firmware + " · " + dispositivo);
      log("Sensores: pH PH-4502C (GPIO34) · turbidez SEN0189 (GPIO35) · TDS Gravity (GPIO32) · DS18B20 (GPIO4)");
      log("WiFi: conectando…");
      wifi.reconectaEn = wifi.conectado ? 2.5 : 0;
    }

    function objetivo() {
      var m = MUESTRAS[muestraId];
      var ntu = m.ntu;
      if (m.sedimenta) ntu = m.ntu * (0.35 + 0.65 * Math.exp(-tDesdeCambio / 480));  // la tierra se asienta
      var ambiente = Math.sin(t / 1800) * 0.4;
      if (fallas.fueraDelAgua) return { ph: null, ntu: 0, ec25: 0, temp: 23.6 + ambiente };
      return { ph: m.ph, ntu: ntu, ec25: m.ec25, temp: m.temp + ambiente };
    }

    // Avanza la física dt segundos (respuesta de cada sonda con su constante de tiempo).
    function fisica(dt) {
      var o = objetivo();
      function acercar(actual, meta, tau) { return actual + (meta - actual) * (1 - Math.exp(-dt / tau)); }
      if (o.ph === null) {
        verdad.ph = limitar(verdad.ph + gauss(rng) * 0.08 * Math.sqrt(dt), 4.5, 9.5);   // sonda seca: deriva
      } else {
        verdad.ph = acercar(verdad.ph, o.ph, 6);
      }
      verdad.ntu = acercar(verdad.ntu, o.ntu, 3);
      verdad.ec25 = acercar(verdad.ec25, o.ec25, 2);
      verdad.temp = acercar(verdad.temp, o.temp, 25);
      tDesdeCambio += dt;
      t += dt; uptime += dt;
      wifi.rssi = limitar(wifi.rssi + gauss(rng) * 0.6 * Math.sqrt(dt) + (-59 - wifi.rssi) * 0.02 * dt, -85, -42);
      if (wifi.reconectaEn > 0) {
        wifi.reconectaEn -= dt;
        if (wifi.reconectaEn <= 0) log("WiFi: conectado · IP 192.168.1.73 · RSSI " + Math.round(wifi.rssi) + " dBm");
      }
    }

    // ---- Lectura de cada sensor (lo que hace el firmware) ----

    function ruidoAdc() { return fallas.sinCapacitor ? 9 : 4; }

    function leerTemp() {
      if (fallas.temperatura) return { real: verdad.temp, calculado: null, nota: "DEVICE_DISCONNECTED_C (-127)" };
      var medida = verdad.temp + defectos.tempSesgo + gauss(rng) * 0.03;
      return { real: verdad.temp, calculado: Math.round(medida / 0.0625) * 0.0625 };
    }

    function leerPH(tempFw) {
      var tK = verdad.temp + 273.15;
      var vSensor;
      if (fallas.ph) vSensor = 0;
      else {
        var mvSonda = defectos.phOffsetMv / 1000 - defectos.phEficiencia * NERNST_25 * (tK / 298.15) * (verdad.ph - 7);
        vSensor = PH.centro + PH.ganancia * (mvSonda + gauss(rng) * 0.0015);
      }
      var a = sobremuestrear(vSensor * PH.divisor, 64, rng, ruidoAdc());
      var v = a.mv / 1000 / PH.divisor;
      var calculado = null, nota = "";
      if (v < 0.5 || v > 4.6) nota = "fuera de rango eléctrico → null (¿módulo desconectado?)";
      else {
        var pendiente = cal.phPendiente25 * ((tempFw === null ? 25 : tempFw) + 273.15) / 298.15;
        calculado = limitar(7 + (cal.phV7 - v) / pendiente, 0, 14);
      }
      return { real: fallas.fueraDelAgua ? null : verdad.ph, vSensor: vSensor, vPin: vSensor * PH.divisor, mv: a.mv, cuentas: a.cuentas, v: v, calculado: calculado, nota: nota };
    }

    function leerTurbidez() {
      var vSensor = fallas.turbidez ? 0 : voltajeDesdeNtu(verdad.ntu) + defectos.turbOffsetV + gauss(rng) * 0.0004;
      var a = sobremuestrear(vSensor * TURB.divisor, 256, rng, ruidoAdc());
      var vMedido = a.mv / 1000 / TURB.divisor;
      var v = vMedido - cal.turbOffsetV;             // corrección de la calibración con agua limpia
      var instante = null, nota = "";
      if (v < 0.5) nota = "voltaje ~0 → null (¿sensor desconectado?)";
      else if (v < TURB_VERTICE) instante = TURB_MAX;
      else instante = Math.max(0, ntuDesdeVoltaje(v));
      var calculado = null;
      if (instante !== null) {
        historialTurb.push(instante);
        if (historialTurb.length > 5) historialTurb.shift();
        calculado = mediana(historialTurb);                 // mediana de los últimos 5 ciclos
      } else {
        historialTurb = [];
      }
      return { real: verdad.ntu, vSensor: vSensor, vPin: vSensor * TURB.divisor, mv: a.mv, cuentas: a.cuentas, v: vMedido, vCorregido: v, instante: instante, calculado: calculado, nota: nota };
    }

    function leerTDS(tempFw) {
      var ecT = verdad.ec25 * (1 + 0.02 * (verdad.temp - 25)) * defectos.tdsCelda;
      var vSensor = fallas.conductividad ? 0 : Math.min(TDS.vmax, voltajeDesdeEc(ecT) + gauss(rng) * 0.002);
      vSensor = Math.max(0, vSensor);
      var a = sobremuestrear(vSensor * TDS.divisor, 64, rng, ruidoAdc());
      var v = Math.max(0, a.mv / 1000 / TDS.divisor - 0.003);
      var coef = 1 + 0.02 * ((tempFw === null ? 25 : tempFw) - 25);
      var calculado = Math.max(0, cal.tdsK * ecDesdeVoltaje(v / coef));
      var nota = v >= TDS.vmax - 0.02 ? "módulo saturado (máx ≈ " + Math.round(ecDesdeVoltaje(TDS.vmax)) + " µS/cm)"
        : v < 0.15 && !fallas.conductividad ? "debajo de 150 mV el ADC del ESP32 subestima" : "";
      return { real: verdad.ec25, vSensor: vSensor, vPin: vSensor * TDS.divisor, mv: a.mv, cuentas: a.cuentas, v: v, calculado: calculado, nota: nota };
    }

    function medir(registrar) {
      ciclo++;
      var temp = leerTemp();
      var ph = leerPH(temp.calculado);
      var turb = leerTurbidez();
      var tds = leerTDS(temp.calculado);
      var crudo = { ph: ph, turbidez: turb, conductividad: tds, temperatura: temp };
      var lectura = {
        fecha: null,
        dispositivo: dispositivo,
        ph: ph.calculado === null ? null : redondear(ph.calculado, 2),
        turbidez: turb.calculado === null ? null : redondear(turb.calculado, 1),
        conductividad: redondear(tds.calculado, 1),
        temperatura: temp.calculado === null ? null : redondear(temp.calculado, 2),
        rssi: wifi.conectado ? Math.round(wifi.rssi) : null,
        ph_v: fallas.ph ? null : redondear(ph.v, 3),
        turbidez_v: fallas.turbidez ? null : redondear(turb.v, 3),
        conductividad_v: redondear(tds.v, 3)
      };
      if (registrar) {
        log("Ciclo #" + ciclo + " · muestreo secuencial (enciendo un sensor a la vez)");
        log("  pH   : " + ph.v.toFixed(3) + " V (ADC " + ph.cuentas + ", " + Math.round(ph.mv) + " mV) → " +
          (ph.calculado === null ? "null · " + ph.nota : "pH " + ph.calculado.toFixed(2)));
        log("  NTU  : " + turb.v.toFixed(3) + " V (ADC " + turb.cuentas + ", " + Math.round(turb.mv) + " mV) → " +
          (turb.calculado === null ? "null · " + turb.nota : turb.instante.toFixed(1) + " NTU · mediana 5: " + turb.calculado.toFixed(1)));
        log("  TDS  : " + tds.v.toFixed(3) + " V (ADC " + tds.cuentas + ") → " + tds.calculado.toFixed(0) + " µS/cm @25 °C" + (tds.nota ? " · " + tds.nota : ""));
        log("  Temp : " + (temp.calculado === null ? "null · " + temp.nota + " · compenso a 25 °C" : temp.calculado.toFixed(2) + " °C (DS18B20)"));
      }
      ultimo = { lectura: lectura, crudo: crudo };
      return ultimo;
    }

    // Avanza dt segundos. Devuelve las lecturas que tocó enviar en ese lapso.
    function avanzar(dt, opcionesAv) {
      var registrar = !(opcionesAv && opcionesAv.silencioso);
      var salida = [];
      var restante = dt;
      while (restante > 0) {
        var paso = Math.min(restante, 1, Math.max(0.001, proximo));
        fisica(paso);
        restante -= paso;
        proximo -= paso;
        if (proximo <= 1e-9) {
          proximo = intervalo;
          var r = medir(registrar);
          r.listoParaEnviar = wifi.conectado && wifi.reconectaEn <= 0;
          if (!r.listoParaEnviar && registrar) log("WiFi sin conexión: lectura descartada (el firmware no guarda sin red)");
          salida.push(r);
        }
      }
      return salida;
    }

    // Respuesta simulada de ThingSpeak cuando no hay llave real.
    function thingSpeakSimulado() { tsEntry++; return tsEntry; }

    function calibrarPH(silencioso) {
      var log = silencioso ? function () {} : logBitacora;
      log("Calibración de pH: buffers 4.00, 7.00 y 10.00 a " + verdad.temp.toFixed(1) + " °C");
      var guardado = verdad.ph, guardadoFalla = fallas.fueraDelAgua;
      fallas.fueraDelAgua = false;
      var puntos = [4, 7, 10].map(function (buffer) {
        verdad.ph = buffer;
        var vs = [];
        for (var i = 0; i < 5; i++) vs.push(leerPH(verdad.temp).v);
        var v = mediana(vs);
        log("  buffer " + buffer.toFixed(2) + " → " + v.toFixed(4) + " V");
        return { referencia: buffer, voltaje: v };
      });
      verdad.ph = guardado; fallas.fueraDelAgua = guardadoFalla;
      // Recta por mínimos cuadrados V = a + b·pH
      var n = puntos.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
      puntos.forEach(function (p) { sx += p.referencia; sy += p.voltaje; sxx += p.referencia * p.referencia; sxy += p.referencia * p.voltaje; });
      var b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      var a = (sy - b * sx) / n;
      var factorT = (verdad.temp + 273.15) / 298.15;
      cal.phV7 = a + b * 7;
      cal.phPendiente25 = -b / factorT;
      cal.fecha = new Date(); cal.fabrica = false;
      var mvPorPh = cal.phPendiente25 / PH.ganancia * 1000;
      var resultado = {
        puntos: puntos,
        pendiente: cal.phPendiente25,
        ordenada: cal.phV7,
        mvPorPh: mvPorPh,
        eficiencia: mvPorPh / (NERNST_25 * 1000) * 100,
        offsetMv: (cal.phV7 - PH.centro) / PH.ganancia * 1000
      };
      log("  pendiente " + mvPorPh.toFixed(1) + " mV/pH (" + resultado.eficiencia.toFixed(1) + " %) · offset " +
        resultado.offsetMv.toFixed(1) + " mV · guardado en Preferences");
      return resultado;
    }

    function calibrarTDS(silencioso) {
      var log = silencioso ? function () {} : logBitacora;
      log("Calibración de conductividad con solución de 1413 µS/cm a " + verdad.temp.toFixed(1) + " °C");
      var guardado = verdad.ec25;
      verdad.ec25 = 1413;
      var lecturas = [];
      for (var i = 0; i < 5; i++) lecturas.push(leerTDS(verdad.temp).calculado / cal.tdsK);
      verdad.ec25 = guardado;
      cal.tdsK = 1413 / mediana(lecturas);
      cal.fecha = new Date(); cal.fabrica = false;
      log("  K = " + cal.tdsK.toFixed(4) + " · guardado en Preferences");
      return { k: cal.tdsK };
    }

    // Turbidez: se mide agua purificada (≈ 0 NTU) y se corrige el voltaje de referencia.
    function calibrarTurbidez(silencioso) {
      var log = silencioso ? function () {} : logBitacora;
      log("Calibración de turbidez con agua purificada (referencia 0 NTU)");
      var guardado = verdad.ntu;
      verdad.ntu = 0;
      var vs = [];
      for (var i = 0; i < 5; i++) vs.push(leerTurbidez().v);
      verdad.ntu = guardado;
      historialTurb = [];
      cal.turbOffsetV = mediana(vs) - voltajeDesdeNtu(0);
      cal.fecha = new Date(); cal.fabrica = false;
      log("  agua limpia = " + mediana(vs).toFixed(4) + " V · corrección " + (cal.turbOffsetV * 1000).toFixed(1) + " mV · guardado en Preferences");
      return { offsetV: cal.turbOffsetV };
    }

    function valoresFabrica() {
      cal = calFabrica(); historialTurb = [];
      logBitacora("⚠ Calibración borrada: valores de fábrica");
    }

    arranque();
    if (opciones.calibrado !== false) {           // un equipo real se calibra al instalarlo
      calibrarTurbidez(true); calibrarPH(true); calibrarTDS(true);
    }

    return {
      dispositivo: dispositivo,
      firmware: firmware,
      intervalo: intervalo,
      avanzar: avanzar,
      log: log,
      bitacora: function () { return bitacora.slice(); },
      cambiarMuestra: function (id, silencioso) {
        if (!MUESTRAS[id] || id === muestraId) return;
        muestraId = id; tDesdeCambio = 0;
        if (!silencioso) log("Muestra nueva en el vaso: " + MUESTRAS[id].nombre);
      },
      muestra: function () { return muestraId; },
      falla: function (nombre, activa) {
        if (!(nombre in fallas)) return;
        fallas[nombre] = !!activa;
        var textos = {
          ph: "módulo de pH", turbidez: "sensor de turbidez", conductividad: "módulo TDS", temperatura: "DS18B20",
          fueraDelAgua: "sondas fuera del agua", sinCapacitor: "sin capacitor de filtrado (más ruido en el ADC)"
        };
        log((activa ? "⚠ " : "✓ ") + textos[nombre] + (nombre === "fueraDelAgua" || nombre === "sinCapacitor" ? (activa ? "" : ": normal") : (activa ? " desconectado" : " conectado")));
      },
      fallas: function () { return Object.assign({}, fallas); },
      wifi: function (encendido) {
        if (encendido === undefined) return { conectado: wifi.conectado && wifi.reconectaEn <= 0, rssi: Math.round(wifi.rssi) };
        if (encendido && !wifi.conectado) { wifi.conectado = true; wifi.reconectaEn = 3; log("WiFi: reconectando…"); }
        if (!encendido && wifi.conectado) { wifi.conectado = false; log("⚠ WiFi: conexión perdida"); }
      },
      reiniciar: function () { log("⚠ Reinicio (brownout / botón EN)"); arranque(); },
      calibrarPH: calibrarPH,
      calibrarTDS: calibrarTDS,
      calibrarTurbidez: calibrarTurbidez,
      valoresFabrica: valoresFabrica,
      calibracion: function () { return Object.assign({}, cal); },
      verdad: function () { return { ph: fallas.fueraDelAgua ? null : verdad.ph, turbidez: verdad.ntu, conductividad: verdad.ec25, temperatura: verdad.temp }; },
      ultimo: function () { return ultimo; },
      uptime: function () { return uptime; },
      proximoEnvio: function () { return proximo; },
      ciclo: function () { return ciclo; },
      thingSpeakSimulado: thingSpeakSimulado
    };
  }

  // Historial previo: una hora siguiendo el guion, para que la página no arranque vacía.
  function precargar(esp, minutos, guion, ahora) {
    guion = guion || GUION_PRECARGA;
    ahora = ahora || Date.now();
    var lecturas = [];
    var totalSeg = minutos * 60;
    var inicio = ahora - totalSeg * 1000;
    var t = 0;
    while (t < totalSeg) {
      var min = t / 60;
      for (var i = guion.length - 1; i >= 0; i--) {
        if (min >= guion[i].min) { esp.cambiarMuestraSilencioso(guion[i].muestra); break; }
      }
      var salida = esp.avanzar(1, { silencioso: true });
      t += 1;
      salida.forEach(function (r) {
        var l = Object.assign({}, r.lectura);
        l.fecha = new Date(inicio + t * 1000);
        lecturas.push(l);
      });
    }
    return lecturas;
  }

  // Cuerpo JSON para POST /api/lecturas
  function cuerpoAPI(lectura) {
    return {
      dispositivo: lectura.dispositivo, simulado: true, firmware: "sim-1.0.0",
      ph: lectura.ph, turbidez: lectura.turbidez, conductividad: lectura.conductividad, temperatura: lectura.temperatura,
      rssi: lectura.rssi, ph_v: lectura.ph_v, turbidez_v: lectura.turbidez_v, conductividad_v: lectura.conductividad_v
    };
  }

  var SimESP32 = {
    MUESTRAS: MUESTRAS,
    GUION_PRECARGA: GUION_PRECARGA,
    crear: function (opciones) {
      var esp = crear(opciones);
      // cambio de muestra sin escribir en la bitácora (para la precarga)
      esp.cambiarMuestraSilencioso = function (id) { esp.cambiarMuestra(id, true); };
      return esp;
    },
    precargar: precargar,
    cuerpoAPI: cuerpoAPI,
    // expuestos para pruebas
    _modelos: { ntuDesdeVoltaje: ntuDesdeVoltaje, voltajeDesdeNtu: voltajeDesdeNtu, ecDesdeVoltaje: ecDesdeVoltaje, voltajeDesdeEc: voltajeDesdeEc, adcLeerMilivolts: adcLeerMilivolts }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = SimESP32;
  else raiz.SimESP32 = SimESP32;
})(typeof window !== "undefined" ? window : this);
