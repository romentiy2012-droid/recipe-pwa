// Dedicated service worker for the React cookbook. Navigation is always refreshed online.
const CACHE="recipes-react-shell-v20261102";
const BASE="/recipe-pwa/react/";
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll([BASE+"manifest.webmanifest"]).catch(()=>{})));
  self.skipWaiting();
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("recipes-react-shell-")&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=="GET"||url.origin!==self.location.origin||!url.pathname.startsWith(BASE))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try {
      const response=await fetch(request,{cache:"no-store"});
      if(response.ok)await cache.put(request,response.clone());
      return response;
    } catch(error) {
      const cached=await cache.match(request,{ignoreSearch:true});
      if(cached)return cached;
      if(request.mode==="navigate"){
        const shell=await cache.match(BASE+"index.html");
        if(shell)return shell;
      }
      return Response.error();
    }
  })());
});
