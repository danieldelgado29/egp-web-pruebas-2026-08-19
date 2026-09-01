"use strict";
const CACHE = "egp-musicos-touch-final-20260825-115209";
const CORE = [
  "./", "./index.html", "./style.css?v=1.5.8.17", "./app.js?v=touch-final-20260825-115209",
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
self.addEventListener("activate",event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith("egp-musicos-")&&k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
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
