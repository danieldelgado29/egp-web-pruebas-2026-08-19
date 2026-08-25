const $ = selector => document.querySelector(selector);
const installView = $("#installView");
const appView = $("#appView");
const installBtn = $("#installBtn");
const installHint = $("#installHint");
const iosHelp = $("#iosHelp");
const androidHelp = $("#androidHelp");
const venueName = $("#venueName");
const queueCount = $("#queueCount");
const queueList = $("#queueList");
const emptyState = $("#emptyState");
const connectionDot = $("#connectionDot");
const appError = $("#appError");

const monitorSetup = $("#monitorSetup");
const monitorModeStep = $("#monitorModeStep");
const monitorProfileStep = $("#monitorProfileStep");
const monitorProfileList = $("#monitorProfileList");
const monitorProfileTitle = $("#monitorProfileTitle");
const monitorBackBtn = $("#monitorBackBtn");
const monitorBtn = $("#monitorBtn");

let monitorMode = "";
let monitorProfile = "";
let monitorAux = "";
let monitorStateData = null;
let monitorConfigData = null;
let unsubscribeMonitorConfig = null;

try {
  const cachedMonitorConfig =
    JSON.parse(localStorage.getItem("egp-monitor-config-v1") || "null");

  if (
    cachedMonitorConfig &&
    typeof cachedMonitorConfig === "object"
  ) {
    monitorConfigData = cachedMonitorConfig;
  }
} catch (_) {}

/*
  Estos son los valores actuales.
  Si el Panel publica monitoreo_perfiles, esos valores
  reemplazan automáticamente esta lista.
*/
const DEFAULT_MONITOR_PROFILES = {
  stereo: [
    { id:"elena",   nombre:"Elena",   aux:"1-2" },
    { id:"bateria", nombre:"Batería", aux:"3-4" },
    { id:"bajo",    nombre:"Bajo",    aux:"5-6" },
    { id:"piano",   nombre:"Piano",   aux:"7-8" }
  ],

  mono: [
    { id:"mono-1", nombre:"Elena",   aux:"1" },
    { id:"mono-2", nombre:"Batería", aux:"2" },
    { id:"mono-3", nombre:"Bajo",    aux:"3" },
    { id:"mono-4", nombre:"Piano",   aux:"4" },
    { id:"mono-5", nombre:"AUX 5",   aux:"5" },
    { id:"mono-6", nombre:"AUX 6",   aux:"6" },
    { id:"mono-7", nombre:"AUX 7",   aux:"7" },
    { id:"mono-8", nombre:"AUX 8",   aux:"8" }
  ]
};

function monitorProfilesForMode(mode) {

  /*
   * Los AUX disponibles son FIJOS:
   *
   * STEREO: 1-2 / 3-4 / 5-6 / 7-8
   * MONO:   1 / 2 / 3 / 4 / 5 / 6 / 7 / 8
   *
   * El Panel puede cambiar los NOMBRES.
   * Nunca puede hacer desaparecer un AUX.
   */

  const base =
    (DEFAULT_MONITOR_PROFILES[mode] || [])
      .map(item => ({ ...item }));

  const remote =
    (
      monitorConfigData?.monitoreo_perfiles ||
      monitorStateData?.monitoreo_perfiles
    )?.[mode];

  if (!Array.isArray(remote) || !remote.length) {
    return base;
  }

  const remoteByAux = new Map();

  remote.forEach((item, index) => {

    const aux =
      String(item?.aux || "").trim();

    const nombre =
      String(
        item?.nombre ||
        item?.name ||
        ""
      ).trim();

    if (!aux || !nombre) return;

    remoteByAux.set(aux, {
      id:
        String(
          item?.id ||
          `perfil-${mode}-${index}`
        ),

      nombre,
      aux
    });
  });

  return base.map(item => {

    const editado =
      remoteByAux.get(
        String(item.aux)
      );

    if (!editado) {
      return item;
    }

    return {
      ...item,
      id: editado.id,
      nombre: editado.nombre
    };
  });
}

function renderMonitorProfiles() {
  if (!monitorProfileList || !monitorMode) return;

  const profiles = monitorProfilesForMode(monitorMode);

  monitorProfileList.innerHTML = profiles.map(item => `
    <button
      type="button"
      data-monitor-profile="${esc(item.id)}"
      data-monitor-name="${esc(item.nombre)}"
      data-monitor-aux="${esc(item.aux)}"
    >
      ${esc(item.nombre)}
    </button>
  `).join("");
}

document.querySelectorAll("[data-monitor-mode]").forEach(button => {
  button.addEventListener("click", () => {
    monitorMode = button.dataset.monitorMode;

    monitorModeStep.hidden = true;
    monitorProfileStep.hidden = false;

    monitorProfileTitle.textContent =
      monitorMode === "stereo"
        ? "Selecciona tu monitoreo · STEREO"
        : "Selecciona tu monitoreo · MONO";

    renderMonitorProfiles();
  });
});

monitorBackBtn?.addEventListener("click", () => {
  monitorMode = "";
  monitorProfileStep.hidden = true;
  monitorModeStep.hidden = false;
});

monitorProfileList?.addEventListener("click", event => {
  const button = event.target.closest("[data-monitor-profile]");
  if (!button) return;

  monitorProfile = button.dataset.monitorName || "";
  monitorAux = button.dataset.monitorAux || "";

  monitorSetup.hidden = true;

  if (monitorBtn) {
    monitorBtn.hidden = false;
    monitorBtn.title =
      `${monitorProfile} · ${monitorMode.toUpperCase()} · AUX ${monitorAux}`;
  }
});

monitorBtn?.addEventListener("click", () => {
  egpAbrirMonitoreo();
});

const installDialog = $("#installDialog");
const openChromeBtn = $("#openChromeBtn");

let deferredPrompt = null;
let songs = new Map();
let unsubscribe = null;
const LAST_STATE_KEY = "egp-musicos-last-state-v1";
const LOCAL_CORE = "https://core.elenagirjoaba.com";
let localCoreOnline = false;
let localCoreTimer = null;
let firebaseOnline = false;
let latestFirebaseState = null;

function saveLastState(data){ try{ localStorage.setItem(LAST_STATE_KEY,JSON.stringify(data||{})); }catch(_){} }
function loadLastState(){ try{ return JSON.parse(localStorage.getItem(LAST_STATE_KEY)||"null"); }catch(_){ return null; } }

function localCoreToMusicos(data){
  const queue = Array.isArray(data?.queue) ? data.queue : [];
  return {
    show_activo: data?.show?.active === true,
    lugar: String(data?.show?.venue || ""),
    cola: queue.map(item => String(item.id)),
    tocadas: queue.filter(item => item?.played === true).map(item => String(item.id))
  };
}

async function pollLocalCore(){
  try{
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);

    const res = await fetch(LOCAL_CORE + "/api/state", {
      cache: "no-store",
      signal: controller.signal
    });

    clearTimeout(timeout);
    if(!res.ok) throw new Error("Local Core HTTP " + res.status);

    const raw = await res.json();
    if(raw?.ok !== true) throw new Error("Local Core inválido");

    const data = localCoreToMusicos(raw);
    localCoreOnline = true;
    connectionDot.classList.add("online");
    appError.hidden = true;
    saveLastState(data);
    render(data);
  }catch(_){
    const wasLocal = localCoreOnline;
    localCoreOnline = false;

    if(firebaseOnline && latestFirebaseState){
      connectionDot.classList.add("online");
      if(wasLocal){
        saveLastState(latestFirebaseState);
        render(latestFirebaseState);
      }
    }else{
      connectionDot.classList.remove("online");
    }
  }
}

function startLocalCore(){
  if(localCoreTimer) return;
  pollLocalCore();
  localCoreTimer = setInterval(pollLocalCore, 1200);
}

const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const ownPwaLaunch = new URL(location.href).searchParams.get("musicos_pwa") === "1";
const testMode = new URL(location.href).searchParams.get("test") === "1";
const noCoreTest = new URL(location.href).searchParams.get("no_core") === "1";
const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isAndroid = /android/i.test(navigator.userAgent);
const previewMode = new URL(location.href).searchParams.get("preview") === "1";

function chromeIntentUrl() {
  const target = location.origin + location.pathname + "?install=1";
  return `intent://${target.replace(/^https?:\/\//, "")}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(target)};end`;
}
if (openChromeBtn && isAndroid) openChromeBtn.href = chromeIntentUrl();

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function showInstall() {
  installView.hidden = false;
  appView.hidden = true;
}

function showApp() {
  installView.hidden = true;
  appView.hidden = false;
  startApp();
}

function showError(message) {
  appView.hidden = false;
  appError.hidden = false;
  appError.textContent = message;
  connectionDot.classList.remove("online");
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredPrompt = event;
  installBtn.disabled = false;
  installBtn.textContent = "Instalar app";
  installHint.textContent = "";
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  installBtn.textContent = "App instalada";
  installHint.textContent = "Ábrela desde el icono EGP MUSICOS.";
});

installBtn.addEventListener("click", async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    return;
  }

  if (isiOS) {
    iosHelp.hidden = false;
    installHint.textContent = "Sigue los tres pasos mostrados abajo.";
    return;
  }

  if (previewMode || (standalone && (!isAndroid || ownPwaLaunch))) {
    showApp();
    return;
  }

  if (isAndroid) {
    androidHelp.hidden = false;
    installHint.textContent = "Para instalar EGP MUSICOS debe abrirse en Chrome.";
    // Si el QR abrió esta URL dentro de la PWA del Panel, salir de ese scope y abrir Chrome.
    if (standalone && !ownPwaLaunch) {
      openChromeBtn.hidden = false;
      installBtn.hidden = true;
      installHint.textContent = "Abre esta página en Chrome y allí instala EGP MUSICOS.";
    }
    return;
  }

  installHint.textContent = "Usa la opción Instalar aplicación del navegador.";
});

$("#closeDialog")?.addEventListener("click", () => installDialog.close());

async function startApp() {
  if (startApp.started) return;
  startApp.started = true;
  appError.hidden = true;

  let cfg = null;
  try {
    const [cfgRes, songsRes] = await Promise.all([
      fetch("../configuracion.json", { cache: "no-store" }),
      fetch("../canciones.json", { cache: "no-store" })
    ]);
    if (!cfgRes.ok || !songsRes.ok) throw new Error("base no disponible");
    cfg = await cfgRes.json();
    const list = await songsRes.json();
    songs = new Map((Array.isArray(list) ? list : []).map(song => [String(song.id), song]));
  } catch (error) {
    // El Service Worker debe resolver estos archivos desde caché. Si todavía no controla
    // esta apertura, mantenemos la última vista disponible en el dispositivo.
    console.warn("Base offline músicos:", error);
  }

  const cachedState = loadLastState();
  if (cachedState) {
    render(cachedState);
    venueName.textContent = String(cachedState?.lugar || cachedState?.show?.venue || venueName.textContent || "Último estado guardado");
  }

  // En EGP-MUSICOS, Local Core es la fuente preferida.
  // Fuera de esa red, Firebase continúa funcionando normalmente.
  if (!noCoreTest) startLocalCore();

  // Sin Internet la app NO falla: conserva la última cola guardada.
  // Firebase se carga dinámicamente únicamente cuando está disponible.
  try {
    if (!cfg?.firebase) throw new Error("Firebase no disponible");
    const [{ initializeApp }, { initializeFirestore, doc, onSnapshot }] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js")
    ]);
    const firebase = initializeApp(cfg.firebase, "egp-musicos");
    const db = initializeFirestore(firebase, {
      experimentalAutoDetectLongPolling: true,
      useFetchStreams: false
    });
    unsubscribe?.();
    unsubscribe = onSnapshot(doc(db, "config", "estado"), snapshot => {
      connectionDot.classList.add("online");
      appError.hidden = true;
      const data = snapshot.exists() ? snapshot.data() : {};
      firebaseOnline = true;
      latestFirebaseState = data;
      if (!localCoreOnline) {
        saveLastState(data);
        render(data);
      }
    }, error => {
      console.warn("Firebase músicos offline:", error);
      firebaseOnline = false;
      if(!localCoreOnline) connectionDot.classList.remove("online");
      if (!cachedState) {
        emptyState.hidden = false;
        emptyState.textContent = "Sin conexión · esperando último estado guardado";
      }
    });

    unsubscribeMonitorConfig?.();

    unsubscribeMonitorConfig = onSnapshot(
      doc(db, "imageEdits", "egp-system-monitoreo-v1"),

      snapshot => {
        monitorConfigData =
          snapshot.exists()
            ? snapshot.data()
            : null;

        try {
          if (monitorConfigData) {
            localStorage.setItem(
              "egp-monitor-config-v1",
              JSON.stringify(monitorConfigData)
            );
          }
        } catch (_) {}

        if (monitorMode && !monitorProfile) {
          renderMonitorProfiles();
        }
      },

      error => {
        console.warn(
          "Configuración de monitores offline:",
          error
        );
      }
    );

  } catch (error) {
    console.warn("EGP MÚSICOS en modo offline:", error);
    connectionDot.classList.remove("online");
    if (!cachedState) {
      emptyState.hidden = false;
      emptyState.textContent = "Sin conexión · abre una vez con datos para guardar el estado inicial";
    }
  }
}

function render(data) {
  monitorStateData = data;
  if (monitorMode && !monitorProfile) renderMonitorProfiles();
  const active = data.show_activo === true;
  const venue = String(data.lugar || "").trim();
  venueName.textContent = active ? (venue || "Show activo") : "No hay show activo";

  const ids = active && Array.isArray(data.cola) ? data.cola.map(String) : [];
  const playedIds = new Set(Array.isArray(data.tocadas) ? data.tocadas.map(String) : []);

  const queueItems = ids
    .map((id, originalIndex) => ({
      id,
      song: songs.get(id),
      originalIndex,
      played: playedIds.has(id)
    }))
    .filter(item => item.song);

  const pendingItems = queueItems.filter(item => !item.played);
  const playedItems = queueItems.filter(item => item.played);

  // El contador conserva la cola pendiente REAL.
  // Una tarjeta SONANDO añadida solo visualmente no aumenta este número.
  queueCount.textContent =
    `${pendingItems.length} ${pendingItems.length === 1 ? "canción" : "canciones"}`;

  const showInicio = String(data.inicio_show || "");
  const sonandoId = active ? String(data.sonando_id || "") : "";
  const sonandoShowInicio = String(data.sonando_show_inicio || "");

  // SONANDO solo pertenece al show actual.
  const sonandoValido =
    Boolean(sonandoId) &&
    Boolean(showInicio) &&
    sonandoShowInicio === showInicio &&
    songs.has(sonandoId);

  let sonandoItem = null;

  if (sonandoValido) {
    sonandoItem =
      queueItems.find(item => item.id === sonandoId) ||
      {
        id: sonandoId,
        song: songs.get(sonandoId),
        originalIndex: -1,
        played: playedIds.has(sonandoId)
      };
  }

  // SONANDO gana prioridad visual aunque también figure como Tocada.
  const pendientesVisuales =
    pendingItems.filter(item => item.id !== sonandoId);

  const tocadasVisuales =
    playedItems.filter(item => item.id !== sonandoId);

  const siguienteId = pendientesVisuales[0]?.id || "";

  const visualItems = [
    ...(sonandoItem ? [{ ...sonandoItem, playing: true }] : []),
    ...pendientesVisuales,
    ...tocadasVisuales
  ];

  queueList.innerHTML = visualItems.map(item => {
    const song = item.song;
    const isPlaying = item.playing === true;
    const isNext = !isPlaying && !item.played && item.id === siguienteId;

    const rawNumber =
      song.numero ||
      song.n ||
      (item.originalIndex >= 0 ? item.originalIndex + 1 : "");

    const number =
      rawNumber === "" ? "—" : String(rawNumber).padStart(2, "0");

    let label = "";

    if (isPlaying) {
      label = `
        <div class="song-label playing-label">
          <span>SONANDO</span>
          <span class="egp-eq" aria-hidden="true">
            <i></i><i></i><i></i><i></i>
          </span>
        </div>`;
    } else if (isNext) {
      label = '<div class="song-label">Sigue</div>';
    } else if (item.played) {
      label = '<div class="song-label played-label">Tocada</div>';
    }

    return `
      <article class="song-card
        ${isPlaying ? "playing" : ""}
        ${isNext ? "next" : ""}
        ${item.played && !isPlaying ? "played" : ""}">
        <div class="song-number">${esc(number)}</div>
        <div>
          ${label}
          <div class="song-title">${esc(song.titulo || "Sin título")}</div>
          <div class="song-artist">${esc(song.artista || "")}</div>
        </div>
      </article>`;
  }).join("");

  queueList.hidden = visualItems.length === 0;
  emptyState.hidden = visualItems.length > 0;
  emptyState.textContent = active ? "No hay canciones en cola" : "No hay show activo";
}

if (previewMode && "serviceWorker" in navigator) {
  (async()=>{
    try{
      const TEST_PATH="/egp-web-pruebas-2026-08-19/";
      const regs=await navigator.serviceWorker.getRegistrations();

      const testRegs=regs.filter(reg=>{
        try{
          return new URL(reg.scope).pathname.startsWith(TEST_PATH);
        }catch(_){
          return false;
        }
      });

      await Promise.all(testRegs.map(reg=>reg.unregister()));

      const controllerPath=(()=>{
        try{
          return navigator.serviceWorker.controller
            ? new URL(navigator.serviceWorker.controller.scriptURL).pathname
            : "";
        }catch(_){
          return "";
        }
      })();

      if(
        controllerPath.startsWith(TEST_PATH) &&
        sessionStorage.getItem("egp-musicos-preview-clean-v2")!=="1"
      ){
        sessionStorage.setItem("egp-musicos-preview-clean-v2","1");

        const url=new URL(location.href);
        url.searchParams.set("fresh",Date.now());
        location.replace(url.toString());
      }

    }catch(err){
      console.warn("Limpieza preview Músicos:",err);
    }
  })();
}

if ("serviceWorker" in navigator && !previewMode) {
  window.addEventListener("load", async () => {
    try {
      const EGP_TEST_REPO =
        location.hostname === "danieldelgado29.github.io" &&
        location.pathname.startsWith("/egp-web-pruebas-2026-08-19/musicos/");

      if (EGP_TEST_REPO) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(reg => reg.unregister()));

        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(
            keys
              .filter(key => key.startsWith("egp-musicos-"))
              .map(key => caches.delete(key))
          );
        }

        return;
      }

      const registration = await navigator.serviceWorker.register("./service-worker.js?v=1.5.8", {
        scope: "./",
        updateViaCache: "none"
      });
      await registration.update();
    } catch (error) {
      console.warn("Service Worker músicos:", error);
    }
  });
}

// Una PWA instalada siempre entra directamente a la cola.
// No depende de localStorage ni del evento appinstalled, que iOS no garantiza.
if (previewMode || testMode || (standalone && (!isAndroid || ownPwaLaunch))) {
  showApp();
} else {
  showInstall();
  if (isiOS) {
    installBtn.textContent = "Cómo instalar";
    installHint.textContent = "Sigue los tres pasos mostrados abajo.";
    iosHelp.hidden = false;
  } else {
    installBtn.disabled = false;
    if (isAndroid && standalone && !ownPwaLaunch) {
      installBtn.hidden = true;
      openChromeBtn.hidden = false;
      installHint.textContent = "Abre Chrome para instalar EGP MUSICOS como una app independiente.";
      androidHelp.hidden = false;
    } else {
      installHint.textContent = "";
    }
  }
}


/* EGP MUSICOS 1.5.8 · UI24R PERSISTENTE REAL */

const EGP_UI24R_ORIGIN =
  "https://ui.elenagirjoaba.com";


const egpUi24rOverlay =
  document.getElementById(
    "egpUi24rOverlay"
  );

const egpUi24rFrame =
  document.getElementById(
    "egpUi24rFrame"
  );

const egpUi24rBack =
  document.getElementById(
    "egpUi24rBack"
  );


let egpAuxListo = "";
let egpAuxToken = 0;


/*
 * IMPORTANTE:
 *
 * El iframe existe desde que index.html
 * comienza a cargar.
 *
 * NO se crea al pulsar MONITOREO.
 * NO se cambia el src.
 * NO se destruye al volver a COLA.
 */


function egpEnviarAux() {

  if (
    !monitorAux ||
    !egpUi24rFrame?.contentWindow
  ) return;


  egpUi24rFrame
    .contentWindow
    .postMessage(
      {
        type:
          "egp-ui24r-select-aux",

        aux:
          String(monitorAux),

        mode:
          monitorMode,

        profile:
          monitorProfile
      },

      EGP_UI24R_ORIGIN
    );
}


function egpPrepararAux() {

  if (!monitorAux) return;

  egpAuxToken++;

  const miToken =
    egpAuxToken;

  const aux =
    String(monitorAux);

  egpAuxListo = "";


  const enviar = () => {

    if (
      miToken !== egpAuxToken
    ) return;

    if (
      String(monitorAux) !== aux
    ) return;

    if (
      egpAuxListo === aux
    ) return;

    egpEnviarAux();
  };


  enviar();

  setTimeout(enviar,250);
  setTimeout(enviar,700);
  setTimeout(enviar,1400);
}


function egpMostrarMonitoreo() {

  egpUi24rOverlay
    ?.classList
    .add("is-open");

  egpUi24rOverlay
    ?.setAttribute(
      "aria-hidden",
      "false"
    );

  document.body
    .classList
    .add("egp-ui24r-open");
}


function egpAbrirMonitoreo() {

  if (!monitorAux) return;


  /*
   * Se abre EN LA MISMA APP.
   */
  egpMostrarMonitoreo();


  if (
    egpAuxListo ===
    String(monitorAux)
  ) {

    egpUi24rOverlay
      ?.classList
      .remove("is-waiting");

    return;
  }


  /*
   * Si el AUX todavía se prepara,
   * tapamos MAIN hasta confirmar AUX.
   */
  egpUi24rOverlay
    ?.classList
    .add("is-waiting");

  egpPrepararAux();
}


function egpCerrarMonitoreo() {

  egpUi24rOverlay
    ?.classList
    .remove(
      "is-open",
      "is-waiting"
    );

  egpUi24rOverlay
    ?.setAttribute(
      "aria-hidden",
      "true"
    );

  document.body
    .classList
    .remove("egp-ui24r-open");


  /*
   * NO:
   * - remove iframe
   * - reload
   * - src=
   *
   * La Ui24R sigue viva.
   */
}


egpUi24rBack
  ?.addEventListener(
    "click",
    event => {

      event.preventDefault();

      egpCerrarMonitoreo();
    }
  );


/*
 * Al elegir músico:
 * preparar SU AUX mientras
 * ya está viendo la cola.
 */
monitorProfileList
  ?.addEventListener(
    "click",
    () => {

      setTimeout(() => {

        if (!monitorAux) return;

        monitorBtn.hidden = false;
        monitorBtn.disabled = false;

        egpPrepararAux();

      },0);
    }
  );


egpUi24rFrame
  ?.addEventListener(
    "load",
    () => {

      if (monitorAux) {

        setTimeout(
          egpPrepararAux,
          200
        );
      }
    }
  );


window.addEventListener(
  "message",
  event => {

    if (
      event.origin !==
      EGP_UI24R_ORIGIN
    ) return;


    const data =
      event.data || {};


    if (
      data.type ===
      "egp-ui24r-launcher-ready"
    ) {

      if (monitorAux) {
        egpPrepararAux();
      }

      return;
    }


    if (
      data.type !==
      "egp-ui24r-aux-ready"
    ) return;


    if (
      String(data.aux || "") !==
      String(monitorAux || "")
    ) return;


    egpAuxListo =
      String(data.aux);


    egpUi24rOverlay
      ?.classList
      .remove("is-waiting");
  }
);


/*
 * LUGAR | PUNTO VERDE | MONITOREO
 */
(() => {

  if (
    !monitorBtn ||
    !connectionDot
  ) return;


  const row =
    monitorBtn.closest(
      ".venue-monitor-row"
    )
    ||
    monitorBtn.parentElement;


  if (!row) return;


  let actions =
    row.querySelector(
      ".venue-actions"
    );


  if (!actions) {

    actions =
      document.createElement(
        "div"
      );

    actions.className =
      "venue-actions";

    row.appendChild(actions);
  }


  actions.appendChild(
    connectionDot
  );

  actions.appendChild(
    monitorBtn
  );

})();


document.addEventListener(
  "keydown",
  event => {

    if (
      event.key === "Escape" &&
      egpUi24rOverlay
        ?.classList
        .contains("is-open")
    ) {

      egpCerrarMonitoreo();
    }
  }
);


/* EGP MUSICOS · TITULO SETUP GRANDE */
(() => {
  const textos = [...document.querySelectorAll("body *")]
    .filter(el =>
      el.children.length === 0 &&
      String(el.textContent || "")
        .trim()
        .toUpperCase() === "EGP MÚSICOS"
    );

  textos.forEach(titulo => {
    const contenedor = titulo.closest("div,section,main");

    if (!contenedor) return;

    const texto = String(contenedor.textContent || "").toUpperCase();

    if (
      texto.includes("STEREO") ||
      texto.includes("MONO") ||
      contenedor.querySelector("#monitorProfileList")
    ){
      titulo.classList.add("egp-setup-main-title");
    }
  });
})();

/* EGP MUSICOS · TITULO SETUP GRANDE */
(() => {
  const textos = [...document.querySelectorAll("body *")]
    .filter(el =>
      el.children.length === 0 &&
      String(el.textContent || "")
        .trim()
        .toUpperCase() === "EGP MÚSICOS"
    );

  textos.forEach(titulo => {
    const contenedor = titulo.closest("div,section,main");

    if (!contenedor) return;

    const texto = String(contenedor.textContent || "").toUpperCase();

    if (
      texto.includes("STEREO") ||
      texto.includes("MONO") ||
      contenedor.querySelector("#monitorProfileList")
    ){
      titulo.classList.add("egp-setup-main-title");
    }
  });
})();

/* EGP MUSICOS 1.5.8.2 · POSICION EXACTA MARCA SETUP */

(() => {

  const setup =
    document.getElementById("monitorSetup");

  const marca =
    setup?.querySelector(".mini-brand");

  const modeStep =
    document.getElementById("monitorModeStep");

  const profileStep =
    document.getElementById("monitorProfileStep");

  const back =
    document.getElementById("monitorBackBtn");


  if (!setup || !marca) return;


  function posicionar(){

    if (setup.hidden) return;

    let limite = null;


    /*
     * PÁGINA 1:
     * mitad exacta entre arriba
     * y "Selecciona el tipo de monitoreo".
     */
    if (!modeStep?.hidden) {

      limite =
        modeStep.querySelector("h2");

    }


    /*
     * PÁGINA 2:
     * mitad exacta entre arriba
     * y botón ATRÁS.
     */
    else if (!profileStep?.hidden) {

      limite = back;

    }


    if (!limite) return;


    const rect =
      limite.getBoundingClientRect();


    const centro =
      Math.max(45, rect.top / 2);


    marca.style.top =
      `${centro}px`;
  }


  document
    .querySelectorAll("[data-monitor-mode]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () => requestAnimationFrame(
          () => requestAnimationFrame(posicionar)
        )
      );

    });


  back?.addEventListener(
    "click",
    () => requestAnimationFrame(
      () => requestAnimationFrame(posicionar)
    )
  );


  window.addEventListener(
    "resize",
    posicionar
  );


  window.addEventListener(
    "orientationchange",
    () => setTimeout(posicionar,150)
  );


  new MutationObserver(posicionar)
    .observe(
      setup,
      {
        attributes:true,
        subtree:true,
        attributeFilter:["hidden"]
      }
    );


  requestAnimationFrame(
    () => requestAnimationFrame(posicionar)
  );

})();


/* EGP MUSICOS 1.5.8.3 · MONO 8 AUX + NOMBRES DESDE PANEL */

/* EGP MUSICOS 1.5.8.4 · GRID MONO 4x2 */

document.querySelectorAll("[data-monitor-mode]").forEach(button => {
  button.addEventListener("click", () => {
    setTimeout(() => {
      monitorProfileList?.classList.toggle(
        "egp-mono-8",
        monitorMode === "mono"
      );
    },0);
  });
});

monitorBackBtn?.addEventListener("click", () => {
  monitorProfileList?.classList.remove("egp-mono-8");
});


/* EGP MUSICOS 1.5.8.12 · MISMO METODO ISLA DEL PANEL */

(() => {

  const frame =
    document.getElementById(
      "egpUi24rFrame"
    );

  if (!frame) return;


  function safeArea(lado){

    const probe =
      document.createElement("div");

    probe.style.cssText = `
      position:fixed;
      visibility:hidden;
      pointer-events:none;
      padding-${lado}:
        env(safe-area-inset-${lado},0px);
    `;

    document.body.appendChild(probe);

    const css =
      getComputedStyle(probe);

    const value =
      parseFloat(
        lado === "left"
          ? css.paddingLeft
          : css.paddingRight
      ) || 0;

    probe.remove();

    return value;
  }


  function angulo(){

    let a = 0;

    if (
      screen.orientation &&
      typeof screen.orientation.angle
        === "number"
    ){
      a = screen.orientation.angle;
    }
    else if (
      typeof window.orientation
        === "number"
    ){
      a = window.orientation;
    }

    return (
      (a % 360) + 360
    ) % 360;
  }


  function ajustar(){

    const landscape =
      window.innerWidth >
      window.innerHeight;

    const iphone =
      /iPhone|iPod/i.test(
        navigator.userAgent
      );

    const android =
      /Android/i.test(
        navigator.userAgent
      );


    /*
     * VERTICAL:
     * sin compresión.
     */
    if (!landscape){

      frame.style.setProperty(
        "--egp-ui-sx",
        "1"
      );

      frame.style.setProperty(
        "--egp-ui-origin",
        "50% 50%"
      );

      return;
    }


    let margen = 0;
    let ladoIsla = "";


    /*
     * iPHONE:
     * EXACTAMENTE COMO PANEL.
     */
    if (iphone){

      margen = 46;

      const a =
        angulo();

      ladoIsla =
        a === 90
          ? "left"
          : "right";
    }


    /*
     * ANDROID:
     * solo aplicamos corrección
     * cuando Android reporta realmente
     * un cutout / safe-area.
     */
    else if (android){

      const L =
        safeArea("left");

      const R =
        safeArea("right");


      if (L > R + 2){

        margen =
          Math.min(L,60);

        ladoIsla =
          "left";
      }
      else if (R > L + 2){

        margen =
          Math.min(R,60);

        ladoIsla =
          "right";
      }
      else if (Math.max(L,R) > 2){

        margen =
          Math.min(
            Math.max(L,R),
            60
          );

        ladoIsla =
          angulo() === 90
            ? "left"
            : "right";
      }
    }


    /*
     * Sin isla/cutout:
     * Ui24R normal 100%.
     */
    if (!margen){

      frame.style.setProperty(
        "--egp-ui-sx",
        "1"
      );

      frame.style.setProperty(
        "--egp-ui-origin",
        "50% 50%"
      );

      return;
    }


    /*
     * MISMA MATEMATICA DEL PANEL:
     *
     * ancho visual =
     * ancho pantalla - margen isla
     */
    const sx =
      (
        window.innerWidth -
        margen
      )
      /
      window.innerWidth;


    frame.style.setProperty(
      "--egp-ui-sx",
      String(sx)
    );


    /*
     * Isla IZQUIERDA:
     * fijamos el borde DERECHO.
     *
     * Isla DERECHA:
     * fijamos el borde IZQUIERDO.
     *
     * Así solo queda libre el lado
     * de la isla.
     */
    frame.style.setProperty(
      "--egp-ui-origin",

      ladoIsla === "left"
        ? "100% 50%"
        : "0% 50%"
    );
  }


  window.addEventListener(
    "resize",
    ajustar
  );


  window.addEventListener(
    "orientationchange",
    () => {

      setTimeout(
        ajustar,
        200
      );
    }
  );


  ajustar();

})();






/* EGP MUSICOS · VOLVER A CONFIGURACION DESDE COLA */
(() => {
  const btn = document.getElementById("configBackBtn");
  const setup = document.getElementById("monitorSetup");
  const modeStep = document.getElementById("monitorModeStep");
  const profileStep = document.getElementById("monitorProfileStep");
  const profileList = document.getElementById("monitorProfileList");

  if (!btn || !setup) return;

  btn.addEventListener("click", () => {
    setup.hidden = false;

    if (modeStep) {
      modeStep.hidden = false;
    }

    if (profileStep) {
      profileStep.hidden = true;
    }

    if (profileList) {
      profileList.classList.remove("egp-mono-8");
    }
  });
})();


/* =========================================================
   EGP MUSICOS · TOUCH GRANDE V3
   Zonas tactiles amplias centradas sobre botones reales
   ========================================================= */

(() => {

  const monitor =
    document.getElementById("monitorBtn");

  const back =
    document.getElementById("egpUi24rBack");

  const overlay =
    document.getElementById("egpUi24rOverlay");

  if (!monitor || !back || !overlay) {
    return;
  }


  function crearZona(id, etiqueta) {

    let zona =
      document.getElementById(id);

    if (zona) {
      zona.remove();
    }

    zona =
      document.createElement("button");

    zona.id = id;
    zona.type = "button";
    zona.setAttribute(
      "aria-label",
      etiqueta
    );

    /*
     * No usamos ::before / ::after.
     * Esta es una superficie táctil REAL,
     * completamente transparente.
     */
    zona.style.cssText = `
      position:fixed;
      display:none;
      width:1px;
      height:1px;
      left:0;
      top:0;

      border:0;
      padding:0;
      margin:0;

      background:rgba(255,255,255,0.001);
      color:transparent;

      appearance:none;
      -webkit-appearance:none;

      touch-action:manipulation;
      -webkit-tap-highlight-color:transparent;

      user-select:none;
      -webkit-user-select:none;

      z-index:2147483647;
      cursor:pointer;
    `;

    document.body.appendChild(zona);

    /* DEBUG TEMPORAL — mostrar zona táctil real */
    if(id === "egpMonitorTouchZone"){
      zona.style.background = "rgba(0,120,255,.25)";
      zona.style.outline = "3px solid rgba(0,120,255,.95)";
    }

    if(id === "egpUi24rBackTouchZone"){
      zona.style.background = "rgba(255,0,0,.25)";
      zona.style.outline = "3px solid rgba(255,0,0,.95)";
    }

    return zona;
  }


  const zonaMonitor =
    crearZona(
      "egpMonitorTouchZone",
      "Abrir monitoreo"
    );

  const zonaBack =
    crearZona(
      "egpUi24rBackTouchZone",
      "Volver a la cola"
    );


  function horizontal() {
    return (
      window.innerWidth >
      window.innerHeight
    );
  }


  function visible(elemento) {

    if (!elemento) return false;

    if (elemento.hidden) return false;

    const css =
      getComputedStyle(elemento);

    if (
      css.display === "none" ||
      css.visibility === "hidden"
    ) {
      return false;
    }

    const r =
      elemento.getBoundingClientRect();

    return (
      r.width > 1 &&
      r.height > 1
    );
  }


  function colocarZona(
    zona,
    boton,
    ancho,
    alto,
    activa
  ) {

    if (!activa || !visible(boton)) {
      zona.style.display = "none";
      return;
    }

    const r =
      boton.getBoundingClientRect();

    const centroX =
      r.left + r.width / 2;

    const centroY =
      r.top + r.height / 2;


    /*
     * Centramos el área grande exactamente
     * sobre el botón visual.
     *
     * Si el botón está junto a un borde,
     * desplazamos solamente la zona invisible
     * hacia el interior de la pantalla.
     */

    let left =
      centroX - ancho / 2;

    let top =
      centroY - (alto + 24) / 2;

    if (zona.id === "egpUi24rBackTouchZone") {
      top -= 3;
    }


    left =
      Math.max(
        0,
        Math.min(
          window.innerWidth - ancho,
          left
        )
      );

    top =
      Math.max(
        0,
        Math.min(
          window.innerHeight - alto,
          top
        )
      );


    zona.style.left =
      Math.round(left) + "px";

    zona.style.top =
      Math.round(top) + "px";

    zona.style.width =
      ancho + "px";

    zona.style.height =
      alto + "px";

    zona.style.display =
      "block";
  }


  function actualizar() {

    const landscape =
      horizontal();

    const ui24rAbierta =
      overlay.classList.contains(
        "is-open"
      );


    /*
     * MONITOREO
     * 180 x 84 px
     *
     * Solo mientras estamos viendo la cola.
     */
    colocarZona(
      zonaMonitor,
      monitor,
      180,
      60,
      landscape &&
      !ui24rAbierta &&
      !monitor.disabled
    );


    /*
     * ← COLA
     * 160 x 84 px
     *
     * Solo cuando Ui24R está abierta.
     * Queda por encima del iframe.
     */
    colocarZona(
      zonaBack,
      back,
      160,
      54,
      landscape &&
      ui24rAbierta
    );
  }


  function pulsar(
    event,
    boton
  ) {

    if (!horizontal()) {
      return;
    }

    if (
      event.pointerType === "mouse" &&
      event.button !== 0
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    /*
     * Ejecutamos el CLICK ORIGINAL
     * del botón.
     *
     * No duplicamos la lógica de
     * abrir/cerrar Ui24R.
     */
    boton.click();

    requestAnimationFrame(
      actualizar
    );

    setTimeout(
      actualizar,
      80
    );
  }


  zonaMonitor.addEventListener(
    "pointerdown",
    event => {
      pulsar(
        event,
        monitor
      );
    },
    {passive:false}
  );


  zonaBack.addEventListener(
    "pointerdown",
    event => {
      pulsar(
        event,
        back
      );
    },
    {passive:false}
  );


  window.addEventListener(
    "resize",
    actualizar
  );


  window.addEventListener(
    "orientationchange",
    () => {

      setTimeout(
        actualizar,
        80
      );

      setTimeout(
        actualizar,
        250
      );

    }
  );


  /*
   * Cuando MONITOREO se muestra/oculta
   * o Ui24R abre/cierra, recalculamos.
   */

  const observer =
    new MutationObserver(
      actualizar
    );

  observer.observe(
    monitor,
    {
      attributes:true,
      attributeFilter:[
        "hidden",
        "disabled",
        "class",
        "style"
      ]
    }
  );

  observer.observe(
    back,
    {
      attributes:true,
      attributeFilter:[
        "hidden",
        "class",
        "style"
      ]
    }
  );

  observer.observe(
    overlay,
    {
      attributes:true,
      attributeFilter:[
        "class",
        "aria-hidden"
      ]
    }
  );


  document.addEventListener(
    "click",
    () => {
      requestAnimationFrame(
        actualizar
      );
    },
    true
  );


  requestAnimationFrame(
    () => {
      requestAnimationFrame(
        actualizar
      );
    }
  );

})();

/* FIN EGP MUSICOS · TOUCH GRANDE V3 */
