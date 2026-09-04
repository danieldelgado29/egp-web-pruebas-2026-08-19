"use strict";
const VERSION = "egm-v6.36.103-reparacion-com-20260904-v1";
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const STATIC_ASSETS = [
  "./",
  "./assets/anotaciones/afuera.jpeg",
  "./assets/anotaciones/ahora-te-puedes-marchar.jpeg",
  "./assets/anotaciones/aint-no-sunshine.jpeg",
  "./assets/anotaciones/all-about-that-bass.jpeg",
  "./assets/anotaciones/american-woman.jpeg",
  "./assets/anotaciones/amor-prohibido.jpeg",
  "./assets/anotaciones/amy-amy-amy.jpeg",
  "./assets/anotaciones/another-one-bites-the-dust.jpeg",
  "./assets/anotaciones/asi-es-la-vida.jpeg",
  "./assets/anotaciones/at-last-2.jpeg",
  "./assets/anotaciones/at-last.jpeg",
  "./assets/anotaciones/bang-bang-my-baby-shot-me-down.jpeg",
  "./assets/anotaciones/baracunatana.jpeg",
  "./assets/anotaciones/chica-de-humo.jpeg",
  "./assets/anotaciones/clavado-en-un-bar.jpeg",
  "./assets/anotaciones/come-together.jpeg",
  "./assets/anotaciones/como-la-flor.jpeg",
  "./assets/anotaciones/como-te-voy-a-olvidar.jpeg",
  "./assets/anotaciones/corazon.jpeg",
  "./assets/anotaciones/dont-look-back-in-anger.jpeg",
  "./assets/anotaciones/dont-stop-me-now.jpeg",
  "./assets/anotaciones/el-embrujo.jpeg",
  "./assets/anotaciones/enter-sandman.jpeg",
  "./assets/anotaciones/es-mejor-asi.jpeg",
  "./assets/anotaciones/every-breath-you-take.jpeg",
  "./assets/anotaciones/feeling-good.jpeg",
  "./assets/anotaciones/felicidad.jpeg",
  "./assets/anotaciones/fever 2.jpeg",
  "./assets/anotaciones/fever.jpeg",
  "./assets/anotaciones/fuck me.jpeg",
  "./assets/anotaciones/fuck-me-pumps.jpeg",
  "./assets/anotaciones/godspeed.jpeg",
  "./assets/anotaciones/heart-of-glass.jpeg",
  "./assets/anotaciones/hey-little-rich-girl.jpeg",
  "./assets/anotaciones/hit-me-with-your-best-shot.jpeg",
  "./assets/anotaciones/hit-the-road-jack.jpeg",
  "./assets/anotaciones/i am not the only one.jpeg",
  "./assets/anotaciones/i love you more.jpeg",
  "./assets/anotaciones/i-don-t-want-to-miss.jpeg",
  "./assets/anotaciones/i-put-a-spell-on-you.jpeg",
  "./assets/anotaciones/i-will-survive.jpeg",
  "./assets/anotaciones/id-rather-go-blind.jpeg",
  "./assets/anotaciones/ill-take-care-of-you.jpeg",
  "./assets/anotaciones/index.json",
  "./assets/anotaciones/its-a-pitty.jpeg",
  "./assets/anotaciones/just-friends.jpeg",
  "./assets/anotaciones/killing-in-the-name.jpeg",
  "./assets/anotaciones/la-guitarra.jpeg",
  "./assets/anotaciones/la-muralla.jpeg",
  "./assets/anotaciones/lamento-boliviano.jpeg",
  "./assets/anotaciones/let-it-be.jpeg",
  "./assets/anotaciones/like-a-stone.jpeg",
  "./assets/anotaciones/love is a losing game.jpeg",
  "./assets/anotaciones/love-is-a-losing-game.jpeg",
  "./assets/anotaciones/luna-de-miel.jpeg",
  "./assets/anotaciones/me-mr-jones.jpeg",
  "./assets/anotaciones/mentirosa.jpeg",
  "./assets/anotaciones/mercy.jpeg",
  "./assets/anotaciones/mil-horas.jpeg",
  "./assets/anotaciones/natural-mystic.jpeg",
  "./assets/anotaciones/nunca-es-suficiente.jpeg",
  "./assets/anotaciones/ode too my family.jpeg",
  "./assets/anotaciones/our-day-will-come.jpeg",
  "./assets/anotaciones/oye-mi-amor.jpeg",
  "./assets/anotaciones/para-no-verte-mas.jpeg",
  "./assets/anotaciones/persiana-americana.jpeg",
  "./assets/anotaciones/personal-jesus.jpeg",
  "./assets/anotaciones/puto.jpeg",
  "./assets/anotaciones/que-bello.jpeg",
  "./assets/anotaciones/red-red-wine.jpeg",
  "./assets/anotaciones/sent me.jpeg",
  "./assets/anotaciones/sentimiento-original.jpeg",
  "./assets/anotaciones/si-antes-te-hubiera-conocido.jpeg",
  "./assets/anotaciones/si-una-vez-dije-que-te-amaba.jpeg",
  "./assets/anotaciones/sin-documentos.jpeg",
  "./assets/anotaciones/sinners-prayer.jpeg",
  "./assets/anotaciones/softly.jpeg",
  "./assets/anotaciones/some-unholy-war.jpeg",
  "./assets/anotaciones/somebodys-watching-me.jpeg",
  "./assets/anotaciones/stand-by-me.jpeg",
  "./assets/anotaciones/still-got-the-blues.jpeg",
  "./assets/anotaciones/stronger-than-me.jpeg",
  "./assets/anotaciones/summertime.jpeg",
  "./assets/anotaciones/sweet-dreams.jpeg",
  "./assets/anotaciones/take-the-box.jpeg",
  "./assets/anotaciones/te-vas.jpeg",
  "./assets/anotaciones/tears-dry-on-their-own.jpeg",
  "./assets/anotaciones/these-boots-are-made-for-walkin.jpeg",
  "./assets/anotaciones/thriller.jpeg",
  "./assets/anotaciones/to the church.jpeg",
  "./assets/anotaciones/toxic.jpeg",
  "./assets/anotaciones/tu-carcel.jpeg",
  "./assets/anotaciones/tu-sin-mi.jpeg",
  "./assets/anotaciones/valio-la-pena.jpeg",
  "./assets/anotaciones/wake-up-alone.jpeg",
  "./assets/anotaciones/we-will-rock-you.jpeg",
  "./assets/anotaciones/what a wonderful world.jpeg",
  "./assets/anotaciones/why-dont-you-do-right.jpeg",
  "./assets/anotaciones/will-you-still-love-me-tomorrow.jpeg",
  "./assets/anotaciones/wonderwall.jpeg",
  "./assets/anotaciones/work-song.jpeg",
  "./assets/anotaciones/yesterday.jpeg",
  "./assets/anotaciones/you-dont-love-me.jpeg",
  "./assets/anotaciones/you-oughta-know.jpeg",
  "./assets/anotaciones/you-sent-me-flying.jpeg",
  "./assets/app-icon-192.png",
  "./assets/app-icon-512.png",
  "./assets/apple-touch-icon-180.png",
  "./assets/favicon.png",
  "./assets/foto-banda-mobile.jpg",
  "./assets/foto-banda.jpg",
  "./assets/hero-mobile.jpg",
  "./assets/hero.jpg",
  "./canciones.json",
  "./configuracion.json",
  "./data/letras.json",
  "./favicon.png",
  "./foto-banda-mobile.jpg",
  "./foto-banda.jpg",
  "./hero-mobile.jpg",
  "./hero.jpg",
  "./index.html",
  "./manifest.json",
  "./musicos/app.js",
  "./musicos/apple-touch-icon.png",
  "./musicos/icon-192.png",
  "./musicos/icon-512.png",
  "./musicos/index.html",
  "./musicos/manifest.webmanifest",
  "./musicos/qr-musicos.png",
  "./musicos/service-worker.js",
  "./musicos/style.css",
  "./panel.css",
  "./panel.html",
  "./panel.js",
  "./pwa.js",
  "./script.js",
  "./style.css",
  "./version.json"
];
const EXTERNAL_MODULES = [
  "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js",
  "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js"
];
const scopedUrl = path => new URL(path, self.registration.scope).href;
async function cacheOne(cache,url){
  try{
    const request=new Request(url,{cache:"reload"});
    const response=await fetch(request);
    if(response && (response.ok || response.type==="opaque")) await cache.put(request,response);
  }catch(error){ console.warn("EGP offline: no se pudo precargar",url); }
}
self.addEventListener("install",event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(STATIC_CACHE);
    const urls=[...STATIC_ASSETS.map(scopedUrl),...EXTERNAL_MODULES];
    await Promise.allSettled(urls.map(url=>cacheOne(cache,url)));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>
      (name.startsWith("egm-") || name.startsWith("egm-panel-")) &&
      ![STATIC_CACHE,RUNTIME_CACHE].includes(name)
    ).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener("message",event=>{ if(event.data?.type==="SKIP_WAITING") self.skipWaiting(); });
async function networkFirst(request, fallbackUrl=null){
  const cache=await caches.open(RUNTIME_CACHE);
  try{
    const response=await fetch(new Request(request,{cache:"no-store"}));
    if(response && (response.ok || response.type==="opaque")) await cache.put(request,response.clone());
    return response;
  }catch(error){
    /*
     * Primero buscar EXACTAMENTE la URL solicitada.
     * Evita que panel.html?v=NUEVO reciba una copia
     * de panel.html?v=VIEJO por ignoreSearch.
     */
    const cachedExact=await caches.match(request);
    if(cachedExact) return cachedExact;

    const cached=await caches.match(request,{ignoreSearch:true});
    if(cached) return cached;

    if(fallbackUrl){
      return (
        await caches.match(fallbackUrl)
      ) || (
        await caches.match(fallbackUrl,{ignoreSearch:true})
      ) || Response.error();
    }
    return Response.error();
  }
}
async function cacheFirst(request){
  const cached=await caches.match(request,{ignoreSearch:true});
  if(cached) return cached;
  const cache=await caches.open(RUNTIME_CACHE);
  try{
    const response=await fetch(request);
    if(response && (response.ok || response.type==="opaque")) await cache.put(request,response.clone());
    return response;
  }catch(error){ return Response.error(); }
}
self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET") return;
  const url=new URL(request.url);

  /*
   * EGP_ANDROID_CORE_NOCACHE_V1
   *
   * Local Core y Pedidos LAN son APIs en tiempo real.
   * Nunca deben pasar por Cache Storage.
   *
   * Si /__egp_core/api/state se cachea, Android puede:
   * 1. guardar una canción correctamente en Core;
   * 2. mostrarla durante un instante;
   * 3. leer después un /api/state viejo desde cache;
   * 4. borrar visualmente la cola y el estado "A la cola".
   */
  if(
    url.origin===self.location.origin &&
    (
      url.pathname.includes("/__egp_core/") ||
      url.pathname.includes("/__egp_lan/") ||
      url.pathname.includes("/__egp_ui/")
    )
  ){
    event.respondWith(
      fetch(
        new Request(request,{
          cache:"no-store"
        })
      )
    );
    return;
  }

  if(request.mode==="navigate"){
    /*
     * PANEL:
     * El manifest antiguo podía abrir panel.html?v=6.36.100.
     * Desde ahora cualquier variante de panel.html se normaliza
     * al recurso canónico ./panel.html.
     *
     * Así una instalación vieja NO puede resucitar un HTML viejo
     * al quedarse sin Internet.
     */
    if(url.pathname.endsWith("/panel.html")){
      const canonicalRequest=
        new Request(
          scopedUrl("./panel.html"),
          {
            method:"GET",
            headers:request.headers,
            mode:"same-origin",
            credentials:"same-origin",
            cache:"no-store",
            redirect:"follow"
          }
        );

      event.respondWith(
        networkFirst(
          canonicalRequest,
          scopedUrl("./panel.html")
        )
      );
      return;
    }

    const fallback=
      url.pathname.includes("/musicos/")
        ? scopedUrl("./musicos/index.html")
        : scopedUrl("./index.html");

    event.respondWith(networkFirst(request,fallback));
    return;
  }
  if(url.origin===self.location.origin){
    const isCode=/\.(?:html|css|js|json|webmanifest)$/.test(url.pathname);
    event.respondWith(isCode?networkFirst(request):cacheFirst(request));
    return;
  }
  if(url.hostname==="www.gstatic.com" || url.hostname==="fonts.googleapis.com" || url.hostname==="fonts.gstatic.com"){
    event.respondWith(cacheFirst(request));
  }
});
