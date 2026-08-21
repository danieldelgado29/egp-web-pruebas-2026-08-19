"use strict";
console.info("Elena Girjoaba Music · 6.36.93 · Cola activa solo pendientes");
document.documentElement.dataset.egmVersion="6.36.92";

// 6.36.30 — El panel no solicita ni utiliza datos del llavero.
// Evita que Safari/gestores de contraseñas clasifiquen los campos internos como formularios de credenciales.
(function disablePanelAutofill(){
  const harden=()=>{
    document.querySelectorAll("form").forEach(form=>form.setAttribute("autocomplete","off"));
    document.querySelectorAll('input:not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]), textarea, [contenteditable="true"]').forEach(el=>{
      el.setAttribute("autocomplete","off");
      el.setAttribute("data-form-type","other");
      el.setAttribute("data-lpignore","true");
      el.setAttribute("data-1p-ignore","true");
      el.setAttribute("data-bwignore","");
      if(el.tagName!=="TEXTAREA" && !el.hasAttribute("contenteditable")){
        el.setAttribute("autocorrect","off");
        el.setAttribute("spellcheck","false");
      }
    });
  };
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",harden,{once:true});
  else harden();
})();
(() => {
  'use strict';
  const $ = (s, p=document) => p.querySelector(s);
  const $$ = (s, p=document) => [...p.querySelectorAll(s)];
  const state = {
    songs: [], filtered: [], queue: [], played: new Set(), notes: {}, lyrics: {},
    config: null, pendingConfirm: null, customSongs: [], customRepertoires: [], newSongElenaNotes: null, newSongDanielNotes: null, songEdits: {}, editSongElenaNotes: null, editSongDanielNotes: null
  };
  const queueDragState={
    active:false,saving:false,pointerId:null,item:null,handle:null,ghost:null,timer:0,
    startX:0,startY:0,lastX:0,lastY:0,movedId:'',initialOrder:[],pendingRemoteQueue:null,
    suppressClickUntil:0
  };
  let remoteRunTransaction=null;
  const dialogBaselines = new WeakMap();
  const trackedDialogIds = new Set(['newSongDialog','repertoiresDialog','editSongDialog','songbookEditorDialog','photoManagerDialog','securityDialog','imageEditorDialog']);
  const labels = {alto:'Alto potencial', medio:'Potencial medio', bajo:'Bajo potencial'};
  const PANEL_PREFS_KEY='egm-panel-device-profile-v1';
  const isDesktopMac=/Macintosh|MacIntel/.test(navigator.platform||navigator.userAgent)&&Number(navigator.maxTouchPoints||0)===0;
  const defaultDanielAutoOpen=isDesktopMac?'image':'none';
  let panelDevicePrefs={profile:'elena',autoOpen:'none'};
  let suppressQueueAutoOpenUntil=Date.now()+2500;
  function loadPanelDevicePrefs(){
    try{
      const saved=JSON.parse(localStorage.getItem(PANEL_PREFS_KEY)||'{}');
      const profile=saved.profile==='daniel'?'daniel':'elena';
      const autoOpen=profile==='daniel'?(saved.autoOpen==='songbook'?'songbook':saved.autoOpen==='image'?'image':saved.autoOpen==='none'?'none':defaultDanielAutoOpen):(saved.autoOpen==='image'||saved.autoOpen==='lyrics'?saved.autoOpen:'none');
      panelDevicePrefs={profile,autoOpen};
    }catch(_){panelDevicePrefs={profile:'elena',autoOpen:'none'};}
  }
  function savePanelDevicePrefs(){localStorage.setItem(PANEL_PREFS_KEY,JSON.stringify(panelDevicePrefs));}
  function refreshPanelProfileControls(){
    const profile=$('#panelUserSelect');
    const auto=$('#panelAutoOpenSelect');
    if(!profile||!auto)return;
    profile.value=panelDevicePrefs.profile;
    auto.innerHTML=panelDevicePrefs.profile==='daniel'
      ? '<option value="image">Imagen, solo si existe contenido</option><option value="songbook">Cancionero Daniel</option><option value="none">No abrir nada</option>'
      : '<option value="none">No abrir nada</option><option value="image">Imagen</option><option value="lyrics">Letra</option>';
    if(![...auto.options].some(o=>o.value===panelDevicePrefs.autoOpen))panelDevicePrefs.autoOpen=panelDevicePrefs.profile==='daniel'?defaultDanielAutoOpen:'none';
    auto.value=panelDevicePrefs.autoOpen;
    const help=$('#panelAutoOpenHelp');
    if(help)help.textContent=panelDevicePrefs.profile==='daniel'?'Daniel: esta preferencia se guarda solo en este dispositivo. Imagen abre únicamente cuando existe contenido real.':'Elena: esta preferencia se guarda solo en este dispositivo.';
    document.body.dataset.panelUser=panelDevicePrefs.profile;
    const profileLabel=$('#panelProfileLabel');if(profileLabel)profileLabel.textContent=panelDevicePrefs.profile==='daniel'?'Daniel':'Elena';
  }
  function imageEditStructuralContent(value){
    if(!value||typeof value!=='object')return {source:'',hasDrawing:false,hasText:false};
    const source=String(value.originalSrc||value.original||value.dataUrl||value.src||'').trim();
    const hasDrawing=Array.isArray(value.operations)&&value.operations.some(op=>
      op&&op.tool==='pencil'&&Array.isArray(op.points)&&op.points.length>1
    );
    const hasText=Array.isArray(value.textBoxes)&&value.textBoxes.some(box=>
      String(box?.text||box?.html||'').replace(/<[^>]*>/g,'').trim().length>0
    );
    return {source,hasDrawing,hasText};
  }
  function imageEditHasVisibleContent(value){
    if(!value)return false;
    if(typeof value==='string')return value.trim().length>0;
    const {source,hasDrawing,hasText}=imageEditStructuralContent(value);
    if(hasDrawing||hasText)return true;
    // Un data URL puede ser un lienzo blanco residual de versiones anteriores.
    // Se valida de forma asíncrona antes de activar bordes o apertura automática.
    return Boolean(source&&!source.startsWith('data:image/'));
  }
  // 6.36.78 · A la la Long y Afuera conservaban residuos de imageEdits de
  // versiones anteriores. Se ignoran únicamente los residuos anteriores a esta
  // migración; cualquier edición nueva vuelve a considerarse contenido real.
  const LEGACY_EMPTY_DANIEL_IMAGE_IDS=new Set(['c001','c002']);
  const LEGACY_EMPTY_DANIEL_IMAGE_CUTOFF=1786124100000;
  function isKnownLegacyEmptyDanielImage(song,value){
    if(!song||!LEGACY_EMPTY_DANIEL_IMAGE_IDS.has(String(song.id)))return false;
    const updated=Number(value?.updatedAt||value?.savedAt||0);
    return !updated||updated<=LEGACY_EMPTY_DANIEL_IMAGE_CUTOFF;
  }
  async function imageSourceHasVisiblePixels(source){
    const src=String(source||'').trim();
    if(!src)return false;
    if(!src.startsWith('data:image/'))return true;
    return new Promise(resolve=>{
      const img=new Image();
      const finish=value=>resolve(Boolean(value));
      const timer=setTimeout(()=>finish(false),2200);
      img.onload=()=>{
        clearTimeout(timer);
        try{
          const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
          const ctx=canvas.getContext('2d',{willReadFrequently:true});
          ctx.fillStyle='#fff';ctx.fillRect(0,0,32,32);ctx.drawImage(img,0,0,32,32);
          const px=ctx.getImageData(0,0,32,32).data;
          let meaningful=0;
          for(let i=0;i<px.length;i+=4){
            const a=px[i+3],r=px[i],g=px[i+1],b=px[i+2];
            if(a>18&&(r<242||g<242||b<242||Math.max(r,g,b)-Math.min(r,g,b)>10)){meaningful++;if(meaningful>8)break;}
          }
          finish(meaningful>8);
        }catch(_){finish(true);}
      };
      img.onerror=()=>{clearTimeout(timer);finish(false);};
      img.src=src;
    });
  }
  async function imageEditHasRealVisibleContent(value){
    if(!value)return false;
    if(typeof value==='string')return value.trim().length>0;
    const {source,hasDrawing,hasText}=imageEditStructuralContent(value);
    if(hasDrawing||hasText)return true;
    return imageSourceHasVisiblePixels(source);
  }
  async function hasDanielImageContent(song){
    if(!song?.id)return false;
    // Primero revisar la copia actual en memoria. Después consultar la fuente
    // oficial compartida imageEdits/daniel-<songId>. Esto evita que Mac decida
    // usando el campo antiguo notasDaniel antes de que Firestore/IndexedDB cargue.
    const edit=await loadRemoteImageEdit(song.id,'daniel','image');
    if(isKnownLegacyEmptyDanielImage(song,edit))return false;
    if(await imageEditHasRealVisibleContent(edit)){
      song[visualField('daniel','image')]={
        original:edit.originalSrc||edit.original||'',
        canvasWidth:edit.canvasWidth||1000,
        canvasHeight:edit.canvasHeight||1300,
        operations:Array.isArray(edit.operations)?edit.operations:[],
        textBoxes:Array.isArray(edit.textBoxes)?edit.textBoxes:[],
        updatedAt:edit.updatedAt||Date.now(),
        remote:true
      };
      return true;
    }
    // No usar composite/overlay ni el campo legado para decidir la apertura:
    // la fuente oficial del editor actual es imageEdits/daniel-<songId>.
    return false;
  }
  const visualContentCache=new Map();
  const visualContentLoading=new Set();
  function visualCacheKey(songId,owner,mode){return `${owner}-${songId}-${mode}`;}
  function localVisualContent(song,owner,mode){
    if(!song)return false;
    const memory=song[visualField(owner,mode)];
    if(owner==='daniel'&&mode==='image'&&isKnownLegacyEmptyDanielImage(song,memory))return false;
    if(imageEditHasVisibleContent(memory))return true;
    if(mode==='songbook'){
      const text=owner==='daniel'
        ? (song.cancioneroDaniel||song.danielLyrics||song.letraDaniel)
        : (song.cancioneroElena||song.elenaLyrics||song.letraElena);
      return hasMeaningfulContent(text);
    }
    if(owner==='daniel')return false;
    const noteFile=state.notes?.[slug(song.titulo)];
    return Boolean((Array.isArray(noteFile)?noteFile.length:noteFile)||imageEditHasVisibleContent(song.notasElena));
  }
  function visualContentNow(song,owner,mode){
    const key=visualCacheKey(song.id,owner,mode);
    if(visualContentCache.has(key))return visualContentCache.get(key);
    return localVisualContent(song,owner,mode);
  }
  async function hydrateVisualContentButton(song,owner,mode,button){
    if(!song?.id||!button)return;
    const key=visualCacheKey(song.id,owner,mode);
    if(visualContentLoading.has(key))return;
    visualContentLoading.add(key);
    try{
      const remote=await loadRemoteImageEdit(song.id,owner,mode);
      const remoteHas=(owner==='daniel'&&mode==='image'&&isKnownLegacyEmptyDanielImage(song,remote))?false:await imageEditHasRealVisibleContent(remote);
      // Si existe un documento imageEdits actual, éste manda. No reactivar el borde
      // por restos antiguos guardados dentro del objeto canción.
      const has=remote!==null&&remote!==undefined ? remoteHas : localVisualContent(song,owner,mode);
      visualContentCache.set(key,has);
      if(button.isConnected){
        button.classList.toggle('has-content',has);
        const label=mode==='songbook'?(owner==='daniel'?'Cancionero Daniel':'Letra'):(owner==='daniel'?'Imagen de Daniel':'Imagen');
        button.title=has?`${label} con contenido`:`${label} sin contenido`;
      }
    }catch(err){
      const has=localVisualContent(song,owner,mode);
      visualContentCache.set(key,has);
      if(button.isConnected)button.classList.toggle('has-content',has);
    }finally{visualContentLoading.delete(key);}
  }

  async function maybeAutoOpenQueuedSong(song){
    if(!song||Date.now()<suppressQueueAutoOpenUntil||!document.body.classList.contains('live-mode'))return;
    const pref=panelDevicePrefs.autoOpen;
    if(pref==='none')return;
    if(panelDevicePrefs.profile==='elena'){
      if(pref==='image')openViewer(song,'notes');
      else if(pref==='lyrics')openViewer(song,'lyrics');
    }else{
      if(pref==='image'){
        if(await hasDanielImageContent(song))openViewer(song,'daniel-image');
      }else if(pref==='songbook')openViewer(song,'daniel');
    }
  }
  function processQueueAdditions(previous,next){
    if(!remoteReady||Date.now()<suppressQueueAutoOpenUntil)return;
    const before=new Set(previous||[]);
    const added=(next||[]).filter(id=>!before.has(id));
    if(!added.length)return;
    const song=state.songs.find(x=>x.id===added[added.length-1]);
    if(song)setTimeout(()=>maybeAutoOpenQueuedSong(song),120);
  }
  const fallbackRepertoires = [{id:'todas',name:'Todas las canciones'}];
  loadPanelDevicePrefs();
  let remoteStateRef = null;
  let remoteDb = null;
  let remoteGetDoc = null;
  let remoteDoc = null;
  let remoteSetDoc = null;
  let remoteReady = false;
  let pendingRemoteLibrary = null;
  let remoteShowWriteTimer = 0;
  let remoteLibraryWriteTimer = 0;
  let remoteShowWriteChain = Promise.resolve();
  let remoteLibraryWriteChain = Promise.resolve();
  let localShowTransitionUntil = 0;
  let localDesiredShowActive = null;
  let remoteInitPromise = null;
  let activeViewerSongId=null, activeViewerType=null, activeImageOwner='elena', activeImageSongId=null, activeImageMode='image', returnToImageViewer=false, viewerRenderGeneration=0, pendingViewerRefresh=null;
  let applyingRemoteShowState=false;
  let latestRemoteState=null;
  let egpPedidosPendientes=[];
  let egpPedidosFirebase=[];
  let egpPedidosLan=[];
  let remoteShowGeneration=0;
  let lastAppliedRemoteRevision=0;
  const DEVICE_ID=sessionStorage.getItem('egm-device-id')||(`dev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  sessionStorage.setItem('egm-device-id',DEVICE_ID);

  const EGP_AUDIT_LOCAL=new URL(location.href).searchParams.get('audit_local')==='1';
  const LOCAL_CORE_URL=EGP_AUDIT_LOCAL?'http://10.10.10.2:8796':'https://core.elenagirjoaba.com';
  const CORE_TEST_MODE=new URL(location.href).searchParams.get('core_test')==='1';
  let LOCAL_QUEUE_MODE=false;
  let localQueueTimer=0;
  let localQueueBusy=false;
  let localQueueMutationChain=Promise.resolve();
  let localQueueMutationPending=0;


  // 6.36.35 — Persistencia offline-first para imágenes y anotaciones.
  const OFFLINE_DB_NAME='egm-editor-offline-v1';
  const OFFLINE_DB_VERSION=1;
  let offlineDbPromise=null;
  function openOfflineDb(){
    if(offlineDbPromise)return offlineDbPromise;
    offlineDbPromise=new Promise((resolve,reject)=>{
      if(!('indexedDB' in window)){reject(new Error('IndexedDB no disponible'));return;}
      const req=indexedDB.open(OFFLINE_DB_NAME,OFFLINE_DB_VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains('imageEdits'))db.createObjectStore('imageEdits',{keyPath:'editId'});
        if(!db.objectStoreNames.contains('pendingSync'))db.createObjectStore('pendingSync',{keyPath:'editId'});
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('No se pudo abrir IndexedDB'));
    });
    return offlineDbPromise;
  }
  async function offlineStoreGet(store,key){
    try{const db=await openOfflineDb();return await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly');const req=tx.objectStore(store).get(key);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);});}catch(_){return null;}
  }
  async function offlineStorePut(store,value){
    try{const db=await openOfflineDb();await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});return true;}catch(err){console.warn('No se pudo guardar offline',err);return false;}
  }
  async function offlineStoreDelete(store,key){
    try{const db=await openOfflineDb();await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}catch(_){}
  }
  async function offlineStoreAll(store){
    try{const db=await openOfflineDb();return await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readonly');const req=tx.objectStore(store).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);});}catch(_){return [];}
  }
  async function cacheEditorImage(src){
    if(!src||src.startsWith('data:')||!('caches' in window))return;
    try{const cache=await caches.open('egm-editor-images-v1');const req=new Request(src,{mode:'cors',credentials:'same-origin'});if(!(await cache.match(req))){const res=await fetch(req);if(res.ok||res.type==='opaque')await cache.put(req,res.clone());}}catch(err){console.warn('No se pudo guardar la foto para uso offline',err);}
  }
  async function flushPendingImageEdits(){
    if(!navigator.onLine)return;
    const pending=await offlineStoreAll('pendingSync');
    for(const edit of pending){
      try{
        await initRemoteSync();
        const ref=remoteImageRef(edit.songId,edit.owner);
        if(!ref||!remoteSetDoc)continue;
        await remoteSetDoc(ref,{...edit,pendingSync:false,syncedAt:Date.now()},{merge:false});
        const synced={...edit,pendingSync:false,syncedAt:Date.now()};
        await offlineStorePut('imageEdits',synced);
        await offlineStoreDelete('pendingSync',edit.editId);
      }catch(err){console.warn('Edición pendiente de sincronización',edit.editId,err);}
    }
  }
  window.addEventListener('online',()=>{flushPendingImageEdits();});
  setTimeout(()=>flushPendingImageEdits(),1500);

  async function initRemoteSync(){
    if(EGP_AUDIT_LOCAL){ remoteReady=true; return null; }
    if(remoteStateRef) return remoteStateRef;
    if(remoteInitPromise) return remoteInitPromise;
    remoteInitPromise=(async()=>{
    if(!navigator.onLine) throw new Error('Sin conexión a internet');
    try{
      const [{ initializeApp }, { doc, collection, query, where, getDocs, initializeFirestore, onSnapshot, setDoc: firebaseSetDoc, getDoc, updateDoc, runTransaction }] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js')
      ]);
      const response=await fetch('configuracion.json');
      const cfg=await response.json();
      if(!cfg?.firebase?.apiKey||!cfg?.firebase?.projectId) return;
      const app=initializeApp(cfg.firebase,'panel-v3');
      const panelDb=initializeFirestore(app,{experimentalAutoDetectLongPolling:true,useFetchStreams:false});
      remoteDb=panelDb;
      remoteStateRef=doc(panelDb,'config','estado');
      window.__egmSetDoc=firebaseSetDoc;
      remoteGetDoc=getDoc;
      remoteDoc=doc;
      remoteSetDoc=firebaseSetDoc;
      window.__egmUpdateDoc=updateDoc;
      window.__egmPedidosFns={collection,query,where,onSnapshot,getDocs};
      remoteRunTransaction=runTransaction;
      onSnapshot(remoteStateRef,snap=>{
        if(!snap.exists()) return;
        const data=snap.data()||{};
        const queueBeforeSnapshot=[...state.queue];
        const incomingQueue=LOCAL_QUEUE_MODE?[...state.queue]:(Array.isArray(data.cola)?data.cola.map(String):[]);
        const incomingPlayedOrder=LOCAL_QUEUE_MODE?[...state.played]:(Array.isArray(data.tocadas)?[...new Set(data.tocadas.map(String))]:[]);
        const oldPlayedOrder=[...state.played].map(String);
        const playedChanged=incomingPlayedOrder.join('|')!==oldPlayedOrder.join('|');

        let queueSnapshotApplied=false;
        if(queueDragState.active&&playedChanged){
          abortQueueDragForRemoteSemanticChange(incomingQueue,incomingPlayedOrder);
          queueSnapshotApplied=true;
        }else{
          state.played=new Set(incomingPlayedOrder);
          queueSnapshotApplied=applyRemoteQueueSnapshot(incomingQueue);
          if(queueSnapshotApplied)state.queue=canonicalQueueOrder(incomingQueue,incomingPlayedOrder);
        }

        latestRemoteState=data;

        egpSyncPedidosFromRemote(data);

        const egpRemoteDesdeCache=snap?.metadata?.fromCache===true;
        applyRemotePanelState(data,{skipQueue:true,skipPlayed:true,preserveLocalRequests:egpRemoteDesdeCache});

        if(!LOCAL_QUEUE_MODE&&!queueDragState.active&&!queueDragState.saving){
          normalizeRemoteQueueIfNeeded(incomingQueue,incomingPlayedOrder);
        }

        if(data.biblioteca&&typeof data.biblioteca==='object'){
          const b=data.biblioteca;
          pendingRemoteLibrary=b;
          if(b.songEdits&&typeof b.songEdits==='object') state.songEdits={...state.songEdits,...b.songEdits};
          if(Array.isArray(b.customSongs)) state.customSongs=b.customSongs;
          if(state.songs.length){
            state.songs=state.songs.map(song=>state.songEdits[song.id]?{...song,...state.songEdits[song.id]}:song);
            renderSongs();
            renderSongbookList();
            saveStateLocalOnly();
          }
        }
        // Las ediciones de imagen ya no se leen desde config/estado.
        // La única fuente oficial es imageEdits/{owner-songId}.
        if(state.config){
          state.config.whatsapp=data.pedidos_whatsapp!==false;
          if(!egpRemoteDesdeCache) state.config.requests=data.pedidos_panel===true;
          state.config.requestsMode=data.pedidos_modo==='uno_por_turno'?'uno_por_turno':'libre';
          state.config.publicQueue=data.mostrar_cola!==false;
          $('#whatsappToggle').checked=state.config.whatsapp;
          $('#publicQueueToggle').checked=state.config.publicQueue;
          const requestsToggle=document.getElementById('requestsToggle');
          if(requestsToggle) requestsToggle.checked=state.config.requests===true;
          const requestsMode=document.getElementById('requestsModeSelect');
          if(requestsMode) requestsMode.value=state.config.requestsMode==='uno_por_turno'?'uno_por_turno':'libre';
        $('#advertisingToggle').checked=state.config.advertising===true;
        }
        const wasRemoteReady=remoteReady;
        remoteReady=true;
        renderQueue();
        if(document.body.classList.contains('live-mode')) renderSongs();
        if(wasRemoteReady&&queueSnapshotApplied)processQueueAdditions(queueBeforeSnapshot,state.queue);
      },err=>console.warn('Sincronización remota no disponible',err));
    }catch(err){ console.warn('No se pudo iniciar la sincronización remota',err); throw err; }
    return remoteStateRef;
    })();
    try{return await remoteInitPromise;}finally{if(!remoteStateRef)remoteInitPromise=null;}
  }

  function buildRemoteShowPayload(){
    const cfg=state.config||{};
    const activeId=cfg.repertoire||'todas';
    const activeSongIds=(activeId==='todas'
      ? state.songs
      : state.songs.filter(song=>Array.isArray(song.listas)&&song.listas.includes(activeId))
    ).map(song=>song.id);
    const active=Boolean(state.config);
    return {
      lista_activa:activeId,
      listaActiva:activeId,
      repertorio_activo_ids:activeSongIds,
      repertorioActivoIds:activeSongIds,
      pedidos_whatsapp:cfg.whatsapp!==false,
      pedidos_panel:cfg.requests===true,
      pedidos_modo:cfg.requestsMode==='uno_por_turno'?'uno_por_turno':'libre',
      mostrar_cola:cfg.publicQueue!==false,
      lugar:cfg.venue||'',
      perfil_clientes:cfg.profile||'medio',
      repertorio_nombre:cfg.repertoireName||'',
      uso_publicidad:cfg.advertising===true,
      show_activo:active,
      inicio_show:active&&cfg.startedAt?new Date(cfg.startedAt).getTime():0,
      cronometro_schema:SHOW_TIMER_SCHEMA,
      cronometro_elapsed_ms:active&&typeof showTimer!=='undefined'?Math.max(0,Number(showTimer.elapsedMs)||0):0,
      cronometro_running:active&&typeof showTimer!=='undefined'&&showTimer.running===true,
      cronometro_started_at:active&&typeof showTimer!=='undefined'&&showTimer.running?showTimer.startedAt:0,
      cola:active?[...state.queue]:[],
      tocadas:active?[...state.played]:[],
      updated_at:Date.now(),
      show_revision:Date.now(),
      show_writer:DEVICE_ID
    };
  }

  async function performRemoteShowWrite(expectedGeneration=remoteShowGeneration){
    // AUDITORÍA: nunca toca Firebase. Publica únicamente en el servicio aislado 8796.
    if(EGP_AUDIT_LOCAL){
      const payload=buildRemoteShowPayload();
      if(expectedGeneration!==remoteShowGeneration)return payload;
      await localQueueRequest('/api/show',{active:payload.show_activo===true,venue:String(payload.lugar||'')});
      await egpPublicarConfigLan({show_activo:payload.show_activo===true,inicio_show:payload.inicio_show,pedidos_panel:payload.pedidos_panel,pedidos_modo:payload.pedidos_modo});
      remoteReady=true;
      return payload;
    }
    if(!remoteStateRef) await initRemoteSync();
    if(!remoteStateRef||!window.__egmSetDoc) throw new Error('Firebase todavía no está listo');
    // Siempre construir el payload justo antes de escribir. Así una tarea antigua
    // nunca puede reactivar un show que ya fue finalizado.
    const payload=buildRemoteShowPayload();
    if(expectedGeneration!==remoteShowGeneration) return payload;
    await window.__egmSetDoc(remoteStateRef,payload,{merge:true});
    remoteReady=true;
    return payload;
  }

  async function syncRemoteState(immediate=false){
    clearTimeout(remoteShowWriteTimer);
    const generation=remoteShowGeneration;
    const enqueue=()=>{
      const task=()=>performRemoteShowWrite(generation);
      remoteShowWriteChain=remoteShowWriteChain.then(task,task);
      return remoteShowWriteChain;
    };
    if(immediate)return enqueue();
    return new Promise((resolve,reject)=>{
      remoteShowWriteTimer=setTimeout(()=>enqueue().then(resolve,reject),80);
    });
  }

  async function publishShowPatch(patch){
    const revision=Date.now();

    if(EGP_AUDIT_LOCAL){
      const active=('show_activo' in patch)?patch.show_activo===true:Boolean(state.config);
      const venue=('lugar' in patch)?patch.lugar:(state.config?.venue||'');
      await localQueueRequest('/api/show',{active,venue:String(venue||'')});
      await egpPublicarConfigLan({
        show_activo:active,
        inicio_show:('inicio_show' in patch)?patch.inicio_show:(state.config?.startedAt?new Date(state.config.startedAt).getTime():0),
        pedidos_panel:('pedidos_panel' in patch)?patch.pedidos_panel:(state.config?.requests===true),
        pedidos_modo:('pedidos_modo' in patch)?patch.pedidos_modo:(state.config?.requestsMode||'libre')
      });
      return revision;
    }

    if(LOCAL_QUEUE_MODE){
      const active=('show_activo' in patch)?patch.show_activo:Boolean(state.config);
      const venue=('lugar' in patch)?patch.lugar:(state.config?.venue||'');
      await localQueueRequest('/api/show',{
        active:Boolean(active),
        venue:String(venue||'')
      });

      if(EGP_AUDIT_LOCAL||!navigator.onLine)return revision;
    }

    if(!remoteStateRef) await initRemoteSync();
    if(!remoteStateRef||!window.__egmSetDoc) throw new Error('Firebase todavía no está listo');
    await window.__egmSetDoc(
      remoteStateRef,
      {...patch,show_revision:revision,show_writer:DEVICE_ID,updated_at:revision},
      {merge:true}
    );
    return revision;
  }

  async function performRemoteLibraryWrite(){
    if(!remoteStateRef) await initRemoteSync();
    if(!remoteStateRef||!window.__egmSetDoc) throw new Error('Firebase todavía no está listo');
    await window.__egmSetDoc(remoteStateRef,{
      biblioteca:{
        songEdits:state.songEdits,
        customSongs:state.customSongs,
        customRepertoires:state.customRepertoires
      },
      biblioteca_updated_at:Date.now()
    },{merge:true});
    return true;
  }

  async function syncRemoteLibrary(immediate=false){
    clearTimeout(remoteLibraryWriteTimer);
    const enqueue=()=>{
      const task=()=>performRemoteLibraryWrite();
      remoteLibraryWriteChain=remoteLibraryWriteChain.then(task,task);
      return remoteLibraryWriteChain;
    };
    if(immediate)return enqueue();
    return new Promise((resolve,reject)=>{
      remoteLibraryWriteTimer=setTimeout(()=>enqueue().then(resolve,reject),160);
    });
  }

  function saveLibraryState(immediate=false){
    saveStateLocalOnly();
    return syncRemoteLibrary(immediate);
  }


  async function loadData(){
    try{
      const [songsRes, notesRes, lyricsRes] = await Promise.all([fetch('canciones.json'),fetch('assets/anotaciones/index.json'),fetch('data/letras.json')]);
      state.songs = (await songsRes.json()).map((song,index)=>({
        ...song,
        _sourceIndex:index,
        _searchTitle:norm(song.titulo),
        _searchArtist:norm(song.artista)
      }));
      invalidateRepertoireCache();
      if(notesRes.ok) state.notes = await notesRes.json();
      if(lyricsRes.ok) state.lyrics = await lyricsRes.json();
    }catch(err){
      console.warn('No se pudo usar fetch; cargando demostración.',err);
      state.songs = [
        {id:'demo1',titulo:'A la la Long',artista:'Inner Circle',listas:['todas','principal-diario']},
        {id:'demo2',titulo:'Back to Black',artista:'Amy Winehouse',listas:['todas','principal-diario']},
        {id:'demo3',titulo:'Como la flor',artista:'Selena',listas:['todas','principal-diario']}
      ];
    }
    state.songs.forEach((song,index)=>{ if(!Number.isFinite(song._sourceIndex)) song._sourceIndex=index; });
    hydrateSavedState();
    if(pendingRemoteLibrary){
      const b=pendingRemoteLibrary;
      if(b.songEdits&&typeof b.songEdits==='object') state.songEdits={...state.songEdits,...b.songEdits};
      if(Array.isArray(b.customSongs)) state.customSongs=b.customSongs;
      state.songs=state.songs.map(song=>state.songEdits[song.id]?{...song,...state.songEdits[song.id]}:song);
      saveStateLocalOnly();
    }
    buildRepertoires();
    if(latestRemoteState)applyRemotePanelState(latestRemoteState);
  }

  function hydrateSavedState(){
    const saved = JSON.parse(localStorage.getItem('egm-panel-v3') || '{}');
    state.config = saved.config || null;
    state.customSongs = Array.isArray(saved.customSongs) ? saved.customSongs : [];
    state.songEdits = saved.songEdits && typeof saved.songEdits==='object' ? saved.songEdits : {};
    state.songs = state.songs.map(song=>state.songEdits[song.id] ? {...song,...state.songEdits[song.id]} : song);
    state.customRepertoires = Array.isArray(saved.customRepertoires) ? saved.customRepertoires : [];
    state.songs = [...state.songs, ...state.customSongs];
    sortMasterSongs();
    state.queue = Array.isArray(saved.queue) ? saved.queue : [];
    state.played = new Set(Array.isArray(saved.played) ? saved.played : []);
    (saved.venues || []).forEach(v => addVenueOption(v));
    if(state.config){
      $('#venueInput').value = state.config.venue || '';
      $('#profileSelect').value = state.config.profile || 'alto';
      $('#whatsappToggle').checked = state.config.whatsapp !== false;
      const requestsToggle=document.getElementById('requestsToggle');
      if(requestsToggle)requestsToggle.checked=state.config.requests===true;
      const requestsMode=document.getElementById('requestsModeSelect');
      if(requestsMode)requestsMode.value=state.config.requestsMode==='uno_por_turno'?'uno_por_turno':'libre';
      $('#publicQueueToggle').checked = state.config.publicQueue !== false;
      setStatus(true);
    }
    refreshPanelProfileControls();
  }

  function saveStateLocalOnly(){
    const venues = $$('#venueHistory option').map(o=>o.value);
    localStorage.setItem('egm-panel-v3',JSON.stringify({config:state.config,queue:state.queue,played:[...state.played],venues,customSongs:state.customSongs,customRepertoires:state.customRepertoires,songEdits:state.songEdits}));
  }

  async function localQueueRequest(path,body){
    const controller=new AbortController();
    const timeoutMs=body===undefined?2500:8000;
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const options={
        method:body===undefined?'GET':'POST',
        cache:'no-store',
        signal:controller.signal
      };

      if(body!==undefined){
        options.headers={'Content-Type':'application/json'};
        options.body=JSON.stringify(body);
      }

      const response=await fetch(LOCAL_CORE_URL+path,options);
      const data=await response.json();
      if(!response.ok||data?.ok===false)throw new Error(data?.error||'Local Core no respondió');
      return data;
    }finally{
      clearTimeout(timer);
    }
  }

  function applyLocalQueueSnapshot(snapshot,{force=false}={}){
    if(!snapshot||!Array.isArray(snapshot.queue))return false;
    if(!force&&(queueDragState.active||queueDragState.saving))return false;

    const before=[...state.queue];
    const beforePlayed=[...state.played];

    state.currentId=String(snapshot.currentId||'');

    const rows=snapshot.queue.slice().sort(
      (a,b)=>(Number(a.position)||0)-(Number(b.position)||0)
    );

    const ids=rows.map(x=>String(x.id||'')).filter(Boolean);
    const played=rows
      .filter(x=>x.played===true)
      .map(x=>String(x.id||''))
      .filter(Boolean);

    state.queue=ids;
    state.played=new Set(played);

    saveStateLocalOnly();
    remoteReady=true;

    if(before.join('|')!==ids.join('|') ||
       beforePlayed.join('|')!==played.join('|') ||
       force){
      renderQueue();
      renderSongs();
    }

    if(before.join('|')!==ids.join('|')){
      processQueueAdditions(before,ids);
    }

    return true;
  }

  async function refreshLocalQueue(){
    if(localQueueBusy||localQueueMutationPending>0||queueDragState.active||queueDragState.saving)return;

    localQueueBusy=true;

    try{
      let snap=null;

      try{
        snap=await localQueueRequest('/api/state');
      }catch(err){
        const wasLocal=LOCAL_QUEUE_MODE;
        LOCAL_QUEUE_MODE=false;

        if(wasLocal&&latestRemoteState){
          const q=Array.isArray(latestRemoteState.cola)?latestRemoteState.cola.map(String):[];
          const p=Array.isArray(latestRemoteState.tocadas)?[...new Set(latestRemoteState.tocadas.map(String))]:[];

          state.played=new Set(p);
          applyRemoteQueueSnapshot(q);
          state.queue=canonicalQueueOrder(q,p);
          saveStateLocalOnly();
          renderQueue();
          renderSongs();
        }

        return;
      }

      LOCAL_QUEUE_MODE=true;

      try{
        applyLocalQueueSnapshot(snap);
      }catch(err){
        console.warn('Local Core conectado; error aplicando estado local:',err);
      }
    }finally{
      localQueueBusy=false;
    }
  }

  function startLocalQueueSync(){
    if(localQueueTimer)return;
    refreshLocalQueue();
    localQueueTimer=setInterval(refreshLocalQueue,550);
  }

  setTimeout(startLocalQueueSync,500);
  function saveState(immediate=false){ saveStateLocalOnly(); return syncRemoteState(immediate); }

  function buildRepertoires(){
    const map = new Map(fallbackRepertoires.map(x=>[x.id,x.name]));
    state.customRepertoires.forEach(x=>map.set(x.id,x.name));
    state.songs.forEach(song => (song.listas||[]).forEach(id=>{
      if(!map.has(id)) map.set(id, titleFromId(id));
    }));
    const select=$('#repertoireSelect');
    select.innerHTML='';
    [...map].sort((a,b)=>a[1].localeCompare(b[1],'es')).forEach(([id,name])=>{
      const count=state.songs.filter(song=>id==='todas'||(song.listas||[]).includes(id)).length;
      const option=new Option(`${name} · ${count} ${count===1?'canción':'canciones'}`,id);
      option.dataset.name=name;
      select.add(option);
    });
    select.value = state.config?.repertoire || (map.has('principal-diario')?'principal-diario':'todas');
  }

  function titleFromId(id){ return id.split('-').map(w=>w[0]?.toUpperCase()+w.slice(1)).join(' '); }
  function sortMasterSongs(){
    state.songs.sort((a,b)=>String(a.titulo||'').localeCompare(String(b.titulo||''),'es',{sensitivity:'base'}) || String(a.artista||'').localeCompare(String(b.artista||''),'es',{sensitivity:'base'}));
    state.songs.forEach((song,index)=>{ song.numero=index+1; });
  }
  function addVenueOption(value){
    if(!value || $(`#venueHistory option[value="${CSS.escape(value)}"]`)) return;
    const o=document.createElement('option');o.value=value;$('#venueHistory').append(o);
  }
  $('#venueInput').addEventListener('input',()=>sessionStorage.setItem('egm-venue-draft',$('#venueInput').value));
  $('#repertoireSelect').addEventListener('change',()=>{
    sessionStorage.setItem('egm-venue-draft',$('#venueInput').value);
    // Si el show ya está activo, el cambio de repertorio se publica sin reiniciar
    // cola, cronómetro ni canciones tocadas.
    if(!state.config||applyingRemoteShowState)return;
    const select=$('#repertoireSelect');
    const repertoire=select.value;
    const repertoireName=select.selectedOptions[0]?.dataset?.name||select.selectedOptions[0]?.textContent?.replace(/ · .*$/,'')||titleFromId(repertoire);
    state.config={...state.config,repertoire,repertoireName};
    invalidateRepertoireCache();
    saveStateLocalOnly();
    $('#liveRepertoireName').textContent=repertoireName;
    filterSongs();
    const ids=(repertoire==='todas'?state.songs:state.songs.filter(song=>(song.listas||[]).includes(repertoire))).map(song=>song.id);
    publishShowPatch({lista_activa:repertoire,listaActiva:repertoire,repertorio_nombre:repertoireName,repertorio_activo_ids:ids,repertorioActivoIds:ids,show_activo:true})
      .then(()=>toast('Repertorio sincronizado en todos los dispositivos.'))
      .catch(err=>{console.error('No se sincronizó el repertorio',err);toast('Cambio guardado localmente; sincronización pendiente.');});
  });
  $('#profileSelect').addEventListener('change',()=>sessionStorage.setItem('egm-venue-draft',$('#venueInput').value));
  $('#panelUserSelect').addEventListener('change',()=>{
    panelDevicePrefs.profile=$('#panelUserSelect').value==='daniel'?'daniel':'elena';
    panelDevicePrefs.autoOpen=panelDevicePrefs.profile==='daniel'?defaultDanielAutoOpen:'none';
    savePanelDevicePrefs();refreshPanelProfileControls();renderSongs();
  });
  $('#panelAutoOpenSelect').addEventListener('change',()=>{panelDevicePrefs.autoOpen=$('#panelAutoOpenSelect').value;savePanelDevicePrefs();refreshPanelProfileControls();});
  const venueDraft=sessionStorage.getItem('egm-venue-draft'); if(venueDraft&&!$('#venueInput').value) $('#venueInput').value=venueDraft;
  function setStatus(active){
    const chip=$('#statusChip');chip.textContent=active?'Show activo':'Sin show activo';chip.classList.toggle('active',active);
  }

  function panelAuthValid(){return $('#panelLogin')?.hidden===true;}

  function closeDialogsForRemoteShowEnd(){
    document.querySelectorAll('dialog[open]').forEach(dialog=>{
      if(dialog.id==='confirmDialog')return;
      try{dialog.close();}catch(_){dialog.removeAttribute('open');}
    });
  }

  function abortQueueDragForRemoteSemanticChange(queue,playedOrder){
    if(!queueDragState.active)return false;
    clearTimeout(queueDragState.timer);queueDragState.timer=0;
    cleanupQueueDragVisuals();
    queueDragState.active=false;
    queueDragState.pointerId=null;
    queueDragState.item=null;
    queueDragState.handle=null;
    queueDragState.movedId='';
    queueDragState.initialOrder=[];
    queueDragState.pendingRemoteQueue=null;
    state.played=new Set(playedOrder);
    state.queue=canonicalQueueOrder(queue,playedOrder);
    saveStateLocalOnly();
    renderQueue();
    renderSongs();
    toast('La cola cambió desde otro dispositivo; se actualizó el orden.');
    return true;
  }

  function applyRemoteQueueSnapshot(queue){
    if(!Array.isArray(queue))return false;
    if(queueDragState.active||queueDragState.saving){
      queueDragState.pendingRemoteQueue=[...queue];
      return false;
    }
    state.queue=[...queue];
    return true;
  }

  function applyRemotePanelState(data,options={}){
    if(!data||typeof data!=='object')return;
    const revision=Number(data.show_revision||data.updated_at||0);
    if(revision&&revision<lastAppliedRemoteRevision)return;
    if(revision)lastAppliedRemoteRevision=revision;
    applyingRemoteShowState=true;
    try{
      const incomingQueue=Array.isArray(data.cola)?data.cola.map(String):[];
      if(!options.skipQueue)applyRemoteQueueSnapshot(incomingQueue);
      if(!options.skipPlayed&&Array.isArray(data.tocadas)) state.played=new Set(data.tocadas.map(String));
      if(!queueDragState.active&&!queueDragState.saving){
        state.queue=canonicalQueueOrder(state.queue,state.played);
        if(!options.skipQueue)normalizeRemoteQueueIfNeeded(incomingQueue,state.played);
      }
      const remoteActive=data.show_activo===true;
      if(Date.now()<localShowTransitionUntil && localDesiredShowActive!==null && remoteActive!==localDesiredShowActive)return;
      if(remoteActive){
        const repertoire=data.lista_activa||data.listaActiva||'todas';
        const select=$('#repertoireSelect');
        const option=select?[...select.options].find(o=>o.value===repertoire):null;
        state.config={
          venue:data.lugar||'', repertoire,
          repertoireName:data.repertorio_nombre||option?.dataset?.name||option?.textContent?.replace(/ · .*$/,'')||titleFromId(repertoire),
          profile:data.perfil_clientes||'medio', whatsapp:data.pedidos_whatsapp!==false,
          requests:options.preserveLocalRequests&&state.config?state.config.requests===true:data.pedidos_panel===true,
          requestsMode:data.pedidos_modo==='uno_por_turno'?'uno_por_turno':'libre',
          publicQueue:data.mostrar_cola!==false,
          advertising:data.uso_publicidad===true,
          startedAt:new Date(Number(data.inicio_show)||Date.now()).toISOString()
        };
        $('#venueInput').value=state.config.venue;
        $('#profileSelect').value=state.config.profile;
        $('#whatsappToggle').checked=state.config.whatsapp;
        const requestsToggle=document.getElementById('requestsToggle');
        if(requestsToggle)requestsToggle.checked=state.config.requests===true;
        const requestsMode=document.getElementById('requestsModeSelect');
        if(requestsMode)requestsMode.value=state.config.requestsMode==='uno_por_turno'?'uno_por_turno':'libre';
        $('#publicQueueToggle').checked=state.config.publicQueue;
        if(select&&select.querySelector(`option[value="${CSS.escape(repertoire)}"]`))select.value=repertoire;
        $('#liveRepertoireName').textContent=state.config.repertoireName;
        invalidateRepertoireCache();
        setStatus(true);
        applyRemoteShowTimer({
          schema:Number(data.cronometro_schema)||0,
          elapsedMs:Number(data.cronometro_elapsed_ms)||0,
          running:data.cronometro_running===true,
          startedAt:Number(data.cronometro_started_at)||0
        });
        saveStateLocalOnly();
        // Tras autenticar, un show remoto activo lleva directamente a Control en vivo.
        if(panelAuthValid()&&$('#panelLogin').hidden&&!document.querySelector('#imageEditorDialog[open],#songbookEditorDialog[open]'))showLive();
      }else if(data.show_activo===false){
        state.config=null;state.queue=[];state.played.clear();
        setStatus(false);
        applyRemoteShowTimer({schema:SHOW_TIMER_SCHEMA,elapsedMs:0,running:false,startedAt:0});
        saveStateLocalOnly();
        // El cierre remoto es global: ningún modal puede impedir volver a Configuración.
        if(panelAuthValid()&&$('#panelLogin').hidden){closeDialogsForRemoteShowEnd();showConfig();toast('El show fue finalizado desde otro dispositivo.');}
      }
      renderQueue();
      if(document.body.classList.contains('live-mode')){invalidateRepertoireCache();filterSongs();}
    }finally{applyingRemoteShowState=false;}
  }

  refreshPanelProfileControls();

  $('#showForm').addEventListener('submit',e=>{
    e.preventDefault();
    const venue=$('#venueInput').value.trim();
    if(!venue) return toast('Escribe el lugar del show');
    const config={venue,repertoire:$('#repertoireSelect').value,repertoireName:$('#repertoireSelect').selectedOptions[0].dataset.name||$('#repertoireSelect').selectedOptions[0].textContent,profile:$('#profileSelect').value,whatsapp:$('#whatsappToggle').checked,requests:$('#requestsToggle')?.checked===true,requestsMode:$('#requestsModeSelect')?.value==='uno_por_turno'?'uno_por_turno':'libre',publicQueue:$('#publicQueueToggle').checked,advertising:$('#advertisingToggle').checked,startedAt:new Date().toISOString()};
    askConfirm('Comenzar nuevo show','Se guardará esta configuración y se reiniciará la cola del show anterior.',()=>{
      // Entrada inmediata: no esperar una lectura de verificación para mostrar Control en vivo.
      remoteShowGeneration++;localDesiredShowActive=true;localShowTransitionUntil=Date.now()+10000;
      state.config=config;state.queue=[];state.played.clear();addVenueOption(venue);
      startNewShowTimer();
      saveStateLocalOnly();
      setStatus(true);showLive();egpPublicarConfigLan({show_activo:true,inicio_show:new Date(config.startedAt).getTime(),pedidos_panel:config.requests===true,pedidos_modo:config.requestsMode});
      toast(`Show iniciado. Repertorio activo: ${config.repertoireName}.`);

      // Publicación en segundo plano. Los demás dispositivos reciben el show por onSnapshot.
      syncRemoteState(true).then(()=>{
        localDesiredShowActive=null;localShowTransitionUntil=0;
        toast('Configuración sincronizada en todos los dispositivos.');
      }).catch(err=>{
        console.error('No se pudo publicar el show activo:',err);
        toast('Show iniciado localmente. Se sincronizará cuando vuelva la conexión.');
      });
    },'Comenzar');
  });

  function showLive(){
    if(!state.config) return toast('Primero configura el show');
    document.documentElement.classList.add('live-mode');document.body.classList.add('live-mode');
    $('#configView').classList.remove('is-active');$('#liveView').classList.add('is-active');
    $('#liveRepertoireName').textContent=state.config.repertoireName || 'Repertorio';
    $('#songSearch').value='';filterSongs();renderQueue();
  }
  let configOpenedFromLive=false;
  function showConfig(fromLive=false){ configOpenedFromLive=Boolean(fromLive&&state.config);document.documentElement.classList.remove('live-mode');document.body.classList.remove('live-mode');$('#liveView').classList.remove('is-active');$('#configView').classList.add('is-active');const continueBtn=$('#continueShowBtn');if(continueBtn)continueBtn.hidden=!configOpenedFromLive;window.scrollTo({left:0,top:0,behavior:'smooth'}); }

  // Entrega 6.36.65 · pausa/play con doble clic o doble toque compatible.
  const SHOW_TIMER_KEY='egm-show-timer-v1';
  const SHOW_TIMER_SCHEMA=3;
  let showTimer={elapsedMs:0,running:false,startedAt:0};
  let showTimerFrame=0;
  let legacyRemoteTimerResetPublished=false;

  function resetTimerStateOnly(keepRunning=false){
    showTimer={
      elapsedMs:0,
      running:keepRunning===true,
      startedAt:keepRunning===true?Date.now():0
    };
    saveShowTimer();
    showTimerLoop();
  }

  function loadShowTimer(){
    try{
      const saved=JSON.parse(localStorage.getItem(SHOW_TIMER_KEY)||'null');
      if(!saved||Number(saved.schema)!==SHOW_TIMER_SCHEMA){
        // 6.36.89: nunca heredar un reloj local del formato antiguo, porque pudo
        // quedar inflado por el doble conteo. Solo se sanea el cronómetro.
        showTimer={elapsedMs:0,running:false,startedAt:0};
        saveShowTimer();
        return;
      }
      if(Number.isFinite(saved.elapsedMs)){
        showTimer={
          elapsedMs:Math.max(0,Number(saved.elapsedMs)||0),
          running:saved.running===true,
          startedAt:Number(saved.startedAt)||0
        };
        if(showTimer.running&&!showTimer.startedAt)showTimer.startedAt=Date.now();
      }
    }catch(_){
      showTimer={elapsedMs:0,running:false,startedAt:0};
      saveShowTimer();
    }
  }
  function saveShowTimer(){
    try{
      localStorage.setItem(SHOW_TIMER_KEY,JSON.stringify({
        schema:SHOW_TIMER_SCHEMA,
        elapsedMs:Math.max(0,Number(showTimer.elapsedMs)||0),
        running:showTimer.running===true,
        startedAt:showTimer.running?Number(showTimer.startedAt)||Date.now():0
      }));
    }catch(_){}
  }
  function showTimerTotalMs(){
    return showTimer.elapsedMs+(showTimer.running?Math.max(0,Date.now()-showTimer.startedAt):0);
  }
  function formatShowTimer(ms){
    const total=Math.floor(Math.max(0,ms)/1000);
    const hours=Math.floor(total/3600);
    const minutes=Math.floor((total%3600)/60);
    const seconds=total%60;
    return [hours,minutes,seconds].map(value=>String(value).padStart(2,'0')).join(':');
  }
  function renderShowTimer(){
    const display=$('#showTimerDisplay');
    const button=$('#showTimerToggle');
    if(!display||!button)return;
    display.textContent=formatShowTimer(showTimerTotalMs());
    button.textContent=showTimer.running?'Ⅱ':'▶';
    button.classList.toggle('is-running',showTimer.running);
    button.setAttribute('aria-label',showTimer.running?'Pausar cronómetro':'Iniciar cronómetro');
    button.title=showTimer.running?'Doble clic o doble toque para pausar':'Doble clic o doble toque para iniciar';
  }
  function showTimerLoop(){
    cancelAnimationFrame(showTimerFrame);
    const tick=()=>{
      renderShowTimer();
      if(showTimer.running)showTimerFrame=requestAnimationFrame(tick);
    };
    tick();
  }
  function applyRemoteShowTimer(remote){
    if(!remote||applyingRemoteShowState===false&&remote===showTimer)return;

    const remoteSchema=Number(remote.schema)||0;

    // 6.36.89: cualquier show activo que todavía venga del formato antiguo
    // puede contener tiempo duplicado. No se intenta "adivinar" el tiempo real:
    // se reinicia SOLO el cronómetro y se migra una sola vez a schema 2.
    if(remoteSchema!==SHOW_TIMER_SCHEMA){
      const keepRunning=remote.running===true;
      resetTimerStateOnly(keepRunning);
      if(state.config&&!legacyRemoteTimerResetPublished){
        legacyRemoteTimerResetPublished=true;
        const patch={
          show_activo:true,
          cronometro_schema:SHOW_TIMER_SCHEMA,
          cronometro_elapsed_ms:0,
          cronometro_running:keepRunning,
          cronometro_started_at:keepRunning?showTimer.startedAt:0
        };
        setTimeout(()=>{
          publishShowPatch(patch).catch(err=>console.warn('No se pudo migrar el cronómetro antiguo',err));
        },0);
      }
      return;
    }

    legacyRemoteTimerResetPublished=true;
    let next={
      elapsedMs:Math.max(0,Number(remote.elapsedMs)||0),
      running:remote.running===true,
      startedAt:Number(remote.startedAt)||0
    };
    if(next.running&&!next.startedAt)next.startedAt=Date.now();

    // 6.36.90: saneamiento físico independiente del schema.
    // El cronómetro jamás puede ser mayor que el tiempo transcurrido desde inicio_show.
    // Si una versión anterior dejó horas infladas, reiniciar SOLO el reloj.
    const showStartedAt=state.config?.startedAt?new Date(state.config.startedAt).getTime():0;
    const physicalMax=showStartedAt>0?Math.max(0,Date.now()-showStartedAt):null;
    const incomingTotal=next.elapsedMs+(next.running?Math.max(0,Date.now()-next.startedAt):0);
    if(physicalMax!==null && incomingTotal>physicalMax+30000){
      next={elapsedMs:0,running:next.running,startedAt:next.running?Date.now():0};
      if(state.config){
        setTimeout(()=>publishShowPatch({
          show_activo:true,
          cronometro_schema:SHOW_TIMER_SCHEMA,
          cronometro_elapsed_ms:0,
          cronometro_running:next.running,
          cronometro_started_at:next.running?next.startedAt:0
        }).catch(err=>console.warn('No se pudo sanear el cronómetro remoto',err)),0);
      }
    }
    const same=showTimer.elapsedMs===next.elapsedMs&&showTimer.running===next.running&&showTimer.startedAt===next.startedAt;
    if(same)return;
    showTimer=next;
    saveShowTimer();
    showTimerLoop();
  }
  function toggleShowTimer(){
    if(showTimer.running){
      showTimer.elapsedMs=showTimerTotalMs();
      showTimer.running=false;
      showTimer.startedAt=0;
    }else{
      showTimer.running=true;
      showTimer.startedAt=Date.now();
    }
    saveShowTimer();
    showTimerLoop();
    if(state.config&&!applyingRemoteShowState)publishShowPatch({
      show_activo:true,
      cronometro_schema:SHOW_TIMER_SCHEMA,
      cronometro_elapsed_ms:Math.max(0,Number(showTimer.elapsedMs)||0),
      cronometro_running:showTimer.running,
      cronometro_started_at:showTimer.running?showTimer.startedAt:0
    }).catch(err=>console.warn('No se sincronizó el cronómetro',err));
  }
  function resetShowTimer(){
    showTimer={elapsedMs:0,running:false,startedAt:0};
    saveShowTimer();
    showTimerLoop();
    if(state.config&&!applyingRemoteShowState)publishShowPatch({
      show_activo:true,
      cronometro_schema:SHOW_TIMER_SCHEMA,
      cronometro_elapsed_ms:0,
      cronometro_running:false,
      cronometro_started_at:0
    }).catch(err=>console.warn('No se sincronizó el reinicio del cronómetro',err));
  }
  function startNewShowTimer(){
    showTimer={elapsedMs:0,running:true,startedAt:Date.now()};
    saveShowTimer();
    showTimerLoop();
  }
  function bindDoubleActivation(button,handler){
    if(!button)return;
    let lastTouchUp=0;
    let lastActivation=0;
    let touchResetTimer=0;

    const activate=(event)=>{
      const now=Date.now();
      // Safari/Chrome can emit both click(detail=2) and dblclick for the same gesture.
      // This guard guarantees a single pause/play change per double activation.
      if(now-lastActivation<320)return;
      lastActivation=now;
      if(event){event.preventDefault();event.stopPropagation();}
      handler();
    };

    // Mouse and trackpad: click.detail is the most consistent signal across browsers.
    button.addEventListener('click',event=>{
      if(event.detail>=2)activate(event);
    });
    // Fallback for browsers that only emit dblclick.
    button.addEventListener('dblclick',event=>activate(event));

    // iPhone, Android and installed PWA: detect two pointer releases.
    button.addEventListener('pointerup',event=>{
      if(event.pointerType==='mouse')return;
      event.preventDefault();
      event.stopPropagation();
      const now=Date.now();
      if(now-lastTouchUp<=480){
        lastTouchUp=0;
        clearTimeout(touchResetTimer);
        activate(event);
      }else{
        lastTouchUp=now;
        clearTimeout(touchResetTimer);
        touchResetTimer=setTimeout(()=>{lastTouchUp=0;},520);
      }
    });
    button.addEventListener('contextmenu',event=>event.preventDefault());
  }
  loadShowTimer();
  bindDoubleActivation($('#showTimerToggle'),toggleShowTimer);
  showTimerLoop();
  window.addEventListener('pagehide',()=>{
    if(showTimer.running){showTimer.elapsedMs=showTimerTotalMs();showTimer.startedAt=Date.now();}
    saveShowTimer();
  });

  $('#backConfigBtn').addEventListener('click',()=>showConfig(true));

  $('#continueShowBtn')?.addEventListener('click',async()=>{
    if(!state.config)return showConfig(false);
    const venue=$('#venueInput').value.trim();
    if(!venue)return toast('Escribe el lugar del show');
    const select=$('#repertoireSelect');
    const repertoire=select.value;
    const repertoireName=select.selectedOptions[0]?.dataset?.name||select.selectedOptions[0]?.textContent?.replace(/ · .*$/,'')||titleFromId(repertoire);
    state.config={...state.config,venue,repertoire,repertoireName,profile:$('#profileSelect').value,whatsapp:$('#whatsappToggle').checked,requests:$('#requestsToggle')?.checked===true,requestsMode:$('#requestsModeSelect')?.value==='uno_por_turno'?'uno_por_turno':'libre',publicQueue:$('#publicQueueToggle').checked,advertising:$('#advertisingToggle').checked};
    addVenueOption(venue);invalidateRepertoireCache();saveStateLocalOnly();
    const ids=(repertoire==='todas'?state.songs:state.songs.filter(song=>(song.listas||[]).includes(repertoire))).map(song=>song.id);
    showLive();toast('Configuración actualizada. El show continúa.');
    await egpPublicarConfigLan({show_activo:true,inicio_show:new Date(state.config.startedAt).getTime(),pedidos_panel:state.config.requests===true,pedidos_modo:state.config.requestsMode});
    try{await publishShowPatch({show_activo:true,lugar:venue,lista_activa:repertoire,listaActiva:repertoire,repertorio_nombre:repertoireName,repertorio_activo_ids:ids,repertorioActivoIds:ids,perfil_clientes:state.config.profile,pedidos_whatsapp:state.config.whatsapp,pedidos_panel:state.config.requests===true,pedidos_modo:state.config.requestsMode==='uno_por_turno'?'uno_por_turno':'libre',mostrar_cola:state.config.publicQueue,uso_publicidad:state.config.advertising===true});}
    catch(err){console.warn('Configuración del show pendiente de sincronizar',err);toast('Cambios guardados localmente; sincronización pendiente.');}
  });

  // 6.36.69.4 · cierre global directo, independiente de colas antiguas.
  async function publishFinishedShow(){
    clearTimeout(remoteShowWriteTimer);
    remoteShowGeneration++;
    remoteShowWriteChain=Promise.resolve();
    const finishPayload={show_activo:false,cola:[],tocadas:[],pedidos_panel_lista:[],cronometro_elapsed_ms:0,cronometro_running:false,cronometro_started_at:0,inicio_show:0};

    if(LOCAL_QUEUE_MODE){
      const cleared=await localQueueRequest('/api/queue/clear',{});
      applyLocalQueueSnapshot(cleared,{force:true});
    }

    await egpCerrarPedidosPendientes();
    await publishShowPatch(finishPayload);
    // Segunda publicación corta para ganar ante una pestaña con una escritura vieja en vuelo.
    await new Promise(resolve=>setTimeout(resolve,180));
    await publishShowPatch(finishPayload);
    return finishPayload;
  }

  $('#finishShowBtn').addEventListener('click',()=>askConfirm('Finalizar show','Se cerrará el show actual y se limpiará la cola en todos los dispositivos.',async()=>{
    localDesiredShowActive=false;localShowTransitionUntil=Date.now()+15000;
    state.config=null;state.queue=[];state.played.clear();
    showTimer={elapsedMs:0,running:false,startedAt:0};saveShowTimer();showTimerLoop();
    saveStateLocalOnly();setStatus(false);showConfig();egpPublicarConfigLan({show_activo:false,inicio_show:0,pedidos_panel:false,pedidos_modo:'libre'});toast('Finalizando show en todos los dispositivos…');
    try{
      await publishFinishedShow();
      localDesiredShowActive=null;localShowTransitionUntil=0;
      toast('Show finalizado en todos los dispositivos.');
    }catch(err){
      console.error('No se pudo finalizar el show remotamente:',err);
      localDesiredShowActive=null;localShowTransitionUntil=0;
      toast('No se pudo confirmar el cierre remoto. Revisa la conexión.');
    }
  },'Finalizar'));
  $('#closePanelBtn').addEventListener('click',()=>askConfirm('Cerrar el panel','¿Deseas cerrar esta pantalla?',()=>{window.location.href='index.html?panel=1';},'Cerrar'));
  $('#exitPanelBtn').addEventListener('click',()=>askConfirm('Salir del panel','¿Deseas regresar a la página principal?',()=>{window.location.href='index.html?panel=1';},'Salir'));

  let filterFrame=0;
  function scheduleFilterSongs(){
    cancelAnimationFrame(filterFrame);
    filterFrame=requestAnimationFrame(filterSongs);
  }
  $('#songSearch').addEventListener('input',scheduleFilterSongs);
  let repertoireCache={key:'',songs:[],numbers:new Map()};
  function invalidateRepertoireCache(){repertoireCache={key:'',songs:[],numbers:new Map()};}
  function repertoireSongs(){
    const rep=state.config?.repertoire || 'todas';
    const key=`${rep}|${state.songs.length}|${state.songs.map(s=>`${s.id}:${s.titulo}:${(s.listas||[]).join(',')}`).join(';')}`;
    if(repertoireCache.key===key) return repertoireCache.songs;
    const songs=state.songs
      .filter(s=>rep==='todas'||(s.listas||[]).includes(rep))
      .sort((a,b)=>String(a.titulo||'').localeCompare(String(b.titulo||''),'es',{sensitivity:'base'}) || String(a.artista||'').localeCompare(String(b.artista||''),'es',{sensitivity:'base'}));
    repertoireCache={key,songs,numbers:new Map(songs.map((song,index)=>[song.id,index+1]))};
    return songs;
  }
  function activeRepertoireNumber(songId){
    repertoireSongs();
    return repertoireCache.numbers.get(songId)||null;
  }
  function filterSongs(){
    const q=norm($('#songSearch').value);
    const songs=repertoireSongs();
    if(!q){
      state.filtered=songs;
    }else{
      const isNumber=/^\d+$/.test(q);
      state.filtered=songs.map((song,index)=>{
        const title=song._searchTitle||(song._searchTitle=norm(song.titulo));
        const artist=song._searchArtist||(song._searchArtist=norm(song.artista));
        const number=String(repertoireCache.numbers.get(song.id)||'');
        let score=Infinity;
        if(isNumber){
          if(number===q) score=0;
          else if(number.startsWith(q)) score=1;
          else if(number.includes(q)) score=2;
        }else{
          const titleWords=title.split(/\s+/);
          const artistWords=artist.split(/\s+/);
          if(title.startsWith(q)) score=0;
          else if(titleWords.some(word=>word.startsWith(q))) score=1;
          else if(artist.startsWith(q)) score=2;
          else if(artistWords.some(word=>word.startsWith(q))) score=3;
          else if(title.includes(q)) score=4;
          else if(artist.includes(q)) score=5;
        }
        return {song,index,score};
      }).filter(item=>Number.isFinite(item.score))
        .sort((a,b)=>a.score-b.score||a.index-b.index)
        .map(item=>item.song);
    }
    renderSongs();
  }
  function hasMeaningfulContent(value){
    if(value===null||value===undefined) return false;
    const text=String(value).replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/\s+/g,' ').trim();
    return text.length>0;
  }
  function renderSongs(){
    const list=$('#songList');list.innerHTML='';
    $('#songCount').textContent=`${state.filtered.length} temas`;
    state.filtered.forEach((song,index)=>{
      const queued=state.queue.includes(song.id), played=state.played.has(song.id);
      const hasElenaImage=visualContentNow(song,'elena','image');
      const hasElenaSongbook=visualContentNow(song,'elena','songbook');
      const hasDanielImage=visualContentNow(song,'daniel','image');
      const hasDanielSongbook=visualContentNow(song,'daniel','songbook');
      const card=document.createElement('article');card.dataset.songId=song.id;card.className=`song-card${queued?' is-queued':''}${played?' is-played':''}`;
      const profileActions=panelDevicePrefs.profile==='daniel'
        ? `<button class="song-action notes ${hasDanielImage?'has-content':''}" data-act="daniel-image" data-visual-owner="daniel" data-visual-mode="image" title="${hasDanielImage?'Imagen de Daniel con contenido':'Imagen de Daniel sin contenido'}">Imagen</button><button class="song-action daniel ${hasDanielSongbook?'has-content':''}" data-act="daniel" data-visual-owner="daniel" data-visual-mode="songbook" title="${hasDanielSongbook?'Cancionero Daniel con contenido':'Cancionero Daniel sin contenido'}">Cancionero</button>`
        : `<button class="song-action lyrics ${hasElenaSongbook?'has-content':''}" data-act="lyrics" data-visual-owner="elena" data-visual-mode="songbook" title="${hasElenaSongbook?'Letra con contenido':'Letra sin contenido'}">Letra</button><button class="song-action notes ${hasElenaImage?'has-content':''}" data-act="notes" data-visual-owner="elena" data-visual-mode="image" title="${hasElenaImage?'Imagen con contenido':'Imagen sin contenido'}">Imagen</button>`;
      card.innerHTML=`<div class="song-info"><div class="song-title-row"><span class="song-number">${String(activeRepertoireNumber(song.id)||index+1).padStart(2,'0')}</span><span class="song-title">${esc(song.titulo)}</span><span class="song-artist">${esc(song.artista||'Artista no indicado')}</span></div></div><div class="song-actions"><button class="song-action queue ${queued?'is-on':''}" data-act="queue">${queued?'En cola':'A la cola'}</button><button class="song-action played ${played?'is-on':''}" data-act="played">Tocada</button>${profileActions}</div>`;
      card.querySelectorAll('[data-visual-owner][data-visual-mode]').forEach(button=>hydrateVisualContentButton(song,button.dataset.visualOwner,button.dataset.visualMode,button));
      const handleCardControl=e=>{
        const button=e.target.closest('[data-act]');
        if(!button) return;
        const act=button.dataset.act;
        if(['queue','played','lyrics','notes','daniel','daniel-image'].includes(act)) requireSecondTap(song,act,button);
      };
      card.addEventListener('pointerup',e=>{
        if(e.pointerType!=='touch'&&e.pointerType!=='pen') return;
        const button=e.target.closest('[data-act]');
        if(!button) return;
        e.preventDefault();
        button._egmTouchHandledUntil=Date.now()+700;
        handleCardControl(e);
      });
      card.addEventListener('click',e=>{
        const button=e.target.closest('[data-act]');
        if(button&&button._egmTouchHandledUntil>Date.now()) return;
        handleCardControl(e);
      });
      list.append(card);
    });
    if(!state.filtered.length) list.innerHTML='<div class="viewer-empty"><h3>No se encontraron canciones</h3><p>Prueba con otro título, artista o número.</p></div>';
  }
  const pendingActionTaps=new Map();
  function requireSecondTap(song,act,button){
    const key=`${song.id}:${act}`;
    const now=Date.now();
    const previous=pendingActionTaps.get(key)||0;

    if(previous && now-previous<=500){
      pendingActionTaps.clear();
      handleSongAction(song,act);
      return;
    }

    pendingActionTaps.clear();
    pendingActionTaps.set(key,now);

    setTimeout(()=>{
      if(pendingActionTaps.get(key)===now){
        pendingActionTaps.delete(key);
      }
    },520);
  }

  function handleSongAction(song,act){
    if(act==='queue'){
      const wasQueued=state.queue.includes(song.id);
      persistQueueStateMutation(song.id,wasQueued?'remove':'add').then(()=>{
        if(!wasQueued)setTimeout(()=>maybeAutoOpenQueuedSong(song),100);
      }).catch(()=>{});
    } else if(act==='played'){
      const wasPlayed=state.played.has(song.id);
      persistQueueStateMutation(song.id,wasPlayed?'unplay':'play').catch(()=>{});
    } else if(act==='lyrics') openViewer(song,'lyrics');
    else if(act==='notes') openViewer(song,'notes');
    else if(act==='daniel') openViewer(song,'daniel');
    else if(act==='daniel-image') openViewer(song,'daniel-image');
  }

  function focusSongFromQueue(songId){
    const safeId=String(songId||'');
    let card=[...document.querySelectorAll('.song-card[data-song-id]')].find(el=>String(el.dataset.songId)===safeId);
    if(!card){
      const search=$('#searchInput');
      if(search&&search.value){search.value='';filterSongs();card=[...document.querySelectorAll('.song-card[data-song-id]')].find(el=>String(el.dataset.songId)===safeId);}
    }
    if(!card){toast('La canción no está en el repertorio visible.');return;}
    card.scrollIntoView({behavior:'smooth',block:'center'});
    card.classList.remove('queue-focus');void card.offsetWidth;card.classList.add('queue-focus');
    setTimeout(()=>card.classList.remove('queue-focus'),1600);
  }

  function canonicalQueueOrder(queue=state.queue,played=state.played){
    const source=[...new Set((Array.isArray(queue)?queue:[]).map(String))];
    const playedOrder=played instanceof Set?[...played].map(String):Array.isArray(played)?[...new Set(played.map(String))]:[];
    const playedSet=new Set(playedOrder);
    const sourceSet=new Set(source);
    const pending=source.filter(id=>!playedSet.has(id));
    const done=playedOrder.filter(id=>sourceSet.has(id));
    return [...pending,...done];
  }

  function protectedQueueId(queue=state.queue,played=state.played){
    const playedSet=played instanceof Set?played:new Set(Array.isArray(played)?played.map(String):[]);
    return (Array.isArray(queue)?queue:[]).map(String).find(id=>!playedSet.has(id))||'';
  }

  function insertAtEndOfPending(queue,id,played){
    const target=String(id);
    const playedOrder=played instanceof Set?[...played].map(String):Array.isArray(played)?[...new Set(played.map(String))]:[];
    const playedSet=new Set(playedOrder);
    const canonical=canonicalQueueOrder(queue,playedOrder).filter(x=>x!==target);
    const pending=canonical.filter(x=>!playedSet.has(x));
    const done=canonical.filter(x=>playedSet.has(x));
    return [...pending,target,...done];
  }

  function persistQueueStateMutation(songId,kind){
    const id=String(songId||'');
    if(!id)return Promise.resolve();

    localQueueMutationPending++;

    const run=()=>persistQueueStateMutationNow(id,kind);
    const task=localQueueMutationChain.then(run,run);

    localQueueMutationChain=task.catch(()=>{});

    return task.finally(()=>{
      localQueueMutationPending=Math.max(0,localQueueMutationPending-1);
      if(localQueueMutationPending===0)setTimeout(refreshLocalQueue,0);
    });
  }

  async function persistQueueStateMutationNow(songId,kind){
    const id=String(songId||'');
    if(!id)return;
    const originalQueue=[...state.queue],originalPlayed=new Set(state.played);

    // Optimistic local state using the exact same invariant as Firestore.
    if(kind==='add'){
      state.played.delete(id);
      state.queue=insertAtEndOfPending(state.queue,id,state.played);
    }else if(kind==='remove'){
      state.queue=state.queue.filter(x=>String(x)!==id);
      state.played.delete(id);
    }else if(kind==='play'){
      state.played.add(id);
      state.queue=canonicalQueueOrder(state.queue,state.played);
    }else if(kind==='unplay'){
      state.played.delete(id);
      state.queue=state.queue.filter(x=>String(x)!==id);
    }
    state.queue=canonicalQueueOrder(state.queue,state.played);
    saveStateLocalOnly();renderQueue();renderSongs();

    try{
      if(LOCAL_QUEUE_MODE){
        const song=state.songs.find(x=>String(x.id)===id);
        let path='',body=null;

        if(kind==='add'){
          path='/api/queue/add';
          body={
            id,
            title:song?.titulo||id,
            number:String(song?.numero||song?.n||'')
          };
        }else if(kind==='remove'){
          path='/api/queue/remove';
          body={id};
        }else if(kind==='play'){
          path='/api/queue/played';
          body={id,played:true};
        }else if(kind==='unplay'){
          path='/api/queue/remove';
          body={id};
        }

        let result;
        try{
          result=await localQueueRequest(path,body);
        }catch(err){
          throw new Error('LAN REQUEST | '+(err?.name||'Error')+' | '+(err?.message||String(err)));
        }

        try{
          applyLocalQueueSnapshot(result,{force:true});
        }catch(err){
          throw new Error('LAN APPLY | '+(err?.name||'Error')+' | '+(err?.message||String(err)));
        }

        return result;
      }

      if(!navigator.onLine)throw new Error('OFFLINE');
      if(!remoteStateRef)await initRemoteSync();
      if(!remoteStateRef||!remoteRunTransaction)throw new Error('Firestore todavía no está listo');

      const result=await remoteRunTransaction(remoteDb,async transaction=>{
        const snap=await transaction.get(remoteStateRef);
        const data=snap.exists()?(snap.data()||{}):{};
        if(data.show_activo===false)return {status:'show-ended',queue:[],played:[]};

        let q=Array.isArray(data.cola)?[...new Set(data.cola.map(String))]:[];
        let p=new Set(Array.isArray(data.tocadas)?data.tocadas.map(String):[]);

        if(kind==='add'){
          p.delete(id);
          q=insertAtEndOfPending(q,id,p);
        }else if(kind==='remove'){
          q=q.filter(x=>x!==id);
          p.delete(id);
        }else if(kind==='play'){
          p.add(id);
          q=canonicalQueueOrder(q,p);
        }else if(kind==='unplay'){
          p.delete(id);
          q=q.filter(x=>x!==id);
        }

        q=canonicalQueueOrder(q,p);
        const revision=Date.now();
        transaction.update(remoteStateRef,{
          cola:q,tocadas:[...p],
          show_revision:revision,show_writer:DEVICE_ID,updated_at:revision
        });
        return {status:'ok',queue:q,played:[...p]};
      });

      if(result?.status==='show-ended'){
        toast('El show terminó; no se cambió la cola.');
        return;
      }
      state.queue=[...(result?.queue||state.queue)];
      state.played=new Set(result?.played||[...state.played]);
      saveStateLocalOnly();renderQueue();renderSongs();
    }catch(err){
      console.warn('No se pudo guardar el cambio de cola',err);
      state.queue=originalQueue;state.played=originalPlayed;
      saveStateLocalOnly();renderQueue();renderSongs();
      toast(err?.message==='OFFLINE'?'Sin conexión: no se cambió la cola remota.':String(err?.message||'Error desconocido'));
      throw err;
    }
  }

  let queueNormalizeTimer=0;
  function normalizeRemoteQueueIfNeeded(remoteQueue,playedOrder=state.played){
    const raw=Array.isArray(remoteQueue)?[...new Set(remoteQueue.map(String))]:[];
    const rawSet=new Set(raw);
    const playedRaw=playedOrder instanceof Set?[...playedOrder].map(String):Array.isArray(playedOrder)?[...new Set(playedOrder.map(String))]:[];

    // 6.36.92:
    // "Tocada" solo tiene sentido si la canción todavía pertenece a la cola.
    // IDs Tocada que ya no existen en cola son huérfanos históricos y se limpian.
    const playedClean=playedRaw.filter(id=>rawSet.has(id));
    const canonical=canonicalQueueOrder(raw,playedClean);

    const queueChanged=canonical.join('|')!==raw.join('|');
    const playedChanged=playedClean.join('|')!==playedRaw.join('|');
    if(!queueChanged&&!playedChanged)return;

    clearTimeout(queueNormalizeTimer);
    queueNormalizeTimer=setTimeout(async()=>{
      try{
        if(!navigator.onLine)return;
        if(!remoteStateRef)await initRemoteSync();
        if(!remoteStateRef||!remoteRunTransaction)return;

        await remoteRunTransaction(remoteDb,async transaction=>{
          const snap=await transaction.get(remoteStateRef);
          const data=snap.exists()?(snap.data()||{}):{};
          if(data.show_activo===false)return;

          const q=Array.isArray(data.cola)?[...new Set(data.cola.map(String))]:[];
          const qSet=new Set(q);
          const pRaw=Array.isArray(data.tocadas)?[...new Set(data.tocadas.map(String))]:[];
          const pClean=pRaw.filter(id=>qSet.has(id));
          const next=canonicalQueueOrder(q,pClean);

          const needsQueue=next.join('|')!==q.join('|');
          const needsPlayed=pClean.join('|')!==pRaw.join('|');
          if(!needsQueue&&!needsPlayed)return;

          const revision=Date.now();
          transaction.update(remoteStateRef,{
            cola:next,
            tocadas:pClean,
            show_revision:revision,
            show_writer:DEVICE_ID,
            updated_at:revision
          });
        });
      }catch(err){
        console.warn('No se pudo normalizar/limpiar la cola remota',err);
      }
    },80);
  }

  function queueOrderFromDom(){
    // La Cola activa muestra solo pendientes. Al reordenar, conservar las Tocadas
    // ocultas dentro del estado interno/Firebase para no alterar historial ni Bridge.
    const visiblePending=[...document.querySelectorAll('#queueList .queue-item[data-song-id]')]
      .map(el=>String(el.dataset.songId||''))
      .filter(Boolean);
    const hiddenPlayed=state.queue.map(String).filter(id=>state.played.has(id));
    return canonicalQueueOrder([...visiblePending,...hiddenPlayed],state.played);
  }

  function queueMoveAnchors(order,movedId){
    const index=order.indexOf(movedId);
    return {
      beforeId:index>0?order[index-1]:null,
      afterId:index>=0&&index<order.length-1?order[index+1]:null,
      intendedFirst:index===0
    };
  }

  async function persistQueueReorder(movedId,localOrder){
    if(!movedId||!Array.isArray(localOrder)||!localOrder.includes(movedId))return;
    const desiredPending=localOrder.map(String).filter(id=>!state.played.has(id));
    const movedIndex=desiredPending.indexOf(String(movedId));
    const beforeId=movedIndex>0?desiredPending[movedIndex-1]:null;
    const afterId=movedIndex>=0&&movedIndex<desiredPending.length-1?desiredPending[movedIndex+1]:null;

    queueDragState.saving=true;
    queueDragState.pendingRemoteQueue=null;
    state.queue=canonicalQueueOrder(localOrder,state.played);
    saveStateLocalOnly();renderSongs();

    try{
      if(LOCAL_QUEUE_MODE){
        const result=await localQueueRequest('/api/queue/reorder',{
          order:state.queue.map(String)
        });
        applyLocalQueueSnapshot(result,{force:true});
        queueDragState.pendingRemoteQueue=null;
        saveStateLocalOnly();
        toast('Orden de cola guardado');
        return result;
      }

      if(!navigator.onLine)throw new Error('OFFLINE');
      if(!remoteStateRef)await initRemoteSync();
      if(!remoteStateRef||!remoteRunTransaction)throw new Error('Firestore todavía no está listo');

      const result=await remoteRunTransaction(remoteDb,async transaction=>{
        const snap=await transaction.get(remoteStateRef);
        const data=snap.exists()?(snap.data()||{}):{};
        if(data.show_activo===false)return {status:'show-ended',queue:[]};

        const p=new Set(Array.isArray(data.tocadas)?data.tocadas.map(String):[]);
        let q=canonicalQueueOrder(Array.isArray(data.cola)?data.cola.map(String):[],p);
        const protectedId=protectedQueueId(q,p);

        if(!q.includes(movedId))return {status:'removed',queue:q};
        if(p.has(movedId)||movedId===protectedId)return {status:'protected',queue:q};

        const pending=q.filter(id=>!p.has(id));
        const done=q.filter(id=>p.has(id));
        const nextPending=pending.filter(id=>id!==movedId);

        let insertAt=nextPending.length;
        if(afterId&&nextPending.includes(afterId))insertAt=nextPending.indexOf(afterId);
        else if(beforeId&&nextPending.includes(beforeId))insertAt=nextPending.indexOf(beforeId)+1;

        // La posición 0 pertenece exclusivamente a la primera pendiente protegida.
        const minIndex=protectedId&&nextPending.includes(protectedId)?nextPending.indexOf(protectedId)+1:0;
        insertAt=Math.max(minIndex,Math.min(insertAt,nextPending.length));
        nextPending.splice(insertAt,0,movedId);

        const next=[...nextPending,...done];
        const revision=Date.now();
        transaction.update(remoteStateRef,{cola:next,show_revision:revision,show_writer:DEVICE_ID,updated_at:revision});
        return {status:'ok',queue:next};
      });

      state.queue=[...(result?.queue||state.queue)];
      queueDragState.pendingRemoteQueue=null;
      saveStateLocalOnly();
      const status=result?.status;
      toast(status==='show-ended'?'El show terminó; no se cambió la cola.':
            status==='removed'?'La canción fue retirada desde otro dispositivo.':
            status==='protected'?'La canción actual está protegida.':
            'Orden de cola guardado');
    }catch(err){
      console.warn('No se pudo guardar el nuevo orden de la cola',err);
      if(queueDragState.pendingRemoteQueue)state.queue=canonicalQueueOrder(queueDragState.pendingRemoteQueue,state.played);
      else state.queue=canonicalQueueOrder(queueDragState.initialOrder,state.played);
      saveStateLocalOnly();
      toast(err?.message==='OFFLINE'?'Sin conexión: no se cambió el orden remoto.':'No se pudo guardar el orden; se restauró la cola.');
    }finally{
      queueDragState.saving=false;
      queueDragState.pendingRemoteQueue=null;
      renderQueue();renderSongs();
    }
  }

  function cleanupQueueDragVisuals(){
    clearTimeout(queueDragState.timer);queueDragState.timer=0;
    queueDragState.ghost?.remove();
    queueDragState.item?.classList.remove('is-dragging');
    $('#queueList')?.classList.remove('is-reordering');
    document.body.classList.remove('queue-drag-active');
    if(queueDragState.handle){
      queueDragState.handle.setAttribute('aria-grabbed','false');
      try{if(queueDragState.pointerId!==null&&queueDragState.handle.hasPointerCapture(queueDragState.pointerId))queueDragState.handle.releasePointerCapture(queueDragState.pointerId);}catch(_){ }
    }
    queueDragState.ghost=null;
  }

  function beginQueueDrag(item,handle,e){
    if(queueDragState.active||queueDragState.saving||!item?.isConnected)return;
    queueDragState.active=true;
    queueDragState.item=item;
    queueDragState.handle=handle;
    queueDragState.pointerId=e.pointerId;
    try {
      if (e.currentTarget && e.currentTarget.setPointerCapture) {
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    } catch (_) {}
    queueDragState.movedId=String(item.dataset.songId||'');
    queueDragState.initialOrder=[...state.queue];
    queueDragState.pendingRemoteQueue=null;
    item.classList.add('is-dragging');
    $('#queueList')?.classList.add('is-reordering');
    document.body.classList.add('queue-drag-active');
    handle.setAttribute('aria-grabbed','true');
    try{handle.setPointerCapture(e.pointerId);}catch(_){ }
    const rect=item.getBoundingClientRect();
    const ghost=item.cloneNode(true);
    ghost.classList.remove('is-dragging');ghost.classList.add('queue-drag-ghost');
    ghost.style.width=`${rect.width}px`;ghost.style.left=`${rect.left}px`;ghost.style.top=`${rect.top}px`;
    ghost.querySelectorAll('button').forEach(b=>b.tabIndex=-1);
    document.body.appendChild(ghost);queueDragState.ghost=ghost;
    if(navigator.vibrate)try{navigator.vibrate(18);}catch(_){ }
  }

  function moveQueueDrag(e){
    if(!queueDragState.active||e.pointerId!==queueDragState.pointerId)return;
    e.preventDefault();
    queueDragState.lastX=e.clientX;queueDragState.lastY=e.clientY;
    const ghost=queueDragState.ghost;
    if(ghost){const r=ghost.getBoundingClientRect();ghost.style.top=`${e.clientY-r.height/2}px`;}

    const list=$('#queueList'),item=queueDragState.item;
    if(!list||!item)return;

    const protectedId=protectedQueueId();
    const protectedEl=protectedId?list.querySelector(`.queue-item[data-song-id="${CSS.escape(protectedId)}"]`):null;
    const firstPlayed=[...list.querySelectorAll('.queue-item.played[data-song-id]:not(.is-dragging)')][0]||null;
    const candidates=[...list.querySelectorAll('.queue-item[data-song-id]:not(.played):not(.is-dragging)')]
      .filter(el=>String(el.dataset.songId)!==protectedId);

    if(protectedEl){
      const r=protectedEl.getBoundingClientRect();
      if(e.clientY<r.bottom){
        protectedEl.after(item);
        return;
      }
    }

    for(const target of candidates){
      const r=target.getBoundingClientRect();
      if(e.clientY<r.top+r.height/2){list.insertBefore(item,target);return;}
    }

    if(firstPlayed)list.insertBefore(item,firstPlayed);
    else list.appendChild(item);
  }

  function finishQueueDrag(e,cancel=false){
    clearTimeout(queueDragState.timer);queueDragState.timer=0;
    if(!queueDragState.active){queueDragState.pointerId=null;return;}
    if(e&&e.pointerId!==queueDragState.pointerId)return;
    const movedId=queueDragState.movedId;
    const initial=[...queueDragState.initialOrder];
    const finalOrder=cancel?initial:queueOrderFromDom();
    queueDragState.suppressClickUntil=Date.now()+800;
    cleanupQueueDragVisuals();
    queueDragState.active=false;
    queueDragState.pointerId=null;queueDragState.item=null;queueDragState.handle=null;queueDragState.movedId='';
    if(cancel||finalOrder.join('|')===initial.join('|')){state.queue=initial;renderQueue();return;}
    state.queue=[...finalOrder];
    renderQueue();
    persistQueueReorder(movedId,finalOrder);
  }

  function setupQueueDrag(item,song){
    const handle=item.querySelector('.queue-name');
    if(!handle)return;
    const protectedId=protectedQueueId();
    if(state.played.has(song.id)||String(song.id)===protectedId){
      handle.tabIndex=-1;
      handle.removeAttribute('role');
      handle.removeAttribute('aria-grabbed');
      handle.setAttribute('aria-label',state.played.has(song.id)?`${song.titulo}. Canción tocada.`:`${song.titulo}. Canción actual protegida.`);
      return;
    }
    handle.tabIndex=0;
    handle.setAttribute('role','button');
    handle.setAttribute('aria-grabbed','false');
    handle.setAttribute('aria-label',`${song.titulo}. Mantén presionado para cambiar su posición. Con teclado usa Alt más flecha arriba o abajo.`);
    handle.addEventListener('contextmenu',e=>e.preventDefault());
    handle.addEventListener('pointerdown',e=>{
      if(e.button!==undefined&&e.button!==0)return;
      if(queueDragState.saving)return;
      clearTimeout(queueDragState.timer);
      queueDragState.pointerId=e.pointerId;queueDragState.startX=e.clientX;queueDragState.startY=e.clientY;
      queueDragState.lastX=e.clientX;queueDragState.lastY=e.clientY;
      queueDragState.item=item;queueDragState.handle=handle;
      queueDragState.timer=setTimeout(()=>beginQueueDrag(item,handle,e),500);
    });
    handle.addEventListener('pointermove',e=>{
      if(queueDragState.active){moveQueueDrag(e);return;}
      if(e.pointerId!==queueDragState.pointerId)return;
      if(Math.hypot(e.clientX-queueDragState.startX,e.clientY-queueDragState.startY)>16){clearTimeout(queueDragState.timer);queueDragState.timer=0;}
    });
    handle.addEventListener('pointerup',e=>finishQueueDrag(e,false));
    handle.addEventListener('pointercancel',e=>finishQueueDrag(e,true));
    handle.addEventListener('keydown',e=>{
      if(!e.altKey||!(e.key==='ArrowUp'||e.key==='ArrowDown')||queueDragState.saving)return;
      e.preventDefault();
      const protectedId=protectedQueueId();
      const pending=state.queue.filter(id=>!state.played.has(id));
      const done=state.queue.filter(id=>state.played.has(id));
      const i=pending.indexOf(song.id),delta=e.key==='ArrowUp'?-1:1,j=i+delta;
      if(i<0||j<0||j>=pending.length)return;
      if(pending[j]===protectedId||song.id===protectedId)return;
      [pending[i],pending[j]]=[pending[j],pending[i]];
      const order=[...pending,...done];
      queueDragState.initialOrder=[...state.queue];
      state.queue=order;renderQueue();
      requestAnimationFrame(()=>document.querySelector(`#queueList .queue-item[data-song-id="${CSS.escape(song.id)}"] .queue-name`)?.focus());
      persistQueueReorder(song.id,order);
    });
  }

  function renderQueue(){
    if(queueDragState.active||queueDragState.saving)return;
    state.queue=canonicalQueueOrder(state.queue,state.played);

    // Cola activa del Panel = pendientes solamente.
    // Las Tocadas permanecen en state.queue/Firebase, pero desaparecen de esta lista.
    const visibleQueue=state.queue.map(String).filter(id=>!state.played.has(id));
    const currentProtectedId=protectedQueueId();
    const panel=$('#queuePanel'),list=$('#queueList');
    panel.hidden=false;list.innerHTML='';
    $('#queueCount').textContent=`${visibleQueue.length} ${visibleQueue.length===1?'canción':'canciones'}`;
    panel.classList.toggle('has-items', visibleQueue.length > 0);
    if(!visibleQueue.length){
      list.innerHTML='<div class="queue-empty">La cola está vacía</div>';
      return;
    }
    visibleQueue.map(id=>state.songs.find(s=>s.id===id)).filter(Boolean).forEach(song=>{
      const item=document.createElement('div');
      const isPlayed=state.played.has(song.id),isProtected=String(song.id)===currentProtectedId;
      item.className=`queue-item${isPlayed?' played':''}${isProtected?' protected-current':''}`;
      item.dataset.songId=song.id;
      item.innerHTML=`<span class="queue-name"><b>${esc(song.titulo)}${isProtected?'<em class="queue-current-label">Actual</em>':''}</b><small>${esc(song.artista||'')}</small></span><button class="mini-btn played-toggle ${isPlayed?'is-on':''}" data-q="played">${isPlayed?'Tocada':'Tocada'}</button><button class="mini-btn remove" data-q="remove" aria-label="Quitar de la cola">×</button>`;
      const handleQueueControl=e=>{
        const button=e.target.closest('[data-q]');
        if(!button)return;
        requireSecondQueueTap(song,button.dataset.q,button);
      };
      item.addEventListener('pointerup',e=>{
        if(e.pointerType!=='touch'&&e.pointerType!=='pen') return;
        const button=e.target.closest('[data-q]');
        if(!button)return;
        e.preventDefault();
        button._egmTouchHandledUntil=Date.now()+700;
        handleQueueControl(e);
      });
      item.addEventListener('click',e=>{
        if(queueDragState.suppressClickUntil>Date.now()){e.preventDefault();e.stopPropagation();return;}
        const button=e.target.closest('[data-q]');
        if(button&&button._egmTouchHandledUntil>Date.now()) return;
        handleQueueControl(e);
      });
      item.addEventListener('dblclick',e=>{
        if(queueDragState.suppressClickUntil>Date.now())return;
        if(e.target.closest('[data-q]'))return;
        e.preventDefault();focusSongFromQueue(song.id);
      });
      setupQueueDrag(item,song);
      list.append(item);
    });
  }

  let pendingQueueTap=null;
  function requireSecondQueueTap(song,act,button){
    const key=`${song.id}:queue:${act}`;
    const now=Date.now();
    if(pendingQueueTap?.key===key && now-pendingQueueTap.time<=900){
      clearTimeout(pendingQueueTap.timer);
      pendingQueueTap=null;
      if(act==='played'){
        const wasPlayed=state.played.has(song.id);
        persistQueueStateMutation(song.id,wasPlayed?'unplay':'play').catch(()=>{});
      }else if(act==='remove'){
        persistQueueStateMutation(song.id,'remove').catch(()=>{});
      }
      return;
    }
    if(pendingQueueTap){
      clearTimeout(pendingQueueTap.timer);
    }
    const entry={key,time:now,button,timer:null};
    entry.timer=setTimeout(()=>{
      if(pendingQueueTap===entry) pendingQueueTap=null;
    },900);
    pendingQueueTap=entry;
  }


  const noteViewerState={scale:1,minScale:0.1,maxScale:8,x:0,y:0,pointers:new Map(),startDistance:0,startScale:1,startX:0,startY:0,originX:0,originY:0,lastTap:0};
  function resetNoteViewer(){
    Object.assign(noteViewerState,{scale:1,minScale:0.1,maxScale:8,x:0,y:0,startDistance:0,startScale:1,startX:0,startY:0,originX:0,originY:0,lastTap:0});
    noteViewerState.pointers.clear();
  }
  function applyNoteTransform(img){
    // El elemento parte siempre del centro real del visor. x/y son desplazamientos
    // relativos a ese centro, por lo que abrir Imagen nunca hereda una posición lateral.
    img.style.transform=`translate(-50%,-50%) translate3d(${noteViewerState.x}px,${noteViewerState.y}px,0) scale(${noteViewerState.scale})`;
  }
  function clampNotePosition(img){
    const stage=$('#viewerContent');
    // El visor permite mover libremente la hoja incluso cuando está alejada.
    // El margen amplio evita la sensación de que la imagen se "traba" al llegar al ajuste completo.
    const scaledW=img.clientWidth*noteViewerState.scale;
    const scaledH=img.clientHeight*noteViewerState.scale;
    const freeX=Math.max(stage.clientWidth*0.85,(scaledW+stage.clientWidth)/2);
    const freeY=Math.max(stage.clientHeight*0.85,(scaledH+stage.clientHeight)/2);
    noteViewerState.x=Math.max(-freeX,Math.min(freeX,noteViewerState.x));
    noteViewerState.y=Math.max(-freeY,Math.min(freeY,noteViewerState.y));
  }
  function setNoteScale(img,nextScale,centerX=0,centerY=0){
    const previous=noteViewerState.scale;
    const next=Math.max(noteViewerState.minScale,Math.min(noteViewerState.maxScale,nextScale));
    if(previous!==next){
      const ratio=next/previous;
      noteViewerState.x=centerX-(centerX-noteViewerState.x)*ratio;
      noteViewerState.y=centerY-(centerY-noteViewerState.y)*ratio;
      noteViewerState.scale=next;
      
      clampNotePosition(img);applyNoteTransform(img);
    }
  }
  function fitNoteViewer(img){
    const stage=$('#viewerContent');
    if(!stage||!img)return;
    requestAnimationFrame(()=>{
      const stageW=Math.max(1,stage.clientWidth),stageH=Math.max(1,stage.clientHeight);
      const baseW=Math.max(1,img.naturalWidth||img.width||img.offsetWidth||1);
      const baseH=Math.max(1,img.naturalHeight||img.height||img.offsetHeight||1);
      const margin=24;
      const fit=Math.max(.03,Math.min(1,(stageW-margin*2)/baseW,(stageH-margin*2)/baseH));
      noteViewerState.scale=fit;
      noteViewerState.minScale=Math.max(.02,fit*.2);
      noteViewerState.x=0;
      noteViewerState.y=0;
      applyNoteTransform(img);
    });
  }
  function installNoteGestures(img){
    const stage=$('#viewerContent');
    resetNoteViewer();
    stage.classList.add('is-note-viewer');
    img.classList.add('note-photo');
    img.draggable=false;
    img.style.position='absolute';
    img.style.left='50%';
    img.style.top='50%';
    fitNoteViewer(img);
    const distance=()=>{const [a,b]=[...noteViewerState.pointers.values()];return Math.hypot(a.x-b.x,a.y-b.y);};
    const midpoint=()=>{const [a,b]=[...noteViewerState.pointers.values()];return {x:(a.x+b.x)/2-stage.clientWidth/2,y:(a.y+b.y)/2-stage.clientHeight/2};};
    img.addEventListener('pointerdown',e=>{
      e.preventDefault();img.setPointerCapture(e.pointerId);noteViewerState.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(noteViewerState.pointers.size===1){noteViewerState.startX=e.clientX;noteViewerState.startY=e.clientY;noteViewerState.originX=noteViewerState.x;noteViewerState.originY=noteViewerState.y;}
      if(noteViewerState.pointers.size===2){noteViewerState.startDistance=distance();noteViewerState.startScale=noteViewerState.scale;}
    });
    img.addEventListener('pointermove',e=>{
      if(!noteViewerState.pointers.has(e.pointerId))return;e.preventDefault();noteViewerState.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(noteViewerState.pointers.size===2){const mid=midpoint();setNoteScale(img,noteViewerState.startScale*(distance()/Math.max(1,noteViewerState.startDistance)),mid.x,mid.y);}
      else if(noteViewerState.pointers.size===1){noteViewerState.x=noteViewerState.originX+(e.clientX-noteViewerState.startX);noteViewerState.y=noteViewerState.originY+(e.clientY-noteViewerState.startY);clampNotePosition(img);applyNoteTransform(img);}
    });
    const finish=e=>{noteViewerState.pointers.delete(e.pointerId);if(noteViewerState.pointers.size===1){const p=[...noteViewerState.pointers.values()][0];noteViewerState.startX=p.x;noteViewerState.startY=p.y;noteViewerState.originX=noteViewerState.x;noteViewerState.originY=noteViewerState.y;}clampNotePosition(img);applyNoteTransform(img);};
    img.addEventListener('pointerup',finish);img.addEventListener('pointercancel',finish);
    img.addEventListener('dblclick',e=>{e.preventDefault();setNoteScale(img,noteViewerState.scale>1?1:2,e.clientX-stage.getBoundingClientRect().left-stage.clientWidth/2,e.clientY-stage.getBoundingClientRect().top-stage.clientHeight/2);});
    stage.addEventListener('wheel',e=>{
      if(!stage.classList.contains('is-note-viewer'))return;
      e.preventDefault();
      const rect=stage.getBoundingClientRect();
      const factor=e.deltaY<0?1.12:0.88;
      setNoteScale(img,noteViewerState.scale*factor,e.clientX-rect.left-stage.clientWidth/2,e.clientY-rect.top-stage.clientHeight/2);
    },{passive:false,once:false});
  }

  function imageField(owner){ return owner==='daniel'?'notasDaniel':'notasElena'; }
  function songbookVisualField(owner){ return owner==='daniel'?'cancioneroDanielVisual':'cancioneroElenaVisual'; }
  function visualField(owner,mode='image'){ return mode==='songbook'?songbookVisualField(owner):imageField(owner); }
  function imageEditScope(owner,mode='image'){ return mode==='songbook'?`${owner}-songbook`:owner; }
  function imagePayload(song,owner){
    const value=song[imageField(owner)];
    let candidate='';
    if(value&&typeof value==='object') candidate=value.composite||value.dataUrl||value.src||value.original||value.archivo||value.file||value.ruta||'';
    else if(value) candidate=value;
    if(candidate) return candidate;
    if(owner==='elena'){
      const fallback=state.notes[slug(song.titulo)];
      return Array.isArray(fallback)?fallback[0]:fallback;
    }
    return '';
  }
  function stableTextHash(value){
    const text=String(value||'').replace(/\r\n?/g,'\n').trim();
    let hash=2166136261;
    for(let i=0;i<text.length;i++){
      hash^=text.charCodeAt(i);
      hash=Math.imul(hash,16777619);
    }
    return `txt-${(hash>>>0).toString(16)}-${text.length}`;
  }
  function importedElenaBoxId(songId){return `import-elena-${String(songId).replace(/[^a-zA-Z0-9_-]/g,'_')}`;}
  function initialImageSourceForSong(song,owner){
    const value=song?.[imageField(owner)];
    if(value&&typeof value==='object'){
      const candidate=value.originalSrc||value.original||value.dataUrl||value.src||'';
      if(candidate)return String(candidate);
    }else if(value)return String(value);
    if(owner==='elena'){
      const fallback=state.notes[slug(song?.titulo||'')];
      const raw=Array.isArray(fallback)?fallback[0]:fallback;
      if(raw){const v=String(raw);return v.startsWith('data:')||v.startsWith('http:')||v.startsWith('https:')||v.startsWith('assets/')?v:`assets/anotaciones/${v}`;}
    }
    return '';
  }
  function estimateSongbookTextHeightPx(box,canvasWidth=1000){
    const text=String(box?.text||'').replace(/\r\n?/g,'\n');
    const widthPx=Math.max(120,(Number(box?.w)||.88)*canvasWidth);
    const fontPx=Number(box?.fontRatio)>0?Number(box.fontRatio)*canvasWidth:Math.max(16,(Number(box?.size)||9)*3);
    const charsPerLine=Math.max(4,Math.floor(widthPx/Math.max(7,fontPx*.56)));
    let lines=0;
    for(const explicit of text.split('\n')){
      if(!explicit){lines+=1;continue;}
      const words=explicit.split(/\s+/).filter(Boolean);
      if(!words.length){lines+=1;continue;}
      let used=0;
      for(const word of words){
        const token=Math.max(1,word.length);
        if(token>charsPerLine){
          if(used)lines+=1;
          lines+=Math.floor(token/charsPerLine);
          used=token%charsPerLine;
        }else if(!used)used=token;
        else if(used+1+token<=charsPerLine)used+=1+token;
        else{lines+=1;used=token;}
      }
      if(used||!words.length)lines+=1;
    }
    return Math.max(fontPx*3.4,lines*fontPx*1.25+fontPx*.9);
  }
  function prepareSongbookLayout(textBoxes,operations=[],canvasWidth=1000,canvasHeight=1300){
    const width=Math.max(600,Number(canvasWidth)||1000);
    const oldHeight=Math.max(800,Number(canvasHeight)||1300);
    const sourceBoxes=Array.isArray(textBoxes)?textBoxes.map(box=>({...box})):[];
    const pixelBoxes=sourceBoxes.map(box=>{
      const top=(Number(box.y)||0)*oldHeight;
      const currentHeight=Math.max(30,(Number(box.h)||.12)*oldHeight);
      const needed=estimateSongbookTextHeightPx(box,width);
      return {box,top,height:Math.max(currentHeight,needed)};
    });
    let newHeight=oldHeight;
    for(const item of pixelBoxes)newHeight=Math.max(newHeight,item.top+item.height+70);
    newHeight=Math.max(1300,Math.ceil(newHeight/50)*50);
    const scaleY=oldHeight/newHeight;
    const boxes=pixelBoxes.map(({box,top,height})=>({...box,y:top/newHeight,h:height/newHeight}));
    const ops=(Array.isArray(operations)?operations:[]).map(op=>({...op,points:Array.isArray(op.points)?op.points.map(point=>({...point,y:(Number(point.y)||0)*scaleY})):[]}));
    return {canvasWidth:width,canvasHeight:newHeight,textBoxes:boxes,operations:ops};
  }
  function importedTextBoxHeight(text){
    return Math.max(.18,estimateSongbookTextHeightPx({text,w:.88,size:9},1000)/1300);
  }
  async function syncElenaSongTextToImageEdit(song,previousText=''){
    if(!song?.id)return null;
    const text=String(song.cancioneroElena||'').replace(/\r\n?/g,'\n').trim();
    const previous=String(previousText||'').replace(/\r\n?/g,'\n').trim();
    const editId=remoteImageKey(song.id,'elena','songbook');
    const existing=await loadRemoteImageEdit(song.id,'elena','songbook')||await offlineStoreGet('imageEdits',editId)||null;
    const boxes=Array.isArray(existing?.textBoxes)?existing.textBoxes.map(box=>({...box})):[];
    const boxId=importedElenaBoxId(song.id);
    const index=boxes.findIndex(box=>box.id===boxId||box.importSource==='cancioneroElena');
    const newHash=stableTextHash(text);
    const oldHash=index>=0?String(boxes[index].importHash||''):stableTextHash(previous);

    // Si el campo no cambió y ya existe la caja importada, no sobrescribir
    // posibles ajustes hechos dentro del editor visual.
    if(text&&index>=0&&oldHash===newHash)return existing;

    if(!text){
      if(index<0)return existing;
      boxes.splice(index,1);
    }else{
      const current=index>=0?boxes[index]:null;
      const box={
        ...(current||{}),
        id:boxId,
        importSource:'cancioneroElena',
        importHash:newHash,
        x:Number.isFinite(Number(current?.x))?Number(current.x):.06,
        y:Number.isFinite(Number(current?.y))?Number(current.y):.06,
        w:Number.isFinite(Number(current?.w))?Number(current.w):.88,
        h:current&&Number.isFinite(Number(current.h))?Number(current.h):importedTextBoxHeight(text),
        rotation:Number(current?.rotation)||0,
        text,
        html:escapeTextHtml(text),
        color:current?.color||'#111111',
        size:Number(current?.size)||9,
        fontRatio:Number(current?.fontRatio)||0,
        bold:false,
        italic:false,
        align:['left','center','right'].includes(current?.align)?current.align:'center',
        locked:true
      };
      if(index>=0)boxes[index]=box;else boxes.unshift(box);
    }

    const layout=prepareSongbookLayout(boxes,existing?.operations,existing?.canvasWidth||1000,existing?.canvasHeight||1300);
    const stamp=Date.now();
    const metadata={
      editId,
      songId:song.id,
      owner:'elena',
      mode:'songbook',
      originalSrc:'',
      canvasWidth:layout.canvasWidth,
      canvasHeight:layout.canvasHeight,
      operations:layout.operations,
      textBoxes:layout.textBoxes.map(serializeImageTextBox),
      updatedAt:stamp,
      format:'vector-v4',
      source:'imageEdits',
      pendingSync:true
    };
    await offlineStorePut('imageEdits',metadata);
    await offlineStorePut('pendingSync',metadata);
    song.cancioneroElenaVisual={original:'',canvasWidth:metadata.canvasWidth,canvasHeight:metadata.canvasHeight,operations:metadata.operations,textBoxes:metadata.textBoxes,updatedAt:stamp,pendingSync:true};

    if(navigator.onLine){
      try{
        await initRemoteSync();
        const ref=remoteImageRef(song.id,'elena','songbook');
        if(ref&&remoteSetDoc){
          const remotePayload={...metadata,pendingSync:false,syncedAt:Date.now()};
          await remoteSetDoc(ref,remotePayload,{merge:false});
          await offlineStorePut('imageEdits',remotePayload);
          await offlineStoreDelete('pendingSync',editId);
          song.cancioneroElenaVisual={original:'',canvasWidth:remotePayload.canvasWidth,canvasHeight:remotePayload.canvasHeight,operations:remotePayload.operations,textBoxes:remotePayload.textBoxes,updatedAt:stamp,remote:true};
          return remotePayload;
        }
      }catch(err){console.warn('Texto Elena guardado localmente; sincronización pendiente',err);}
    }
    return metadata;
  }

  function importedDanielBoxId(songId){return `import-daniel-${String(songId).replace(/[^a-zA-Z0-9_-]/g,'_')}`;}
  async function syncDanielSongTextToImageEdit(song,previousText=''){
    if(!song?.id)return null;
    const text=String(song.cancioneroDaniel||'').replace(/\r\n?/g,'\n').trim();
    const previous=String(previousText||'').replace(/\r\n?/g,'\n').trim();
    const editId=remoteImageKey(song.id,'daniel','songbook');
    const existing=await loadRemoteImageEdit(song.id,'daniel','songbook')||await offlineStoreGet('imageEdits',editId)||null;
    const boxes=Array.isArray(existing?.textBoxes)?existing.textBoxes.map(box=>({...box})):[];
    const boxId=importedDanielBoxId(song.id);
    const index=boxes.findIndex(box=>box.id===boxId||box.importSource==='cancioneroDaniel');
    const newHash=stableTextHash(text);
    const oldHash=index>=0?String(boxes[index].importHash||''):stableTextHash(previous);

    if(text&&index>=0&&oldHash===newHash)return existing;

    if(!text){
      if(index<0)return existing;
      boxes.splice(index,1);
    }else{
      const current=index>=0?boxes[index]:null;
      const box={
        ...(current||{}),
        id:boxId,
        importSource:'cancioneroDaniel',
        importHash:newHash,
        x:Number.isFinite(Number(current?.x))?Number(current.x):.06,
        y:Number.isFinite(Number(current?.y))?Number(current.y):.06,
        w:Number.isFinite(Number(current?.w))?Number(current.w):.88,
        h:current&&Number.isFinite(Number(current.h))?Number(current.h):importedTextBoxHeight(text),
        rotation:Number(current?.rotation)||0,
        text,
        html:escapeTextHtml(text),
        color:current?.color||'#111111',
        size:Number(current?.size)||9,
        fontRatio:Number(current?.fontRatio)||0,
        bold:false,
        italic:false,
        align:['left','center','right'].includes(current?.align)?current.align:'center',
        locked:true
      };
      if(index>=0)boxes[index]=box;else boxes.unshift(box);
    }

    const layout=prepareSongbookLayout(boxes,existing?.operations,existing?.canvasWidth||1000,existing?.canvasHeight||1300);
    const stamp=Date.now();
    const metadata={
      editId,
      songId:song.id,
      owner:'daniel',
      mode:'songbook',
      originalSrc:'',
      canvasWidth:layout.canvasWidth,
      canvasHeight:layout.canvasHeight,
      operations:layout.operations,
      textBoxes:layout.textBoxes.map(serializeImageTextBox),
      updatedAt:stamp,
      format:'vector-v4',
      source:'imageEdits',
      pendingSync:true
    };
    await offlineStorePut('imageEdits',metadata);
    await offlineStorePut('pendingSync',metadata);
    song.cancioneroDanielVisual={original:'',canvasWidth:metadata.canvasWidth,canvasHeight:metadata.canvasHeight,operations:metadata.operations,textBoxes:metadata.textBoxes,updatedAt:stamp,pendingSync:true};

    if(navigator.onLine){
      try{
        await initRemoteSync();
        const ref=remoteImageRef(song.id,'daniel','songbook');
        if(ref&&remoteSetDoc){
          const remotePayload={...metadata,pendingSync:false,syncedAt:Date.now()};
          await remoteSetDoc(ref,remotePayload,{merge:false});
          await offlineStorePut('imageEdits',remotePayload);
          await offlineStoreDelete('pendingSync',editId);
          song.cancioneroDanielVisual={original:'',canvasWidth:remotePayload.canvasWidth,canvasHeight:remotePayload.canvasHeight,operations:remotePayload.operations,textBoxes:remotePayload.textBoxes,updatedAt:stamp,remote:true};
          return remotePayload;
        }
      }catch(err){console.warn('Texto Daniel guardado localmente; sincronización pendiente',err);}
    }
    return metadata;
  }

  function imageCandidates(song,owner){
    const candidates=[];
    const add=value=>{
      if(!value) return;
      const raw=String(value);
      if(raw.startsWith('blob:')) return;
      const src=raw.startsWith('data:')||raw.startsWith('http:')||raw.startsWith('https:')||raw.startsWith('assets/')
        ? raw
        : `assets/anotaciones/${raw}`;
      if(!candidates.includes(src)) candidates.push(src);
    };
    add(imagePayload(song,owner));
    if(owner==='elena'){
      const fallback=state.notes[slug(song.titulo)];
      (Array.isArray(fallback)?fallback:[fallback]).forEach(add);
    }
    return candidates;
  }


  function wrapCanvasTextLines(ctx,text,maxWidth){
    const width=Math.max(1,Number(maxWidth)||1);
    const lines=[];
    const splitLongToken=token=>{
      const chunks=[];
      let current='';
      for(const char of Array.from(String(token||''))){
        const test=current+char;
        if(current&&ctx.measureText(test).width>width){chunks.push(current);current=char;}
        else current=test;
      }
      if(current||!chunks.length)chunks.push(current);
      return chunks;
    };
    for(const paragraph of String(text??'').split(/\n/)){
      if(paragraph===''){lines.push('');continue;}
      const words=paragraph.trim().split(/\s+/).filter(Boolean);
      if(!words.length){lines.push('');continue;}
      let line='';
      for(const word of words){
        const candidate=line?`${line} ${word}`:word;
        if(ctx.measureText(candidate).width<=width){line=candidate;continue;}
        if(line){lines.push(line);line='';}
        if(ctx.measureText(word).width<=width){line=word;continue;}
        const chunks=splitLongToken(word);
        chunks.forEach((chunk,index)=>{
          if(index<chunks.length-1)lines.push(chunk);
          else line=chunk;
        });
      }
      if(line)lines.push(line);
    }
    return lines;
  }

  function drawWrappedCanvasText(ctx,text,{x=0,y=0,maxWidth=1,maxHeight=Infinity,lineHeight=20}={}){
    let yy=y;
    for(const line of wrapCanvasTextLines(ctx,text,maxWidth)){
      if(yy+lineHeight>y+maxHeight+0.5)break;
      ctx.fillText(line,x,yy);
      yy+=lineHeight;
    }
    return yy;
  }

  async function composeRemoteImageEdit(remote,song,owner,mode='image'){
    // Cancionero (Elena/Daniel) comparte el motor visual, pero nunca la foto de Imagen.
    const src=mode==='songbook'
      ? (remote?.originalSrc||remote?.original||'')
      : (remote?.originalSrc||remote?.original||imageCandidates(song,owner)[0]||'');
    const paintComposition=(img=null)=>{
      try{
        const c=document.createElement('canvas');
        let composition=remote||{};
        if(mode==='songbook')composition={...composition,...prepareSongbookLayout(composition.textBoxes,composition.operations,composition.canvasWidth||1000,composition.canvasHeight||1300)};
        if(img&&img.naturalWidth&&img.naturalHeight){
          const ratio=Math.min(1,1800/Math.max(1,img.naturalWidth),2400/Math.max(1,img.naturalHeight));
          c.width=Math.max(1,Math.round(img.naturalWidth*ratio));
          c.height=Math.max(1,Math.round(img.naturalHeight*ratio));
        }else if(mode==='songbook'){
          c.width=Math.max(600,Number(composition.canvasWidth)||1000);
          c.height=Math.max(1300,Number(composition.canvasHeight)||1300);
        }else{
          c.width=1000;c.height=1300;
        }
        const ctx=c.getContext('2d');
        ctx.fillStyle='#ffffff';ctx.fillRect(0,0,c.width,c.height);
        if(img)ctx.drawImage(img,0,0,c.width,c.height);
        const overlay=document.createElement('canvas');overlay.width=c.width;overlay.height=c.height;const oc=overlay.getContext('2d');
        const arrowHead=(target,tip,from,size)=>{const angle=Math.atan2(tip.y-from.y,tip.x-from.x),len=Math.max(12,size*3.2),spread=Math.PI/6;target.beginPath();target.moveTo(tip.x,tip.y);target.lineTo(tip.x-len*Math.cos(angle-spread),tip.y-len*Math.sin(angle-spread));target.moveTo(tip.x,tip.y);target.lineTo(tip.x-len*Math.cos(angle+spread),tip.y-len*Math.sin(angle+spread));target.stroke();};
        for(const op of composition?.operations||[]){
          const target=op.tool==='eraser'&&op.target==='photo'?ctx:oc;
          const pts=(op.points||[]).map(p=>({x:p.x*c.width,y:p.y*c.height}));
          if(pts.length<2)continue;
          target.save();target.lineCap='round';target.lineJoin='round';target.lineWidth=Math.max(1,(op.size||.008)*c.width);target.strokeStyle=op.color||'#d00000';target.globalCompositeOperation=op.tool==='eraser'?'destination-out':'source-over';target.beginPath();target.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)target.lineTo(pts[i].x,pts[i].y);target.stroke();if(op.tool==='pencil'&&op.mode&&op.mode!=='free'){arrowHead(target,pts.at(-1),pts.at(-2),target.lineWidth);if(op.mode==='double-arrow')arrowHead(target,pts[0],pts[1],target.lineWidth);}target.restore();
        }
        ctx.drawImage(overlay,0,0);
        for(const box of (Array.isArray(composition?.textBoxes)?composition.textBoxes:[])){
          if(!String(box.text||'').trim())continue;
          ctx.save();
          const x=(Number(box.x)||0)*c.width,y=(Number(box.y)||0)*c.height,bw=Math.max(40,(Number(box.w)||.25)*c.width),bh=Math.max(30,(Number(box.h)||.12)*c.height);
          ctx.translate(x+bw/2,y+bh/2);ctx.rotate((Number(box.rotation)||0)*Math.PI/180);ctx.translate(-bw/2,-bh/2);
          const fontSize=Number(box.fontRatio)>0?Number(box.fontRatio)*c.width:Math.max(16,(Number(box.size)||9)*3)*(c.width/1200);
          ctx.fillStyle=box.color||'#d00000';ctx.font=`${box.italic?'italic ':''}${box.bold?'700':'400'} ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;ctx.textBaseline='top';const align=['left','center','right'].includes(box.align)?box.align:'left';ctx.textAlign=align;const textX=align==='left'?0:align==='center'?bw/2:bw;
          const lineHeight=fontSize*1.25,maxWidth=Math.max(fontSize*2,bw);
          drawWrappedCanvasText(ctx,box.text||'',{x:textX,y:0,maxWidth,maxHeight:bh,lineHeight});
          ctx.restore();
        }
        return c;
      }catch(err){console.warn('No se pudo componer la vista de imagen',err);return '';}
    };
    if(!src)return paintComposition(null);
    return await new Promise(resolve=>{
      const img=new Image();
      img.onload=()=>resolve(paintComposition(img));
      img.onerror=()=>resolve(paintComposition(null));
      img.src=src.startsWith('data:')?src:encodeURI(src);
    });
  }
  function showViewerImage(content,src,song){
    if(!src)return false;
    content.innerHTML='';content.classList.add('is-note-viewer');
    const img=new Image();img.alt=`Imagen de ${song.titulo}`;img.addEventListener('load',()=>installNoteGestures(img),{once:true});img.addEventListener('error',()=>{content.classList.remove('is-note-viewer');content.innerHTML='<div class="viewer-empty"><h3>No se pudo abrir la foto</h3><p>La imagen guardada no pudo cargarse.</p></div>';},{once:true});img.src=src;content.append(img);return true;
  }
  function showViewerCanvas(content,canvas,song){
    if(!(canvas instanceof HTMLCanvasElement))return false;
    content.innerHTML='';content.classList.add('is-note-viewer');
    canvas.classList.add('note-photo');
    canvas.setAttribute('role','img');
    canvas.setAttribute('aria-label',`Imagen de ${song.titulo}`);
    content.append(canvas);
    requestAnimationFrame(()=>installNoteGestures(canvas));
    return true;
  }
  async function showComposedViewerEdit(content,edit,song,owner,mode='image'){
    if(!edit||typeof edit!=='object')return false;
    if((Array.isArray(edit.operations)&&edit.operations.length)||Array.isArray(edit.textBoxes)||edit.originalSrc||edit.original){
      const canvas=await composeRemoteImageEdit(edit,song,owner,mode);
      if(canvas)return showViewerCanvas(content,canvas,song);
    }
    if(edit.composite)return showViewerImage(content,edit.composite,song);
    return false;
  }
  function openViewer(song,type,preferredEdit=null){
    const renderGeneration=++viewerRenderGeneration;
    activeViewerSongId=song.id;activeViewerType=type;
    const label=type==='notes'?'Imagen':type==='daniel-image'?'Imagen Daniel':type==='daniel'?'Daniel':'Letra';
    $('#viewerTitle').textContent=`${label} · ${song.titulo}`;
    const content=$('#viewerContent');content.innerHTML='';content.classList.remove('is-note-viewer');
    if(type==='notes'||type==='daniel-image'||type==='lyrics'||type==='daniel'){
      // 6.36.71.2 · Elena deja de usar el visor antiguo de texto. El botón
      // Letra abre el mismo visor vectorial que Imagen, sobre lienzo blanco
      // cuando no existe fotografía ni capas guardadas.
      const owner=(type==='daniel-image'||type==='daniel')?'daniel':'elena',viewerMode=(type==='lyrics'||type==='daniel')?'songbook':'image',raw=preferredEdit||song[visualField(owner,viewerMode)];
      let rendered=false;
      // 6.36.34 · Si no existe una foto, el visor muestra un lienzo blanco editable.
      // El mismo lienzo se usa como base al mantener pulsado “Editar imagen”.
      const renderBlankCanvas=async()=>{
        if(rendered)return;
        const blankCanvas=await composeRemoteImageEdit({originalSrc:'',operations:[],textBoxes:[]},song,owner,viewerMode);
        if(blankCanvas){rendered=showViewerCanvas(content,blankCanvas,song);return;}
        content.classList.remove('is-note-viewer');
        content.innerHTML='<div class="viewer-empty viewer-blank-canvas" aria-label="Lienzo blanco editable"></div>';
        rendered=true;
      };
      const renderFallback=()=>{
        if(rendered)return;
        const files=viewerMode==='songbook'?[]:imageCandidates(song,owner);
        if(!files.length){void renderBlankCanvas();return;}
        content.innerHTML='';content.classList.add('is-note-viewer');
        const img=new Image();img.alt=`Notas de ${song.titulo}`;let fileIndex=0;
        const tryNext=()=>{
          if(fileIndex>=files.length){content.innerHTML='';void renderBlankCanvas();return;}
          const src=files[fileIndex++];img.src=src.startsWith('data:')?src:encodeURI(src);
        };
        img.addEventListener('load',()=>{rendered=true;installNoteGestures(img);},{once:true});
        img.addEventListener('error',tryNext);
        content.append(img);tryNext();
      };
      content.innerHTML='<div class="viewer-empty"><p>Cargando imagen…</p></div>';
      // Mostrar inmediatamente la copia que ya está en memoria. La consulta
      // remota queda solo como actualización posterior y nunca debe dejar el visor
      // mostrando la versión anterior después de guardar.
      if(raw&&typeof raw==='object'){
        const immediate={...raw,originalSrc:raw.originalSrc||raw.original||'',operations:Array.isArray(raw.operations)?raw.operations:[],textBoxes:Array.isArray(raw.textBoxes)?raw.textBoxes:[]};
        void showComposedViewerEdit(content,immediate,song,owner,viewerMode).then(ok=>{if(renderGeneration!==viewerRenderGeneration)return;if(ok)rendered=true;});
      }
      loadRemoteImageEdit(song.id,owner,viewerMode).then(async remote=>{
        if(renderGeneration!==viewerRenderGeneration)return;
        const localUpdated=Number((raw&&typeof raw==='object'&&raw.updatedAt)||0);
        const remoteUpdated=Number(remote?.updatedAt||0);
        // No reemplazar una edición recién guardada por una respuesta remota vieja.
        if(remote&&remoteUpdated>=localUpdated){
          const ok=await showComposedViewerEdit(content,remote,song,owner,viewerMode);
          if(renderGeneration!==viewerRenderGeneration)return;
          if(ok){rendered=true;song[visualField(owner,viewerMode)]={original:viewerMode==='songbook'?'':(remote.originalSrc||remote.original||''),canvasWidth:remote.canvasWidth||1000,canvasHeight:remote.canvasHeight||1300,operations:Array.isArray(remote.operations)?remote.operations:[],textBoxes:Array.isArray(remote.textBoxes)?remote.textBoxes:[],updatedAt:remote.updatedAt||Date.now(),remote:true};return;}
        }
        if(renderGeneration===viewerRenderGeneration&&!rendered)renderFallback();
      }).catch(err=>{console.warn('No se pudo actualizar el visor desde imageEdits',err);if(renderGeneration===viewerRenderGeneration&&!rendered)renderFallback();});
    } else {
      const isDaniel=type==='daniel';
      const storedLyrics=state.lyrics[song.id]||{};
      const html=isDaniel ? (song.cancioneroDaniel || song.danielLyrics || song.letraDaniel || '') : (song.elenaLyrics || song.cancioneroElena || song.letraElena || storedLyrics.escenarioHtml || storedLyrics.publicaHtml || '');
      if(html){const page=document.createElement('article');page.className='live-songbook-page';page.innerHTML=html;content.append(page);}
      else content.innerHTML=`<div class="viewer-empty"><h3>Sin contenido disponible</h3><p>Esta canción todavía no tiene contenido en el Cancionero ${isDaniel?'Daniel':'Elena'}.</p></div>`;
    }
    $('#viewerDialog').showModal();
  }

  function askConfirm(title,text,onAccept,acceptLabel='Confirmar'){
    state.pendingConfirm=onAccept;$('#confirmTitle').textContent=title;$('#confirmText').textContent=text;$('#confirmAccept').textContent=acceptLabel;$('#confirmDialog').showModal();
  }
  $('#confirmAccept').addEventListener('click',()=>{const fn=state.pendingConfirm;state.pendingConfirm=null;$('#confirmDialog').close();fn?.();});
  $('#confirmCancel').addEventListener('click',()=>{$('#confirmDialog').close();state.pendingConfirm=null;});

  function dialogSnapshot(dialog){
    const fields=$$('input, select, textarea',dialog).map(el=>{
      if(el.type==='file') return `${el.id}:file:${el.files?.[0]?.name||''}`;
      if(el.type==='checkbox'||el.type==='radio') return `${el.id||el.name||el.value}:${el.checked}`;
      return `${el.id||el.name}:${el.value}`;
    });
    if(dialog.id==='newSongDialog') fields.push(`photo:${state.newSongElenaNotes?.dataUrl||''}`);
    if(dialog.id==='editSongDialog') fields.push(`photo:${state.editSongElenaNotes?.dataUrl||state.editSongElenaNotes?.src||''}`);
    if(dialog.id==='songbookEditorDialog'){ fields.push(`html:${$('#songbookEditor').innerHTML}`); fields.push(`drawing:${state.songbookDrawingData||''}`); }
    if(dialog.id==='imageEditorDialog') fields.push(`image-revision:${imageEditorChangeRevision}`);
    return JSON.stringify(fields);
  }
  function rememberDialogState(dialog){dialogBaselines.set(dialog,dialogSnapshot(dialog));}
  function dialogHasUnsavedChanges(dialog){
    if(!trackedDialogIds.has(dialog.id)) return false;
    if(dialog.id==='imageEditorDialog') return imageEditorChangeRevision!==imageEditorSavedRevision;
    return dialogBaselines.get(dialog)!==dialogSnapshot(dialog);
  }
  function closeDialogDirect(dialog){dialog.close();dialogBaselines.delete(dialog);}
  function requestDialogClose(dialog){
    if(!dialogHasUnsavedChanges(dialog)) return closeDialogDirect(dialog);
    askConfirm('Hay cambios sin guardar','¿Deseas salir sin guardar?',()=>closeDialogDirect(dialog),'Salir sin guardar');
  }
  $$('[data-dialog-close]').forEach(btn=>btn.addEventListener('click',()=>{
    const dialog=btn.closest('dialog');
    if(dialog.id==='confirmDialog'){dialog.close();state.pendingConfirm=null;return;}
    if(dialog.id==='viewerDialog'){closeDialogDirect(dialog);return;}
    requestDialogClose(dialog);
  }));
  $$('dialog').forEach(d=>{
    d.addEventListener('click',e=>{if(e.target===d)e.preventDefault();});
    d.addEventListener('cancel',e=>{e.preventDefault();if(trackedDialogIds.has(d.id))requestDialogClose(d);});
  });
  $$('.menu-options button').forEach(btn=>btn.addEventListener('click',()=>{
    $('#toolsMenu').close();
    $('#openMenuBtn').setAttribute('aria-expanded','false');
    if(btn.dataset.module==='new-song') return openNewSong();
    if(btn.dataset.module==='repertoires') return openRepertoires();
    if(btn.dataset.module==='edit-songs') return openEditSongs();
    if(btn.dataset.module==='songbook-elena') return openSongbookList('elena');
    if(btn.dataset.module==='songbook-daniel') return openSongbookList('daniel');
    if(btn.dataset.module==='export-contacts') return openExportContacts();
    if(btn.dataset.module==='upload-photos') return openPhotoManager();
    if(btn.id==='openAuxMonitorsBtn') return;
    if(btn.dataset.module==='security') return openSecurityAuth();
    $('#noticeTitle').textContent=btn.dataset.placeholder;
    $('#noticeDialog').showModal();
  }));
  $('#openMenuBtn').addEventListener('click',()=>{
    $('#toolsMenu').showModal();
    $('#openMenuBtn').setAttribute('aria-expanded','true');
  });
  $('#closeMenuBtn').addEventListener('click',()=>{
    $('#toolsMenu').close();
    $('#openMenuBtn').setAttribute('aria-expanded','false');
  });


  const defaultGenres=['Blues','Jazz','Rock','Pop','Reggae','Soul','Latino','Balada'];
  function allRepertoires(){
    const map=new Map([['todas','Todas las canciones']]);
    state.customRepertoires.forEach(r=>map.set(r.id,r.name));
    state.songs.forEach(song=>(song.listas||[]).forEach(id=>{if(!map.has(id))map.set(id,titleFromId(id));}));
    return [...map].map(([id,name])=>({id,name})).sort((a,b)=>{
      if(a.id==='todas') return 1;
      if(b.id==='todas') return -1;
      return a.name.localeCompare(b.name,'es');
    });
  }
  function openNewSong(){
    $('#newSongForm').reset();
    clearElenaNotesSelection();
    $('#newSongGenres').innerHTML=defaultGenres.map(g=>`<label class="check-item"><input type="checkbox" value="${esc(g)}">${esc(g)}</label>`).join('');
    $('#newSongRepertoires').innerHTML=allRepertoires().map(r=>`<label class="check-item"><input type="checkbox" value="${esc(r.id)}" ${r.id==='todas'?'checked disabled':''}>${esc(r.name)}</label>`).join('');
    $('#newSongDialog').showModal();
    rememberDialogState($('#newSongDialog'));
  }
  const elenaNotesInput=$('#newSongElenaNotes');
  $('#chooseElenaNotesBtn').addEventListener('click',()=>elenaNotesInput.click());
  $('#removeElenaNotesBtn').addEventListener('click',clearElenaNotesSelection);
  elenaNotesInput.addEventListener('change',async()=>{
    const file=elenaNotesInput.files?.[0];
    if(!file) return clearElenaNotesSelection();
    if(!isPhotoFile(file)){clearElenaNotesSelection();return toast('Selecciona un archivo de imagen');}
    $('#elenaNotesFileName').textContent=file.name;
    try{
      const dataUrl=await normalizePhoto(file);
      state.newSongElenaNotes={name:file.name,type:file.type||'image/*',dataUrl};
      $('#elenaNotesPreviewImage').src=dataUrl;
      $('#elenaNotesPreview').hidden=false;
      $('#removeElenaNotesBtn').hidden=false;
    }catch(err){
      console.error(err);clearElenaNotesSelection();toast('No se pudo leer la imagen');
    }
  });
  function isPhotoFile(file){
    return file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|avif|gif|bmp|tiff?)$/i.test(file.name);
  }
  function clearElenaNotesSelection(){
    state.newSongElenaNotes=null;
    if(elenaNotesInput) elenaNotesInput.value='';
    $('#elenaNotesFileName').textContent='Ninguna foto seleccionada';
    $('#elenaNotesPreview').hidden=true;
    $('#elenaNotesPreviewImage').removeAttribute('src');
    $('#removeElenaNotesBtn').hidden=true;
  }
  function readAsDataURL(file){
    return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
  }
  async function normalizePhoto(file){
    const original=await readAsDataURL(file);
    return new Promise(resolve=>{
      const img=new Image();
      img.onload=()=>{
        const max=1800,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
        const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
        try{resolve(canvas.toDataURL('image/jpeg',.86));}catch(_){resolve(original);}
      };
      img.onerror=()=>resolve(original);
      img.src=original;
    });
  }

  $$('.lyric-input').forEach(field=>field.addEventListener('paste',e=>{
    e.preventDefault();
    const text=(e.clipboardData||window.clipboardData).getData('text/plain').replace(/\r\n?/g,'\n');
    const start=field.selectionStart,end=field.selectionEnd;
    field.setRangeText(text,start,end,'end');
    field.dispatchEvent(new Event('input',{bubbles:true}));
  }));

  $('#newSongForm').addEventListener('submit',e=>{
    e.preventDefault();
    const title=$('#newSongTitle').value.trim(),artist=$('#newSongArtist').value.trim();
    if(!title||!artist)return toast('Completa título y artista');
    const duplicate=state.songs.some(s=>norm(s.titulo)===norm(title)&&norm(s.artista)===norm(artist));
    if(duplicate)return toast('Esta canción ya existe');
    const genres=$$('#newSongGenres input:checked').map(x=>x.value);
    const lists=['todas',...$$('#newSongRepertoires input:checked:not([value="todas"])').map(x=>x.value)];
    const song={
      id:`custom-${Date.now()}`,
      titulo:title,
      artista:artist,
      idioma:$('#newSongLanguage').value,
      generos:genres,
      listas:[...new Set(lists)],
      letraPublica:$('#newSongPublicLyrics').value.trim(),
      cancioneroElena:$('#newSongElenaLyrics').value.trim(),
      notasElena:state.newSongElenaNotes,
      cancioneroDaniel:$('#newSongDanielLyrics').value.trim(),notasDaniel:state.newSongDanielNotes
    };
    askConfirm('Guardar nueva canción',`Se añadirá “${title}” a la base de canciones.`,async()=>{
      song._sourceIndex=Math.max(-1,...state.songs.map(x=>Number(x._sourceIndex)||0))+1;state.customSongs.push(song);state.songs.push(song);sortMasterSongs();state.customSongs.sort((a,b)=>a.numero-b.numero);try{saveLibraryState();}catch(err){state.customSongs=state.customSongs.filter(s=>s.id!==song.id);state.songs=state.songs.filter(s=>s.id!==song.id);sortMasterSongs();return toast('La foto es demasiado pesada para guardarla. Prueba una imagen más pequeña.');}
      try{await syncElenaSongTextToImageEdit(song,'');}catch(err){console.error(err);toast('Canción guardada; la caja de Elena quedó pendiente');}
      try{await syncDanielSongTextToImageEdit(song,'');}catch(err){console.error(err);toast('Canción guardada; la caja de Daniel quedó pendiente');}
      buildRepertoires();dialogBaselines.delete($('#newSongDialog'));$('#newSongDialog').close();clearElenaNotesSelection();toast('Guardado exitosamente');
      if(state.config)filterSongs();
    },'Guardar');
  });
  function openEditSongs(){
    $('#editSongsSearch').value='';
    renderEditSongsList();
    $('#editSongsDialog').showModal();
  }
  $('#editSongsSearch').addEventListener('input',renderEditSongsList);
  function renderEditSongsList(){
    const q=norm($('#editSongsSearch').value), list=$('#editSongsList');
    const songs=state.songs.filter(song=>!q||norm(song.titulo).includes(q)||norm(song.artista).includes(q));
    $('#editSongsCount').textContent=`${songs.length} canciones`;
    list.innerHTML='';
    songs.forEach(song=>{
      const row=document.createElement('div');row.className='edit-song-row';
      row.innerHTML=`<span class="edit-song-number">${String(song.numero||'').padStart(2,'0')}</span><div><strong>${esc(song.titulo)}</strong><small>${esc(song.artista||'Artista no indicado')}</small></div><button type="button" class="secondary-btn">Editar</button>`;
      row.querySelector('button').addEventListener('click',()=>openEditSong(song.id));
      list.append(row);
    });
    if(!songs.length) list.innerHTML='<div class="viewer-empty"><h3>No se encontraron canciones</h3></div>';
  }
  function openEditSong(id){
    const song=state.songs.find(s=>s.id===id);if(!song)return;
    $('#editSongId').value=id;$('#editSongTitle').value=song.titulo||'';$('#editSongArtist').value=song.artista||'';
    $('#editSongLanguage').value=song.idioma||'Español';
    const songGenres=Array.isArray(song.generos)?song.generos:[];
    const genres=[...new Set([...defaultGenres,...songGenres])];
    const selectedGenres=new Set(songGenres.map(norm));
    $('#editSongGenres').innerHTML=genres.map(g=>`<label class="check-item"><input type="checkbox" value="${esc(g)}" ${selectedGenres.has(norm(g))?'checked':''}>${esc(g)}</label>`).join('');
    const rawLists=Array.isArray(song.listas)?song.listas:[];
    const selectedLists=new Set(rawLists.map(norm));
    $('#editSongRepertoires').innerHTML=allRepertoires().map(r=>{
      const assigned=r.id==='todas'||selectedLists.has(norm(r.id))||selectedLists.has(norm(r.name));
      return `<label class="check-item"><input type="checkbox" value="${esc(r.id)}" ${assigned?'checked':''} ${r.id==='todas'?'disabled':''}>${esc(r.name)}</label>`;
    }).join('');
    $('#editSongPublicLyrics').value=song.letraPublica||'';$('#editSongElenaLyrics').value=song.cancioneroElena||'';$('#editSongDanielLyrics').value=song.cancioneroDaniel||'';state.editSongDanielNotes=song.notasDaniel||null;
    state.editSongElenaNotes=song.notasElena ? structuredClone(song.notasElena) : null;
    refreshEditNotesPreview(song);
    $('#editSongDialog').showModal();rememberDialogState($('#editSongDialog'));
  }
  const editNotesInput=$('#editSongElenaNotes');
  $('#chooseEditElenaNotesBtn').addEventListener('click',()=>editNotesInput.click());
  $('#removeEditElenaNotesBtn').addEventListener('click',()=>{state.editSongElenaNotes=null;editNotesInput.value='';refreshEditNotesPreview();});
  editNotesInput.addEventListener('change',async()=>{
    const file=editNotesInput.files?.[0];if(!file)return;
    if(!isPhotoFile(file)){editNotesInput.value='';return toast('Selecciona un archivo de imagen');}
    try{state.editSongElenaNotes={name:file.name,type:file.type||'image/*',dataUrl:await normalizePhoto(file)};refreshEditNotesPreview();}
    catch(err){console.error(err);toast('No se pudo leer la imagen');}
  });
  function refreshEditNotesPreview(song){
    const note=state.editSongElenaNotes;let src=note?.dataUrl||note?.src||'';
    if(!src && song){const key=slug(song.titulo);let file=state.notes[key];if(Array.isArray(file))file=file[0];if(file)src=`assets/anotaciones/${file}`;}
    $('#editElenaNotesFileName').textContent=note?.name|| (src?'Imagen actual':'Sin imagen');
    $('#removeEditElenaNotesBtn').hidden=!src;
    $('#editElenaNotesPreview').hidden=!src;
    if(src)$('#editElenaNotesPreviewImage').src=src;else $('#editElenaNotesPreviewImage').removeAttribute('src');
  }
  $('#editSongForm').addEventListener('submit',e=>{
    e.preventDefault();const id=$('#editSongId').value,song=state.songs.find(s=>s.id===id);if(!song)return;
    const title=$('#editSongTitle').value.trim(),artist=$('#editSongArtist').value.trim();if(!title||!artist)return toast('Completa título y artista');
    const duplicate=state.songs.some(s=>s.id!==id&&norm(s.titulo)===norm(title)&&norm(s.artista)===norm(artist));if(duplicate)return toast('Esta canción ya existe');
    const updated={...song,titulo:title,artista:artist,idioma:$('#editSongLanguage').value,generos:$$('#editSongGenres input:checked').map(x=>x.value),listas:[...new Set(['todas',...$$('#editSongRepertoires input:checked:not([value="todas"])').map(x=>x.value)])],letraPublica:$('#editSongPublicLyrics').value.trim(),cancioneroElena:$('#editSongElenaLyrics').value.trim(),notasElena:state.editSongElenaNotes,cancioneroDaniel:$('#editSongDanielLyrics').value.trim(),notasDaniel:state.editSongDanielNotes};
    const previousElenaText=String(song.cancioneroElena||'');
    const previousDanielText=String(song.cancioneroDaniel||'');
    askConfirm('Guardar cambios',`Se actualizará “${title}”.`,async()=>{
      const index=state.songs.findIndex(s=>s.id===id);state.songs[index]=updated;
      const customIndex=state.customSongs.findIndex(s=>s.id===id);
      if(customIndex>=0)state.customSongs[customIndex]=updated;else state.songEdits[id]={...updated};
      sortMasterSongs();
      try{saveLibraryState();}catch(err){return toast('La imagen es demasiado pesada para guardarla. Prueba una imagen más pequeña.');}
      try{await syncElenaSongTextToImageEdit(updated,previousElenaText);}catch(err){console.error(err);toast('Canción guardada; la caja de Elena quedó pendiente');}
      try{await syncDanielSongTextToImageEdit(updated,previousDanielText);}catch(err){console.error(err);toast('Canción guardada; la caja de Daniel quedó pendiente');}
      buildRepertoires();dialogBaselines.delete($('#editSongDialog'));$('#editSongDialog').close();renderEditSongsList();if(state.config)filterSongs();toast('Guardado exitosamente');
    },'Guardar');
  });


  let activeSongbookOwner='elena';
  let activeSongbookSongId=null;
  state.songbookDrawingData='';
  let songbookDrawingEnabled=false;
  let drawingCtx=null, drawingSnapshot=null, drawingActive=false, drawingPath=[];
  let editorUndoStack=[], editorRedoStack=[], wordHistoryTimer=null, restoringEditorHistory=false;
  let savedEditorRange=null, currentTextColor='#d00000', currentFontSize='30', currentBold=true, currentItalic=false, currentDrawColor='#d00000';
  let drawHoldTimer=null, drawHoldTriggered=false;

  function songbookField(owner){ return owner==='elena'?'cancioneroElena':'cancioneroDaniel'; }
  function songbookDrawingField(owner){ return owner==='elena'?'cancioneroElenaDibujo':'cancioneroDanielDibujo'; }
  function ownerLabel(owner){ return owner==='elena'?'Elena':'Daniel'; }

  function openSongbookList(owner){
    activeSongbookOwner=owner;$('#songbookListTitle').textContent=`Cancionero ${ownerLabel(owner)}`;$('#songbookSearch').value='';renderSongbookList();$('#songbookListDialog').showModal();
  }
  function renderSongbookList(){
    const q=norm($('#songbookSearch').value),field=songbookField(activeSongbookOwner),songs=state.songs.filter(song=>!q||norm(song.titulo).includes(q)||norm(song.artista).includes(q));
    $('#songbookCount').textContent=`${songs.length} canciones`;const list=$('#songbookSongsList');list.innerHTML='';
    songs.forEach(song=>{const row=document.createElement('div');row.className='edit-song-row';const hasText=Boolean(String(song[field]||'').trim());const hasImage=Boolean(imagePayload(song,activeSongbookOwner));row.innerHTML=`<span class="edit-song-number">${String(song.numero||'').padStart(2,'0')}</span><div><strong>${esc(song.titulo)}</strong><small>${esc(song.artista||'Artista no indicado')} · ${hasText?'Con texto':'Sin texto'} · ${hasImage?'Con imagen':'Sin imagen'}</small></div><div class="edit-song-actions"><button type="button" class="secondary-btn" data-edit-text>Editar letra</button><button type="button" class="secondary-btn" data-edit-image>Editar imagen</button></div>`;row.querySelector('[data-edit-text]').addEventListener('click',()=>openImageEditor(song.id,activeSongbookOwner,'songbook'));row.querySelector('[data-edit-image]').addEventListener('click',()=>openImageEditor(song.id,activeSongbookOwner,'image'));list.append(row);});
    if(!songs.length)list.innerHTML='<div class="viewer-empty"><h3>No se encontraron canciones</h3></div>';
  }
  $('#songbookSearch').addEventListener('input',renderSongbookList);
  function cleanPastedText(html,text){const raw=text||new DOMParser().parseFromString(html||'','text/html').body.innerText||'';return raw.replace(/\r/g,'').replace(/\n{3,}/g,'\n\n').trim();}

  function fullEditorSnapshot(){return{html:$('#songbookEditor').innerHTML,drawing:state.songbookDrawingData||''};}
  function sameSnapshot(a,b){return a&&b&&a.html===b.html&&a.drawing===b.drawing;}
  function resetEditorHistory(){editorUndoStack=[fullEditorSnapshot()];editorRedoStack=[];updateEditorHistoryButtons();}
  function updateEditorHistoryButtons(){$('#songbookUndo').disabled=editorUndoStack.length<=1;$('#songbookRedo').disabled=!editorRedoStack.length;}
  function commitEditorHistory(){if(restoringEditorHistory)return;clearTimeout(wordHistoryTimer);const snap=fullEditorSnapshot();if(!sameSnapshot(editorUndoStack.at(-1),snap)){editorUndoStack.push(snap);if(editorUndoStack.length>120)editorUndoStack.shift();editorRedoStack=[];}updateEditorHistoryButtons();}
  function scheduleWordHistory(){clearTimeout(wordHistoryTimer);wordHistoryTimer=setTimeout(commitEditorHistory,500);}
  function restoreEditorState(snap){restoringEditorHistory=true;$('#songbookEditor').innerHTML=snap.html;state.songbookDrawingData=snap.drawing||'';loadSongbookDrawing(state.songbookDrawingData);restoringEditorHistory=false;updateEditorHistoryButtons();}
  function undoEditor(){commitEditorHistory();if(editorUndoStack.length<=1)return;editorRedoStack.push(editorUndoStack.pop());restoreEditorState(editorUndoStack.at(-1));}
  function redoEditor(){if(!editorRedoStack.length)return;const next=editorRedoStack.pop();editorUndoStack.push(next);restoreEditorState(next);}

  function openSongbookEditor(id){
    const song=state.songs.find(s=>s.id===id);if(!song)return;activeSongbookSongId=id;const field=songbookField(activeSongbookOwner);
    $('#songbookEditorOwner').textContent=`CANCIONERO ${ownerLabel(activeSongbookOwner).toUpperCase()}`;$('#songbookEditorTitle').textContent=`${song.titulo} · ${song.artista||''}`;
    const editor=$('#songbookEditor'),saved=String(song[field]||'');editor.innerHTML=saved.includes('<')?saved:esc(saved).replace(/\n/g,'<br>');
    currentTextColor='#d00000';currentFontSize='30';currentBold=true;currentItalic=false;$('#songbookFontSize').value='30';updateColorButton();updateFormatButtons();
    state.songbookDrawingData=String(song[songbookDrawingField(activeSongbookOwner)]||'');songbookDrawingEnabled=false;$('#songbookDrawToggle').classList.remove('is-active');$('#songbookDrawingCanvas').classList.remove('is-active');editor.contentEditable='true';
    $('#songbookEditorDialog').showModal();requestAnimationFrame(()=>{resizeSongbookCanvas();loadSongbookDrawing(state.songbookDrawingData);rememberDialogState($('#songbookEditorDialog'));resetEditorHistory();});setTimeout(()=>{placeCaretAtEnd(editor);applyTypingFormat();saveEditorSelection();},80);
  }
  function placeCaretAtEnd(el){const range=document.createRange(),sel=window.getSelection();range.selectNodeContents(el);range.collapse(false);sel.removeAllRanges();sel.addRange(range);el.focus();}
  function selectionInsideEditor(){const sel=window.getSelection();return sel&&sel.rangeCount&&$('#songbookEditor').contains(sel.anchorNode);}
  function saveEditorSelection(){if(selectionInsideEditor())savedEditorRange=window.getSelection().getRangeAt(0).cloneRange();}
  function restoreEditorSelection(){const editor=$('#songbookEditor');editor.focus();if(savedEditorRange){const sel=window.getSelection();sel.removeAllRanges();sel.addRange(savedEditorRange);}}
  document.addEventListener('selectionchange',()=>{if($('#songbookEditorDialog').open&&selectionInsideEditor()){saveEditorSelection();updateFormatButtonsFromSelection();}});
  function applyTypingFormat(){restoreEditorSelection();document.execCommand('styleWithCSS',false,true);document.execCommand('foreColor',false,currentTextColor);const bold=document.queryCommandState('bold');if(bold!==currentBold)document.execCommand('bold');const italic=document.queryCommandState('italic');if(italic!==currentItalic)document.execCommand('italic');saveEditorSelection();applyFontSize(currentFontSize);}
  function updateColorButton(){$('#songbookColorSwatch').style.background=currentTextColor;$$('[data-text-color]').forEach(b=>b.classList.toggle('is-active',b.dataset.textColor===currentTextColor));}
  function updateFormatButtons(){$('#songbookBold').classList.toggle('is-active',currentBold);$('#songbookItalic').classList.toggle('is-active',currentItalic);}
  function updateFormatButtonsFromSelection(){currentBold=document.queryCommandState('bold');currentItalic=document.queryCommandState('italic');updateFormatButtons();}
  function positionPopover(pop,anchor){const r=anchor.getBoundingClientRect();pop.hidden=false;const w=pop.offsetWidth;let left=Math.min(Math.max(6,r.left),window.innerWidth-w-6);let top=r.bottom+5;if(top+pop.offsetHeight>window.innerHeight-6)top=Math.max(6,r.top-pop.offsetHeight-5);pop.style.left=`${left}px`;pop.style.top=`${top}px`;}
  function closeToolbarPopovers(except){[$('#songbookColorMenu'),$('#songbookDrawOptions'),$('#songbookEraserOptions')].forEach(p=>{if(p!==except)p.hidden=true;});}

  function resizeSongbookCanvas(){const canvas=$('#songbookDrawingCanvas'),stage=$('#songbookPaperStage');if(!canvas||!stage)return;const ratio=Math.max(1,window.devicePixelRatio||1),w=Math.max(1,stage.scrollWidth),h=Math.max(1,stage.scrollHeight),old=state.songbookDrawingData;canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);canvas.style.width=`${w}px`;canvas.style.height=`${h}px`;drawingCtx=canvas.getContext('2d');drawingCtx.setTransform(ratio,0,0,ratio,0,0);drawingCtx.lineCap='round';drawingCtx.lineJoin='round';if(old)loadSongbookDrawing(old);}
  function loadSongbookDrawing(data){const canvas=$('#songbookDrawingCanvas');if(!drawingCtx||!canvas)return;drawingCtx.clearRect(0,0,parseFloat(canvas.style.width)||canvas.width,parseFloat(canvas.style.height)||canvas.height);if(!data)return;const img=new Image();img.onload=()=>drawingCtx.drawImage(img,0,0,parseFloat(canvas.style.width),parseFloat(canvas.style.height));img.src=data;}
  function saveDrawingData(){state.songbookDrawingData=$('#songbookDrawingCanvas').toDataURL('image/png');}
  function canvasPoint(e){const r=$('#songbookDrawingCanvas').getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
  function drawArrowHead(ctx,from,to){
    const dx=to.x-from.x,dy=to.y-from.y,distance=Math.hypot(dx,dy);
    if(distance<0.5)return;
    const ux=dx/distance,uy=dy/distance,width=Number($('#songbookDrawWidth').value||5);
    const headLength=14+width,headHalfWidth=Math.max(6,headLength*.48);
    // La punta se prolonga fuera del último punto, en la dirección real del trazo.
    const tip={x:to.x+ux*headLength*.55,y:to.y+uy*headLength*.55};
    const base={x:tip.x-ux*headLength,y:tip.y-uy*headLength};
    const px=-uy,py=ux;
    ctx.beginPath();
    ctx.moveTo(base.x+px*headHalfWidth,base.y+py*headHalfWidth);
    ctx.lineTo(tip.x,tip.y);
    ctx.lineTo(base.x-px*headHalfWidth,base.y-py*headHalfWidth);
    ctx.stroke();
  }
  function drawPath(points,mode){if(points.length<2)return;drawingCtx.beginPath();drawingCtx.moveTo(points[0].x,points[0].y);for(let i=1;i<points.length;i++)drawingCtx.lineTo(points[i].x,points[i].y);drawingCtx.stroke();if(mode==='arrow'||mode==='double-arrow')drawArrowHead(drawingCtx,points.at(-2),points.at(-1));if(mode==='double-arrow')drawArrowHead(drawingCtx,points[1],points[0]);}
  function toggleDrawing(force){songbookDrawingEnabled=force??!songbookDrawingEnabled;$('#songbookDrawToggle').classList.toggle('is-active',songbookDrawingEnabled&&$('#songbookDrawMode').value!=='eraser');if($('#songbookDrawMode').value!=='eraser')$('#songbookEraserToggle')?.classList.remove('is-active');$('#songbookDrawingCanvas').classList.toggle('is-active',songbookDrawingEnabled);$('#songbookEditor').contentEditable=String(!songbookDrawingEnabled);if(songbookDrawingEnabled)resizeSongbookCanvas();}
  function updateDrawColorUI(){
    const input=$('#songbookDrawColor');
    if(input)input.value=currentDrawColor;
    const toggle=$('#songbookDrawToggle');
    if(toggle){
      toggle.style.setProperty('--active-draw-color',currentDrawColor);
      toggle.style.setProperty('--active-draw-text-color',['#111111','#1565c0','#16833b','#d00000'].includes(currentDrawColor)?'#fff':'#111');
    }
    $$('[data-draw-color]').forEach(btn=>btn.classList.toggle('is-active',btn.dataset.drawColor===currentDrawColor));
  }

  $('#songbookColorBtn').addEventListener('click',e=>{e.stopPropagation();const pop=$('#songbookColorMenu');if(!pop.hidden){pop.hidden=true;return;}closeToolbarPopovers(pop);positionPopover(pop,e.currentTarget);});
  $$('[data-text-color]').forEach(btn=>btn.addEventListener('click',()=>{currentTextColor=btn.dataset.textColor;updateColorButton();restoreEditorSelection();document.execCommand('styleWithCSS',false,true);document.execCommand('foreColor',false,currentTextColor);saveEditorSelection();commitEditorHistory();$('#songbookColorMenu').hidden=true;}));
  $('.songbook-toolbar').addEventListener('mousedown',e=>{if(e.target.closest('button'))e.preventDefault();});
  $$('[data-editor-command]').forEach(btn=>btn.addEventListener('click',()=>{restoreEditorSelection();document.execCommand(btn.dataset.editorCommand,false,null);currentBold=document.queryCommandState('bold');currentItalic=document.queryCommandState('italic');updateFormatButtons();saveEditorSelection();commitEditorHistory();}));
  function applyFontSize(size){
    currentFontSize=String(size);
    restoreEditorSelection();
    const editor=$('#songbookEditor'),sel=window.getSelection();
    if(!sel||!sel.rangeCount||!editor.contains(sel.anchorNode))return;
    const range=sel.getRangeAt(0);
    if(!range.collapsed){
      const span=document.createElement('span');span.style.fontSize=`${currentFontSize}px`;
      try{span.append(range.extractContents());range.insertNode(span);range.selectNodeContents(span);sel.removeAllRanges();sel.addRange(range);}catch{document.execCommand('fontSize',false,'7');}
    }else{
      const span=document.createElement('span');
      span.style.fontSize=`${currentFontSize}px`;span.style.color=currentTextColor;
      span.style.fontWeight=currentBold?'700':'400';span.style.fontStyle=currentItalic?'italic':'normal';
      const marker=document.createTextNode('\u200B');span.append(marker);range.insertNode(span);
      range.setStart(marker,1);range.collapse(true);sel.removeAllRanges();sel.addRange(range);
    }
    saveEditorSelection();commitEditorHistory();
  }
  $('#songbookFontSize').addEventListener('pointerdown',saveEditorSelection);
  $('#songbookFontSize').addEventListener('mousedown',saveEditorSelection);
  $('#songbookFontSize').addEventListener('change',e=>applyFontSize(e.target.value));
  $('#songbookUndo').addEventListener('click',undoEditor);$('#songbookRedo').addEventListener('click',redoEditor);
  $('#songbookTextTool').addEventListener('click',()=>{songbookDrawingEnabled=false;$('#songbookDrawToggle').classList.remove('is-active');$('#songbookEraserToggle').classList.remove('is-active');$('#songbookTextTool').classList.add('is-active');$('#songbookDrawingCanvas').classList.remove('is-active');$('#songbookEditor').contentEditable='true';$('#songbookEditor').focus();});

  $('#songbookDrawToggle').addEventListener('pointerdown',e=>{e.preventDefault();drawHoldTriggered=false;drawHoldTimer=setTimeout(()=>{drawHoldTriggered=true;closeToolbarPopovers($('#songbookDrawOptions'));positionPopover($('#songbookDrawOptions'),$('#songbookDrawToggle'));},480);});
  function finishDrawButtonPress(){clearTimeout(drawHoldTimer);if(!drawHoldTriggered)toggleDrawing();}
  $('#songbookDrawToggle').addEventListener('pointerup',finishDrawButtonPress);$('#songbookDrawToggle').addEventListener('pointercancel',()=>clearTimeout(drawHoldTimer));$('#songbookDrawToggle').addEventListener('contextmenu',e=>e.preventDefault());
  $$('[data-draw-color]').forEach(btn=>btn.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    currentDrawColor=btn.dataset.drawColor;
    updateDrawColorUI();
  }));
  $('#songbookClearDrawing').addEventListener('click',()=>askConfirm('Borrar dibujo','Se eliminarán todos los trazos de esta canción.',()=>{drawingCtx.clearRect(0,0,parseFloat($('#songbookDrawingCanvas').style.width),parseFloat($('#songbookDrawingCanvas').style.height));state.songbookDrawingData='';commitEditorHistory();},'Borrar'));
  updateDrawColorUI();
  let songbookEraserHold=0;
  $('#songbookEraserToggle').addEventListener('pointerdown',e=>{songbookEraserHold=setTimeout(()=>{const pop=$('#songbookEraserOptions');closeToolbarPopovers(pop);positionPopover(pop,e.currentTarget);},550);});
  ['pointerup','pointercancel','pointerleave'].forEach(name=>$('#songbookEraserToggle').addEventListener(name,()=>clearTimeout(songbookEraserHold)));
  $('#songbookEraserToggle').addEventListener('click',()=>{$('#songbookDrawMode').value='eraser';toggleDrawing(true);$('#songbookEraserToggle').classList.add('is-active');$('#songbookDrawToggle').classList.remove('is-active');});
  $$('[data-eraser-size]').forEach(btn=>btn.addEventListener('click',()=>{$('#songbookDrawWidth').value=btn.dataset.eraserSize;$('#songbookDrawMode').value='eraser';toggleDrawing(true);$('#songbookEraserOptions').hidden=true;$('#songbookEraserToggle').classList.add('is-active');}));

  $('#songbookDrawingCanvas').addEventListener('pointerdown',e=>{if(!songbookDrawingEnabled)return;e.preventDefault();drawingActive=true;drawingPath=[canvasPoint(e)];drawingSnapshot=drawingCtx.getImageData(0,0,$('#songbookDrawingCanvas').width,$('#songbookDrawingCanvas').height);drawingCtx.globalCompositeOperation=$('#songbookDrawMode').value==='eraser'?'destination-out':'source-over';drawingCtx.strokeStyle=$('#songbookDrawColor').value;drawingCtx.lineWidth=Number($('#songbookDrawWidth').value);e.currentTarget.setPointerCapture(e.pointerId);});
  $('#songbookDrawingCanvas').addEventListener('pointermove',e=>{if(!drawingActive)return;e.preventDefault();drawingPath.push(canvasPoint(e));drawingCtx.putImageData(drawingSnapshot,0,0);drawingCtx.globalCompositeOperation=$('#songbookDrawMode').value==='eraser'?'destination-out':'source-over';drawingCtx.strokeStyle=$('#songbookDrawColor').value;drawingCtx.lineWidth=Number($('#songbookDrawWidth').value);drawPath(drawingPath,$('#songbookDrawMode').value);});
  function finishDrawing(e){if(!drawingActive)return;drawingActive=false;saveDrawingData();commitEditorHistory();try{e.currentTarget.releasePointerCapture(e.pointerId)}catch{}}
  $('#songbookDrawingCanvas').addEventListener('pointerup',finishDrawing);$('#songbookDrawingCanvas').addEventListener('pointercancel',finishDrawing);
  window.addEventListener('resize',()=>{closeToolbarPopovers();if($('#songbookEditorDialog').open)resizeSongbookCanvas();});
  document.addEventListener('click',e=>{if(!e.target.closest('.toolbar-popover-wrap')&&!e.target.closest('.compact-popover'))closeToolbarPopovers();});

  $('#songbookEditor').addEventListener('paste',e=>{e.preventDefault();restoreEditorSelection();const text=cleanPastedText(e.clipboardData.getData('text/html'),e.clipboardData.getData('text/plain'));document.execCommand('insertText',false,text);applyTypingFormat();commitEditorHistory();});
  $('#songbookEditor').addEventListener('beforeinput',e=>{if(e.inputType==='insertText'&&/[\s.,;:!?]/.test(e.data||''))commitEditorHistory();});
  $('#songbookEditor').addEventListener('input',()=>{saveEditorSelection();scheduleWordHistory();});
  $('#songbookEditor').addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redoEditor():undoEditor();}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redoEditor();}});

  $('#saveSongbookBtn').addEventListener('click',()=>{commitEditorHistory();const song=state.songs.find(s=>s.id===activeSongbookSongId);if(!song)return;const field=songbookField(activeSongbookOwner),html=$('#songbookEditor').innerHTML.trim();askConfirm('Guardar cancionero',`Se actualizará “${song.titulo}”.`,()=>{song[field]=html;song[songbookDrawingField(activeSongbookOwner)]=state.songbookDrawingData||'';const ci=state.customSongs.findIndex(s=>s.id===song.id);if(ci>=0)state.customSongs[ci]={...song};else state.songEdits[song.id]={...song};saveStateLocalOnly();syncRemoteLibrary(true);dialogBaselines.delete($('#songbookEditorDialog'));$('#songbookEditorDialog').close();renderSongbookList();toast('Guardado exitosamente');},'Guardar');});

  let activeRepertoireId = null;

  function openRepertoires(){
    const reps=allRepertoires();
    activeRepertoireId = reps.find(r=>r.id!=='todas')?.id || 'todas';
    $('#newRepertoireName').value='';
    $('#repertoireSongSearch').value='';
    renderRepertoireManager();
    $('#repertoiresDialog').showModal();
    rememberDialogState($('#repertoiresDialog'));
  }

  function repertoireSongIds(repId){
    if(repId==='todas') return new Set(state.songs.map(song=>song.id));
    return new Set(state.songs.filter(song=>(song.listas||[]).includes(repId)).map(song=>song.id));
  }

  function renderRepertoireManager(){
    const reps=allRepertoires();
    if(!reps.some(r=>r.id===activeRepertoireId)) activeRepertoireId=reps[0]?.id||'todas';
    $('#repertoireTotalCount').textContent=`${reps.length}`;
    const box=$('#repertoireManagerList');box.innerHTML='';
    reps.forEach(rep=>{
      const count=rep.id==='todas'?state.songs.length:state.songs.filter(song=>(song.listas||[]).includes(rep.id)).length;
      const button=document.createElement('button');
      button.type='button';
      button.className=`repertoire-select${rep.id===activeRepertoireId?' is-active':''}${rep.id==='todas'?' protected-repertoire':''}`;
      button.innerHTML=`<span><strong>${esc(rep.name)}</strong><small>${count} ${count===1?'canción':'canciones'}</small></span><b>›</b>`;
      button.addEventListener('click',()=>{
        if(dialogHasUnsavedChanges($('#repertoiresDialog'))){
          askConfirm('Cambios sin guardar','Se perderán los cambios del repertorio actual.',()=>{activeRepertoireId=rep.id;renderRepertoireManager();rememberDialogState($('#repertoiresDialog'));},'Continuar');
        }else{activeRepertoireId=rep.id;renderRepertoireManager();rememberDialogState($('#repertoiresDialog'));}
      });
      box.append(button);
    });
    renderSelectedRepertoire();
  }

  function renderSelectedRepertoire(){
    const rep=allRepertoires().find(r=>r.id===activeRepertoireId);
    const editor=$('#repertoireEditor');
    if(!rep){editor.hidden=true;return;}
    editor.hidden=false;
    const protectedRep=rep.id==='todas';
    const nameInput=$('#selectedRepertoireName');
    nameInput.value=rep.name;nameInput.disabled=protectedRep;
    $('#deleteSelectedRepertoireBtn').hidden=protectedRep;
    $('#duplicateSelectedRepertoireBtn').hidden=false;
    $('#saveRepertoireBtn').hidden=protectedRep;
    $('.repertoire-selection-help').textContent=protectedRep?'Lista maestra automática: incluye todas las canciones.':'Marca para agregar. Desmarca para quitar del repertorio.';
    renderRepertoireSongs();
  }

  function renderRepertoireSongs(){
    const rep=allRepertoires().find(r=>r.id===activeRepertoireId);if(!rep)return;
    const selected=repertoireSongIds(rep.id), q=norm($('#repertoireSongSearch').value);
    const songs=state.songs.filter(song=>!q||norm(song.titulo).includes(q)||norm(song.artista).includes(q));
    $('#selectedRepertoireCount').textContent=selected.size;
    $('#repertoireSongsVisibleCount').textContent=`${songs.length} visibles`;
    const list=$('#repertoireSongsList');list.innerHTML='';
    songs.forEach(song=>{
      const label=document.createElement('label');label.className='repertoire-song-item';
      label.innerHTML=`<input type="checkbox" value="${esc(song.id)}" ${selected.has(song.id)?'checked':''} ${rep.id==='todas'?'disabled':''}><span class="repertoire-song-copy"><strong>${esc(song.titulo)}</strong><small>${esc(song.artista||'Artista no indicado')}</small></span><em>${String(song.numero||'').padStart(2,'0')}</em>`;
      label.querySelector('input').addEventListener('change',()=>{
        const count=$$('#repertoireSongsList input:checked').length;
        $('#selectedRepertoireCount').textContent=count;
      });
      list.append(label);
    });
    if(!songs.length)list.innerHTML='<div class="viewer-empty"><h3>No se encontraron canciones</h3><p>Prueba con otro título o artista.</p></div>';
  }

  $('#repertoireSongSearch').addEventListener('input',renderRepertoireSongs);

  $('#addRepertoireBtn').addEventListener('click',()=>{
    const name=$('#newRepertoireName').value.trim();if(!name)return toast('Escribe un nombre');
    if(allRepertoires().some(r=>norm(r.name)===norm(name)))return toast('Ese repertorio ya existe');
    const id=`rep-${slug(name)}-${Date.now().toString().slice(-5)}`;
    state.customRepertoires.push({id,name});
    activeRepertoireId=id;$('#newRepertoireName').value='';
    saveLibraryState();buildRepertoires();renderRepertoireManager();rememberDialogState($('#repertoiresDialog'));toast('Guardado exitosamente');
  });

  $('#saveRepertoireBtn').addEventListener('click',()=>{
    const rep=allRepertoires().find(r=>r.id===activeRepertoireId);if(!rep||rep.id==='todas')return;
    const name=$('#selectedRepertoireName').value.trim();if(!name)return toast('Escribe un nombre');
    if(allRepertoires().some(r=>r.id!==rep.id&&norm(r.name)===norm(name)))return toast('Ese repertorio ya existe');
    const checked=new Set($$('#repertoireSongsList input:checked').map(x=>x.value));
    askConfirm('Guardar repertorio',`Se actualizará “${name}” con ${checked.size} canciones.`,()=>{
      let item=state.customRepertoires.find(r=>r.id===rep.id);
      if(!item){item={id:rep.id,name:rep.name};state.customRepertoires.push(item);}
      item.name=name;
      state.songs.forEach(song=>{
        const listas=new Set(song.listas||[]);listas.add('todas');
        checked.has(song.id)?listas.add(rep.id):listas.delete(rep.id);
        song.listas=[...listas];
        const ci=state.customSongs.findIndex(s=>s.id===song.id);
        if(ci>=0)state.customSongs[ci]={...song};else state.songEdits[song.id]={...song};
      });
      if(state.config?.repertoire===rep.id)state.config.repertoireName=name;
      saveLibraryState();buildRepertoires();renderRepertoireManager();rememberDialogState($('#repertoiresDialog'));if(state.config)filterSongs();toast('Guardado exitosamente');
    },'Guardar');
  });


  $('#duplicateSelectedRepertoireBtn').addEventListener('click',()=>{
    const rep=allRepertoires().find(r=>r.id===activeRepertoireId);if(!rep)return;
    const sourceIds=repertoireSongIds(rep.id);
    const baseName=`Copia de ${rep.name}`;
    let name=baseName, n=2;
    while(allRepertoires().some(r=>norm(r.name)===norm(name))) name=`${baseName} ${n++}`;
    askConfirm('Duplicar repertorio',`Se creará “${name}” con ${sourceIds.size} canciones.`,()=>{
      const id=`rep-${slug(name)}-${Date.now().toString().slice(-5)}`;
      state.customRepertoires.push({id,name});
      state.songs.forEach(song=>{
        const listas=new Set(song.listas||[]);listas.add('todas');
        if(sourceIds.has(song.id))listas.add(id);
        song.listas=[...listas];
        const ci=state.customSongs.findIndex(s=>s.id===song.id);
        if(ci>=0)state.customSongs[ci]={...song};else state.songEdits[song.id]={...song};
      });
      activeRepertoireId=id;
      saveLibraryState();buildRepertoires();renderRepertoireManager();rememberDialogState($('#repertoiresDialog'));toast('Guardado exitosamente');
    },'Duplicar');
  });

  $('#deleteSelectedRepertoireBtn').addEventListener('click',()=>{
    const rep=allRepertoires().find(r=>r.id===activeRepertoireId);if(!rep||rep.id==='todas')return;
    askConfirm('Eliminar repertorio',`Se quitará “${rep.name}” de todas las canciones. Las canciones no serán eliminadas.`,()=>{
      state.customRepertoires=state.customRepertoires.filter(r=>r.id!==rep.id);
      state.songs.forEach(song=>{song.listas=[...new Set(['todas',...(song.listas||[]).filter(id=>id!==rep.id&&id!=='todas')])];const ci=state.customSongs.findIndex(s=>s.id===song.id);if(ci>=0)state.customSongs[ci]={...song};else state.songEdits[song.id]={...song};});
      if(state.config?.repertoire===rep.id){state.config.repertoire='todas';state.config.repertoireName='Todas las canciones';}
      activeRepertoireId=allRepertoires().find(r=>r.id!=='todas')?.id||'todas';
      saveLibraryState();buildRepertoires();renderRepertoireManager();rememberDialogState($('#repertoiresDialog'));toast('Guardado exitosamente');
    },'Eliminar');
  });

  function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),2800);}
  function norm(v=''){return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
  function slug(v=''){return norm(v).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
  function esc(v=''){return String(v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}


  // Entrega 6.16 — Exportar contactos
  const DANIEL_PHONE='593992890540';
  function readContacts(){
    const candidates=['egm-contactos','contactos','egm-panel-v3-contactos']; let list=[];
    for(const key of candidates){try{const value=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(value))list.push(...value);}catch(_){} }
    try{const saved=JSON.parse(localStorage.getItem('egm-panel-v3')||'{}');if(Array.isArray(saved.contacts))list.push(...saved.contacts);if(Array.isArray(saved.contactos))list.push(...saved.contactos);}catch(_){}
    return list.map((x,i)=>({id:x.id||i,nombre:x.nombre||x.name||'Sin nombre',telefono:String(x.telefono||x.phone||'').replace(/\D/g,''),fecha:x.fecha||x.date||x.creado_en||x.createdAt||'',hora:x.hora||x.time||'',cancion:x.cancion||x.song||'',lugar:x.lugar||x.venue||'',perfil:x.perfil||x.perfil_clientes||x.profile||'',show:x.show||x.show_id||''})).filter(x=>x.telefono);
  }
  function uniqueContacts(list){const m=new Map();list.forEach(x=>{if(!m.has(x.telefono))m.set(x.telefono,x)});return [...m.values()];}
  function openExportContacts(){
    const contacts=readContacts(); const shows=[...new Set(contacts.map(x=>x.show).filter(Boolean))]; const venues=[...new Set(contacts.map(x=>x.lugar).filter(Boolean))];
    $('#exportShow').innerHTML='<option value="all">Todos</option>'+shows.map(x=>`<option>${esc(x)}</option>`).join('');
    $('#exportVenue').innerHTML='<option value="all">Todos</option>'+venues.map(x=>`<option>${esc(x)}</option>`).join('');
    $('#exportContactsDialog').showModal(); updateExportCount();
  }
  function filteredContacts(){let list=readContacts();const sh=$('#exportShow').value,v=$('#exportVenue').value,p=$('#exportProfile').value,fr=$('#exportDateFrom').value,to=$('#exportDateTo').value;list=list.filter(x=>(sh==='all'||x.show===sh)&&(v==='all'||x.lugar===v)&&(p==='all'||x.perfil===p));if(fr)list=list.filter(x=>String(x.fecha).slice(0,10)>=fr);if(to)list=list.filter(x=>String(x.fecha).slice(0,10)<=to);return uniqueContacts(list);}
  function updateExportCount(){$('#exportCount').textContent=filteredContacts().length;}
  ['exportContent','exportFormat','exportShow','exportVenue','exportProfile','exportDateFrom','exportDateTo'].forEach(id=>$('#'+id).addEventListener('change',updateExportCount));
  function contactRows(){const only=$('#exportContent').value==='phones';const rows=filteredContacts();return {only,rows};}
  function exportText(){const {only,rows}=contactRows();return only?rows.map(x=>'+'+x.telefono).join('\n'):['nombre\tteléfono\tfecha\thora\tcanción\tlugar\tperfil\tshow',...rows.map(x=>[x.nombre,'+'+x.telefono,x.fecha,x.hora,x.cancion,x.lugar,x.perfil,x.show].join('\t'))].join('\n');}
  function downloadContacts(){const {only,rows}=contactRows();if(!rows.length)return toast('No hay contactos para exportar');askConfirm('Exportar contactos',`Se exportarán ${rows.length} contactos únicos.`,()=>{let blob,name;if($('#exportFormat').value==='text'){blob=new Blob([exportText()],{type:'text/plain;charset=utf-8'});name='contactos.txt';}else{const heads=only?['Teléfono']:['Nombre','Teléfono','Fecha','Hora','Canción','Lugar','Perfil','Show'];const body=rows.map(x=>only?['+'+x.telefono]:[x.nombre,'+'+x.telefono,x.fecha,x.hora,x.cancion,x.lugar,x.perfil,x.show]);const html='<table><tr>'+heads.map(x=>`<th>${esc(x)}</th>`).join('')+'</tr>'+body.map(r=>'<tr>'+r.map(x=>`<td>${esc(x)}</td>`).join('')+'</tr>').join('')+'</table>';blob=new Blob(['\ufeff'+html],{type:'application/vnd.ms-excel'});name='contactos.xls';}const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);toast('Exportado exitosamente.');},'Exportar');}
  function securitySettings(){try{return {...{password:'2907',danielPhone:'593992890540',elenaPhone:'593987388915'},...JSON.parse(localStorage.getItem('egm-security-settings')||'{}')}}catch(_){return {password:'2907',danielPhone:'593992890540',elenaPhone:'593987388915'}}}
  function whatsappNumberElena(){return String(securitySettings().elenaPhone||'593987388915').replace(/\D/g,'');}
  function whatsappNumberDaniel(){return String(securitySettings().danielPhone||'593992890540').replace(/\D/g,'');}
  function shareContacts(phone){const rows=filteredContacts();if(!rows.length)return toast('No hay contactos para exportar');askConfirm('Enviar contactos',`Se enviarán ${rows.length} contactos únicos por WhatsApp.`,()=>{window.open(`https://wa.me/${phone}?text=${encodeURIComponent(exportText())}`,'_blank','noopener');toast('Exportado exitosamente.');},'Abrir WhatsApp');}
  $('#downloadContactsBtn').addEventListener('click',downloadContacts);$('#whatsappDanielBtn').addEventListener('click',()=>shareContacts(whatsappNumberDaniel()));$('#whatsappElenaBtn').addEventListener('click',()=>shareContacts(whatsappNumberElena()));

  // Entrega 6.20 — Seguridad y teléfonos
  function openSecurityAuth(){
    $('#securityCurrentPassword').value='';
    $('#securityAuthError').hidden=true;
    $('#securityAuthDialog').showModal();
    setTimeout(()=>$('#securityCurrentPassword').focus(),50);
  }
  $('#securityAuthForm').addEventListener('submit',e=>{
    e.preventDefault();
    if($('#securityCurrentPassword').value!==securitySettings().password){
      $('#securityAuthError').hidden=false;
      return;
    }
    $('#securityAuthDialog').close();
    const cfg=securitySettings();
    $('#securityNewPassword').value=cfg.password;
    $('#securityConfirmPassword').value=cfg.password;
    $('#securityDanielPhone').value=cfg.danielPhone;
    $('#securityElenaPhone').value=cfg.elenaPhone;
    $('#securityFormError').hidden=true;
    $('#securityDialog').showModal();
    rememberDialogState($('#securityDialog'));
  });
  $('#securityForm').addEventListener('submit',e=>{
    e.preventDefault();
    const password=$('#securityNewPassword').value.trim();
    const confirmPassword=$('#securityConfirmPassword').value.trim();
    const danielPhone=$('#securityDanielPhone').value.replace(/\D/g,'');
    const elenaPhone=$('#securityElenaPhone').value.replace(/\D/g,'');
    const error=$('#securityFormError');
    if(password.length<4){error.textContent='La contraseña debe tener al menos 4 caracteres.';error.hidden=false;return;}
    if(password!==confirmPassword){error.textContent='Las contraseñas no coinciden.';error.hidden=false;return;}
    if(danielPhone.length<8||elenaPhone.length<8){error.textContent='Revisa los números de WhatsApp.';error.hidden=false;return;}
    error.hidden=true;
    askConfirm('Guardar seguridad','Se cambiarán la contraseña del panel y los teléfonos de WhatsApp.',()=>{
      localStorage.setItem('egm-security-settings',JSON.stringify({password,danielPhone,elenaPhone}));
      rememberDialogState($('#securityDialog'));
      toast('Guardado exitosamente');
    },'Guardar');
  });

  // Entrega 6.17 — Subir fotos y editor real de encuadre
  let activePhotoSlot='inicio',photoDrafts={},dragState=null;
  const PHOTO_DEFAULTS={x:50,y:50,zoom:100,intensity:55,direction:'to bottom',color:'#000000',opacity:70};
  function loadPhotoSettings(){try{return JSON.parse(localStorage.getItem('egm-photo-settings')||'{}')}catch(_){return {}}}
  function loadPhotoSources(){try{return JSON.parse(localStorage.getItem('egm-photo-originals')||'{}')}catch(_){return {}}}
  function currentPhotoDraft(){
    if(!photoDrafts[activePhotoSlot]){
      const saved=loadPhotoSettings()[activePhotoSlot]||{},sources=loadPhotoSources();
      photoDrafts[activePhotoSlot]={...PHOTO_DEFAULTS,...saved,src:sources[activePhotoSlot]||saved.src||''};
    }
    return photoDrafts[activePhotoSlot];
  }
  function syncPhotoControls(){
    const d=currentPhotoDraft();
    $('#photoPosX').value=d.x;$('#photoPosY').value=d.y;$('#photoZoom').value=d.zoom;
    $('#gradientIntensity').value=d.intensity;$('#gradientDirection').value=d.direction;
    $('#gradientColor').value=d.color;$('#gradientOpacity').value=d.opacity;
    const preview=$('#photoPreview');preview.classList.toggle('is-inicio',activePhotoSlot==='inicio');preview.classList.toggle('is-hero',activePhotoSlot==='hero');
    $('#photoPreviewLabel').textContent=activePhotoSlot==='inicio'?'Foto inicio':'Foto Hero';
    renderPhotoPreview();
  }
  function renderPhotoPreview(){
    const d=currentPhotoDraft(),img=$('.photo-preview-image'),grad=$('.photo-preview-gradient');
    img.style.backgroundImage=d.src?`url("${d.src}")`:'none';img.style.backgroundPosition=`${d.x}% ${d.y}%`;img.style.backgroundSize=`${d.zoom}%`;
    const alpha=(Number(d.opacity)/100)*(Number(d.intensity)/100);
    grad.style.background=`linear-gradient(${d.direction}, ${hexRgba(d.color,0)} 0%, ${hexRgba(d.color,alpha)} 100%)`;
    $$('.photo-controls input[type=range]').forEach(el=>el.parentElement.querySelector('output').textContent=el.value+'%');
  }
  function hexRgba(hex,a){const n=parseInt(hex.slice(1),16);return `rgba(${n>>16},${(n>>8)&255},${n&255},${a})`}
  function openPhotoManager(){
    const settings=structuredClone(loadPhotoSettings()),sources=loadPhotoSources();photoDrafts={};
    ['inicio','hero'].forEach(slot=>{const saved=settings[slot]||{};photoDrafts[slot]={...PHOTO_DEFAULTS,...saved,src:sources[slot]||saved.src||''};});
    activePhotoSlot='inicio';$$('[data-photo-slot]').forEach(b=>b.classList.toggle('is-active',b.dataset.photoSlot===activePhotoSlot));
    syncPhotoControls();$('#photoSourceInput').value='';$('#photoSourceStatus').textContent=currentPhotoDraft().fileName||'Ninguna imagen seleccionada';$('#photoManagerDialog').showModal();rememberDialogState($('#photoManagerDialog'));
  }
  $$('[data-photo-slot]').forEach(b=>b.addEventListener('click',()=>{activePhotoSlot=b.dataset.photoSlot;$$('[data-photo-slot]').forEach(x=>x.classList.toggle('is-active',x===b));syncPhotoControls();$('#photoSourceInput').value='';$('#photoSourceStatus').textContent=currentPhotoDraft().fileName||'Ninguna imagen seleccionada';}));
  const photoSourceInput=$('#photoSourceInput');
  const photoSourceStatus=$('#photoSourceStatus');
  $('#choosePhotoSourceBtn').addEventListener('click',()=>{photoSourceInput.value='';photoSourceInput.click();});
  async function preparePhotoForPanel(file){
    if(!file||!String(file.type||'').startsWith('image/'))throw new Error('Selecciona un archivo de imagen');
    if(file.size>25*1024*1024)throw new Error('La imagen supera 25 MB');
    const objectUrl=URL.createObjectURL(file);
    try{
      const img=new Image();img.decoding='async';
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('Este formato no pudo abrirse en este dispositivo'));img.src=objectUrl;});
      const maxSide=1800,ratio=Math.min(1,maxSide/Math.max(img.naturalWidth||1,img.naturalHeight||1));
      const w=Math.max(1,Math.round(img.naturalWidth*ratio)),h=Math.max(1,Math.round(img.naturalHeight*ratio));
      const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
      let data=canvas.toDataURL('image/webp',.84);
      if(!data.startsWith('data:image/webp'))data=canvas.toDataURL('image/jpeg',.86);
      return data;
    }finally{URL.revokeObjectURL(objectUrl);}
  }
  photoSourceInput.addEventListener('change',async e=>{
    const f=e.target.files?.[0];if(!f)return;
    photoSourceStatus.textContent='Procesando imagen…';
    try{
      const src=await preparePhotoForPanel(f);
      currentPhotoDraft().src=src;currentPhotoDraft().fileName=f.name;
      photoSourceStatus.textContent=f.name;renderPhotoPreview();toast('Imagen lista para guardar');
    }catch(err){photoSourceStatus.textContent='Ninguna imagen seleccionada';toast(err?.message||'No se pudo leer la imagen');}
  });
  const photoMap={photoPosX:'x',photoPosY:'y',photoZoom:'zoom',gradientIntensity:'intensity',gradientDirection:'direction',gradientColor:'color',gradientOpacity:'opacity'};
  Object.entries(photoMap).forEach(([id,key])=>$('#'+id).addEventListener('input',e=>{currentPhotoDraft()[key]=e.target.value;renderPhotoPreview();}));
  $('#resetPhotoFrameBtn').addEventListener('click',()=>askConfirm('Restablecer encuadre','La imagen original se conservará y solo se restablecerán los ajustes de esta foto.',()=>{const src=currentPhotoDraft().src,fileName=currentPhotoDraft().fileName;photoDrafts[activePhotoSlot]={...PHOTO_DEFAULTS,src,fileName};syncPhotoControls();},'Restablecer'));
  const preview=$('#photoPreview');
  preview.addEventListener('pointerdown',e=>{if(!currentPhotoDraft().src)return;preview.setPointerCapture(e.pointerId);dragState={id:e.pointerId,startX:e.clientX,startY:e.clientY,x:Number(currentPhotoDraft().x),y:Number(currentPhotoDraft().y)};});
  preview.addEventListener('pointermove',e=>{if(!dragState||dragState.id!==e.pointerId)return;const rect=preview.getBoundingClientRect(),d=currentPhotoDraft();d.x=Math.max(0,Math.min(100,dragState.x+((e.clientX-dragState.startX)/rect.width)*100));d.y=Math.max(0,Math.min(100,dragState.y+((e.clientY-dragState.startY)/rect.height)*100));$('#photoPosX').value=Math.round(d.x);$('#photoPosY').value=Math.round(d.y);renderPhotoPreview();});
  const endDrag=e=>{if(dragState&&(!e||dragState.id===e.pointerId))dragState=null;};preview.addEventListener('pointerup',endDrag);preview.addEventListener('pointercancel',endDrag);
  $('#savePhotoSettingsBtn').addEventListener('click',()=>askConfirm('Guardar fotografías','Se conservarán las imágenes originales y se guardarán por separado únicamente los parámetros de encuadre.',()=>{
    const sources={},settings={};
    Object.entries(photoDrafts).forEach(([slot,d])=>{sources[slot]=d.src||'';const {src,fileName,...params}=d;settings[slot]={...params,fileName:fileName||''};});
    try{localStorage.setItem('egm-photo-originals',JSON.stringify(sources));localStorage.setItem('egm-photo-settings',JSON.stringify(settings));rememberDialogState($('#photoManagerDialog'));toast('Guardado exitosamente');}
    catch(_){toast('La imagen es demasiado grande. Usa una imagen más liviana.');}
  },'Guardar'));



  const IMAGE_COLORS=['#d00000','#111111','#ffffff','#0057d9','#ffd400'];
  const imageEditorState={original:'',overlay:'',sources:[],canvasWidth:1000,canvasHeight:1300,operations:[],textBoxes:[],activeTextBoxId:null,tool:'pencil',pencilSize:8,eraserSize:100,textSize:9,pencilColor:'#d00000',textColor:'#d00000',drawMode:'free',eraserTarget:'annotations',drawing:false,last:null,path:[],undo:[],redo:[],textBold:false,textItalic:false,textX:.05,textY:.05,scale:1,panX:0,panY:0,pointers:new Map(),pinch:null,panning:null,textGesture:null};
  let imageEditorChangeRevision=0,imageEditorSavedRevision=0,imageTextAutosaveTimer=0;
  function markImageEditorDirty(){imageEditorChangeRevision++;}
  function resetImageEditorDirty(){imageEditorChangeRevision=0;imageEditorSavedRevision=0;}
  function markImageEditorSaved(){imageEditorSavedRevision=imageEditorChangeRevision;}
  function scheduleImageTextAutosave(){
    clearTimeout(imageTextAutosaveTimer);
    imageTextAutosaveTimer=setTimeout(()=>{
      const run=()=>persistImageEditorLayers(false).catch?.(()=>{});
      if('requestIdleCallback' in window)requestIdleCallback(run,{timeout:1200});else setTimeout(run,0);
    },1100);
  }
  const imageInlineText=$('#imageInlineText');
  function imageEditorCanvas(){return $('#imageEditorCanvas');}
  function imageBaseCanvas(){return $('#imageBaseCanvas');}
  function imageEditorPaper(){return $('#imageEditorPaper');}
  function imageEditorContext(){return imageEditorCanvas().getContext('2d');}
  function imageBaseContext(){return imageBaseCanvas().getContext('2d');}
  function setCanvasSize(w,h){for(const c of [imageBaseCanvas(),imageEditorCanvas()]){c.width=w;c.height=h;c.style.aspectRatio=`${w}/${h}`;}const stage=$('#imageEditorStage'),displayW=Math.max(260,Math.min(w,(stage?.clientWidth||innerWidth)-24,1100));const paper=imageEditorPaper();paper.style.width=`${displayW}px`;paper.style.height=`${displayW*h/w}px`;paper.style.aspectRatio=`${w}/${h}`;}
  function imageEditorComposite(){const b=imageBaseCanvas(),o=imageEditorCanvas(),out=document.createElement('canvas');out.width=b.width;out.height=b.height;const x=out.getContext('2d');x.drawImage(b,0,0);x.drawImage(o,0,0);return out.toDataURL('image/png');}
  function imageLayerSnapshot(){return {base:imageBaseCanvas().toDataURL('image/png'),overlay:imageEditorCanvas().toDataURL('image/png')};}
  function sameSnapshot(a,b){return a&&b&&a.base===b.base&&a.overlay===b.overlay;}
  function pushImageHistory(){const snap=imageLayerSnapshot();if(!sameSnapshot(imageEditorState.undo.at(-1),snap)){imageEditorState.undo.push(snap);if(imageEditorState.undo.length>40)imageEditorState.undo.shift();imageEditorState.redo=[];}updateImageHistory();}
  function updateImageHistory(){$('#imageUndo').disabled=imageEditorState.undo.length<=1;$('#imageRedo').disabled=!imageEditorState.redo.length;}
  function drawDataUrl(canvas,src,done){const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);if(!src){done?.();return;}const img=new Image();img.onload=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);done?.();};img.onerror=()=>done?.();img.src=src;}
  function restoreImageSnapshot(snap){if(!snap)return;drawDataUrl(imageBaseCanvas(),snap.base);drawDataUrl(imageEditorCanvas(),snap.overlay);}
  function applyImageTransform(){imageEditorPaper().style.transform=`translate3d(${imageEditorState.panX}px,${imageEditorState.panY}px,0) scale(${imageEditorState.scale})`;}
  function resetImageViewport(){imageEditorState.scale=1;imageEditorState.panX=0;imageEditorState.panY=0;applyImageTransform();requestAnimationFrame(()=>{const stage=$('#imageEditorStage'),paper=imageEditorPaper();if(!stage||!paper)return;const stageW=Math.max(1,stage.clientWidth),stageH=Math.max(1,stage.clientHeight),paperW=Math.max(1,paper.offsetWidth),paperH=Math.max(1,paper.offsetHeight);const margin=24;const fitScale=Math.max(.12,Math.min(1,(stageW-margin*2)/paperW,(stageH-margin*2)/paperH));imageEditorState.scale=fitScale;imageEditorState.panX=(stageW-paperW*fitScale)/2;imageEditorState.panY=(stageH-paperH*fitScale)/2;applyImageTransform();});}
  function zoomImageAt(clientX,clientY,factor){const stage=$('#imageEditorStage'),r=stage.getBoundingClientRect();const x=clientX-r.left,y=clientY-r.top;const old=imageEditorState.scale;const safe=Math.max(.94,Math.min(1.06,Number(factor)||1));const next=Math.max(.12,Math.min(20,old*safe));if(Math.abs(next-old)<.0001)return;imageEditorState.panX=x-(x-imageEditorState.panX)*(next/old);imageEditorState.panY=y-(y-imageEditorState.panY)*(next/old);imageEditorState.scale=next;applyImageTransform();}
  function replayImageOperations(){
    const base=imageBaseCanvas(), overlay=imageEditorCanvas(), bw=base.width, bh=base.height;
    for(const op of imageEditorState.operations||[]){
      const target=op.tool==='eraser'&&op.target==='photo'?base:overlay;
      const ctx=target.getContext('2d'), pts=(op.points||[]).map(p=>({x:p.x*bw,y:p.y*bh}));
      if(pts.length<2)continue;
      ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=Math.max(1,(op.size||.008)*bw);
      ctx.strokeStyle=op.color||'#d00000';ctx.globalCompositeOperation=op.tool==='eraser'?'destination-out':'source-over';
      ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);ctx.stroke();
      if(op.tool==='pencil'&&op.mode&&op.mode!=='free'){const oldSize=imageEditorState.pencilSize;imageEditorState.pencilSize=ctx.lineWidth;ctx.beginPath();strokeArrow(ctx,pts,op.mode==='double-arrow');ctx.stroke();imageEditorState.pencilSize=oldSize;}
      ctx.restore();
    }
  }
  function operationFromCurrentPath(){
    const c=imageEditorCanvas(), w=Math.max(1,c.width), h=Math.max(1,c.height);
    return {tool:imageEditorState.tool,target:imageEditorState.eraserTarget,color:imageEditorState.pencilColor,size:(imageEditorState.tool==='eraser'?imageEditorState.eraserSize:imageEditorState.pencilSize)/w,mode:imageEditorState.drawMode,points:(imageEditorState.path||[]).map(p=>({x:p.x/w,y:p.y/h}))};
  }
  function renderImageEditor(){
    const sources=[...(imageEditorState.sources||[])];
    const blank=()=>{const w=Math.max(600,Number(imageEditorState.canvasWidth)||1000),h=Math.max(800,Number(imageEditorState.canvasHeight)||1300);imageEditorState.canvasWidth=w;imageEditorState.canvasHeight=h;setCanvasSize(w,h);const b=imageBaseContext(),o=imageEditorContext();b.fillStyle='#fff';b.fillRect(0,0,w,h);o.clearRect(0,0,w,h);replayImageOperations();imageEditorState.undo=[imageLayerSnapshot()];updateImageHistory();resetImageViewport();renderTextBoxes();};
    const loadNext=()=>{const base=sources.shift();if(!base){blank();return;}const img=new Image();img.onload=()=>{imageEditorState.original=base;const ratio=Math.min(1,1800/img.naturalWidth,2400/img.naturalHeight);const w=Math.max(1,Math.round(img.naturalWidth*ratio)),h=Math.max(1,Math.round(img.naturalHeight*ratio));setCanvasSize(w,h);const b=imageBaseContext(),o=imageEditorContext();b.clearRect(0,0,w,h);b.drawImage(img,0,0,w,h);o.clearRect(0,0,w,h);replayImageOperations();if(imageEditorState.overlay){const ov=new Image();ov.onload=()=>{o.drawImage(ov,0,0,w,h);imageEditorState.undo=[imageLayerSnapshot()];updateImageHistory();resetImageViewport();renderTextBoxes();};ov.onerror=()=>{imageEditorState.undo=[imageLayerSnapshot()];updateImageHistory();resetImageViewport();renderTextBoxes();};ov.src=imageEditorState.overlay;}else{imageEditorState.undo=[imageLayerSnapshot()];updateImageHistory();resetImageViewport();renderTextBoxes();}};img.onerror=loadNext;img.src=encodeURI(base);};loadNext();
  }
  function syncImageSwatches(){$('#imageTextSwatch').style.background=imageEditorState.textColor;$('#imagePencilSwatch').style.background=imageEditorState.pencilColor;}
  function remoteImageKey(songId,owner,mode='image'){return `${imageEditScope(owner,mode)}-${String(songId).replace(/[^a-zA-Z0-9_-]/g,'_')}`;}
  function remoteImageRef(songId,owner,mode='image'){
    if(!remoteDb||!remoteDoc)return null;
    return remoteDoc(remoteDb,'imageEdits',remoteImageKey(songId,owner,mode));
  }
  async function loadRemoteImageEdit(songId,owner,mode='image'){
    const editId=remoteImageKey(songId,owner,mode);
    const local=await offlineStoreGet('imageEdits',editId);
    if(!navigator.onLine)return local;
    try{
      await initRemoteSync();
      if(!remoteGetDoc)throw new Error('Firestore todavía no está listo');
      const ref=remoteImageRef(songId,owner,mode);
      if(!ref)throw new Error('No se pudo crear la referencia imageEdits');
      const snap=await remoteGetDoc(ref);
      const remote=snap.exists()?(snap.data()||null):null;
      // Una edición local pendiente nunca debe ser reemplazada por una copia
      // remota anterior. Cuando no hay cambios pendientes, Firestore vuelve a
      // ser la fuente compartida entre dispositivos.
      const latest=(local&&local.pendingSync)?local:(remote||local);
      if(latest){await offlineStorePut('imageEdits',{...latest,editId});cacheEditorImage(latest.originalSrc||latest.original||'');}
      return latest;
    }catch(err){console.warn('Se usará la edición offline',err);return local;}
  }
  async function openImageEditor(songId,owner,mode='image'){
    const song=state.songs.find(x=>x.id===songId);if(!song)return;
    activeImageMode=mode==='songbook'?'songbook':'image';
    const viewerMatchesOwner=owner==='daniel'
      ? activeViewerType==='daniel-image'
      : (activeViewerType==='notes'||activeViewerType==='lyrics');
    returnToImageViewer=Boolean($('#viewerDialog')?.open&&activeViewerSongId===songId&&viewerMatchesOwner);
    activeImageSongId=songId;activeImageOwner=owner;
    $('#imageEditorTitle').textContent=activeImageMode==='songbook'
      ? `Cancionero ${ownerLabel(owner)} · ${song.titulo}`
      : `Imagen ${ownerLabel(owner)} · ${song.titulo}`;
    const editorDialog=$('#imageEditorDialog');
    const uploadTrigger=$('#imageUploadTrigger');
    const uploadWrap=uploadTrigger?.closest('.toolbar-popover-wrap');
    const uploadInput=$('#imageSourceInput');
    const hideUpload=activeImageMode==='songbook';
    // Cancionero Elena y Cancionero Daniel comparten el editor visual, pero
    // nunca deben ofrecer controles para subir, reemplazar o eliminar fotos.
    if(editorDialog){
      editorDialog.classList.toggle('is-songbook-mode',hideUpload);
      editorDialog.dataset.editorMode=activeImageMode;
    }
    if(uploadTrigger){
      uploadTrigger.hidden=hideUpload;
      uploadTrigger.disabled=hideUpload;
      uploadTrigger.style.setProperty('display',hideUpload?'none':'','important');
      uploadTrigger.setAttribute('aria-hidden',hideUpload?'true':'false');
      uploadTrigger.tabIndex=hideUpload?-1:0;
    }
    if(uploadWrap){
      uploadWrap.hidden=hideUpload;
      uploadWrap.style.setProperty('display',hideUpload?'none':'','important');
      uploadWrap.setAttribute('aria-hidden',hideUpload?'true':'false');
    }
    if(uploadInput){uploadInput.disabled=hideUpload;uploadInput.tabIndex=hideUpload?-1:0;}
    if(imageUploadMenu)imageUploadMenu.hidden=true;
    const localRaw=song[visualField(owner,activeImageMode)];
    const remote=await loadRemoteImageEdit(songId,owner,activeImageMode);
    // 6.36.37: el editor usa la misma fuente oficial que el visor. Si existe
    // imageEdits, sus capas siempre prevalecen sobre copias antiguas del objeto canción.
    const raw=remote ? {
      original:remote.originalSrc||remote.original||'',
      canvasWidth:Number(remote.canvasWidth)||1000,
      canvasHeight:Number(remote.canvasHeight)||1300,
      operations:Array.isArray(remote.operations)?remote.operations:[],
      textBoxes:Array.isArray(remote.textBoxes)?remote.textBoxes:[],
      updatedAt:remote.updatedAt||Date.now(),remote:true
    } : (localRaw&&typeof localRaw==='object'?localRaw:{});
    if(remote) song[visualField(owner,activeImageMode)]={...raw};
    const baseSources=[];
    const addBase=value=>{if(!value)return;const v=String(value);if(!baseSources.includes(v))baseSources.push(v);};
    if(activeImageMode==='image'){
      addBase(raw.original);
      // Evitar usar una previsualización compuesta como foto base: el editor debe
      // reconstruir siempre foto + operaciones + cajas editables.
      const fieldValue=localRaw&&typeof localRaw==='object'?(localRaw.original||localRaw.src||localRaw.dataUrl||''):localRaw;
      addBase(fieldValue);
      if(owner==='elena'){
        const fallback=state.notes[slug(song.titulo)];
        (Array.isArray(fallback)?fallback:[fallback]).forEach(value=>{
          if(!value)return;const v=String(value);addBase(v.startsWith('data:')||v.startsWith('http:')||v.startsWith('https:')||v.startsWith('assets/')?v:`assets/anotaciones/${v}`);
        });
      }
    }
    const prepared=activeImageMode==='songbook'?prepareSongbookLayout(raw.textBoxes,raw.operations,raw.canvasWidth||1000,raw.canvasHeight||1300):{canvasWidth:Number(raw.canvasWidth)||1000,canvasHeight:Number(raw.canvasHeight)||1300,textBoxes:Array.isArray(raw.textBoxes)?raw.textBoxes:[],operations:Array.isArray(raw.operations)?raw.operations:[]};
    imageEditorState.sources=baseSources;imageEditorState.original=baseSources[0]||'';imageEditorState.overlay=raw.drawingOverlay||raw.overlay||'';imageEditorState.canvasWidth=prepared.canvasWidth;imageEditorState.canvasHeight=prepared.canvasHeight;imageEditorState.operations=prepared.operations.map(x=>({...x,points:Array.isArray(x.points)?x.points.map(p=>({...p})):[]}));imageEditorState.textBoxes=prepared.textBoxes.map(x=>({...x}));imageEditorState.activeTextBoxId=null;
    Object.assign(imageEditorState,{tool:'pencil',pencilSize:8,eraserSize:100,textSize:9,pencilColor:'#d00000',textColor:'#d00000',drawMode:'free',eraserTarget:'annotations',drawing:false,textBold:false,textItalic:false,textX:.05,textY:.05,scale:1,panX:0,panY:0,textGesture:null});imageInlineText.value='';imageInlineText.hidden=true;
    $('#imageToolPencil').classList.add('is-active');$('#imageToolEraser').classList.remove('is-active');$('#imageTextTool').classList.remove('is-active');syncImageSwatches();resetImageEditorDirty();$('#imageEditorDialog').showModal();requestAnimationFrame(()=>{renderImageEditor();rememberDialogState($('#imageEditorDialog'));});
  }
  const imageUploadMenu=$('#imageUploadOptions');
  $('#imageUploadTrigger').addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    if(activeImageMode==='songbook')return;
    if(!imageUploadMenu.hidden){imageUploadMenu.hidden=true;return;}
    positionPopover(imageUploadMenu,$('#imageUploadTrigger'));
  });
  $('#imageChoosePhotoBtn').addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    if(activeImageMode==='songbook')return;
    const input=$('#imageSourceInput');
    input.disabled=false;
    input.value='';
    // Mantener la apertura dentro del gesto real del usuario. En Firefox/macOS
    // showPicker es más fiable que un click programático sobre un input oculto.
    try{
      if(typeof input.showPicker==='function')input.showPicker();
      else input.click();
    }catch(err){
      try{input.click();}catch(_){toast('No se pudo abrir el selector de archivos');}
    }
    imageUploadMenu.hidden=true;
  });
  $('#imageDeletePhotoBtn').addEventListener('click',()=>{
    imageUploadMenu.hidden=true;
    if(activeImageMode==='songbook')return;
    if(!imageEditorState.original){toast('No hay una foto para eliminar');return;}
    askConfirm('Eliminar fotografía','Se eliminará únicamente la fotografía. Los dibujos y cajas de texto se conservarán sobre un lienzo blanco.',async()=>{
      imageEditorState.original='';
      imageEditorState.sources=[];
      imageEditorState.overlay='';
      renderImageEditor();
      await persistImageEditorLayers(false);
      toast('Fotografía eliminada · lienzo blanco activo');
    },'Eliminar');
  });
  document.addEventListener('pointerdown',e=>{
    if(!imageUploadMenu.hidden&&!e.target.closest('#imageUploadOptions,#imageUploadTrigger'))imageUploadMenu.hidden=true;
  });
  async function compressEditorPhoto(file){
    const dataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(new Error('No se pudo leer la imagen'));r.onload=()=>resolve(String(r.result||''));r.readAsDataURL(file);});
    const img=await new Promise((resolve,reject)=>{const x=new Image();x.onload=()=>resolve(x);x.onerror=()=>reject(new Error('No se pudo abrir la imagen'));x.src=dataUrl;});
    let maxW=1280,maxH=1800,quality=.78,result='';
    for(let pass=0;pass<6;pass++){
      const ratio=Math.min(1,maxW/Math.max(1,img.naturalWidth),maxH/Math.max(1,img.naturalHeight));
      const w=Math.max(1,Math.round(img.naturalWidth*ratio)),h=Math.max(1,Math.round(img.naturalHeight*ratio));
      const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
      const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
      result=canvas.toDataURL('image/jpeg',quality);
      // Mantener el documento imageEdits con margen bajo el límite de 1 MiB de Firestore.
      if(result.length<=650000)return result;
      quality=Math.max(.48,quality-.08);maxW=Math.round(maxW*.86);maxH=Math.round(maxH*.86);
    }
    if(result.length>780000)throw new Error('La foto sigue siendo demasiado grande; elige una imagen más pequeña');
    return result;
  }
  $('#imageSourceInput').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    if(!/^image\/(jpeg|png|webp)$/i.test(file.type)){toast('Selecciona una imagen JPG, PNG o WEBP');e.target.value='';return;}
    if(file.size>20*1024*1024){toast('La imagen supera 20 MB');e.target.value='';return;}
    const proceed=async()=>{
      try{
        toast('Preparando imagen…');
        const compressed=await compressEditorPhoto(file);
        imageEditorState.original=compressed;imageEditorState.sources=[compressed];imageEditorState.overlay='';markImageEditorDirty();
        // Al reemplazar la foto se conservan las operaciones y cajas como capas editables.
        renderImageEditor();
        await persistImageEditorLayers(false);
        toast('Imagen lista para guardar');
      }catch(err){console.error(err);toast(err?.message||'No se pudo preparar la imagen');}
    };
    if(imageEditorState.original)askConfirm('Reemplazar imagen','La fotografía vinculada será reemplazada. Las anotaciones actuales se conservarán en una capa separada.',proceed,'Reemplazar');else await proceed();
  });
  function textBoxLayer(){
    let layer=$('#imageTextBoxLayer');
    if(!layer){layer=document.createElement('div');layer.id='imageTextBoxLayer';layer.className='image-textbox-layer';imageEditorPaper().append(layer);}
    return layer;
  }
  function escapeTextHtml(value){return String(value||'').replace(/[&<>]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch])).replace(/\n/g,'<br>');}
  function normalizeTextBoxRichContent(box){
    if(typeof box.html==='string')return;
    let html=escapeTextHtml(box.text||'');
    if(box.bold)html=`<b>${html}</b>`;
    if(box.italic)html=`<i>${html}</i>`;
    box.html=html;
    box.bold=false;box.italic=false;
  }
  function newTextBox(x,y){
    const box={id:`txt-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,x,y,w:.34,h:.13,rotation:0,text:'',html:'',color:imageEditorState.textColor,size:imageEditorState.textSize,bold:false,italic:false,align:'left',locked:false};
    imageEditorState.textBoxes.push(box);imageEditorState.activeTextBoxId=box.id;markImageEditorDirty();renderTextBoxes(true);return box;
  }
  function activeTextBox(){return imageEditorState.textBoxes.find(x=>x.id===imageEditorState.activeTextBoxId)||null;}
  function applyTextBoxStyle(el,box){
    normalizeTextBoxRichContent(box);
    el.style.left=`${box.x*100}%`;el.style.top=`${box.y*100}%`;el.style.width=`${box.w*100}%`;el.style.height=`${box.h*100}%`;el.style.transform=`rotate(${box.rotation||0}deg)`;
    const area=el.querySelector('.text-box-editor');
    if(area&&document.activeElement!==area&&area.innerHTML!==box.html)area.innerHTML=box.html||'';
    if(area){
      box.locked=Boolean(box.locked);
      el.classList.toggle('is-locked',box.locked);
      area.contentEditable=box.locked?'false':'true';
      area.setAttribute('aria-readonly',box.locked?'true':'false');
      const paperWidth=Math.max(1,imageEditorPaper().offsetWidth||1);
      const fontPx=Number(box.fontRatio)>0?Number(box.fontRatio)*paperWidth:Math.max(16,(box.size||9)*3);
      area.style.color=box.color||'#d00000';area.style.fontSize=`${fontPx}px`;area.style.fontWeight='400';area.style.fontStyle='normal';area.style.textAlign=['left','center','right'].includes(box.align)?box.align:'left';
    }
  }
  function renderTextBoxes(focusActive=false){
    const layer=textBoxLayer();layer.innerHTML='';
    imageEditorState.textBoxes.forEach(box=>{
      const el=document.createElement('div');el.className='image-text-box'+(box.id===imageEditorState.activeTextBoxId?' is-selected':'');el.dataset.id=box.id;
      el.innerHTML='<div class="text-box-editor" contenteditable="true" spellcheck="false" role="textbox" aria-multiline="true" aria-label="Caja de texto"></div><button type="button" class="text-box-delete" aria-label="Eliminar texto"><b>×</b><small>Eliminar</small></button><button type="button" class="text-box-align" aria-label="Cambiar alineación del texto"><b>≡</b><small>Alinear</small></button><button type="button" class="text-box-lock" aria-label="Bloquear caja con doble toque"><b>🔓</b><small>Bloquear</small></button><button type="button" class="text-box-move" aria-label="Mover caja"><b>↔</b><small>Mover</small></button><button type="button" class="text-box-rotate" aria-label="Girar caja"><b>↻</b><small>Girar</small></button><button type="button" class="text-box-resize" aria-label="Cambiar tamaño"><b>↘</b><small>Tamaño</small></button>';
      applyTextBoxStyle(el,box);layer.append(el);
      const area=el.querySelector('.text-box-editor');
      const rememberSelection=()=>{const sel=getSelection();if(!sel||!sel.rangeCount)return;const range=sel.getRangeAt(0);if(area.contains(range.commonAncestorContainer))box._selection=range.cloneRange();};
      area.addEventListener('focus',()=>{if(box.locked){area.blur();return;}imageEditorState.activeTextBoxId=box.id;renderTextBoxSelection();updateImageTextFormatButtons(area);setTimeout(keepFocusedTextBoxVisible,60);});
      area.addEventListener('keyup',rememberSelection);area.addEventListener('pointerup',rememberSelection);area.addEventListener('selectstart',()=>setTimeout(rememberSelection,0));
      area.addEventListener('input',()=>{if(box.locked)return;box.html=area.innerHTML;box.text=area.innerText.replace(/\n$/,'');rememberSelection();updateImageTextFormatButtons(area);markImageEditorDirty();scheduleImageTextAutosave();setTimeout(keepFocusedTextBoxVisible,0);});
      area.addEventListener('blur',()=>{if(!box.locked&&imageEditorChangeRevision!==imageEditorSavedRevision)scheduleImageTextAutosave();});
      el.addEventListener('pointerdown',e=>{if(box.locked&&!e.target.closest('button')){imageEditorState.activeTextBoxId=box.id;renderTextBoxSelection();e.preventDefault();e.stopPropagation();}});
      el.querySelector('.text-box-delete').addEventListener('pointerdown',e=>{if(box.locked)return;e.preventDefault();e.stopPropagation();imageEditorState.textBoxes=imageEditorState.textBoxes.filter(x=>x.id!==box.id);imageEditorState.activeTextBoxId=null;markImageEditorDirty();renderTextBoxes();persistImageEditorLayers(false);});
      const alignButton=el.querySelector('.text-box-align');
      const syncAlignButton=()=>{const align=['left','center','right'].includes(box.align)?box.align:'left';alignButton.dataset.align=align;alignButton.querySelector('b').textContent=align==='left'?'≡':align==='center'?'☰':'≣';alignButton.setAttribute('aria-label',`Alineación ${align}. Pulsar para cambiar`);};
      syncAlignButton();
      alignButton.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();});
      alignButton.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();if(box.locked)return;imageEditorState.activeTextBoxId=box.id;const order=['left','center','right'];const current=order.includes(box.align)?box.align:'left';box.align=order[(order.indexOf(current)+1)%order.length];area.style.textAlign=box.align;syncAlignButton();renderTextBoxSelection();markImageEditorDirty();persistImageEditorLayers(false);});
      const lockButton=el.querySelector('.text-box-lock');
      const syncLockButton=()=>{lockButton.querySelector('b').textContent=box.locked?'🔒':'🔓';lockButton.querySelector('small').textContent=box.locked?'Bloqueada':'Bloquear';lockButton.setAttribute('aria-label',box.locked?'Caja bloqueada. Doble toque para desbloquear':'Caja desbloqueada. Doble toque para bloquear');};
      syncLockButton();
      let lastLockTap=0,lastLockPointer='';
      lockButton.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();});
      lockButton.addEventListener('pointerup',e=>{e.preventDefault();e.stopPropagation();const now=Date.now(),kind=e.pointerType||'mouse';if(kind===lastLockPointer&&now-lastLockTap<430){lastLockTap=0;lastLockPointer='';box.locked=!box.locked;imageEditorState.activeTextBoxId=box.id;syncImageTextBoxesFromDom();markImageEditorDirty();renderTextBoxes();persistImageEditorLayers(false);}else{lastLockTap=now;lastLockPointer=kind;imageEditorState.activeTextBoxId=box.id;renderTextBoxSelection();}});
      bindTextBoxDrag(el.querySelector('.text-box-move'),el,box);
      bindTextBoxResize(el.querySelector('.text-box-resize'),box);
      bindTextBoxRotate(el.querySelector('.text-box-rotate'),box);
    });
    if(focusActive){const area=layer.querySelector(`[data-id="${imageEditorState.activeTextBoxId}"] .text-box-editor`);if(area){try{area.focus({preventScroll:true});}catch(_){area.focus();}const range=document.createRange(),sel=getSelection();range.selectNodeContents(area);range.collapse(false);sel.removeAllRanges();sel.addRange(range);activeTextBox()._selection=range.cloneRange();}}
  }
  function renderTextBoxSelection(){textBoxLayer().querySelectorAll('.image-text-box').forEach(el=>el.classList.toggle('is-selected',el.dataset.id===imageEditorState.activeTextBoxId));}
  function bindTextBoxDrag(handle,el,box){let drag=null;
    handle.addEventListener('pointerdown',e=>{if(box.locked)return;imageEditorState.activeTextBoxId=box.id;renderTextBoxSelection();const paper=imageEditorPaper(),r=paper.getBoundingClientRect();drag={id:e.pointerId,x:e.clientX,y:e.clientY,bx:box.x,by:box.y,w:r.width,h:r.height};handle.setPointerCapture?.(e.pointerId);e.preventDefault();e.stopPropagation();});
    handle.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;box.x=Math.max(-1.5,Math.min(2.5,drag.bx+(e.clientX-drag.x)/drag.w));box.y=Math.max(-1.5,Math.min(2.5,drag.by+(e.clientY-drag.y)/drag.h));applyTextBoxStyle(el,box);e.preventDefault();});
    const end=e=>{if(!drag||drag.id!==e.pointerId)return;drag=null;markImageEditorDirty();persistImageEditorLayers(false);};handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
  }
  function bindTextBoxResize(handle,box){let d=null;handle.addEventListener('pointerdown',e=>{if(box.locked)return;const r=imageEditorPaper().getBoundingClientRect();d={id:e.pointerId,x:e.clientX,y:e.clientY,w:box.w,h:box.h,pw:r.width,ph:r.height};handle.setPointerCapture?.(e.pointerId);e.preventDefault();e.stopPropagation();});handle.addEventListener('pointermove',e=>{if(!d||d.id!==e.pointerId)return;box.w=Math.max(.12,Math.min(2,d.w+(e.clientX-d.x)/d.pw));box.h=Math.max(.07,Math.min(2,d.h+(e.clientY-d.y)/d.ph));applyTextBoxStyle(handle.parentElement,box);e.preventDefault();});const end=e=>{if(d&&d.id===e.pointerId){d=null;markImageEditorDirty();persistImageEditorLayers(false);}};handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);}
  function bindTextBoxRotate(handle,box){let d=null;handle.addEventListener('pointerdown',e=>{if(box.locked)return;const r=handle.parentElement.getBoundingClientRect();d={id:e.pointerId,cx:r.left+r.width/2,cy:r.top+r.height/2,start:Math.atan2(e.clientY-(r.top+r.height/2),e.clientX-(r.left+r.width/2)),rotation:box.rotation||0};handle.setPointerCapture?.(e.pointerId);e.preventDefault();e.stopPropagation();});handle.addEventListener('pointermove',e=>{if(!d||d.id!==e.pointerId)return;const a=Math.atan2(e.clientY-d.cy,e.clientX-d.cx);box.rotation=d.rotation+(a-d.start)*180/Math.PI;applyTextBoxStyle(handle.parentElement,box);e.preventDefault();});const end=e=>{if(d&&d.id===e.pointerId){d=null;markImageEditorDirty();persistImageEditorLayers(false);}};handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);}
  function activeTextEditor(){const box=activeTextBox();return box?textBoxLayer().querySelector(`[data-id="${box.id}"] .text-box-editor`):null;}
  function restoreImageTextSelection(area,box){
    if(!area||!box)return false;
    try{area.focus({preventScroll:true});}catch(_){area.focus();}
    const sel=getSelection();
    if(box._selection&&area.contains(box._selection.commonAncestorContainer)){sel.removeAllRanges();sel.addRange(box._selection);return true;}
    const range=document.createRange();range.selectNodeContents(area);range.collapse(false);sel.removeAllRanges();sel.addRange(range);box._selection=range.cloneRange();return true;
  }
  function updateImageTextFormatButtons(area=activeTextEditor()){
    if(area&&document.activeElement===area){imageEditorState.textBold=document.queryCommandState('bold');imageEditorState.textItalic=document.queryCommandState('italic');}
    $('#imageBold').classList.toggle('is-active',Boolean(imageEditorState.textBold));$('#imageItalic').classList.toggle('is-active',Boolean(imageEditorState.textItalic));
  }
  function applyImageTextCommand(command){
    const box=activeTextBox(),area=activeTextEditor();
    if(!box||!area){imageEditorState[command==='bold'?'textBold':'textItalic']=!imageEditorState[command==='bold'?'textBold':'textItalic'];updateImageTextFormatButtons();return;}
    restoreImageTextSelection(area,box);
    document.execCommand('styleWithCSS',false,false);
    document.execCommand(command,false,null);
    box.html=area.innerHTML;box.text=area.innerText.replace(/\n$/,'');
    const sel=getSelection();if(sel?.rangeCount&&area.contains(sel.getRangeAt(0).commonAncestorContainer))box._selection=sel.getRangeAt(0).cloneRange();
    updateImageTextFormatButtons(area);markImageEditorDirty();persistImageEditorLayers(false);
  }
  function syncInlineTextStyle(){
    const box=activeTextBox();if(box){box.color=imageEditorState.textColor;box.size=imageEditorState.textSize;const el=textBoxLayer().querySelector(`[data-id="${box.id}"]`);if(el)applyTextBoxStyle(el,box);}
    updateImageTextFormatButtons();syncImageSwatches();
  }
  function placeImageTextAt(clientX,clientY){const paper=imageEditorPaper(),r=paper.getBoundingClientRect();const x=(clientX-r.left)/Math.max(1,r.width),y=(clientY-r.top)/Math.max(1,r.height);newTextBox(x,y);}
  function activateImageText(){imageEditorState.tool='text';imageEditorPaper().classList.add('text-mode');$('#imageTextTool').classList.add('is-active');$('#imageToolPencil').classList.remove('is-active');$('#imageToolEraser').classList.remove('is-active');syncInlineTextStyle();}
  function syncImageTextBoxesFromDom(){
    const layer=document.querySelector('#imageTextBoxLayer');
    if(!layer)return;
    layer.querySelectorAll('.image-text-box[data-id]').forEach(el=>{
      const box=imageEditorState.textBoxes.find(item=>item.id===el.dataset.id);
      const area=el.querySelector('.text-box-editor');
      if(!box||!area)return;
      box.html=area.innerHTML;
      box.text=area.innerText.replace(/\n$/,'');
      const paperWidth=Math.max(1,imageEditorPaper().offsetWidth||1);
      const fontPx=parseFloat(area.style.fontSize||getComputedStyle(area).fontSize)||Math.max(16,(box.size||9)*3);
      box.fontRatio=fontPx/paperWidth;
      const align=area.style.textAlign||getComputedStyle(area).textAlign;
      if(['left','center','right'].includes(align))box.align=align;
    });
  }
  function commitImageText(){
    // Copia el contenido visible sin ejecutar una composición pesada en cada cambio de herramienta.
    syncImageTextBoxesFromDom();
    renderTextBoxes();
    scheduleImageTextAutosave();
  }
  let suppressTextClick=false,textHold=0;const imageTextButton=$('#imageTextTool'),imageTextMenu=$('#imageTextOptions');imageTextButton.addEventListener('contextmenu',e=>e.preventDefault());imageTextButton.addEventListener('click',()=>{if(suppressTextClick){suppressTextClick=false;return;}if(!imageTextMenu.hidden){imageTextMenu.hidden=true;return;}activateImageText();});imageTextButton.addEventListener('pointerdown',()=>{clearTimeout(textHold);suppressTextClick=false;textHold=setTimeout(()=>{suppressTextClick=true;activateImageText();positionPopover(imageTextMenu,imageTextButton);},520);});['pointerup','pointercancel'].forEach(n=>imageTextButton.addEventListener(n,()=>clearTimeout(textHold)));
  $$('[data-image-text-color]').forEach(b=>b.addEventListener('click',()=>{imageEditorState.textColor=b.dataset.imageTextColor;$('#imageTextOptions').hidden=true;syncInlineTextStyle();}));
  $$('[data-image-text-size]').forEach(b=>b.addEventListener('click',()=>{imageEditorState.textSize=Number(b.dataset.imageTextSize);$('#imageTextOptions').hidden=true;syncInlineTextStyle();}));
  $('#imageBold').addEventListener('pointerdown',e=>e.preventDefault());
  $('#imageItalic').addEventListener('pointerdown',e=>e.preventDefault());
  $('#imageBold').addEventListener('click',()=>applyImageTextCommand('bold'));
  $('#imageItalic').addEventListener('click',()=>applyImageTextCommand('italic'));
  function activateImagePencil(){
    commitImageText();
    imageEditorState.tool='pencil';
    imageEditorPaper().classList.remove('text-mode');
    $('#imageTextTool').classList.remove('is-active');
    $('#imageToolPencil').classList.add('is-active');
    $('#imageToolEraser').classList.remove('is-active');
    syncImageEraserCursor();
  }
  $('#imageToolPencil').addEventListener('click',e=>{const menu=$('#imagePencilOptions');if(menu&&!menu.hidden){menu.hidden=true;e.preventDefault();return;}activateImagePencil();});
  $$('[data-image-pencil-color]').forEach(b=>b.addEventListener('click',()=>{activateImagePencil();imageEditorState.pencilColor=b.dataset.imagePencilColor;$('#imagePencilOptions').hidden=true;syncImageSwatches();}));
  let imageEraserHold=0;$('#imageToolEraser').addEventListener('pointerdown',e=>{imageEraserHold=setTimeout(()=>positionPopover($('#imageEraserOptions'),e.currentTarget),550);});['pointerup','pointercancel','pointerleave'].forEach(name=>$('#imageToolEraser').addEventListener(name,()=>clearTimeout(imageEraserHold)));
  $('#imageToolEraser').addEventListener('click',()=>{commitImageText();imageEditorState.tool='eraser';imageEditorPaper().classList.remove('text-mode');$('#imageToolEraser').classList.add('is-active');$('#imageToolPencil').classList.remove('is-active');$('#imageTextTool').classList.remove('is-active');syncImageEraserCursor();});
  $$('[data-image-eraser-target]').forEach(btn=>btn.addEventListener('click',()=>{imageEditorState.eraserTarget=btn.dataset.imageEraserTarget;imageEditorState.tool='eraser';$('#imageEraserOptions').hidden=true;syncImageEraserCursor();toast(imageEditorState.eraserTarget==='photo'?'Borrador: parte de la foto':'Borrador: anotaciones');}));
  $$('[data-image-eraser-size]').forEach(btn=>btn.addEventListener('click',()=>{imageEditorState.eraserSize=Number(btn.dataset.imageEraserSize);imageEditorState.tool='eraser';$('#imageEraserOptions').hidden=true;syncImageEraserCursor();}));
  function finishImagePencilOptionChange(control){
    activateImagePencil();
    const menu=$('#imagePencilOptions');
    if(menu)menu.hidden=true;
    control?.blur?.();
  }
  $('#imageDrawSize').addEventListener('change',e=>{
    imageEditorState.pencilSize=Number(e.target.value);
    finishImagePencilOptionChange(e.currentTarget);
  });
  $('#imageDrawMode').addEventListener('change',e=>{
    imageEditorState.drawMode=e.target.value;
    finishImagePencilOptionChange(e.currentTarget);
  });
  function imagePoint(e){const c=imageEditorCanvas(),r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*c.width/r.width,y:(e.clientY-r.top)*c.height/r.height};}
  function imageEraserCursor(){
    let cursor=$('#imageEraserCursor');
    if(!cursor){cursor=document.createElement('div');cursor.id='imageEraserCursor';cursor.className='image-eraser-cursor';cursor.hidden=true;$('#imageEditorStage').append(cursor);}
    return cursor;
  }
  function syncImageEraserCursor(e){
    const cursor=imageEraserCursor(),active=imageEditorState.tool==='eraser';
    imageEditorPaper().classList.toggle('eraser-mode',active);
    if(!active){cursor.hidden=true;return;}
    const canvas=imageEditorCanvas(),rect=canvas.getBoundingClientRect();
    const diameter=Math.max(6,imageEditorState.eraserSize*(rect.width/Math.max(1,canvas.width)));
    cursor.style.width=`${diameter}px`;cursor.style.height=`${diameter}px`;
    cursor.dataset.target=imageEditorState.eraserTarget;
    if(e){const stageRect=$('#imageEditorStage').getBoundingClientRect();cursor.style.left=`${e.clientX-stageRect.left}px`;cursor.style.top=`${e.clientY-stageRect.top}px`;cursor.hidden=false;}
  }
  function hideImageEraserCursor(e){if(!e||e.pointerType!=='mouse')imageEraserCursor().hidden=true;}
  function arrowTangent(path,atEnd=true){if(!path||path.length<2)return null;const edge=atEnd?path.length-1:0,step=atEnd?-1:1,tip=path[edge];let i=edge+step;while(i>=0&&i<path.length){const q=path[i];if(Math.hypot(tip.x-q.x,tip.y-q.y)>=Math.max(5,imageEditorState.pencilSize*.8))return {from:q,tip};i+=step;}const q=path[Math.max(0,Math.min(path.length-1,edge+step))];return {from:q,tip};}
  function strokeArrow(ctx,path,both=false){const len=Math.max(18,imageEditorState.pencilSize*3);const head=t=>{const ang=Math.atan2(t.tip.y-t.from.y,t.tip.x-t.from.x);ctx.moveTo(t.tip.x,t.tip.y);ctx.lineTo(t.tip.x-len*Math.cos(ang-Math.PI/6),t.tip.y-len*Math.sin(ang-Math.PI/6));ctx.moveTo(t.tip.x,t.tip.y);ctx.lineTo(t.tip.x-len*Math.cos(ang+Math.PI/6),t.tip.y-len*Math.sin(ang+Math.PI/6));};const end=arrowTangent(path,true);if(end)head(end);if(both){const start=arrowTangent(path,false);if(start)head(start);}}
  imageEditorCanvas().addEventListener('pointerdown',e=>{if(e.pointerType==='touch'&&imageEditorState.pointers.size>1)return;const pencilMenu=$('#imagePencilOptions');if(pencilMenu&&!pencilMenu.hidden){pencilMenu.hidden=true;activateImagePencil();}if(imageEditorState.tool==='text')return;syncImageEraserCursor(e);e.preventDefault();imageEditorState.drawing=true;imageEditorState.last=imagePoint(e);imageEditorState.path=[imageEditorState.last];e.currentTarget.setPointerCapture(e.pointerId);});
  imageEditorCanvas().addEventListener('pointermove',e=>{syncImageEraserCursor(e);if(imageEditorState.pointers.size>=2)return;if(!imageEditorState.drawing)return;e.preventDefault();const p=imagePoint(e),target=imageEditorState.tool==='eraser'&&imageEditorState.eraserTarget==='photo'?imageBaseCanvas():imageEditorCanvas(),ctx=target.getContext('2d');ctx.save();ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=imageEditorState.tool==='eraser'?imageEditorState.eraserSize:imageEditorState.pencilSize;ctx.strokeStyle=imageEditorState.pencilColor;ctx.globalCompositeOperation=imageEditorState.tool==='eraser'?'destination-out':'source-over';ctx.beginPath();ctx.moveTo(imageEditorState.last.x,imageEditorState.last.y);ctx.lineTo(p.x,p.y);ctx.stroke();ctx.restore();imageEditorState.last=p;imageEditorState.path.push(p);});
  const finishImageDraw=e=>{hideImageEraserCursor(e);if(!imageEditorState.drawing)return;imageEditorState.drawing=false;if(imageEditorState.tool==='pencil'&&imageEditorState.drawMode!=='free'&&imageEditorState.path.length>1){const ctx=imageEditorContext();ctx.save();ctx.strokeStyle=imageEditorState.pencilColor;ctx.lineWidth=imageEditorState.pencilSize;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();strokeArrow(ctx,imageEditorState.path,imageEditorState.drawMode==='double-arrow');ctx.stroke();ctx.restore();}if(imageEditorState.path.length>1){imageEditorState.operations.push(operationFromCurrentPath());markImageEditorDirty();}pushImageHistory();persistImageEditorLayers(false);};imageEditorCanvas().addEventListener('pointerup',finishImageDraw);imageEditorCanvas().addEventListener('pointercancel',finishImageDraw);imageEditorCanvas().addEventListener('pointerenter',e=>syncImageEraserCursor(e));imageEditorCanvas().addEventListener('pointerleave',e=>{if(!imageEditorState.drawing)imageEraserCursor().hidden=true;});
  $('#imageUndo').addEventListener('click',()=>{if(imageEditorState.undo.length<=1)return;imageEditorState.redo.push(imageEditorState.undo.pop());restoreImageSnapshot(imageEditorState.undo.at(-1));updateImageHistory();});$('#imageRedo').addEventListener('click',()=>{if(!imageEditorState.redo.length)return;const x=imageEditorState.redo.pop();imageEditorState.undo.push(x);restoreImageSnapshot(x);updateImageHistory();});
  let imageKeyboardRestorePanY=null;
  function restoreImageViewportAfterKeyboard(){
    if(imageKeyboardRestorePanY===null)return;
    imageEditorState.panY=imageKeyboardRestorePanY;imageKeyboardRestorePanY=null;applyImageTransform();
  }
  function keepFocusedTextBoxVisible(){
    const dialog=$('#imageEditorDialog'),vv=window.visualViewport,area=document.activeElement?.closest?.('.text-box-editor');
    if(!dialog?.open||!vv||!area||area.contentEditable==='false')return;
    const viewportBottom=vv.offsetTop+vv.height,viewportTop=vv.offsetTop,margin=18,toolbarGap=62;
    const rect=area.getBoundingClientRect();
    if(vv.height>=window.innerHeight*.82){restoreImageViewportAfterKeyboard();return;}
    if(imageKeyboardRestorePanY===null)imageKeyboardRestorePanY=imageEditorState.panY;
    let shift=0;
    if(rect.bottom>viewportBottom-margin)shift=rect.bottom-(viewportBottom-margin);
    else if(rect.top<viewportTop+toolbarGap)shift=rect.top-(viewportTop+toolbarGap);
    if(Math.abs(shift)>1){imageEditorState.panY-=shift;applyImageTransform();}
  }
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize',()=>requestAnimationFrame(keepFocusedTextBoxVisible));
    window.visualViewport.addEventListener('scroll',()=>requestAnimationFrame(keepFocusedTextBoxVisible));
  }
  document.addEventListener('focusout',e=>{if(e.target?.classList?.contains('text-box-editor'))setTimeout(()=>{if(!document.activeElement?.classList?.contains('text-box-editor'))restoreImageViewportAfterKeyboard();},180);},true);
  const imageStage=$('#imageEditorStage');
  let nativeTouchPinch=null;
  const touchCenterAndDistance=touches=>{
    const a=touches[0],b=touches[1],r=imageStage.getBoundingClientRect();
    return {cx:(a.clientX+b.clientX)/2-r.left,cy:(a.clientY+b.clientY)/2-r.top,distance:Math.max(1,Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY))};
  };
  // iPhone/Android: una sola ruta táctil para el pellizco. Evita que Safari procese
  // a la vez GestureEvent + PointerEvent, que era lo que desplazaba la imagen.
  imageStage.addEventListener('touchstart',e=>{
    if(e.touches.length!==2)return;
    e.preventDefault();
    const g=touchCenterAndDistance(e.touches);
    nativeTouchPinch={distance:g.distance,scale:imageEditorState.scale,localX:(g.cx-imageEditorState.panX)/imageEditorState.scale,localY:(g.cy-imageEditorState.panY)/imageEditorState.scale};
    imageEditorState.pinch=null;
    imageEditorState.pointers.clear();
    if(imageEditorState.drawing){imageEditorState.drawing=false;imageEditorState.path=[];restoreImageSnapshot(imageEditorState.undo.at(-1));}
  },{passive:false,capture:true});
  imageStage.addEventListener('touchmove',e=>{
    if(!nativeTouchPinch||e.touches.length!==2)return;
    e.preventDefault();
    const g=touchCenterAndDistance(e.touches),raw=g.distance/nativeTouchPinch.distance;
    const next=Math.max(.12,Math.min(20,nativeTouchPinch.scale*Math.pow(raw,.9)));
    imageEditorState.scale=next;
    imageEditorState.panX=g.cx-nativeTouchPinch.localX*next;
    imageEditorState.panY=g.cy-nativeTouchPinch.localY*next;
    applyImageTransform();
  },{passive:false,capture:true});
  const finishNativeTouchPinch=e=>{if(e.touches.length<2)nativeTouchPinch=null;};
  imageStage.addEventListener('touchend',finishNativeTouchPinch,{passive:true,capture:true});
  imageStage.addEventListener('touchcancel',()=>{nativeTouchPinch=null;},{passive:true,capture:true});
  // 6.36.33 · Visor Mac robusto y lienzo blanco sin imagen.
  // - Safari/Chrome envían el pellizco como wheel + ctrlKey.
  // - El desplazamiento fino del trackpad mueve la hoja.
  // - La rueda física del mouse conserva el zoom centrado en el cursor.
  let imageWheelFrame=0,imageWheelZoomDelta=0,imageWheelX=0,imageWheelY=0;
  imageStage.addEventListener('wheel',e=>{
    e.preventDefault();
    const dx=Number.isFinite(e.deltaX)?e.deltaX:0;
    const dy=Number.isFinite(e.deltaY)?e.deltaY:0;
    const looksLikeTrackpadScroll=!e.ctrlKey&&e.deltaMode===0&&(Math.abs(dx)>0.01||Math.abs(dy)<48);
    if(looksLikeTrackpadScroll){
      // Dos dedos: mover la hoja sin límites artificiales.
      imageEditorState.panX-=dx;
      imageEditorState.panY-=dy;
      applyImageTransform();
      return;
    }
    // Pellizco o rueda física: acumular eventos y aplicar un solo cambio por frame.
    imageWheelZoomDelta+=Math.max(-36,Math.min(36,dy));
    imageWheelX=e.clientX;imageWheelY=e.clientY;
    if(imageWheelFrame)return;
    imageWheelFrame=requestAnimationFrame(()=>{
      const delta=imageWheelZoomDelta;imageWheelZoomDelta=0;imageWheelFrame=0;
      const sensitivity=e.ctrlKey?0.00115:0.00165;
      const factor=Math.max(.94,Math.min(1.06,Math.exp(-delta*sensitivity)));
      zoomImageAt(imageWheelX,imageWheelY,factor);
    });
  },{passive:false});
  // Safari puede emitir GestureEvent en algunas versiones/PWA.
  let safariGesture=null;
  imageStage.addEventListener('gesturestart',e=>{
    e.preventDefault();
    if(nativeTouchPinch)return;
    const r=imageStage.getBoundingClientRect();
    const clientX=Number.isFinite(e.clientX)&&e.clientX?e.clientX:r.left+r.width/2;
    const clientY=Number.isFinite(e.clientY)&&e.clientY?e.clientY:r.top+r.height/2;
    const cx=clientX-r.left,cy=clientY-r.top;
    safariGesture={startScale:imageEditorState.scale,localX:(cx-imageEditorState.panX)/imageEditorState.scale,localY:(cy-imageEditorState.panY)/imageEditorState.scale};
  },{passive:false});
  imageStage.addEventListener('gesturechange',e=>{
    e.preventDefault();if(nativeTouchPinch||!safariGesture)return;
    const r=imageStage.getBoundingClientRect();
    const clientX=Number.isFinite(e.clientX)&&e.clientX?e.clientX:r.left+r.width/2;
    const clientY=Number.isFinite(e.clientY)&&e.clientY?e.clientY:r.top+r.height/2;
    const cx=clientX-r.left,cy=clientY-r.top;
    const next=Math.max(.12,Math.min(20,safariGesture.startScale*Math.pow(Math.max(.05,Number(e.scale)||1),.82)));
    imageEditorState.scale=next;
    imageEditorState.panX=cx-safariGesture.localX*next;
    imageEditorState.panY=cy-safariGesture.localY*next;
    applyImageTransform();
  },{passive:false});
  imageStage.addEventListener('gestureend',e=>{e.preventDefault();safariGesture=null;},{passive:false});
  imageStage.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'&&nativeTouchPinch)return;imageEditorState.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(imageEditorState.pointers.size===2){
    // El segundo dedo convierte inmediatamente el gesto en zoom y cancela cualquier trazo iniciado por el primero.
    if(imageEditorState.drawing){imageEditorState.drawing=false;imageEditorState.path=[];restoreImageSnapshot(imageEditorState.undo.at(-1));}
    const [a,b]=[...imageEditorState.pointers.values()],r=imageStage.getBoundingClientRect();
    const cx=(a.x+b.x)/2-r.left,cy=(a.y+b.y)/2-r.top;
    imageEditorState.pinch={
      distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),
      scale:imageEditorState.scale,
      // Coordenadas locales del escenario: evita que iPhone desplace la imagen abajo/derecha.
      localX:(cx-imageEditorState.panX)/imageEditorState.scale,
      localY:(cy-imageEditorState.panY)/imageEditorState.scale
    };
    imageEditorState.panning=null;imageEditorState.textGesture=null;
  }else if(imageEditorState.tool==='text'&&!e.target.closest('.image-text-box,.egm-editor-toolbar')){imageEditorState.textGesture={id:e.pointerId,x:e.clientX,y:e.clientY,panX:imageEditorState.panX,panY:imageEditorState.panY,moved:false};}else if(e.target===imageStage){imageEditorState.panning={id:e.pointerId,x:e.clientX,y:e.clientY,panX:imageEditorState.panX,panY:imageEditorState.panY};imageStage.setPointerCapture?.(e.pointerId);}},true);
  imageStage.addEventListener('pointermove',e=>{if(e.pointerType==='touch'&&nativeTouchPinch)return;if(imageEditorState.pointers.has(e.pointerId))imageEditorState.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(imageEditorState.pointers.size===2&&imageEditorState.pinch){
    const [a,b]=[...imageEditorState.pointers.values()],d=Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),r=imageStage.getBoundingClientRect(),cx=(a.x+b.x)/2-r.left,cy=(a.y+b.y)/2-r.top;
    const pinch=imageEditorState.pinch;
    // Escala absoluta desde el inicio del gesto: evita acumular errores y que la imagen derive abajo/derecha.
    const raw=d/pinch.distance;
    const next=Math.max(.12,Math.min(20,pinch.scale*Math.pow(raw,.82)));
    imageEditorState.scale=next;
    imageEditorState.panX=cx-pinch.localX*next;
    imageEditorState.panY=cy-pinch.localY*next;
    applyImageTransform();e.preventDefault();
  }else if(imageEditorState.textGesture?.id===e.pointerId){const dx=e.clientX-imageEditorState.textGesture.x,dy=e.clientY-imageEditorState.textGesture.y;if(Math.hypot(dx,dy)>6)imageEditorState.textGesture.moved=true;if(imageEditorState.textGesture.moved){imageEditorState.panX=imageEditorState.textGesture.panX+dx;imageEditorState.panY=imageEditorState.textGesture.panY+dy;applyImageTransform();e.preventDefault();}}else if(imageEditorState.panning?.id===e.pointerId){imageEditorState.panX=imageEditorState.panning.panX+e.clientX-imageEditorState.panning.x;imageEditorState.panY=imageEditorState.panning.panY+e.clientY-imageEditorState.panning.y;applyImageTransform();e.preventDefault();}},true);
  const endImagePointer=e=>{const tg=imageEditorState.textGesture?.id===e.pointerId?imageEditorState.textGesture:null;imageEditorState.pointers.delete(e.pointerId);if(imageEditorState.pointers.size<2)imageEditorState.pinch=null;if(tg&&!tg.moved&&imageEditorState.tool==='text'){imageTextMenu.hidden=true;placeImageTextAt(e.clientX,e.clientY);}if(imageEditorState.textGesture?.id===e.pointerId)imageEditorState.textGesture=null;if(imageEditorState.panning?.id===e.pointerId)imageEditorState.panning=null;};imageStage.addEventListener('pointerup',endImagePointer,true);imageStage.addEventListener('pointercancel',endImagePointer,true);
  function drawTextBoxesToContext(ctx,w,h){
    imageEditorState.textBoxes.forEach(box=>{if(!String(box.text||'').trim())return;ctx.save();const x=box.x*w,y=box.y*h,bw=box.w*w,bh=box.h*h;ctx.translate(x+bw/2,y+bh/2);ctx.rotate((box.rotation||0)*Math.PI/180);ctx.translate(-bw/2,-bh/2);const fontSize=Number(box.fontRatio)>0?Number(box.fontRatio)*w:Math.max(18,(box.size||9)*3)*(w/Math.max(1,imageEditorPaper().offsetWidth));ctx.fillStyle=box.color||'#d00000';ctx.font=`${box.italic?'italic ':''}${box.bold?'700':'400'} ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;ctx.textBaseline='top';const align=['left','center','right'].includes(box.align)?box.align:'left';ctx.textAlign=align;const textX=align==='left'?0:align==='center'?bw/2:bw;const lineHeight=fontSize*1.25,maxWidth=Math.max(fontSize*2,bw);drawWrappedCanvasText(ctx,box.text||'',{x:textX,y:0,maxWidth,maxHeight:bh,lineHeight});ctx.restore();});
  }
  function serializeImageTextBox(box){
    // Firestore solo recibe datos simples. Rangos de selección, nodos DOM y
    // otras propiedades temporales del editor nunca deben salir del navegador.
    const clean={};
    for(const [key,value] of Object.entries(box||{})){
      if(key.startsWith('_'))continue;
      if(value===undefined||typeof value==='function')continue;
      if(value===null||['string','number','boolean'].includes(typeof value))clean[key]=value;
      else if(Array.isArray(value))clean[key]=value.map(item=>item&&typeof item==='object'?JSON.parse(JSON.stringify(item)):item);
      else if(value&&value.constructor===Object)clean[key]=JSON.parse(JSON.stringify(value));
    }
    clean.align=['left','center','right'].includes(clean.align)?clean.align:'left';
    return clean;
  }
  async function saveImageEditorVectorsRemote(){
    syncImageTextBoxesFromDom();
    const stamp=Date.now();
    const editId=remoteImageKey(activeImageSongId,activeImageOwner,activeImageMode);
    const metadata={editId,songId:activeImageSongId,owner:activeImageOwner,mode:activeImageMode,originalSrc:activeImageMode==='songbook'?'':(imageEditorState.original||''),canvasWidth:imageBaseCanvas().width||imageEditorState.canvasWidth||1000,canvasHeight:imageBaseCanvas().height||imageEditorState.canvasHeight||1300,operations:(imageEditorState.operations||[]).map(op=>({...op,points:(op.points||[]).map(p=>({...p}))})),textBoxes:imageEditorState.textBoxes.map(serializeImageTextBox),updatedAt:stamp,format:'vector-v4',source:'imageEdits',pendingSync:true};
    // El guardado local siempre ocurre primero y nunca depende de internet.
    await offlineStorePut('imageEdits',metadata);
    await offlineStorePut('pendingSync',metadata);
    cacheEditorImage(metadata.originalSrc);
    if(!navigator.onLine)return metadata;
    try{
      await initRemoteSync();
      if(!remoteSetDoc||!remoteGetDoc)throw new Error('Firestore todavía no está listo');
      // La foto elegida se comprime antes de llegar aquí y se guarda junto a las capas.
      // Así queda visible también en otros dispositivos sin depender de Firebase Storage.
      const originalSrc=String(metadata.originalSrc||'');
      if(originalSrc.startsWith('data:')&&originalSrc.length>780000)throw new Error('La foto supera el tamaño seguro para Firestore');
      const remotePayload={...metadata,originalSrc,pendingSync:false,syncedAt:Date.now()};
      const ref=remoteImageRef(activeImageSongId,activeImageOwner,activeImageMode);
      if(!ref)throw new Error('No se pudo crear el documento remoto de la edición');
      const timeout=new Promise((_,reject)=>setTimeout(()=>reject(new Error('Firestore tardó demasiado en responder')),15000));
      await Promise.race([remoteSetDoc(ref,remotePayload,{merge:false}),timeout]);
      const check=await Promise.race([remoteGetDoc(ref),timeout]);
      const remote=check.exists()?check.data():null;
      if(!remote||Number(remote.updatedAt)!==stamp||remote.source!=='imageEdits')throw new Error('Firestore no confirmó la edición en imageEdits/'+editId);
      const synced={...metadata,...remote,pendingSync:false};
      await offlineStorePut('imageEdits',synced);
      await offlineStoreDelete('pendingSync',editId);
      console.info('[EGM imageEdits] guardado confirmado:',editId,remote.updatedAt);
      return synced;
    }catch(err){
      console.warn('Guardado local; sincronización pendiente',err);
      return metadata;
    }
  }
  async function refreshOpenImageViewer(edit,song,owner,mode='image'){
    const viewer=$('#viewerDialog');
    const expectedType=mode==='songbook'?(owner==='daniel'?'daniel':'lyrics'):(owner==='daniel'?'daniel-image':'notes');
    if(!viewer?.open)return false;
    // El editor puede cerrarse antes de que Safari actualice la pila de dialogs.
    // Forzamos el visor activo a la canción recién guardada y pintamos la copia
    // en memoria, sin esperar otra lectura de Firestore.
    activeViewerSongId=song.id;
    activeViewerType=expectedType;
    $('#viewerTitle').textContent=`${expectedType==='daniel-image'?'Imagen Daniel':expectedType==='lyrics'?'Letra':expectedType==='daniel'?'Daniel':'Imagen'} · ${song.titulo}`;
    const normalized={...edit,originalSrc:edit?.originalSrc||edit?.original||'',operations:Array.isArray(edit?.operations)?edit.operations:[],textBoxes:Array.isArray(edit?.textBoxes)?edit.textBoxes:[]};
    const content=$('#viewerContent');
    content.innerHTML='';
    content.classList.remove('is-note-viewer');
    const ok=await showComposedViewerEdit(content,normalized,song,owner,mode);
    if(!ok){
      const src=mode==='songbook'
        ? (normalized.originalSrc||'')
        : (normalized.originalSrc||imageCandidates(song,owner)[0]);
      if(src)return showViewerImage(content,src,song);
    }
    return ok;
  }

  async function persistImageEditorLayers(syncRemote=false){
    syncImageTextBoxesFromDom();
    const song=state.songs.find(x=>x.id===activeImageSongId);if(!song)return false;
    const composite=imageEditorComposite();
    let saved={original:activeImageMode==='songbook'?'':(imageEditorState.original||imageCandidates(song,activeImageOwner)[0]||''),canvasWidth:imageBaseCanvas().width||imageEditorState.canvasWidth||1000,canvasHeight:imageBaseCanvas().height||imageEditorState.canvasHeight||1300,operations:(imageEditorState.operations||[]).map(op=>({...op,points:(op.points||[]).map(p=>({...p}))})),textBoxes:imageEditorState.textBoxes.map(serializeImageTextBox),composite,updatedAt:Date.now()};
    if(syncRemote){const remote=await saveImageEditorVectorsRemote();saved={original:remote.originalSrc,canvasWidth:remote.canvasWidth||1000,canvasHeight:remote.canvasHeight||1300,operations:remote.operations,textBoxes:remote.textBoxes,composite,updatedAt:remote.updatedAt,remote:!remote.pendingSync,pendingSync:Boolean(remote.pendingSync)};}
    song[visualField(activeImageOwner,activeImageMode)]=saved;
    const ci=state.customSongs.findIndex(x=>x.id===song.id);if(ci>=0)state.customSongs[ci]={...song};else state.songEdits[song.id]={...song};
    saveStateLocalOnly();renderSongbookList();renderSongs();
    return saved;
  }

  // 6.36.54 · El visor que queda debajo se actualiza cuando el dialog del editor
  // realmente terminó de cerrarse. Safari/iOS no siempre repinta un dialog inferior
  // mientras el superior sigue en la pila modal.
  $('#imageEditorDialog').addEventListener('close',()=>{
    clearTimeout(imageTextAutosaveTimer);
    const pending=pendingViewerRefresh;
    pendingViewerRefresh=null;
    returnToImageViewer=false;
    if(!pending)return;
    requestAnimationFrame(()=>requestAnimationFrame(async()=>{
      const song=state.songs.find(x=>x.id===pending.songId);
      const expectedType=pending.mode==='songbook'?(pending.owner==='daniel'?'daniel':'lyrics'):(pending.owner==='daniel'?'daniel-image':'notes');
      if(!song||!$('#viewerDialog')?.open||activeViewerSongId!==pending.songId||activeViewerType!==expectedType)return;
      try{
        // Invalida cualquier lectura remota antigua iniciada cuando se abrió el visor.
        viewerRenderGeneration++;
        await refreshOpenImageViewer(pending.edit,song,pending.owner,pending.mode||'image');
      }catch(err){
        console.error('No se pudo redibujar el visor abierto después de cerrar el editor',err);
      }
    }));
  });
  $('#saveImageEditorBtn').addEventListener('click',()=>{
    commitImageText();
    const song=state.songs.find(x=>x.id===activeImageSongId);if(!song)return;
    const saveSongId=activeImageSongId;
    const saveOwner=activeImageOwner;
    askConfirm('Guardar imagen',`Se guardarán las capas de ${ownerLabel(saveOwner)} para “${song.titulo}”.`,async()=>{
      const btn=$('#saveImageEditorBtn');
      btn.disabled=true;
      btn.textContent='Guardando…';
      toast('Guardando…');
      try{
        // Guardar primero la edición completa en IndexedDB y Firestore.
        // El editor solo se cierra después de que la copia local quede confirmada.
        clearTimeout(imageTextAutosaveTimer);
        const saved=await persistImageEditorLayers(true);
        if(!saved)throw new Error('No se pudo preparar la edición');
        markImageEditorSaved();
        const editId=remoteImageKey(saveSongId,saveOwner,activeImageMode);
        const local=await offlineStoreGet('imageEdits',editId);
        const savedSong=state.songs.find(x=>x.id===saveSongId)||song;
        const immediateEdit={...saved,originalSrc:saved.originalSrc||saved.original||'',operations:Array.isArray(saved.operations)?saved.operations:[],textBoxes:Array.isArray(saved.textBoxes)?saved.textBoxes:[]};
        savedSong[visualField(saveOwner,activeImageMode)]={
          original:immediateEdit.originalSrc||immediateEdit.original||'',
          canvasWidth:immediateEdit.canvasWidth||1000,
          canvasHeight:immediateEdit.canvasHeight||1300,
          operations:Array.isArray(immediateEdit.operations)?immediateEdit.operations:[],
          textBoxes:Array.isArray(immediateEdit.textBoxes)?immediateEdit.textBoxes:[],
          updatedAt:immediateEdit.updatedAt||Date.now(),
          remote:!immediateEdit.pendingSync
        };
        visualContentCache.set(visualCacheKey(saveSongId,saveOwner,activeImageMode),imageEditHasVisibleContent(immediateEdit));
        // 6.36.54: no refrescar mientras el editor todavía está por encima.
        // Guardamos una orden pendiente y el evento real `close` del dialog redibuja
        // exactamente el visor que queda visible debajo. Esto también cubre el caso
        // en que el usuario pulsa la X después de haber guardado.
        if(returnToImageViewer){
          pendingViewerRefresh={edit:immediateEdit,songId:saveSongId,owner:saveOwner,mode:activeImageMode};
        }
        rememberDialogState($('#imageEditorDialog'));
        dialogBaselines.delete($('#imageEditorDialog'));
        $('#imageEditorDialog').close();
        toast(local?.pendingSync
          ? 'Guardado en el dispositivo · pendiente de sincronización'
          : `Guardado y sincronizado · imageEdits/${editId}`);
      }catch(err){
        console.error('No se pudo guardar la imagen',err);
        toast(`No se guardó: ${err.message||'revisa Firestore'}`);
      }finally{
        btn.disabled=false;
        btn.textContent='Guardar';
      }
    },'Guardar');
  });

  const viewerEdit=$('#viewerEditBtn');
  let viewerEditHold=0;
  viewerEdit.addEventListener('pointerdown',()=>{viewerEditHold=setTimeout(()=>{const song=state.songs.find(x=>x.id===activeViewerSongId);if(!song)return;if(activeViewerType==='lyrics'){openImageEditor(song.id,'elena','songbook');}else if(activeViewerType==='daniel'){openImageEditor(song.id,'daniel','songbook');}else if(activeViewerType==='notes'){openImageEditor(song.id,'elena','image');}else if(activeViewerType==='daniel-image'){openImageEditor(song.id,'daniel','image');}},650);});
  ['pointerup','pointercancel','pointerleave'].forEach(name=>viewerEdit.addEventListener(name,()=>clearTimeout(viewerEditHold)));


  function bindImageInput(id,setter){const el=$(id);if(!el)return;el.addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;if(!/^image\/(jpeg|png|webp)$/i.test(f.type))return toast('Selecciona una imagen JPG, PNG o WEBP');const r=new FileReader();r.onload=()=>setter(r.result);r.readAsDataURL(f);});}
  bindImageInput('#newSongDanielNotes',v=>state.newSongDanielNotes=v);
  bindImageInput('#editSongDanielNotes',v=>state.editSongDanielNotes=v);

  // 6.36.79 · Cancionero Daniel abre directamente con un toque/clic.
  // Se eliminó por completo el menú por pulsación sostenida Cancionero/Imagen.


  // El zoom por doble toque se bloquea con touch-action: manipulation en CSS.
  // No cancelamos touchend: Android necesita completar ambos pointerup para detectar el doble toque.
  document.addEventListener('dblclick',event=>{
    if(event.target.closest('button,.song-action,.mini-btn,[role="button"]')) event.preventDefault();
  },{passive:false,capture:true});


  /* EGP CONFIG LAN CONSOLIDADA V85 */
  const EGP_REQUESTS_LAN_URL=EGP_AUDIT_LOCAL?'http://10.10.10.2:8796':'http://10.10.10.2:8790';

  async function egpPublicarConfigLan(data={}){
    try{
      const cfg=state.config||{};
      const active=('show_activo' in data)?data.show_activo===true:Boolean(state.config);
      const showId=String(
        data.inicio_show ||
        (cfg.startedAt?new Date(cfg.startedAt).getTime():0) ||
        latestRemoteState?.inicio_show ||
        0
      );
      const enabled=('pedidos_panel' in data)?(active&&data.pedidos_panel===true):(active&&cfg.requests===true);
      const mode=('pedidos_modo' in data)?(data.pedidos_modo==='uno_por_turno'?'uno_por_turno':'libre'):(cfg.requestsMode==='uno_por_turno'?'uno_por_turno':'libre');

      await fetch(`${EGP_REQUESTS_LAN_URL}/api/config`,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        cache:'no-store',
        body:JSON.stringify({show_active:active,show_id:showId,pedidos_panel:enabled,pedidos_modo:mode})
      });
    }catch(err){
      console.warn('Fallback LAN de Pedidos no disponible:',err);
    }
  }

  /* EGP PEDIDOS AL PANEL · implementación integrada en el núcleo del Panel */
  const EGP_PEDIDOS_PANEL_KEY='egp-pedidos-panel-enabled-v1';

  function egpCrearInterfazPedidos(){
    if(!document.getElementById('requestsToggle')){
      const whatsapp=document.getElementById('whatsappToggle');
      const card=whatsapp?.closest('.switch-card');
      if(card){
        const nueva=document.createElement('div');
        nueva.className='switch-card';
        nueva.innerHTML=`
          <div>
            <strong>Pedidos al panel</strong>
            <small>Recibir pedidos en una lista para aceptar antes de enviarlos a la cola.</small>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex:0 0 auto">
            <select id="requestsModeSelect" aria-label="Modo de pedidos" style="width:116px;max-width:116px;border:1px solid #30343d;border-radius:9px;background:#0d0f13;color:inherit;padding:7px 6px;font-size:12px">
              <option value="libre">Libre</option>
              <option value="uno_por_turno">1 por turno</option>
            </select>
            <label class="switch">
              <input id="requestsToggle" type="checkbox">
              <span></span>
            </label>
          </div>
        `;
        card.insertAdjacentElement('afterend',nueva);
        const toggle=nueva.querySelector('#requestsToggle');
        const mode=nueva.querySelector('#requestsModeSelect');
        toggle.checked=state.config?.requests===true;
        mode.value=state.config?.requestsMode==='uno_por_turno'?'uno_por_turno':'libre';
        const publishCurrent=async()=>{
          localStorage.setItem(EGP_PEDIDOS_PANEL_KEY,toggle.checked?'1':'0');
          if(state.config){
            state.config.requests=toggle.checked===true;
            state.config.requestsMode=mode.value==='uno_por_turno'?'uno_por_turno':'libre';
            saveStateLocalOnly();
            await egpPublicarConfigLan({show_activo:true,inicio_show:new Date(state.config.startedAt).getTime(),pedidos_panel:state.config.requests,pedidos_modo:state.config.requestsMode});
            if(!EGP_AUDIT_LOCAL){
              try{await publishShowPatch({pedidos_panel:state.config.requests,pedidos_modo:state.config.requestsMode});}catch(err){console.warn('Pedidos pendientes de sincronizar',err);}
            }
          }
        };
        toggle.addEventListener('change',publishCurrent);
        mode.addEventListener('change',publishCurrent);
      }
    }

    if(!document.getElementById('egpPedidosBtn')){
      const right=document.querySelector('.live-toolbar-right');
      const ui24=document.getElementById('ui24rBtn');
      if(right){
        const btn=document.createElement('button');
        btn.id='egpPedidosBtn';
        btn.className='toolbar-btn egp-pedidos-btn';
        btn.type='button';
        if(ui24)right.insertBefore(btn,ui24);else right.prepend(btn);
      }
    }

    if(!document.getElementById('egpPedidosDialog')){
      const dialog=document.createElement('dialog');
      dialog.id='egpPedidosDialog';
      dialog.className='egp-pedidos-dialog';
      dialog.innerHTML=`
        <div class="egp-pedidos-panel">
          <div class="egp-pedidos-head">
            <div><strong>Pedidos</strong><small id="egpPedidosResumen">0 pendientes</small></div>
            <button id="egpPedidosCerrar" type="button" aria-label="Cerrar">×</button>
          </div>
          <div id="egpPedidosLista" class="egp-pedidos-lista"></div>
        </div>
      `;
      document.body.appendChild(dialog);
      dialog.addEventListener('cancel',e=>e.preventDefault());
      document.getElementById('egpPedidosCerrar')?.addEventListener('click',()=>dialog.close());
    }

    document.getElementById('egpPedidosBtn')?.addEventListener('click',()=>{
      egpRenderPedidos();
      document.getElementById('egpPedidosDialog')?.showModal();
    });
    egpRenderPedidos();
  }

  function egpEscPedidos(value=''){
    return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#039;");
  }

  function egpHoraPedido(ms){
    const n=Number(ms||0);if(!n)return '';
    try{return new Date(n).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}catch{return '';}
  }

  function egpCombinarPedidosV85(){
    const mapa=new Map();

    [...egpPedidosFirebase,...egpPedidosLan]
      .sort((a,b)=>Number(a?.creado_en_ms||0)-Number(b?.creado_en_ms||0))
      .forEach(p=>{
        const telefono=String(p?.telefono||'').replace(/\D/g,'');
        const songId=String(p?.cancion_id||'');
        const personaKey=telefono&&songId?`${telefono}|${songId}`:'';
        const id=String(p?.id||'');

        const existente=[...mapa.values()].find(x=>
          telefono && songId &&
          String(x?.telefono||'').replace(/\D/g,'')===telefono &&
          String(x?.cancion_id||'')===songId
        );

        if(existente){
          if(!p?.__egp_lan_v85 && existente?.__egp_lan_v85){
            for(const [k,v] of mapa.entries())if(v===existente)mapa.delete(k);
            mapa.set(id?`id:${id}`:`persona:${personaKey}`,p);
          }
          return;
        }

        if(id)mapa.set(`id:${id}`,p);
        else if(personaKey)mapa.set(`persona:${personaKey}`,p);
      });

    egpPedidosPendientes=[...mapa.values()];
    egpRenderPedidos();
  }

  function egpSyncPedidosFromRemote(data={}){
    const showId=String(data.inicio_show||'');
    const lista=Array.isArray(data.pedidos_panel_lista)?data.pedidos_panel_lista:[];
    egpPedidosFirebase=lista
      .filter(p=>String(p.show_id||'')===showId&&p.estado==='pendiente')
      .sort((a,b)=>Number(a.creado_en_ms||0)-Number(b.creado_en_ms||0));
    egpCombinarPedidosV85();
  }

  function egpPedidosAgrupados(){
    const grupos=new Map();

    egpPedidosPendientes.forEach(pedido=>{
      const songId=String(pedido?.cancion_id||'');
      if(!songId)return;

      if(!grupos.has(songId)){
        grupos.set(songId,{
          songId,
          cancion:pedido.cancion||'Canción',
          creado_en_ms:Number(pedido.creado_en_ms||0),
          pedidos:[]
        });
      }

      const grupo=grupos.get(songId);
      grupo.pedidos.push(pedido);
      const t=Number(pedido.creado_en_ms||0);
      if(t&&(grupo.creado_en_ms===0||t<grupo.creado_en_ms))grupo.creado_en_ms=t;
    });

    return [...grupos.values()].sort((a,b)=>
      Number(a.creado_en_ms||0)-Number(b.creado_en_ms||0)
    );
  }

  /* EGP USUARIOS PEDIDOS V82 */
  const EGP_USUARIOS_PEDIDOS_V82='egp-usuarios-pedidos-v82';

  function egpShowUsuariosKeyV82(){
    return String(
      state.config?.startedAt ||
      latestRemoteState?.inicio_show ||
      'show-actual'
    );
  }

  function egpPersonaKeyV82(pedido){
    const tel=String(
      pedido?.telefono ||
      pedido?.telefono_whatsapp ||
      pedido?.phone ||
      ''
    ).replace(/\D/g,'');
    if(tel)return `tel:${tel}`;
    return `pedido:${String(pedido?.id||'sin-id')}`;
  }

  function egpMapaUsuariosV82(){
    try{
      const all=JSON.parse(localStorage.getItem(EGP_USUARIOS_PEDIDOS_V82)||'{}');
      const key=egpShowUsuariosKeyV82();
      return (all[key]&&typeof all[key]==='object')?all[key]:{};
    }catch(err){
      return {};
    }
  }

  function egpGuardarMapaUsuariosV82(mapa){
    try{
      const all=JSON.parse(localStorage.getItem(EGP_USUARIOS_PEDIDOS_V82)||'{}');
      all[egpShowUsuariosKeyV82()]=mapa;
      localStorage.setItem(EGP_USUARIOS_PEDIDOS_V82,JSON.stringify(all));
    }catch(err){}
  }

  function egpAsignarUsuariosV82(){
    const mapa=egpMapaUsuariosV82();
    let max=Object.values(mapa).map(Number).filter(Number.isFinite).reduce((a,b)=>Math.max(a,b),0);

    [...egpPedidosPendientes]
      .sort((a,b)=>Number(a?.creado_en_ms||0)-Number(b?.creado_en_ms||0))
      .forEach(p=>{
        const key=egpPersonaKeyV82(p);
        if(!mapa[key]){
          max+=1;
          mapa[key]=max;
        }
      });

    egpGuardarMapaUsuariosV82(mapa);
    return mapa;
  }

  function egpUsuariosGrupoV82(pedidos,mapa){
    return [...new Set(
      pedidos
        .map(p=>Number(mapa[egpPersonaKeyV82(p)]||0))
        .filter(n=>n>0)
    )].sort((a,b)=>a-b);
  }

  function egpCssUsuariosV82(){
    if(document.getElementById('egpCssUsuariosV82'))return;
    const style=document.createElement('style');
    style.id='egpCssUsuariosV82';
    style.textContent=`
      .egp-pedido-numero-v82{
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:flex-start;
        min-width:42px;
        flex:0 0 auto;
      }
      .egp-pedido-users-v82{
        display:flex;
        gap:3px;
        flex-wrap:wrap;
        justify-content:center;
        margin-top:3px;
        color:#ff3b30;
        font-size:.68rem;
        line-height:1;
        font-weight:900;
      }
      .egp-pedido-user-v82{
        color:#ff2d2d!important;
        -webkit-text-fill-color:#ff2d2d!important;
        opacity:1!important;
        white-space:nowrap;
      }
    `;
    document.head.appendChild(style);
  }

  function egpRenderPedidos(){
    egpCssUsuariosV82();

    const btn=document.getElementById('egpPedidosBtn');
    const lista=document.getElementById('egpPedidosLista');
    const resumen=document.getElementById('egpPedidosResumen');
    const grupos=egpPedidosAgrupados();
    const totalPedidos=egpPedidosPendientes.length;
    const mapaUsuarios=egpAsignarUsuariosV82();

    if(btn){
      btn.textContent=`Pedidos ${totalPedidos}`;
      btn.classList.toggle('has-pedidos',totalPedidos>0);
    }

    if(resumen){
      if(!totalPedidos)resumen.textContent='0 pendientes';
      else resumen.textContent=`${grupos.length} ${grupos.length===1?'canción':'canciones'} · ${totalPedidos} ${totalPedidos===1?'pedido':'pedidos'}`;
    }

    if(!lista)return;

    if(!totalPedidos){
      lista.innerHTML='<div class="egp-pedidos-vacio">No hay pedidos pendientes.</div>';
      return;
    }

    lista.innerHTML=grupos.map(grupo=>{
      const numero=activeRepertoireNumber(grupo.songId)||'—';
      const cantidad=grupo.pedidos.length;
      const usuarios=egpUsuariosGrupoV82(grupo.pedidos,mapaUsuarios);

      return `
        <article class="egp-pedido-item egp-pedido-item--compacto">
          <div class="egp-pedido-info egp-pedido-info--compacto">
            <strong>
              <span class="egp-pedido-numero-v82">
                <span class="egp-pedido-numero">${numero}</span>
                <span class="egp-pedido-users-v82">
                  ${usuarios.map(u=>`<span class="egp-pedido-user-v82">U${u}</span>`).join('')}
                </span>
              </span>
              <span>${egpEscPedidos(grupo.cancion)}</span>
            </strong>
          </div>
          ${cantidad>1?`<b class="egp-pedido-cantidad">×${cantidad}</b>`:''}
          <button class="egp-pedido-aceptar" type="button" data-song-id="${egpEscPedidos(grupo.songId)}">Aceptar</button>
        </article>`;
    }).join('');

    lista.querySelectorAll('.egp-pedido-aceptar').forEach(button=>{
      button.addEventListener('click',()=>egpAceptarPedido(button.dataset.songId,button));
    });
  }

  /* EGP PEDIDOS LAN PANEL V77 */
  async function egpPedidosLanPanelV85(){
    if(document.hidden)return;
    try{
      const configResponse=await fetch(`${EGP_REQUESTS_LAN_URL}/api/config`,{cache:'no-store'});
      if(!configResponse.ok)return;
      const configLan=await configResponse.json();

      if(configLan?.ok&&state.config){
        state.config.requests=configLan.pedidos_panel===true;
        state.config.requestsMode=configLan.pedidos_modo==='uno_por_turno'?'uno_por_turno':'libre';
        const t=document.getElementById('requestsToggle');if(t)t.checked=state.config.requests;
        const m=document.getElementById('requestsModeSelect');if(m)m.value=state.config.requestsMode;
      }
      if(!configLan?.ok || configLan.show_active!==true || !configLan.show_id){
        egpPedidosLan=[];
        egpCombinarPedidosV85();
        return;
      }

      const r=await fetch(
        `${EGP_REQUESTS_LAN_URL}/api/orders?show_id=${encodeURIComponent(String(configLan.show_id))}&estado=pendiente`,
        {cache:'no-store'}
      );
      if(!r.ok)return;
      const data=await r.json();
      if(!data?.ok||!Array.isArray(data.orders))return;

      const antes=JSON.stringify(egpPedidosLan.map(p=>String(p?.id||'')).sort());
      egpPedidosLan=data.orders.map(p=>({...p,__egp_lan_v85:true}));
      const despues=JSON.stringify(egpPedidosLan.map(p=>String(p?.id||'')).sort());
      if(antes!==despues)egpCombinarPedidosV85();
    }catch(err){
      console.warn('No se pudieron leer Pedidos LAN:',err);
    }
  }

  let egpPedidosLanTimerV85=0;
  function egpProgramarPedidosLanPanelV85(delay=2500){
    clearTimeout(egpPedidosLanTimerV85);
    egpPedidosLanTimerV85=setTimeout(async()=>{
      await egpPedidosLanPanelV85();
      egpProgramarPedidosLanPanelV85(2500);
    },delay);
  }

  egpProgramarPedidosLanPanelV85(200);
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)egpPedidosLanPanelV85();
  });

  async function egpAceptarPedidosLanV85(pedidos){
    if(!pedidos.length)return;
    const r=await fetch(`${EGP_REQUESTS_LAN_URL}/api/orders/accept`,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      cache:'no-store',
      body:JSON.stringify({ids:pedidos.map(p=>String(p.id))})
    });
    if(!r.ok)throw new Error('No se pudo aceptar pedido LAN');
    const data=await r.json();
    if(!data?.ok)throw new Error('Pedido LAN rechazado');
  }

  async function egpAceptarPedido(songId,button){
    const id=String(songId||'');
    const pedidos=egpPedidosPendientes.filter(p=>String(p?.cancion_id||'')===id);
    if(!id||!pedidos.length)return;

    const pedidosLan=pedidos.filter(p=>p?.__egp_lan_v85);
    const pedidosFirebase=pedidos.filter(p=>!p?.__egp_lan_v85);

    button.disabled=true;
    button.textContent='Aceptando…';

    try{
      if(!state.queue.map(String).includes(id)){
        await persistQueueStateMutation(id,'add');
      }

      if(pedidosLan.length){
        await egpAceptarPedidosLanV85(pedidosLan);
      }

      if(pedidosFirebase.length){
        if(!remoteStateRef)await initRemoteSync();
        if(!remoteDb||!remoteDoc||!window.__egmUpdateDoc||!remoteRunTransaction||!remoteStateRef){
          throw new Error('Firebase todavía no está listo');
        }

        const aceptadoEn=Date.now();
        await Promise.all(
          pedidosFirebase.map(pedido=>{
            const ref=remoteDoc(remoteDb,'pedidos',String(pedido.id));
            return window.__egmUpdateDoc(ref,{
              estado:'aceptado',
              aceptado_en_ms:aceptadoEn
            });
          })
        );

        const idsFirebase=new Set(pedidosFirebase.map(p=>String(p.id)));
        await remoteRunTransaction(remoteDb,async transaction=>{
          const snap=await transaction.get(remoteStateRef);
          const data=snap.exists()?(snap.data()||{}):{};
          const actual=Array.isArray(data.pedidos_panel_lista)?data.pedidos_panel_lista:[];
          transaction.update(remoteStateRef,{
            pedidos_panel_lista:actual.filter(x=>!idsFirebase.has(String(x?.id||'')))
          });
        });
      }

      const idsAceptados=new Set(pedidos.map(p=>String(p.id)));
      egpPedidosFirebase=egpPedidosFirebase.filter(p=>!idsAceptados.has(String(p.id)));
      egpPedidosLan=egpPedidosLan.filter(p=>!idsAceptados.has(String(p.id)));
      egpCombinarPedidosV85();

      toast(
        pedidos.length>1
          ? `${pedidos.length} pedidos aceptados y enviados a la cola.`
          : 'Pedido aceptado y enviado a la cola.'
      );
    }catch(err){
      console.error('No se pudo aceptar pedido:',err);
      button.disabled=false;
      button.textContent='Aceptar';
      toast('No se pudo aceptar el pedido.');
    }
  }

  async function egpCerrarPedidosPendientes(){
    const pendientes=[...egpPedidosPendientes];
    if(remoteDb&&remoteDoc&&window.__egmUpdateDoc&&pendientes.length){
      await Promise.allSettled(pendientes.map(p=>{
        const ref=remoteDoc(remoteDb,'pedidos',String(p.id));
        return window.__egmUpdateDoc(ref,{estado:'cerrado',cerrado_en_ms:Date.now()});
      }));
    }
    egpPedidosPendientes=[];
    egpPedidosFirebase=[];
    egpPedidosLan=[];
    egpRenderPedidos();
  }

  egpCrearInterfazPedidos();

  // 6.36.69.2 — La contraseña se solicita en cada apertura del panel.
  // No se conserva autorización en localStorage/sessionStorage, para que otro dispositivo
  // nunca entre directamente aunque ya exista un show activo.
  function rememberPanelAuth(){}

  // Android/iPhone: permitir siempre el desplazamiento vertical normal.
  // La prevención global de touchmove podía bloquear el scroll en PWA/Android.
  // El rebote/recarga se controla por CSS con overscroll-behavior.

  const login=$('#panelLogin'),loginForm=$('#panelLoginForm'),loginPassword=$('#panelLoginPassword'),loginError=$('#panelLoginError');
  const params=new URLSearchParams(location.search);
  const trusted=params.get('trusted')==='1';
  if(!trusted){ login.removeAttribute('hidden'); login.setAttribute('aria-hidden','false'); }
  login.hidden=trusted;
  loginForm.addEventListener('submit',e=>{e.preventDefault();const security=JSON.parse(localStorage.getItem('egm-security-settings')||'{}');if(loginPassword.value===(security.password||'2907')){rememberPanelAuth();login.hidden=true;loginError.hidden=true;loginPassword.value='';if(latestRemoteState)applyRemotePanelState(latestRemoteState);else if(state.config)showLive();else showConfig();}else loginError.hidden=false;});
  loadData().then(async()=>{
    if(trusted&&state.config)showLive(); else if(trusted)showConfig();
    try{
      await initRemoteSync();
      if(remoteGetDoc&&remoteStateRef){
        const snap=await remoteGetDoc(remoteStateRef);
        if(snap.exists()){
          latestRemoteState=snap.data()||{};
          applyRemotePanelState(latestRemoteState);
        }
      }
    }catch(err){
      console.warn('Panel iniciado con la última copia local; la sincronización se reintentará al recuperar conexión.',err);
    }
    await egpPublicarConfigLan({
      show_activo:Boolean(state.config),
      inicio_show:state.config?.startedAt?new Date(state.config.startedAt).getTime():0
    });
    egpPedidosLanPanelV85();
  });
})();



/* Entrega 6.36 · controlador base de la barra nueva */
(function(){
  const $id=id=>document.getElementById(id);
  const textDialog=$id('songbookEditorDialog');
  const imageDialog=$id('imageEditorDialog');
  if(!textDialog||!imageDialog)return;

  function closeAllPopovers(except){
    document.querySelectorAll('.egm-editor-toolbar .compact-popover').forEach(p=>{if(p!==except)p.hidden=true;});
  }
  function showHeldPopover(button,popover){
    if(!button||!popover)return;
    closeAllPopovers(popover);
    const r=button.getBoundingClientRect();
    popover.hidden=false;
    requestAnimationFrame(()=>{
      const pr=popover.getBoundingClientRect();
      const left=Math.max(8,Math.min(innerWidth-pr.width-8,r.left+r.width/2-pr.width/2));
      const top=Math.max(8,r.top-pr.height-8);
      popover.style.left=left+'px';popover.style.top=top+'px';
    });
  }
  function bindHold(button,popover,delay=520){
    if(!button||!popover)return;
    let timer=0,held=false,touchActive=false,suppressClickUntil=0,startX=0,startY=0;
    const clear=()=>{clearTimeout(timer);timer=0;};
    const open=()=>{
      held=true;
      suppressClickUntil=Date.now()+700;
      showHeldPopover(button,popover);
      if(navigator.vibrate) navigator.vibrate(18);
    };

    // iPhone/iPad: Safari puede abrir “Copiar / Traducir” antes del click.
    // Capturamos el gesto táctil desde touchstart y anulamos el menú nativo.
    button.addEventListener('touchstart',e=>{
      if(e.touches.length!==1)return;
      touchActive=true;held=false;
      startX=e.touches[0].clientX;startY=e.touches[0].clientY;
      e.preventDefault();
      clear();timer=setTimeout(open,delay);
    },{passive:false});
    button.addEventListener('touchmove',e=>{
      if(!touchActive||e.touches.length!==1)return;
      const t=e.touches[0];
      if(Math.hypot(t.clientX-startX,t.clientY-startY)>12)clear();
      e.preventDefault();
    },{passive:false});
    button.addEventListener('touchend',e=>{
      if(!touchActive)return;
      e.preventDefault();clear();touchActive=false;
      if(!held){
        // Ejecutar primero el clic real de la herramienta y solo después
        // bloquear el clic fantasma que Safari/iOS genera al terminar el toque.
        suppressClickUntil=0;
        button.click();
        suppressClickUntil=Date.now()+500;
      }
      held=false;
    },{passive:false});
    button.addEventListener('touchcancel',()=>{clear();touchActive=false;held=false;},{passive:true});

    // Mouse, trackpad, Android y Apple Pencil mediante Pointer Events.
    button.addEventListener('pointerdown',e=>{
      if(e.pointerType==='touch'||touchActive)return;
      held=false;clear();timer=setTimeout(open,delay);
    });
    ['pointerup','pointercancel','pointerleave'].forEach(type=>button.addEventListener(type,clear));

    ['contextmenu','selectstart','dragstart'].forEach(type=>button.addEventListener(type,e=>e.preventDefault()));
    button.addEventListener('click',e=>{
      if(held||Date.now()<suppressClickUntil){
        e.preventDefault();e.stopImmediatePropagation();held=false;
      }
    },true);
  }
  bindHold($id('songbookTextTool'),$id('songbookTextOptions'));
  bindHold($id('songbookAlign'),$id('songbookAlignOptions'));
  bindHold($id('songbookDrawToggle'),$id('songbookDrawOptions'));
  bindHold($id('songbookEraserToggle'),$id('songbookEraserOptions'));
  bindHold($id('imageToolPencil'),$id('imagePencilOptions'));
  bindHold($id('imageToolEraser'),$id('imageEraserOptions'));
  bindHold($id('imageUploadTrigger'),null);

  const textModeButtons=[$id('songbookTextTool'),$id('songbookDrawToggle'),$id('songbookEraserToggle')].filter(Boolean);
  function setExclusive(button,buttons){buttons.forEach(b=>b.classList.toggle('is-active',b===button));}
  textModeButtons.forEach(b=>b.addEventListener('click',()=>setExclusive(b,textModeButtons)));
  const imageModeButtons=[$id('imageTextTool'),$id('imageToolPencil'),$id('imageToolEraser')].filter(Boolean);
  imageModeButtons.forEach(b=>b.addEventListener('click',()=>setExclusive(b,imageModeButtons)));

  $id('songbookAlignOptions')?.addEventListener('click',e=>{
    const align=e.target.closest('[data-align]')?.dataset.align;if(!align)return;
    const command=align==='left'?'justifyLeft':align==='center'?'justifyCenter':'justifyRight';
    document.execCommand(command,false,null);$id('songbookAlignOptions').hidden=true;$id('songbookEditor')?.focus();
  });

  document.addEventListener('pointerdown',e=>{if(!e.target.closest('.egm-tool-wrap,.compact-popover'))closeAllPopovers();});
  [textDialog,imageDialog].forEach(dialog=>dialog.addEventListener('close',closeAllPopovers));
})();

/* Entrega V4.1 · sincronización visual de colores en T y lápiz */
(function(){
  const byId=id=>document.getElementById(id);
  const paint=(id,color)=>{const el=byId(id);if(el)el.style.background=color||'#d00000';};
  const textColor=byId('songbookColorMenu');
  textColor?.addEventListener('click',e=>{const b=e.target.closest('[data-text-color]');if(b)paint('songbookColorSwatch',b.dataset.textColor);});
  const drawColors=byId('songbookDrawColorMenu');
  drawColors?.addEventListener('click',e=>{const b=e.target.closest('[data-draw-color]');if(b)paint('songbookPencilSwatch',b.dataset.drawColor);});
  const imageColor=byId('imageDrawColor');
  imageColor?.addEventListener('input',()=>paint('imagePencilSwatch',imageColor.value));
  paint('songbookColorSwatch',byId('songbookColorSwatch')?.style.background||'#d00000');
  paint('songbookPencilSwatch',byId('songbookDrawColor')?.value||'#d00000');
  paint('imagePencilSwatch',imageColor?.value||'#d00000');

  // === AUXILIARES / MONITORES DEV ===
  const AUX_NAMES_KEY='egp_aux_monitor_names_v1';

  const AUX_DEFAULTS={
    stereo:['Cantante','Batería','Bajo','Piano'],
    mono:['Cantante','Batería','Bajo','Piano','Aux 5','Aux 6','Aux 7','Aux 8']
  };

  function loadAuxMonitorNames(){
    try{
      const saved=JSON.parse(localStorage.getItem(AUX_NAMES_KEY)||'null');
      return {
        stereo:Array.isArray(saved?.stereo)?saved.stereo:AUX_DEFAULTS.stereo,
        mono:Array.isArray(saved?.mono)?saved.mono:AUX_DEFAULTS.mono
      };
    }catch(_){
      return structuredClone(AUX_DEFAULTS);
    }
  }

  function fillAuxMonitorForm(){
    const data=loadAuxMonitorNames();
    data.stereo.forEach((name,i)=>{
      const el=document.getElementById(`auxStereo${i+1}`);
      if(el)el.value=name||'';
    });
    data.mono.forEach((name,i)=>{
      const el=document.getElementById(`auxMono${i+1}`);
      if(el)el.value=name||'';
    });
  }

  document.getElementById('openAuxMonitorsBtn')?.addEventListener('click',()=>{
    const menu=document.getElementById('toolsMenu');
    if(menu?.open)menu.close();
    fillAuxMonitorForm();
    document.getElementById('auxMonitorsDialog')?.showModal();
  });

  document.getElementById('closeAuxMonitorsBtn')?.addEventListener('click',()=>{
    document.getElementById('auxMonitorsDialog')?.close();
  });

  document.getElementById('auxMonitorsForm')?.addEventListener('submit',e=>{
    e.preventDefault();

    const stereo=Array.from({length:4},(_,i)=>
      document.getElementById(`auxStereo${i+1}`)?.value.trim()||`Aux ${i+1}`
    );

    const mono=Array.from({length:8},(_,i)=>
      document.getElementById(`auxMono${i+1}`)?.value.trim()||`Aux ${i+1}`
    );

    const save=async()=>{
      const btn=document.querySelector('#auxMonitorsForm .aux-save-btn');

      if(btn){
        btn.disabled=true;
        btn.textContent='Guardando…';

        try{
          btn.animate(
            [
              {transform:'scale(1)',opacity:1},
              {transform:'scale(.985)',opacity:.82},
              {transform:'scale(1)',opacity:1}
            ],
            {duration:700,iterations:Infinity}
          ).cancel();
        }catch(_){}
      }

      localStorage.setItem(
        AUX_NAMES_KEY,
        JSON.stringify({stereo,mono})
      );

      const monitoreo_perfiles={
        stereo:[
          {id:'stereo-1-2',nombre:stereo[0],aux:'1-2'},
          {id:'stereo-3-4',nombre:stereo[1],aux:'3-4'},
          {id:'stereo-5-6',nombre:stereo[2],aux:'5-6'},
          {id:'stereo-7-8',nombre:stereo[3],aux:'7-8'}
        ],
        mono:mono.map((nombre,i)=>({
          id:`mono-${i+1}`,
          nombre,
          aux:String(i+1)
        }))
      };

      try{
        const cfgResponse=await fetch(
          'configuracion.json',
          {cache:'no-store'}
        );

        if(!cfgResponse.ok){
          throw new Error('No se pudo leer configuracion.json');
        }

        const cfg=await cfgResponse.json();

        if(!cfg?.firebase?.projectId || !cfg?.firebase?.apiKey){
          throw new Error('Configuración Firebase incompleta');
        }

        const stringValue=value=>({
          stringValue:String(value ?? '')
        });

        const profileValue=item=>({
          mapValue:{
            fields:{
              id:stringValue(item.id),
              nombre:stringValue(item.nombre),
              aux:stringValue(item.aux)
            }
          }
        });

        const firestoreBody={
          fields:{
            kind:{
              stringValue:'egp_monitor_config_v1'
            },
            updated_at:{
              integerValue:String(Date.now())
            },
            monitoreo_perfiles:{
              mapValue:{
                fields:{
                  stereo:{
                    arrayValue:{
                      values:
                        monitoreo_perfiles.stereo.map(profileValue)
                    }
                  },
                  mono:{
                    arrayValue:{
                      values:
                        monitoreo_perfiles.mono.map(profileValue)
                    }
                  }
                }
              }
            }
          }
        };

        const auxUrl=
          'https://firestore.googleapis.com/v1/projects/' +
          encodeURIComponent(cfg.firebase.projectId) +
          '/databases/(default)/documents/imageEdits/' +
          'egp-system-monitoreo-v1?key=' +
          encodeURIComponent(cfg.firebase.apiKey);

        const auxResponse=await Promise.race([
          fetch(
            auxUrl,
            {
              method:'PATCH',
              headers:{
                'Content-Type':'application/json'
              },
              body:JSON.stringify(firestoreBody),
              cache:'no-store'
            }
          ),
          new Promise((_,reject)=>
            setTimeout(
              ()=>reject(new Error('Firebase REST tardó demasiado')),
              8000
            )
          )
        ]);

        if(!auxResponse.ok){
          const detail=await auxResponse.text();

          throw new Error(
            'Firebase REST ' +
            auxResponse.status +
            ': ' +
            detail.slice(0,300)
          );
        }

        fillAuxMonitorForm();

        if(btn){
          btn.textContent='✓ Sincronizado';

          btn.animate(
            [
              {transform:'scale(1)'},
              {transform:'scale(1.035)'},
              {transform:'scale(.99)'},
              {transform:'scale(1.02)'},
              {transform:'scale(1)'}
            ],
            {
              duration:700,
              easing:'ease-out'
            }
          );

          setTimeout(()=>{
            btn.textContent='Guardar';
            btn.disabled=false;
          },1600);
        }

        toast('Nombres actualizados en EGP Músicos');

      }catch(err){
        console.error(
          'No se pudieron sincronizar nombres AUX',
          err
        );

        if(btn){
          btn.textContent='⚠ Reintentar';
          btn.disabled=false;

          btn.animate(
            [
              {transform:'translateX(0)'},
              {transform:'translateX(-5px)'},
              {transform:'translateX(5px)'},
              {transform:'translateX(-3px)'},
              {transform:'translateX(3px)'},
              {transform:'translateX(0)'}
            ],
            {duration:420}
          );
        }

        toast(
          'No se pudo sincronizar con EGP Músicos. Intenta nuevamente.'
        );
      }
    };

    if(typeof askConfirm==='function'){
      askConfirm(
        'Guardar auxiliares',
        '¿Deseas guardar estos nombres de monitores?',
        save,
        'Guardar'
      );
    }else{
      save();
    }
  });
})();
