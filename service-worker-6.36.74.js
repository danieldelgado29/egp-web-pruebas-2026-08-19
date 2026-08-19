"use strict";
const CLEAN_VERSION="egm-v6.36.74-legacy-cleanup";
self.addEventListener("install",event=>event.waitUntil(self.skipWaiting()));
self.addEventListener("activate",event=>event.waitUntil((async()=>{const names=await caches.keys();await Promise.all(names.filter(n=>n.startsWith("egm-")).map(n=>caches.delete(n)));await self.clients.claim();})()));
self.addEventListener("fetch",()=>{});
