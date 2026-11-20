/*
 * app.js
 * Interfaz: navegación entre pantallas, semáforo, historial, alertas y ajustes.
 * Depende de: Chart (vendor), APP_CONFIG, Semaforo, Datos.
 */
(function () {
  "use strict";

  var S = window.Semaforo;
  var CLAVE_LS = "calidadAgua.ajustes.v1";
  var RUTAS = ["inicio", "historial", "alertas", "ajustes"];
  var TITULOS = { inicio: "Estado del agua", historial: "Historial", alertas: "Alertas", ajustes: "Ajustes" };
  var reducirMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var COLORES = {
    primario: "#1D4F8F", rojo: "#B42318", muted: "#4B5D75", rejilla: "#E3E9F1",
    banda: "#E3ECF8", bandaLinea: "#7E9CC4", cruz: "#8EA2BC", nav: "#0C2340",
    verde: "#1E7A46", amarillo: "#F0B429", gris: "#5E6E84"
  };

  var TEXTOS = {
    verde:    { etq: "Agua en buen estado", desc: "Las 3 variables están dentro de rango." },
    amarillo: { etq: "Precaución", desc: "Una variable está fuera de rango. Revísala antes de reutilizar el agua." },
    rojo:     { etq: "No apta", desc: "Dos o más variables están fuera de rango. No reutilices esta agua." },
    gris:     { etq: "Sin datos", desc: "Esperando lecturas del ESP32." }
  };
  var ICONOS = { verde: "✓", amarillo: "!", rojo: "✕", gris: "?" };

  // ---------- Utilidades ----------

  function copiar(o) { return JSON.parse(JSON.stringify(o)); }
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  var formatos = {};
  function fmt(v, dec) {
    if (v === null || v === undefined || !isFinite(v)) return "–";
    if (!formatos[dec]) formatos[dec] = new Intl.NumberFormat("es-MX", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return formatos[dec].format(v);
  }
  function fmtVar(k, v) { return fmt(v, S.VARIABLES[k].decimales); }
  function conUnidad(k, v) { var u = S.VARIABLES[k].unidad; return fmtVar(k, v) + (u ? " " + u : ""); }

  var fHora = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  var fCorta = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" });
  var fFecha = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  var rtf = new Intl.RelativeTimeFormat("es-MX", { numeric: "auto" });
  function hace(fecha) {
    var s = Math.round((fecha.getTime() - Date.now()) / 1000);
    if (Math.abs(s) < 60) return rtf.format(s, "second");
    var m = Math.round(s / 60);
    if (Math.abs(m) < 60) return rtf.format(m, "minute");
    var h = Math.round(m / 60);
    if (Math.abs(h) < 24) return rtf.format(h, "hour");
    return rtf.format(Math.round(h / 24), "day");
  }

  // ---------- Configuración (defecto + localStorage) ----------

  function configDefecto() {
    var c = copiar(window.APP_CONFIG);
    c.umbrales = copiar(S.UMBRALES_DEFECTO);
    return c;
  }

  function cargarConfig() {
    var c = configDefecto();
    try {
      var guardada = JSON.parse(localStorage.getItem(CLAVE_LS) || "null");
      if (guardada) {
        c.fuente = guardada.fuente || c.fuente;
        c.thingspeak = Object.assign(c.thingspeak, guardada.thingspeak || {});
        c.intervaloSeg = guardada.intervaloSeg || c.intervaloSeg;
        c.criticoRojo = !!guardada.criticoRojo;
        if (guardada.umbrales) {
          S.CLAVES.forEach(function (k) { c.umbrales[k] = Object.assign(c.umbrales[k], guardada.umbrales[k] || {}); });
        }
      }
    } catch (e) { /* almacenamiento no disponible: se usan los valores por defecto */ }
    return c;
  }

  function guardarConfig(c) {
    try {
      localStorage.setItem(CLAVE_LS, JSON.stringify({
        fuente: c.fuente, thingspeak: c.thingspeak, intervaloSeg: c.intervaloSeg,
        criticoRojo: c.criticoRojo, umbrales: c.umbrales
      }));
      return true;
    } catch (e) { return false; }
  }

  // ---------- Estado ----------

  var estado = {
    config: cargarConfig(),
    lecturas: [],
    canal: "",
    error: null,
    cargando: false,
    ruta: "inicio",
    variable: "ph",
    rango: 100,
    filtro: "todas",
    grafica: null,
    temporizador: null
  };
  var demo = Datos.crearDemo(estado.config.intervaloSeg);

  function clasificar(l) {
    return S.clasificar(l, estado.config.umbrales, { criticoRojo: estado.config.criticoRojo });
  }
  function ultima() { return estado.lecturas[estado.lecturas.length - 1] || null; }

  function sentido(k, v) {
    var u = estado.config.umbrales[k];
    if (v === null) return "";
    if (u.max !== null && v > u.max) return k === "ph" ? "alcalino" : "alta";
    if (u.min !== null && v < u.min) return k === "ph" ? "ácido" : "baja";
    return "";
  }

  // ---------- Carga de datos ----------

  function actualizar() {
    if (estado.cargando) return;
    estado.cargando = true;
    var btn = $("#btn-actualizar");
    btn.setAttribute("aria-busy", "true");
    btn.disabled = true;

    var c = estado.config;
    var promesa = c.fuente === "thingspeak" ? Datos.leerThingSpeak(c)
      : c.fuente === "api" ? Datos.leerAPI(c)
      : demo.leer(c.resultados);

    promesa
      .then(function (r) {
        estado.lecturas = r.lecturas.filter(function (l) { return !isNaN(l.fecha.getTime()); });
        estado.canal = r.canal || "";
        estado.error = null;
      })
      .catch(function (e) {
        estado.error = !(e instanceof TypeError) ? e.message
          : c.fuente === "api" ? "No se pudo conectar con la API. ¿Está corriendo docker compose?"
          : "No se pudo conectar con ThingSpeak. Revisa tu internet y el Channel ID.";
      })
      .then(function () {
        estado.cargando = false;
        btn.removeAttribute("aria-busy");
        btn.disabled = false;
        render();
      });
  }

  function programar() {
    clearInterval(estado.temporizador);
    var seg = Math.max(15, estado.config.intervaloSeg || 20);
    estado.temporizador = setInterval(function () { if (!document.hidden) actualizar(); }, seg * 1000);
  }

  // ---------- Navegación ----------

  function leerRuta() {
    var partes = location.hash.replace(/^#/, "").split("/");
    var ruta = RUTAS.indexOf(partes[0]) >= 0 ? partes[0] : "inicio";
    if (ruta === "historial" && S.CLAVES.indexOf(partes[1]) >= 0) estado.variable = partes[1];
    return ruta;
  }

  function mostrarRuta(enfocar) {
    estado.ruta = leerRuta();
    $$("[data-pantalla]").forEach(function (s) { s.hidden = s.getAttribute("data-pantalla") !== estado.ruta; });
    $$(".nav__boton").forEach(function (a) {
      if (a.getAttribute("data-ruta") === estado.ruta) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    document.title = TITULOS[estado.ruta] + " · Calidad del Agua";
    if (estado.ruta === "ajustes") llenarFormulario(estado.config);
    render();
    if (enfocar) $("#contenido").focus({ preventScroll: false });
  }

  // ---------- Render general ----------

  function render() {
    renderNav();
    renderInicio();
    if (estado.ruta === "historial") renderHistorial();
    renderAlertas();
  }

  function renderNav() {
    var c = estado.config;
    $("#nav-fuente").textContent = c.fuente === "thingspeak"
      ? "Fuente: ThingSpeak · canal " + (c.thingspeak.channelId || "sin configurar")
      : c.fuente === "api" ? "Fuente: MariaDB (API local)"
      : "Fuente: demo (datos simulados)";
  }

  // ---------- 1. Inicio ----------

  function construirTarjetas() {
    var cont = $("#variables");
    S.CLAVES.forEach(function (k) {
      var v = S.VARIABLES[k];
      var b = document.createElement("a");
      b.className = "tarjeta variable";
      b.href = "#historial/" + k;
      b.setAttribute("data-var", k);
      b.innerHTML =
        '<span class="variable__cab"><span class="variable__nombre">' + v.nombre + '</span><span class="chip" data-chip></span></span>' +
        '<span class="variable__valor"><span data-valor>–</span>' + (v.unidad ? '<span class="variable__unidad">' + v.unidad + "</span>" : "") + "</span>" +
        '<span><span class="medidor" aria-hidden="true"><span class="medidor__banda" data-banda></span><span class="medidor__marca" data-marca></span></span>' +
        '<span class="medidor__escala"><span>' + v.escalaMin + '</span><span data-rango-txt></span><span>' + fmt(v.escalaMax, 0) + "</span></span></span>" +
        '<span class="variable__pie">Ver historial →</span>';
      cont.appendChild(b);
    });
  }

  function pct(k, valor) {
    var v = S.VARIABLES[k];
    var p = (valor - v.escalaMin) / (v.escalaMax - v.escalaMin) * 100;
    return Math.max(0, Math.min(100, p));
  }

  function textoRango(k) {
    var u = estado.config.umbrales[k];
    if (u.min === null || u.min === 0) return "aceptable ≤ " + conUnidad(k, u.max);
    return "aceptable " + fmtVar(k, u.min) + " a " + conUnidad(k, u.max);
  }

  function chipVariable(el, detalle, k, valor) {
    var txt = { ok: "✓ En rango", fuera: "! Fuera", critico: "✕ Crítico", "sin-dato": "– Sin dato" }[detalle];
    var s = sentido(k, valor);
    if ((detalle === "fuera" || detalle === "critico") && s) txt += " (" + s + ")";
    el.className = "chip chip--" + detalle;
    el.textContent = txt;
  }

  function renderInicio() {
    var c = estado.config;
    var l = ultima();
    var res = clasificar(l);
    var vencida = l ? S.estaVencida(l.fecha, new Date(), c.minutosSinDatos) && c.fuente !== "demo" : true;
    var est = vencida ? "gris" : res.estado;

    // Aviso de error
    var aviso = $("#aviso-error");
    aviso.hidden = !estado.error;
    aviso.textContent = estado.error || "";

    // Línea de última lectura
    $("#ultima-lectura").textContent = l
      ? "Última lectura " + hace(l.fecha) + " · " + fHora.format(l.fecha) + (estado.canal ? " · " + estado.canal : "")
      : (estado.cargando ? "Cargando lecturas…" : "Todavía no hay lecturas.");

    // Semáforo
    var caja = $("#semaforo");
    caja.setAttribute("data-estado", est);
    var t = TEXTOS[est];
    var desc = t.desc;
    if (est === "rojo" && res.fuera.length === 1) desc = "Una variable superó su límite crítico. No reutilices esta agua.";
    if (est === "gris" && l && vencida) desc = "La última lectura tiene más de " + c.minutosSinDatos + " min. Revisa que el ESP32 esté encendido y con WiFi.";
    else if (est === "gris" && l && res.faltantes.length) desc = "Faltan lecturas de: " + res.faltantes.map(function (k) { return S.VARIABLES[k].nombre; }).join(", ") + ".";
    $("#semaforo-etiqueta").textContent = t.etq;
    $("#semaforo-desc").textContent = desc;
    $("#conteo-num").textContent = l && !vencida ? res.enRango : "–";

    var chips = $("#semaforo-chips");
    chips.innerHTML = "";
    if (!vencida) {
      res.fuera.forEach(function (k) {
        var li = document.createElement("li");
        var critico = res.criticos.indexOf(k) >= 0;
        li.className = "chip " + (critico ? "chip--critico" : "chip--fuera");
        li.textContent = (critico ? "✕ " : "! ") + S.VARIABLES[k].nombre + " " + sentido(k, l[k]) + ": " + conUnidad(k, l[k]);
        chips.appendChild(li);
      });
    }

    // Tarjetas
    S.CLAVES.forEach(function (k) {
      var card = document.querySelector('[data-var="' + k + '"]');
      var valor = l ? l[k] : null;
      var u = c.umbrales[k];
      card.querySelector("[data-valor]").textContent = fmtVar(k, valor);
      chipVariable(card.querySelector("[data-chip]"), res.detalle[k], k, valor);
      var bMin = pct(k, u.min === null ? S.VARIABLES[k].escalaMin : u.min);
      var bMax = pct(k, u.max === null ? S.VARIABLES[k].escalaMax : u.max);
      var banda = card.querySelector("[data-banda]");
      banda.style.left = bMin + "%";
      banda.style.width = (bMax - bMin) + "%";
      var marca = card.querySelector("[data-marca]");
      marca.hidden = valor === null;
      if (valor !== null) marca.style.left = pct(k, valor) + "%";
      marca.classList.toggle("medidor__marca--fuera", res.detalle[k] === "fuera" || res.detalle[k] === "critico");
      card.querySelector("[data-rango-txt]").textContent = textoRango(k);
      card.setAttribute("aria-label", S.VARIABLES[k].nombre + ": " + conUnidad(k, valor) + ", " + textoRango(k) + ". Ver historial.");
    });

    // Temperatura (informativa, no entra al semáforo)
    var nt = $("#nota-temp");
    nt.hidden = !(l && l.temperatura !== null);
    if (l && l.temperatura !== null) {
      nt.textContent = "Temperatura del agua: " + fmt(l.temperatura, 1) + " °C. Se usa para compensar pH y conductividad; no entra al semáforo.";
    }

    // Control de demo
    var dc = $("#demo-control");
    dc.hidden = c.fuente !== "demo";
    $$("[data-escenario]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-escenario") === demo.escenario()));
    });
  }

  // ---------- 2. Historial ----------

  var pluginBanda = {
    id: "banda",
    beforeDatasetsDraw: function (chart, args, o) {
      var y = chart.scales.y, a = chart.chartArea, ctx = chart.ctx;
      var top = o.max === null ? a.top : Math.max(a.top, y.getPixelForValue(o.max));
      var bot = o.min === null ? a.bottom : Math.min(a.bottom, y.getPixelForValue(o.min));
      ctx.save();
      ctx.fillStyle = COLORES.banda;
      if (bot > top) ctx.fillRect(a.left, top, a.right - a.left, bot - top);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = COLORES.bandaLinea;
      ctx.lineWidth = 1;
      ctx.font = "500 12px 'IBM Plex Sans', system-ui, sans-serif";
      ctx.fillStyle = COLORES.muted;
      ctx.textAlign = "right";
      [["máx", o.max], ["mín", o.min]].forEach(function (par) {
        if (par[1] === null || par[1] === 0) return;
        var py = y.getPixelForValue(par[1]);
        if (py < a.top || py > a.bottom) return;
        ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke();
        ctx.fillText(par[0] + " " + fmtVar(o.clave, par[1]), a.right - 6, par[0] === "máx" ? py - 5 : py + 14);
      });
      ctx.restore();
    }
  };

  var pluginCruz = {
    id: "cruz",
    afterDatasetsDraw: function (chart) {
      var activos = chart.tooltip && chart.tooltip.getActiveElements();
      if (!activos || !activos.length) return;
      var x = activos[0].element.x, a = chart.chartArea, ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = COLORES.cruz; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke();
      ctx.restore();
    }
  };

  function fueraDeRango(k, v) {
    var e = S.evaluarVariable(v, estado.config.umbrales[k]);
    return e === "fuera" || e === "critico";
  }

  function crearGrafica() {
    Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
    Chart.defaults.color = COLORES.muted;
    estado.grafica = new Chart($("#hist-canvas"), {
      type: "line",
      data: { labels: [], datasets: [{ data: [], fechas: [] }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reducirMovimiento ? false : { duration: 300 },
        interaction: { mode: "index", intersect: false },
        layout: { padding: { top: 8 } },
        elements: {
          line: { borderWidth: 2, borderColor: COLORES.primario, tension: 0.25 },
          point: {
            radius: function (c) { return fueraDeRango(estado.variable, c.raw) ? 4 : 0; },
            hoverRadius: 6,
            backgroundColor: function (c) { return fueraDeRango(estado.variable, c.raw) ? COLORES.rojo : COLORES.primario; },
            borderColor: "#FFFFFF",
            borderWidth: 2,
            hitRadius: 12
          }
        },
        scales: {
          x: { grid: { display: false }, border: { color: "#CBD6E4" }, ticks: { maxTicksLimit: 6, maxRotation: 0 } },
          y: { grid: { color: COLORES.rejilla }, border: { display: false }, ticks: { maxTicksLimit: 6 } }
        },
        plugins: {
          legend: { display: false },
          banda: { min: null, max: null, clave: "ph" },
          tooltip: {
            backgroundColor: COLORES.nav,
            padding: 10,
            displayColors: false,
            titleFont: { weight: "600" },
            callbacks: {
              title: function (items) {
                var f = items[0].dataset.fechas[items[0].dataIndex];
                return f ? fFecha.format(f) : "";
              },
              label: function (item) {
                var k = estado.variable;
                return S.VARIABLES[k].nombre + ": " + conUnidad(k, item.raw) + (fueraDeRango(k, item.raw) ? "  ·  fuera de rango" : "");
              }
            }
          }
        }
      },
      plugins: [pluginBanda, pluginCruz]
    });
  }

  function renderHistorial() {
    var k = estado.variable;
    var v = S.VARIABLES[k];
    var u = estado.config.umbrales[k];
    var datos = estado.lecturas.slice(-estado.rango);
    var valores = datos.map(function (l) { return l[k]; });

    $$("[data-variable]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-variable") === k)); });
    $$("[data-rango]").forEach(function (b) { b.setAttribute("aria-pressed", String(+b.getAttribute("data-rango") === estado.rango)); });
    $("#hist-titulo").textContent = v.nombre + (v.unidad ? " (" + v.unidad + ")" : "") + " · " + textoRango(k);

    // Estadísticas
    var validos = valores.filter(function (x) { return x !== null; });
    var enRango = validos.filter(function (x) { return !fueraDeRango(k, x); }).length;
    var stats = [
      ["Actual", validos.length ? conUnidad(k, validos[validos.length - 1]) : "–"],
      ["Mínimo", validos.length ? conUnidad(k, Math.min.apply(null, validos)) : "–"],
      ["Máximo", validos.length ? conUnidad(k, Math.max.apply(null, validos)) : "–"],
      ["Promedio", validos.length ? conUnidad(k, validos.reduce(function (a, b) { return a + b; }, 0) / validos.length) : "–"],
      ["En rango", validos.length ? fmt(enRango / validos.length * 100, 0) + " %" : "–"]
    ];
    $("#hist-stats").innerHTML = stats.map(function (s) {
      return '<div class="estadistica"><p class="estadistica__etq">' + s[0] + '</p><p class="estadistica__val">' + s[1] + "</p></div>";
    }).join("");

    // Gráfica
    if (!estado.grafica) crearGrafica();
    var g = estado.grafica;
    g.data.labels = datos.map(function (l) { return fCorta.format(l.fecha); });
    g.data.datasets[0].data = valores;
    g.data.datasets[0].fechas = datos.map(function (l) { return l.fecha; });
    g.options.plugins.banda = { min: u.min, max: u.max, clave: k };
    g.options.scales.y.suggestedMin = u.min === null ? undefined : Math.max(0, u.min - (u.max - u.min) * 0.15);
    g.options.scales.y.suggestedMax = u.max === null ? undefined : u.max + (u.max - (u.min || 0)) * 0.15;
    g.options.scales.y.min = k === "ph" ? undefined : 0;
    $("#hist-canvas").setAttribute("aria-label", "Gráfica de " + v.nombre + " en las últimas " + datos.length + " lecturas. " + enRango + " de " + validos.length + " dentro de rango.");
    g.update();

    // Tabla (más reciente primero)
    $("#hist-tabla").innerHTML = datos.slice().reverse().map(function (l) {
      var r = clasificar(l);
      var celdas = S.CLAVES.map(function (c) {
        return '<td class="' + (fueraDeRango(c, l[c]) ? "fuera" : "") + '">' + fmtVar(c, l[c]) + "</td>";
      }).join("");
      return "<tr><td>" + fHora.format(l.fecha) + "</td>" + celdas +
             '<td><span class="chip chip--' + chipEstado(r.estado) + '">' + ICONOS[r.estado] + " " + nombreEstado(r.estado) + "</span></td></tr>";
    }).join("");
  }

  function chipEstado(e) { return { verde: "ok", amarillo: "fuera", rojo: "rojo", gris: "sin-dato" }[e]; }
  function nombreEstado(e) { return { verde: "Verde", amarillo: "Amarillo", rojo: "Rojo", gris: "Sin datos" }[e]; }

  // ---------- 3. Alertas ----------

  function calcularEventos() {
    var eventos = [], previo = null;
    estado.lecturas.forEach(function (l) {
      var r = clasificar(l);
      if (previo !== null && r.estado !== previo) {
        eventos.push({ lectura: l, de: previo, a: r.estado, res: r });
      }
      previo = r.estado;
    });
    return eventos.reverse();
  }

  function renderAlertas() {
    var eventos = calcularEventos();

    // Distribución de estados
    var conteo = { verde: 0, amarillo: 0, rojo: 0, gris: 0 };
    estado.lecturas.forEach(function (l) { conteo[clasificar(l).estado]++; });
    var total = estado.lecturas.length;
    $("#dist-n").textContent = total ? "· últimas " + total + " lecturas" : "";
    var barra = $("#dist-barra");
    var orden = ["verde", "amarillo", "rojo", "gris"];
    barra.innerHTML = orden.filter(function (e) { return conteo[e] > 0; }).map(function (e) {
      return '<span class="distribucion__seg bg-' + e + '" style="flex-grow:' + conteo[e] + '"></span>';
    }).join("");
    var resumen = orden.filter(function (e) { return conteo[e] > 0; }).map(function (e) {
      return nombreEstado(e) + " " + fmt(conteo[e] / total * 100, 0) + " %";
    });
    barra.setAttribute("aria-label", total ? "Distribución: " + resumen.join(", ") : "Sin lecturas");
    $("#dist-leyenda").innerHTML = orden.filter(function (e) { return conteo[e] > 0; }).map(function (e) {
      return '<li><span class="punto bg-' + e + '"></span>' + nombreEstado(e) + " <strong>" + fmt(conteo[e] / total * 100, 0) + " %</strong></li>";
    }).join("");

    // Insignia de navegación: cuántas veces pasó a amarillo o rojo
    var alertas = eventos.filter(function (e) { return e.a === "amarillo" || e.a === "rojo"; }).length;
    var badge = $("#badge-alertas");
    badge.hidden = alertas === 0;
    badge.textContent = alertas;

    // Lista
    $$("[data-filtro]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-filtro") === estado.filtro)); });
    var visibles = eventos.filter(function (e) { return estado.filtro === "todas" || e.a === estado.filtro; });
    var lista = $("#lista-alertas");
    if (!visibles.length) {
      lista.innerHTML = '<li class="vacio"><strong>Sin cambios que mostrar</strong>' +
        (total ? "El semáforo no cambió a este estado en las últimas " + total + " lecturas." : "Aún no hay lecturas.") + "</li>";
      return;
    }
    lista.innerHTML = visibles.map(function (e) {
      var titulo = e.a === "verde" ? "Se recuperó: agua en buen estado"
        : e.a === "gris" ? "Lectura incompleta"
        : "Cambió a " + TEXTOS[e.a].etq.toLowerCase();
      var detalle = e.res.fuera.length
        ? e.res.fuera.map(function (k) {
            var u = estado.config.umbrales[k];
            var lim = sentido(k, e.lectura[k]) === "baja" || sentido(k, e.lectura[k]) === "ácido" ? "mín " + fmtVar(k, u.min) : "máx " + fmtVar(k, u.max);
            return S.VARIABLES[k].nombre + " " + conUnidad(k, e.lectura[k]) + " (" + lim + ")";
          }).join(" · ")
        : "Venía de " + nombreEstado(e.de).toLowerCase() + ". Las 3 variables en rango.";
      return '<li class="evento"><span class="evento__icono bg-' + e.a + '" aria-hidden="true">' + ICONOS[e.a] + "</span>" +
        '<div><p class="evento__titulo">' + titulo + '</p><p class="evento__detalle">' + detalle + "</p></div>" +
        '<span class="evento__hora"><time datetime="' + e.lectura.fecha.toISOString() + '">' + fFecha.format(e.lectura.fecha) + "</time><br>" + hace(e.lectura.fecha) + "</span></li>";
    }).join("");
  }

  // ---------- 4. Ajustes ----------

  function construirTablaUmbrales() {
    var pasos = { ph: "0.1", turbidez: "0.5", conductividad: "10" };
    $("#tabla-umbrales").innerHTML = S.CLAVES.map(function (k) {
      var v = S.VARIABLES[k];
      var celda = function (campo) {
        return '<td><input type="number" step="' + pasos[k] + '" name="' + k + "-" + campo + '" aria-label="' + v.nombre + " " + campo + '"></td>';
      };
      return "<tr><td>" + v.nombre + (v.unidad ? " <span class='campo__ayuda'>(" + v.unidad + ")</span>" : "") + "</td>" +
        celda("min") + celda("max") + celda("critMin") + celda("critMax") + "</tr>";
    }).join("");
  }

  function llenarFormulario(c) {
    var f = $("#form-ajustes");
    f.fuente.value = c.fuente;
    f.channelId.value = c.thingspeak.channelId || "";
    f.readApiKey.value = c.thingspeak.readApiKey || "";
    f.intervaloSeg.value = c.intervaloSeg;
    f.criticoRojo.checked = !!c.criticoRojo;
    S.CLAVES.forEach(function (k) {
      ["min", "max", "critMin", "critMax"].forEach(function (campo) {
        var val = c.umbrales[k][campo];
        f[k + "-" + campo].value = val === null ? "" : val;
      });
    });
  }

  function leerFormulario() {
    var f = $("#form-ajustes");
    var c = copiar(estado.config);
    c.fuente = f.fuente.value || "demo";
    c.thingspeak.channelId = f.channelId.value.trim();
    c.thingspeak.readApiKey = f.readApiKey.value.trim();
    c.intervaloSeg = parseInt(f.intervaloSeg.value, 10) || 20;
    c.criticoRojo = f.criticoRojo.checked;
    S.CLAVES.forEach(function (k) {
      ["min", "max", "critMin", "critMax"].forEach(function (campo) {
        var t = f[k + "-" + campo].value.trim();
        c.umbrales[k][campo] = t === "" ? null : parseFloat(t);
      });
    });
    return c;
  }

  function validar(c) {
    if (c.fuente === "thingspeak" && !/^\d+$/.test(c.thingspeak.channelId)) return "El Channel ID debe ser un número.";
    if (c.intervaloSeg < 15) return "El intervalo mínimo es 15 s (límite de ThingSpeak gratis).";
    for (var i = 0; i < S.CLAVES.length; i++) {
      var k = S.CLAVES[i], u = c.umbrales[k];
      if (u.max === null) return "Falta el máximo de " + S.VARIABLES[k].nombre + ".";
      if (u.min !== null && u.min >= u.max) return "En " + S.VARIABLES[k].nombre + " el mínimo debe ser menor que el máximo.";
    }
    return null;
  }

  function mensajeAjustes(texto, tipo) {
    var p = $("#ajustes-estado");
    p.textContent = texto;
    p.className = "ajustes__estado " + (tipo || "");
  }

  // ---------- Eventos ----------

  function conectarEventos() {
    window.addEventListener("hashchange", function () { mostrarRuta(true); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) actualizar(); });

    $("#btn-actualizar").addEventListener("click", actualizar);

    $$("[data-escenario]").forEach(function (b) {
      b.addEventListener("click", function () {
        demo.cambiarEscenario(b.getAttribute("data-escenario"));
        actualizar();
      });
    });

    $$("[data-variable]").forEach(function (b) {
      b.addEventListener("click", function () {
        history.replaceState(null, "", "#historial/" + b.getAttribute("data-variable"));
        estado.variable = b.getAttribute("data-variable");
        renderHistorial();
      });
    });
    $$("[data-rango]").forEach(function (b) {
      b.addEventListener("click", function () { estado.rango = +b.getAttribute("data-rango"); renderHistorial(); });
    });
    $$("[data-filtro]").forEach(function (b) {
      b.addEventListener("click", function () { estado.filtro = b.getAttribute("data-filtro"); renderAlertas(); });
    });

    $("#form-ajustes").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var c = leerFormulario();
      var err = validar(c);
      if (err) { mensajeAjustes(err, "error"); return; }
      estado.config = c;
      var ok = guardarConfig(c);
      mensajeAjustes(ok ? "Ajustes guardados." : "Ajustes aplicados, pero este navegador no permite guardarlos.", "ok");
      programar();
      actualizar();
    });

    $("#btn-probar").addEventListener("click", function () {
      var c = leerFormulario();
      var falla = function (e) {
        mensajeAjustes(!(e instanceof TypeError) ? e.message
          : c.fuente === "api" ? "No se pudo conectar con la API. ¿Está corriendo docker compose?"
          : "No se pudo conectar. Revisa tu internet y el Channel ID.", "error");
      };
      mensajeAjustes("Probando conexión…");
      if (c.fuente === "api") {
        Datos.saludAPI(c).then(function (j) {
          mensajeAjustes("Conexión correcta con MariaDB: " + fmt(j.lecturas, 0) + " lecturas guardadas" +
            (j.ultima ? ", la última " + hace(new Date(j.ultima)) + "." : "."), "ok");
        }).catch(falla);
        return;
      }
      if (!/^\d+$/.test(c.thingspeak.channelId)) { mensajeAjustes("Escribe un Channel ID numérico para probar ThingSpeak.", "error"); return; }
      c.resultados = 1;
      Datos.leerThingSpeak(c).then(function (r) {
        var l = r.lecturas[r.lecturas.length - 1];
        mensajeAjustes("Conexión correcta: canal «" + (r.canal || c.thingspeak.channelId) + "»" +
          (l ? ", última lectura " + hace(l.fecha) + "." : ", pero todavía no tiene lecturas."), "ok");
      }).catch(falla);
    });

    $("#btn-restaurar").addEventListener("click", function () {
      var c = configDefecto();
      c.thingspeak = copiar(estado.config.thingspeak);
      llenarFormulario(c);
      mensajeAjustes("Valores por defecto cargados. Presiona Guardar para aplicarlos.");
    });
  }

  // ---------- Arranque ----------

  construirTarjetas();
  construirTablaUmbrales();
  conectarEventos();
  mostrarRuta(false);
  actualizar();
  programar();
  setInterval(function () { if (!document.hidden && estado.ruta === "inicio") renderInicio(); }, 5000);
})();
