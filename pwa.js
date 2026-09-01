(() => {
  "use strict";

  /* EGP DEV LOCAL — PWA DESACTIVADA */
  if (location.hostname === "localhost" ||
      location.hostname === "127.0.0.1") {

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistration("./")
        .then(reg => reg && reg.unregister())
        .catch(err => console.warn("EGP DEV: no se pudo quitar SW", err));
    }

    return;
  }

  const APP_VERSION = "6.36.100";

  /* EGP REPO PRUEBAS SIN SERVICE WORKER */
  const EGP_TEST_REPO =
    location.hostname === "danieldelgado29.github.io" &&
    location.pathname.startsWith("/egp-web-pruebas-2026-08-19/");

  if (EGP_TEST_REPO) {
    Promise.all([
      ("serviceWorker" in navigator)
        ? navigator.serviceWorker.getRegistrations()
            .then(regs => Promise.all(regs.map(reg => reg.unregister())))
        : Promise.resolve(),

      ("caches" in window)
        ? caches.keys().then(keys =>
            Promise.all(
              keys
                .filter(k => k.startsWith("egm-") || k.startsWith("egm-panel-"))
                .map(k => caches.delete(k))
            )
          )
        : Promise.resolve()
    ]).catch(()=>{});

    return;
  }

  const VERSION_URL = "./version.json";
  const UPDATE_INTERVAL = 5 * 60 * 1000;
  let registrationRef = null;
  let reloading = false;

  function showConnectionStatus() {
    let banner = document.getElementById("pwaConnectionStatus");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "pwaConnectionStatus";
      banner.setAttribute("role", "status");
      banner.setAttribute("aria-live", "polite");
      Object.assign(banner.style,{position:"fixed",left:"50%",bottom:"14px",zIndex:"99999",transform:"translateX(-50%)",padding:"8px 13px",borderRadius:"999px",font:"600 12px/1.2 system-ui, sans-serif",color:"#fff",background:"rgba(15,16,19,.94)",border:"1px solid rgba(255,255,255,.18)",boxShadow:"0 8px 30px rgba(0,0,0,.35)",transition:"opacity .25s ease",pointerEvents:"none"});
      document.body.appendChild(banner);
    }
    banner.textContent = navigator.onLine ? "Conexión restablecida" : "Sin conexión · modo offline";
    banner.style.opacity="1";
    clearTimeout(showConnectionStatus.timer);
    if(navigator.onLine) showConnectionStatus.timer=setTimeout(()=>banner.style.opacity="0",2400);
  }
  function activate(worker){ if(worker) worker.postMessage({type:"SKIP_WAITING"}); }
  async function checkForUpdate(){
    if(!registrationRef || !navigator.onLine) return;
    try{
      await fetch(`${VERSION_URL}?t=${Date.now()}`,{cache:"no-store"});
      await registrationRef.update();
      if(registrationRef.waiting) activate(registrationRef.waiting);
    }catch(error){ console.warn("EGP actualización:",error); }
  }
  window.addEventListener("offline",showConnectionStatus);
  window.addEventListener("online",()=>{showConnectionStatus();checkForUpdate();});
  if(!navigator.onLine) window.addEventListener("DOMContentLoaded",showConnectionStatus,{once:true});
  if(!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{
    if(reloading) return;
    reloading=true;
    location.reload();
  });
  window.addEventListener("load",async()=>{
    try{
      const registration=await navigator.serviceWorker.register("./service-worker-6.36.100.js",{scope:"./",updateViaCache:"none"});
      registrationRef=registration;
      if(registration.waiting) activate(registration.waiting);
      registration.addEventListener("updatefound",()=>{
        const worker=registration.installing;
        if(worker) worker.addEventListener("statechange",()=>{
          if(worker.state==="installed" && navigator.serviceWorker.controller) activate(worker);
        });
      });
      await checkForUpdate();
      window.addEventListener("focus",checkForUpdate);
      document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")checkForUpdate();});
      setInterval(checkForUpdate,UPDATE_INTERVAL);
    }catch(error){ console.warn("No se pudo activar el modo offline",error); }
  });
})();
