"use strict";
const CACHE = "egp-musicos-v1.5.8.20-auto-update-v1";
const CORE = [
  "./", "./index.html", "./style.css?v=1.5.8.17", "./app.js?v=authority-v2-auto-update-v1-20260905",
  "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png",
  "../canciones.json", "../configuracion.json"
];
async function cacheOne(cache,url){
  try{ const r=await fetch(new Request(url,{cache:"reload"})); if(r && (r.ok||r.type==="opaque")) await cache.put(url,r); }catch(_){}
}
self.addEventListener("install",event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  await Promise.allSettled(CORE.map(url=>cacheOne(cache,url)));
  await self.skipWaiting();
})()));
/*
 * EGP_MUSICOS_AUTOUPDATE_ACTIVATE_V1
 *
 * Cuando una versión nueva entra:
 * 1) borra únicamente caches viejos de EGP Músicos
 * 2) toma control inmediatamente
 * 3) recarga automáticamente las ventanas abiertas de Músicos
 *
 * Así el usuario no limpia caché ni reinstala.
 */
self.addEventListener("activate",event=>event.waitUntil((async()=>{
  const keys=await caches.keys();

  await Promise.all(
    keys
      .filter(
        k=>
          k.startsWith("egp-musicos-") &&
          k!==CACHE
      )
      .map(k=>caches.delete(k))
  );

  await self.clients.claim();

  const windows=await self.clients.matchAll({
    type:"window",
    includeUncontrolled:true
  });

  await Promise.allSettled(
    windows.map(async client=>{
      try{
        const url=new URL(client.url);

        if(url.origin!==self.location.origin){
          return;
        }

        if(!url.pathname.includes("/musicos/")){
          return;
        }

        if(url.pathname.endsWith("/limpiar.html")){
          return;
        }

        await client.navigate(client.url);
      }catch(_){}
    })
  );
})()));
async function networkFirst(request,fallback){
  try{ const r=await fetch(new Request(request,{cache:"no-store"})); if(r&&r.ok){const c=await caches.open(CACHE);await c.put(request,r.clone());} return r; }
  catch(_){ return (await caches.match(request,{ignoreSearch:true})) || (fallback ? await caches.match(fallback,{ignoreSearch:true}) : null) || Response.error(); }
}
async function cacheFirst(request){
  const c=await caches.match(request,{ignoreSearch:true}); if(c)return c;
  try{const r=await fetch(request);if(r&&r.ok){const cache=await caches.open(CACHE);await cache.put(request,r.clone());}return r;}catch(_){return Response.error();}
}
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const u=new URL(event.request.url);
  if(event.request.mode==="navigate"){ event.respondWith(networkFirst(event.request,"./index.html")); return; }
  if(u.origin===self.location.origin){ event.respondWith(/\.(?:js|css|json|webmanifest)$/.test(u.pathname)?networkFirst(event.request):cacheFirst(event.request)); }
});
