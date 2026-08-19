"use strict";
const CACHE_PREFIX="egm-panel-";
self.addEventListener("install",event=>event.waitUntil(self.skipWaiting()));
self.addEventListener("activate",event=>event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(n=>(n.startsWith(CACHE_PREFIX)||n.startsWith("egm-v"))&&!n.startsWith("egp-musicos-")).map(n=>caches.delete(n)));
  await self.clients.claim();
})()));
self.addEventListener("message",event=>{if(event.data&&event.data.type==="SKIP_WAITING")self.skipWaiting();});
self.addEventListener("fetch",()=>{});
