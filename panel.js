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
      ? '<option value="image">Abrir cancionero · Imagen</option><option value="songbook">Abrir cancionero · Cancionero Daniel</option><option value="none">Abrir cancionero · No abrir</option>'
      : '<option value="none">Abrir cancionero · No abrir</option><option value="image">Abrir cancionero · Imagen</option><option value="lyrics">Abrir cancionero · Letra</option>';
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
  /*
   * EGP_AUTOOPEN_PRIMERA_COLA_V1
   *
   * Una canción NO abre por el hecho de entrar a la cola.
   * Abre únicamente cuando pasa a ser la primera pendiente.
   */
  function firstPendingQueueId(queue,played){
    const playedSet=played instanceof Set
      ? played
      : new Set(
          Array.isArray(played)
            ? played.map(String)
            : []
        );

    return (Array.isArray(queue)?queue:[])
      .map(String)
      .find(id=>!playedSet.has(id)) || '';
  }

  function processQueueHeadChange(
    previousQueue,
    nextQueue,
    previousPlayed,
    nextPlayed
  ){
    if(Date.now()<suppressQueueAutoOpenUntil)return;

    const beforeHead=firstPendingQueueId(
      previousQueue,
      previousPlayed
    );

    const nextHead=firstPendingQueueId(
      nextQueue,
      nextPlayed
    );

    if(!nextHead || nextHead===beforeHead)return;

    const song=state.songs.find(
      x=>String(x.id)===nextHead
    );

    if(song){
      setTimeout(
        ()=>maybeAutoOpenQueuedSong(song),
        120
      );
    }
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
  let showActiveConfirmed=false;
  let lastCoreShowActive=null;
  let remoteInitPromise = null;
  let activeViewerSongId=null, activeViewerType=null, activeImageOwner='elena', activeImageSongId=null, activeImageMode='image', returnToImageViewer=false, viewerRenderGeneration=0, pendingViewerRefresh=null;
  let applyingRemoteShowState=false;
  let latestRemoteState=null;
  let egpPedidosPendientes=[];
  let egpPedidosFirebase=[];
  let egpPedidosLan=[];
  let remoteShowGeneration=0;
  let lastAppliedRemoteRevision=0;
  /*
   * EGP_REMOTE_LIBRARY_REVISION_GATE_V1
   * La biblioteca solo se vuelve a aplicar si cambia
   * biblioteca_updated_at. Un cambio de show/cola no reconstruye
   * repertorios ni reinyecta songEdits.
   */
  let lastAppliedRemoteLibraryRevision=null;
  let lastAppliedCoreRevision=0;

  /*
   * EGP_FIREBASE_TO_CORE_QUEUE_BRIDGE_V1
   *
   * Un Panel que no alcanza Local Core (iPhone/Android fuera de LAN)
   * puede mutar la cola por Firebase.
   *
   * El Panel que SI alcanza Core actúa como puente:
   * Firebase -> Core -> Bridge.
   *
   * Core sigue siendo la autoridad final.
   */
  let egpFirebaseQueueBridgeBaselineRevision=0;
  let egpFirebaseQueueBridgeLastImportedRevision=0;
  let egpFirebaseQueueBridgeChain=Promise.resolve();

  /*
   * EGP_FIREBASE_TO_CORE_FULL_SHOW_BRIDGE_V1
   *
   * Regla constitucional tomada de e017:
   * - Core/LAN sigue siendo la autoridad final cuando está vivo.
   * - Firebase es transporte/failover para Panels fuera del router.
   *
   * Regla que faltaba:
   * una MUTACIÓN NUEVA y válida recibida por Firebase puede entrar a Core.
   * Nunca se aplica Firebase directamente sobre la UI cuando Core está vivo:
   * primero se confirma en Core y luego Core vuelve a repartir el estado.
   */
  let egpFirebaseStateBridgeBaselineRevision=0;
  let egpFirebaseStateBridgeLastImportedRevision=0;
  let egpFirebaseStateBridgeChain=Promise.resolve();
  let egpFirebaseStateBridgeQueued=0;
  let egpFirebaseStateBridgeActive=false;

  /*
   * EGP_SHOW_SEMANTIC_STATE_V3
   * La cola y el show tienen ciclos de cambio distintos.
   */
  let lastAppliedCoreShowSignature='';
  let currentAppliedShowSession='';
  const DEVICE_ID=sessionStorage.getItem('egm-device-id')||(`dev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  sessionStorage.setItem('egm-device-id',DEVICE_ID);

  const EGP_AUDIT_LOCAL=new URL(location.href).searchParams.get('audit_local')==='1';
  /*
   * EGP_CORE_DEDICATED_ROUTE_ALL_DEVICES_V1
   *
   * Una sola puerta al Local Core para Mac, iPhone y Android.
   * Evita que la Mac use /__egp_core, ruta que puede resolver al GitHub público.
   */
  const LOCAL_CORE_URL=EGP_AUDIT_LOCAL
    ? 'http://10.10.10.2:8796'
    : 'https://core.elenagirjoaba.com';
  const CORE_TEST_MODE=new URL(location.href).searchParams.get('core_test')==='1';

  /*
   * Fotos del sitio:
   * - Core local por HTTPS cuando la red EGP está disponible.
   * - Firebase permanece como copia compartida por Internet.
   */
  const EGP_PHOTOS_CORE_URL=
    'https://core.elenagirjoaba.com';

  let LOCAL_QUEUE_MODE=false;
  let localQueueTimer=0;
  let localQueueBusy=false;
  let localQueueMutationChain=Promise.resolve();
  let localQueueMutationPending=0;

  /*
   * EGP_LAN_PRIORITY_FAILOVER_V1
   * LAN manda durante el show.
   * Firebase recibe copia secundaria para web publica y failover.
   */
  let egpQueueFirebaseMirrorChain=Promise.resolve();

  /*
   * EGP_CORE_SHOW_AUTHORITY_V1
   *
   * Mientras Local Core responde, Core manda TODO el estado del show.
   * Firebase es espejo/failover y nunca puede pisar un Core accesible.
   */
  let egpCoreFirebaseMirrorKey='';
  let egpCoreFirebaseMirrorBusy=false;
  let egpCoreFirebaseMirrorRetryAt=0;


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

  async function initRemoteSync(forceNetwork=false){
    if(EGP_AUDIT_LOCAL){ remoteReady=true; return null; }
    if(remoteStateRef) return remoteStateRef;
    if(remoteInitPromise) return remoteInitPromise;
    remoteInitPromise=(async()=>{
    if(!navigator.onLine && !forceNetwork) throw new Error('Sin conexión a internet');
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

        /*
         * EGP_FIREBASE_TO_CORE_QUEUE_BRIDGE_V1
         * Si este dispositivo tiene Core, una mutación de cola hecha
         * por otro Panel vía Internet se importa a Core.
         *
         * NO aplicamos Firebase directamente a la UI: esperamos la
         * confirmación del Core, evitando doble autoridad.
         */
        if(
          LOCAL_QUEUE_MODE &&
          snap?.metadata?.fromCache!==true
        ){
          egpBridgeFirebaseStateToCore(data);
        }

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

        const remoteLibraryRevision=
          Number(data.biblioteca_updated_at)||0;

        if(
          data.biblioteca &&
          typeof data.biblioteca==='object' &&
          (
            lastAppliedRemoteLibraryRevision===null ||
            remoteLibraryRevision!==lastAppliedRemoteLibraryRevision
          )
        ){
          lastAppliedRemoteLibraryRevision=remoteLibraryRevision;
          const b=data.biblioteca;
          pendingRemoteLibrary=b;
          if(b.songEdits&&typeof b.songEdits==='object') state.songEdits={...state.songEdits,...b.songEdits};
          if(Array.isArray(b.customSongs)) mergeRemoteCustomSongs(b.customSongs);
          if(state.songs.length){
            /*
             * EGP_EXPLICIT_REPERTOIRE_LISTS_V1
             * Un snapshot Firebase no puede convertir 76 -> 2 por
             * una copia vieja de `listas` dentro de songEdits.
             */
            state.songs=state.songs.map(
              song=>
                state.songEdits[song.id]
                  ? mergeSongEditSafelyV1(
                      song,
                      state.songEdits[song.id]
                    )
                  : song
            );

            /*
             * EGP_REMOTE_CUSTOM_SONGS_VISIBLE_REFRESH_V1
             *
             * loadData() termina antes de iniciar Firebase.
             * Cuando biblioteca.customSongs llega después:
             * - mergeRemoteCustomSongs() ya la incorpora a state.songs;
             * - ahora también reconstruimos el selector/conteo;
             * - y recalculamos state.filtered para que Control en vivo
             *   muestre inmediatamente la misma cantidad.
             */
            invalidateRepertoireCache();
            buildRepertoires();

            if(state.config){
              filterSongs();
            }else{
              renderSongs();
            }

            renderSongbookList();
            saveStateLocalOnly();
          }
        }
        // Las ediciones de imagen ya no se leen desde config/estado.
        // La única fuente oficial es imageEdits/{owner-songId}.
        // EGP_CORE_SHOW_AUTHORITY_V1: con Core vivo, Firebase no pisa config.
        if(state.config&&!LOCAL_QUEUE_MODE){
          const remoteRequests=egpRemoteDesdeCache?state.config.requests===true:data.pedidos_panel===true;
          const remoteWhatsapp=remoteRequests?false:(data.pedidos_whatsapp===true);
          state.config.requests=remoteRequests;
          state.config.whatsapp=remoteWhatsapp;
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
        if(wasRemoteReady&&queueSnapshotApplied){
          processQueueHeadChange(
            queueBeforeSnapshot,
            state.queue,
            oldPlayedOrder,
            state.played
          );
        }
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
      pedidos_whatsapp:cfg.requests===true?false:(cfg.whatsapp===true),
      pedidos_panel:cfg.requests===true,
      pedidos_modo:cfg.requestsMode==='uno_por_turno'?'uno_por_turno':'libre',
      mostrar_cola:cfg.publicQueue!==false,
      lugar:cfg.venue||'',
      perfil_clientes:cfg.profile||'medio',
      repertorio_nombre:cfg.repertoireName||'',
      uso_publicidad:cfg.advertising===true,
      show_activo:active,
      show_id:active&&cfg.startedAt
        ? String(new Date(cfg.startedAt).getTime())
        : String(latestRemoteState?.show_id||''),
      show_session_id:active&&cfg.startedAt
        ? `show-${new Date(cfg.startedAt).getTime()}`
        : String(latestRemoteState?.show_session_id||''),
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
    if(!remoteStateRef) await initRemoteSync(true);
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

      try{
        /*
         * Esta es la escritura que decide si la LAN esta viva.
         */
        await localQueueRequest('/api/show',{
          active:Boolean(active),
          venue:String(venue||'')
        });

        /*
         * Config/pedidos LAN es adicional.
         * Su fallo NO puede declarar caido al Local Core principal.
         */
        egpPublicarConfigLan(patch).catch(err=>{
          console.warn('Config LAN secundaria pendiente:',err);
        });

        /*
         * Firebase sigue en paralelo para web publica/respaldo.
         */
        if(!EGP_AUDIT_LOCAL){
          (async()=>{
            try{
              if(!remoteStateRef)await initRemoteSync(true);

              if(remoteStateRef&&window.__egmSetDoc){
                await window.__egmSetDoc(
                  remoteStateRef,
                  {...patch,show_revision:revision,show_writer:DEVICE_ID,updated_at:revision},
                  {merge:true}
                );
              }
            }catch(err){
              console.warn('Firebase pendiente; LAN ya sincronizada:',err);
            }
          })();
        }

        return revision;

      }catch(err){
        console.warn(
          'LAN caida durante publicacion; usando Firebase:',
          err
        );
        LOCAL_QUEUE_MODE=false;
      }
    }

    if(!remoteStateRef) await initRemoteSync(true);
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

  /*
   * EGP_LIBRARY_CUSTOM_LOCAL_WRITE_V1
   *
   * Las customSongs que se editan desde Repertorios / Editar canciones
   * deben guardarse también en la SQLite del Local Core.
   * Firebase sigue siendo la copia remota cuando Internet está disponible.
   */
  async function syncLocalCustomSongs(){
    return localQueueRequest('/api/custom-songs',{
      customSongs:Array.isArray(state.customSongs)
        ? state.customSongs
        : []
    });
  }

  function saveLibraryState(immediate=false){
    saveStateLocalOnly();

    const localTask=syncLocalCustomSongs()
      .catch(err=>{
        console.warn(
          'Biblioteca custom pendiente en Local Core:',
          err
        );
        throw err;
      });

    const remoteTask=syncRemoteLibrary(immediate)
      .catch(err=>{
        console.warn(
          'Biblioteca pendiente en Firebase:',
          err
        );
        throw err;
      });

    return Promise.allSettled([
      localTask,
      remoteTask
    ]).then(results=>{
      if(results.some(r=>r.status==='fulfilled')){
        return true;
      }
      throw new Error(
        'No se pudo guardar la biblioteca ni en Local Core ni en Firebase'
      );
    });
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
    purgeRetiredCustomSongsV1();
    saveStateLocalOnly();

    /*
     * EGP_LOCAL_CORE_CUSTOM_SONGS_V1
     *
     * Con Internet, Firebase entrega biblioteca.customSongs.
     * Con SOLO router, las custom persistentes viven en Local Core.
     * Se cargan antes de construir repertorios.
     */
    try{
      const localLibrary=await localQueueRequest('/api/custom-songs');

      if(Array.isArray(localLibrary?.customSongs)){
        mergeRemoteCustomSongs(localLibrary.customSongs);
        saveStateLocalOnly();
      }
    }catch(err){
      console.warn(
        'Custom songs Local Core no disponibles; Firebase/localStorage continúan:',
        err
      );
    }

    if(pendingRemoteLibrary){
      const b=pendingRemoteLibrary;
      if(b.songEdits&&typeof b.songEdits==='object') state.songEdits={...state.songEdits,...b.songEdits};
      if(Array.isArray(b.customSongs)) mergeRemoteCustomSongs(b.customSongs);

      /*
       * EGP_EXPLICIT_REPERTOIRE_LISTS_V1
       * Firebase puede editar otros campos, pero una `listas` legada
       * no reemplaza la membresía base.
       */
      state.songs=state.songs.map(
        song=>
          state.songEdits[song.id]
            ? mergeSongEditSafelyV1(
                song,
                state.songEdits[song.id]
              )
            : song
      );

      saveStateLocalOnly();
    }
    buildRepertoires();
    if(latestRemoteState)applyRemotePanelState(latestRemoteState);
  }

  /*
   * EGP_REMOTE_CUSTOM_SONGS_MERGE_V1
   *
   * Firebase biblioteca.customSongs debe formar parte REAL de state.songs.
   *
   * Antes:
   *   state.customSongs = remoto
   * pero state.songs seguía dependiendo del localStorage de cada dispositivo.
   *
   * Ahora:
   * - conserva custom locales todavía no sincronizadas;
   * - remoto gana cuando existe el mismo id;
   * - elimina duplicados;
   * - reconstruye state.songs con base + custom.
   */
  /*
   * EGP_RETIRED_CUSTOM_SONG_I_WILL_SURVIVE_V1
   *
   * Eliminación explícita solicitada:
   * custom-1787178395533
   *
   * Evita que una copia vieja de localStorage o un snapshot remoto
   * atrasado vuelva a insertar esta canción.
   */
  const EGP_RETIRED_CUSTOM_SONG_IDS_V1=new Set([
    'custom-1787178395533'
  ]);

  function purgeRetiredCustomSongsV1(){
    state.customSongs=(Array.isArray(state.customSongs)?state.customSongs:[])
      .filter(song=>!EGP_RETIRED_CUSTOM_SONG_IDS_V1.has(String(song?.id||'')));

    state.songs=(Array.isArray(state.songs)?state.songs:[])
      .filter(song=>!EGP_RETIRED_CUSTOM_SONG_IDS_V1.has(String(song?.id||'')));

    state.queue=(Array.isArray(state.queue)?state.queue:[])
      .filter(id=>!EGP_RETIRED_CUSTOM_SONG_IDS_V1.has(String(id)));

    for(const id of EGP_RETIRED_CUSTOM_SONG_IDS_V1){
      state.played?.delete?.(id);
    }
  }

  function mergeRemoteCustomSongs(remoteSongs){
    if(!Array.isArray(remoteSongs))return;

    remoteSongs=remoteSongs.filter(
      song=>!EGP_RETIRED_CUSTOM_SONG_IDS_V1.has(String(song?.id||''))
    );

    const byId=new Map();

    (Array.isArray(state.customSongs)?state.customSongs:[])
      .forEach(song=>{
        const id=String(song?.id||'');
        if(id)byId.set(id,{...song});
      });

    state.songs
      .filter(song=>
        String(song?.id||'').startsWith('custom-')
      )
      .forEach(song=>{
        const id=String(song?.id||'');
        if(id&&!byId.has(id))byId.set(id,{...song});
      });

    remoteSongs.forEach(song=>{
      const id=String(song?.id||'');
      if(id)byId.set(id,{...song});
    });

    state.customSongs=[...byId.values()];

    const baseSongs=state.songs.filter(song=>
      !String(song?.id||'').startsWith('custom-')
    );

    state.songs=[
      ...baseSongs,
      ...state.customSongs
    ];

    const unique=new Map();

    state.songs.forEach(song=>{
      const id=String(song?.id||'');
      if(!id)return;
      unique.set(id,song);
    });

    state.songs=[...unique.values()];

    state.songs.forEach((song,index)=>{
      if(!Number.isFinite(song._sourceIndex)){
        song._sourceIndex=index;
      }
    });

    purgeRetiredCustomSongsV1();
    sortMasterSongs();
  }

  /*
   * EGP_EXPLICIT_REPERTOIRE_LISTS_V1
   *
   * Problema histórico:
   * state.songEdits llegó a guardar {...song} completo al editar letra,
   * imagen, nombre, etc. Eso arrastró `listas` aunque el repertorio NO
   * hubiese sido editado. Firebase podía entonces pisar canciones.json
   * con membresías viejas.
   *
   * Regla nueva:
   * - _listasRevision > 0 = listas editadas EXPLÍCITAMENTE en Repertorios.
   *   Esas listas sí son autoritativas.
   * - sin _listasRevision = songEdit legado.
   *   Conservamos las listas base actuales y únicamente heredamos IDs
   *   personalizados `rep-*`, para no perder repertorios personalizados
   *   creados históricamente.
   */
  function mergeSongEditSafelyV1(song,edit){
    if(!song || !edit || typeof edit!=='object'){
      return song;
    }

    const incoming={...edit};

    if(Array.isArray(incoming.listas)){
      const explicitRevision=
        Number(incoming._listasRevision)||0;

      if(explicitRevision>0){
        incoming.listas=[
          ...new Set([
            'todas',
            ...incoming.listas
              .map(String)
              .filter(id=>id && id!=='todas')
          ])
        ];

      }else{
        const currentLists=
          Array.isArray(song.listas)
            ? song.listas.map(String)
            : [];

        const legacyCustomLists=
          incoming.listas
            .map(String)
            .filter(
              id=>
                id.startsWith('rep-')
            );

        incoming.listas=[
          ...new Set([
            'todas',
            ...currentLists.filter(
              id=>id && id!=='todas'
            ),
            ...legacyCustomLists
          ])
        ];
      }
    }

    return {
      ...song,
      ...incoming
    };
  }

  function hydrateSavedState(){
    const saved = JSON.parse(localStorage.getItem('egm-panel-v3') || '{}');
    state.config = saved.config || null;
    state.customSongs = Array.isArray(saved.customSongs) ? saved.customSongs : [];
    state.songEdits = saved.songEdits && typeof saved.songEdits==='object' ? saved.songEdits : {};

    /*
     * EGP_EXPLICIT_REPERTOIRE_LISTS_V1
     * localStorage antiguo tampoco puede reinyectar listas obsoletas.
     */
    state.songs = state.songs.map(
      song=>
        state.songEdits[song.id]
          ? mergeSongEditSafelyV1(
              song,
              state.songEdits[song.id]
            )
          : song
    );

    state.customRepertoires = Array.isArray(saved.customRepertoires) ? saved.customRepertoires : [];
    state.songs = [...state.songs, ...state.customSongs];
    sortMasterSongs();
    state.queue = Array.isArray(saved.queue) ? saved.queue : [];
    state.played = new Set(Array.isArray(saved.played) ? saved.played : []);
    (saved.venues || []).forEach(v => addVenueOption(v));
    if(state.config){
      $('#venueInput').value = state.config.venue || '';
      $('#profileSelect').value = state.config.profile || 'alto';
      $('#whatsappToggle').checked = false; // EGP_DEFAULT_PEDIDOS_OFF_V1: no restaurar preferencia vieja
      const requestsToggle=document.getElementById('requestsToggle');
      if(requestsToggle)requestsToggle.checked=state.config.requests===true;
      const requestsMode=document.getElementById('requestsModeSelect');
      if(requestsMode)requestsMode.value=state.config.requestsMode==='uno_por_turno'?'uno_por_turno':'libre';
      $('#publicQueueToggle').checked = state.config.publicQueue !== false;
      setStatus(showActiveConfirmed===true);
    }
    refreshPanelProfileControls();
  }

  function saveStateLocalOnly(){
    const venues = $$('#venueHistory option').map(o=>o.value);
    const payload={
      config:state.config,
      queue:state.queue,
      played:[...state.played],
      venues,
      customSongs:state.customSongs,
      customRepertoires:state.customRepertoires,
      songEdits:state.songEdits
    };

    /*
     * EGP_LOCALSTORAGE_QUOTA_SAFE_V1
     * El cache local nunca puede bloquear una operacion real de cola.
     */
    try{
      localStorage.setItem('egm-panel-v3',JSON.stringify(payload));
      return true;
    }catch(err){
      console.warn(
        'Cache local lleno o no disponible; la operacion remota continua.',
        err
      );

      try{
        sessionStorage.setItem(
          'egm-panel-runtime-v1',
          JSON.stringify({
            config:state.config,
            queue:state.queue,
            played:[...state.played]
          })
        );
      }catch(_){}

      return false;
    }
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

  function egpFirebaseQueueRevision(data={}){
    return Math.max(
      Number(data?.show_revision)||0,
      Number(data?.updated_at)||0
    );
  }

  function egpQueueSemanticSignature(queue=[],played=[]){
    const p=
      played instanceof Set
        ? played
        : new Set(
            Array.isArray(played)
              ? played.map(String)
              : []
          );

    const q=
      Array.isArray(queue)
        ? queue.map(String).filter(Boolean)
        : [];

    return JSON.stringify({
      queue:q,
      played:q.filter(id=>p.has(id))
    });
  }

  function egpCoreQueueFromSnapshot(snapshot={}){
    const rows=
      Array.isArray(snapshot?.queue)
        ? snapshot.queue.slice()
        : [];

    rows.sort(
      (a,b)=>
        (Number(a?.position)||0)-
        (Number(b?.position)||0)
    );

    return {
      queue:rows
        .map(row=>String(row?.id||''))
        .filter(Boolean),

      played:rows
        .filter(row=>row?.played===true)
        .map(row=>String(row?.id||''))
        .filter(Boolean)
    };
  }

  async function egpApplyDesiredFirebaseQueueToCore(data={},options={}){
    if(!LOCAL_QUEUE_MODE)return false;

    const force=options?.force===true;

    const revision=egpFirebaseQueueRevision(data);
    const writer=String(data?.show_writer||'');

    if(!revision)return false;

    if(
      !force &&
      (
        revision<=egpFirebaseQueueBridgeBaselineRevision ||
        revision<=egpFirebaseQueueBridgeLastImportedRevision
      )
    ){
      return false;
    }

    if(!force && writer && writer===DEVICE_ID){
      egpFirebaseQueueBridgeBaselineRevision=
        Math.max(
          egpFirebaseQueueBridgeBaselineRevision,
          revision
        );
      return false;
    }

    const desiredQueue=
      Array.isArray(data?.cola)
        ? [...new Set(
            data.cola.map(String).filter(Boolean)
          )]
        : [];

    const desiredPlayed=
      new Set(
        Array.isArray(data?.tocadas)
          ? data.tocadas.map(String).filter(Boolean)
          : []
      );

    const core=await localQueueRequest('/api/state');

    if(core?.show?.active!==true){
      return false;
    }

    const remoteSession=String(
      data?.show_session_id ||
      data?.show_id ||
      data?.inicio_show ||
      ''
    );

    const corePub=
      core?.publicConfig &&
      typeof core.publicConfig==='object'
        ? core.publicConfig
        : {};

    const coreSession=String(
      corePub?.show_session_id ||
      corePub?.show_id ||
      corePub?.inicio_show ||
      ''
    );

    if(
      remoteSession &&
      coreSession &&
      remoteSession!==coreSession
    ){
      console.warn(
        'Firebase->Core ignorado: pertenece a otro show',
        {remoteSession,coreSession}
      );

      egpFirebaseQueueBridgeBaselineRevision=
        Math.max(
          egpFirebaseQueueBridgeBaselineRevision,
          revision
        );

      return false;
    }

    const current=egpCoreQueueFromSnapshot(core);

    const desiredSignature=
      egpQueueSemanticSignature(
        desiredQueue,
        desiredPlayed
      );

    const currentSignature=
      egpQueueSemanticSignature(
        current.queue,
        current.played
      );

    if(desiredSignature===currentSignature){
      egpFirebaseQueueBridgeLastImportedRevision=
        Math.max(
          egpFirebaseQueueBridgeLastImportedRevision,
          revision
        );
      return true;
    }

    console.info(
      'EGP Firebase -> Core: importando cola remota',
      {
        writer,
        revision,
        desiredQueue,
        desiredPlayed:[...desiredPlayed]
      }
    );

    const desiredSet=new Set(desiredQueue);
    const currentSet=new Set(current.queue);
    const currentPlayed=new Set(current.played);

    for(const id of current.queue){
      if(!desiredSet.has(id)){
        await localQueueRequest(
          '/api/queue/remove',
          {id}
        );
      }
    }

    for(const id of desiredQueue){
      if(
        currentPlayed.has(id) &&
        !desiredPlayed.has(id)
      ){
        await localQueueRequest(
          '/api/queue/remove',
          {id}
        );

        const song=state.songs.find(
          x=>String(x.id)===id
        );

        await localQueueRequest(
          '/api/queue/add',
          {
            id,
            title:song?.titulo||id,
            number:String(
              song?.numero ||
              song?.n ||
              ''
            )
          }
        );
      }
    }

    for(const id of desiredQueue){
      if(
        !currentSet.has(id) &&
        !(
          currentPlayed.has(id) &&
          !desiredPlayed.has(id)
        )
      ){
        const song=state.songs.find(
          x=>String(x.id)===id
        );

        await localQueueRequest(
          '/api/queue/add',
          {
            id,
            title:song?.titulo||id,
            number:String(
              song?.numero ||
              song?.n ||
              ''
            )
          }
        );
      }
    }

    for(const id of desiredQueue){
      if(desiredPlayed.has(id)){
        await localQueueRequest(
          '/api/queue/played',
          {
            id,
            played:true
          }
        );
      }
    }

    await localQueueRequest(
      '/api/queue/reorder',
      {
        order:desiredQueue
      }
    );

    const finalSnapshot=
      await localQueueRequest('/api/state');

    applyLocalQueueSnapshot(
      finalSnapshot,
      {force:true}
    );

    egpFirebaseQueueBridgeLastImportedRevision=
      Math.max(
        egpFirebaseQueueBridgeLastImportedRevision,
        revision
      );

    egpMirrorCoreSnapshotToFirebase(
      finalSnapshot
    );

    return true;
  }

  function egpBridgeFirebaseQueueToCore(data={}){
    if(
      EGP_AUDIT_LOCAL ||
      !LOCAL_QUEUE_MODE
    ){
      return;
    }

    const revision=
      egpFirebaseQueueRevision(data);

    if(
      !revision ||
      revision<=egpFirebaseQueueBridgeBaselineRevision ||
      revision<=egpFirebaseQueueBridgeLastImportedRevision
    ){
      return;
    }

    const task=async()=>{
      try{
        await egpApplyDesiredFirebaseQueueToCore(
          data
        );
      }catch(err){
        console.warn(
          'Firebase -> Core pendiente:',
          err
        );
      }
    };

    egpFirebaseQueueBridgeChain=
      egpFirebaseQueueBridgeChain.then(
        task,
        task
      );
  }


  /*
   * EGP_FIREBASE_TO_CORE_FULL_SHOW_BRIDGE_V1
   *
   * Flujo:
   * Panel fuera de LAN -> Firebase -> Panel con Core -> Core -> Bridge/Músicos
   *                                                   -> Firebase -> demás Panels
   *
   * Core nunca deja de ser la autoridad final.
   */

  function egpFirebaseStateRevision(data={}){
    return (
      Number(data?.show_revision) ||
      Number(data?.updated_at) ||
      0
    );
  }

  function egpCoreSemanticRevision(snapshot={}){
    const pub=
      snapshot?.publicConfig &&
      typeof snapshot.publicConfig==='object'
        ? snapshot.publicConfig
        : {};

    const rows=
      Array.isArray(snapshot?.queue)
        ? snapshot.queue
        : [];

    /*
     * NO usamos show.updatedAt como autoridad:
     * e017 ya documentó que Core puede tocar timestamps técnicos
     * aunque el significado del show no haya cambiado.
     *
     * show_revision es la revisión semántica de configuración/show.
     * updated_at de cada fila sí representa una mutación real de cola.
     */
    const publicRevision=
      Number(pub.show_revision) ||
      Number(pub.updated_at) ||
      0;

    const queueRevision=rows.reduce(
      (max,row)=>Math.max(
        max,
        Number(row?.updated_at)||0
      ),
      0
    );

    return Math.max(
      publicRevision,
      queueRevision
    );
  }

  function egpRemoteShowSession(data={}){
    return String(
      data?.show_session_id ||
      data?.show_id ||
      data?.inicio_show ||
      ''
    );
  }

  function egpCoreShowSession(snapshot={}){
    const pub=
      snapshot?.publicConfig &&
      typeof snapshot.publicConfig==='object'
        ? snapshot.publicConfig
        : {};

    return String(
      pub.show_session_id ||
      pub.show_id ||
      pub.inicio_show ||
      ''
    );
  }

  function egpRemoteShowStart(data={}){
    const value=
      Number(data?.inicio_show) ||
      Number(data?.show_id) ||
      0;

    return Number.isFinite(value)
      ? Math.max(0,value)
      : 0;
  }

  function egpCoreShowStart(snapshot={}){
    const pub=
      snapshot?.publicConfig &&
      typeof snapshot.publicConfig==='object'
        ? snapshot.publicConfig
        : {};

    const value=
      Number(pub.inicio_show) ||
      Number(pub.show_id) ||
      0;

    return Number.isFinite(value)
      ? Math.max(0,value)
      : 0;
  }

  function egpMarkFirebaseStateBridgeRevision(revision){
    const value=Number(revision)||0;
    if(!value)return;

    egpFirebaseStateBridgeBaselineRevision=
      Math.max(
        egpFirebaseStateBridgeBaselineRevision,
        value
      );

    egpFirebaseStateBridgeLastImportedRevision=
      Math.max(
        egpFirebaseStateBridgeLastImportedRevision,
        value
      );

    egpFirebaseQueueBridgeBaselineRevision=
      Math.max(
        egpFirebaseQueueBridgeBaselineRevision,
        value
      );

    egpFirebaseQueueBridgeLastImportedRevision=
      Math.max(
        egpFirebaseQueueBridgeLastImportedRevision,
        value
      );
  }

  function egpRemoteStateCanReplaceCore(data,core,revision){
    const remoteRevision=Number(revision)||0;
    const coreRevision=egpCoreSemanticRevision(core);

    if(!remoteRevision || remoteRevision<=coreRevision){
      return false;
    }

    const remoteActive=
      data?.show_activo===true;

    const coreActive=
      core?.show?.active===true;

    const remoteSession=
      egpRemoteShowSession(data);

    const coreSession=
      egpCoreShowSession(core);

    if(!remoteActive){
      if(
        remoteSession &&
        coreSession &&
        remoteSession!==coreSession
      ){
        return false;
      }

      return true;
    }

    if(!coreActive){
      return true;
    }

    if(
      !remoteSession ||
      !coreSession ||
      remoteSession===coreSession
    ){
      return true;
    }

    const remoteStart=egpRemoteShowStart(data);
    const coreStart=egpCoreShowStart(core);

    if(remoteStart && coreStart){
      return remoteStart>coreStart;
    }

    return false;
  }

  async function egpApplyDesiredFirebaseStateToCore(data={}){
    if(!LOCAL_QUEUE_MODE)return false;

    const revision=
      egpFirebaseStateRevision(data);

    const writer=
      String(data?.show_writer||'');

    if(!revision)return false;

    if(
      revision<=egpFirebaseStateBridgeBaselineRevision ||
      revision<=egpFirebaseStateBridgeLastImportedRevision
    ){
      return false;
    }

    if(writer && writer===DEVICE_ID){
      egpMarkFirebaseStateBridgeRevision(revision);
      return false;
    }

    const core=
      await localQueueRequest('/api/state');

    if(
      !egpRemoteStateCanReplaceCore(
        data,
        core,
        revision
      )
    ){
      console.info(
        'EGP Firebase -> Core: snapshot rechazado; Core conserva autoridad',
        {
          revision,
          coreRevision:egpCoreSemanticRevision(core),
          remoteSession:egpRemoteShowSession(data),
          coreSession:egpCoreShowSession(core),
          remoteActive:data?.show_activo===true,
          coreActive:core?.show?.active===true
        }
      );

      egpMarkFirebaseStateBridgeRevision(revision);
      return false;
    }

    const active=
      data?.show_activo===true;

    const coreActive=
      core?.show?.active===true;

    const remoteSession=
      egpRemoteShowSession(data);

    const coreSession=
      egpCoreShowSession(core);

    const changingSession=
      active &&
      (
        !coreActive ||
        (
          remoteSession &&
          coreSession &&
          remoteSession!==coreSession
        )
      );

    console.info(
      'EGP Firebase -> Core: importando estado total',
      {
        writer,
        revision,
        active,
        remoteSession,
        coreSession,
        changingSession
      }
    );

    if(!active || changingSession){
      await localQueueRequest(
        '/api/queue/clear',
        {}
      );
    }

    await localQueueRequest(
      '/api/show',
      {
        active,
        venue:String(
          data?.lugar ||
          core?.show?.venue ||
          ''
        )
      }
    );

    const configPatch={
      ...data,
      show_activo:active,
      show_active:active,
      show_revision:revision,
      updated_at:revision
    };

    if(!active){
      Object.assign(
        configPatch,
        {
          cola:[],
          tocadas:[],
          pedidos_whatsapp:false,
          pedidos_panel:false,
          pedidos_modo:'libre',
          inicio_show:0,
          cronometro_elapsed_ms:0,
          cronometro_running:false,
          cronometro_started_at:0
        }
      );
    }

    await egpPublicarConfigLan(
      configPatch
    );

    if(active){
      await egpApplyDesiredFirebaseQueueToCore(
        data,
        {force:true}
      );

    }else{
      try{
        await egpCerrarPedidosPendientes();
      }catch(err){
        console.warn(
          'Pedidos pendientes al finalizar desde Firebase:',
          err
        );
      }

      const finalSnapshot=
        await localQueueRequest('/api/state');

      applyLocalQueueSnapshot(
        finalSnapshot,
        {force:true}
      );
    }

    egpMarkFirebaseStateBridgeRevision(
      revision
    );

    return true;
  }

  async function egpRepublishCoreAfterFirebaseBridge(){
    if(
      EGP_AUDIT_LOCAL ||
      !LOCAL_QUEUE_MODE ||
      egpFirebaseStateBridgeActive ||
      egpFirebaseStateBridgeQueued>0
    ){
      return;
    }

    try{
      const snapshot=
        await localQueueRequest('/api/state');

      applyLocalQueueSnapshot(
        snapshot,
        {force:true}
      );

      egpCoreFirebaseMirrorKey='';

      egpMirrorCoreSnapshotToFirebase(
        snapshot
      );

    }catch(err){
      console.warn(
        'Confirmación Core -> Firebase pendiente:',
        err
      );
    }
  }

  function egpBridgeFirebaseStateToCore(data={}){
    if(
      EGP_AUDIT_LOCAL ||
      !LOCAL_QUEUE_MODE
    ){
      return;
    }

    const revision=
      egpFirebaseStateRevision(data);

    if(!revision)return;

    const writer=
      String(data?.show_writer||'');

    if(writer && writer===DEVICE_ID){
      egpMarkFirebaseStateBridgeRevision(
        revision
      );
      return;
    }

    if(
      revision<=egpFirebaseStateBridgeBaselineRevision ||
      revision<=egpFirebaseStateBridgeLastImportedRevision
    ){
      return;
    }

    egpFirebaseStateBridgeQueued++;

    const task=async()=>{
      egpFirebaseStateBridgeActive=true;

      try{
        await egpApplyDesiredFirebaseStateToCore(
          data
        );

      }catch(err){
        console.warn(
          'Firebase -> Core total pendiente:',
          err
        );

      }finally{
        egpFirebaseStateBridgeActive=false;

        egpFirebaseStateBridgeQueued=
          Math.max(
            0,
            egpFirebaseStateBridgeQueued-1
          );

        if(egpFirebaseStateBridgeQueued===0){
          setTimeout(
            ()=>egpRepublishCoreAfterFirebaseBridge(),
            0
          );
        }
      }
    };

    egpFirebaseStateBridgeChain=
      egpFirebaseStateBridgeChain.then(
        task,
        task
      );
  }


  function egpMirrorQueueLanToFirebase(){
    if(
      EGP_AUDIT_LOCAL ||
      egpFirebaseStateBridgeActive ||
      egpFirebaseStateBridgeQueued>0
    ){
      return Promise.resolve();
    }

    const queue=[...state.queue].map(String);
    const played=[...state.played].map(String);
    const revision=Date.now();

    const run=async()=>{
      try{
        /*
         * No confiar en navigator.onLine:
         * Android puede tener LAN por Wi-Fi e Internet por datos moviles.
         */
        if(!remoteStateRef)await initRemoteSync(true);

        if(!remoteStateRef||!window.__egmSetDoc){
          throw new Error('Firebase todavia no esta listo');
        }

        await window.__egmSetDoc(
          remoteStateRef,
          {
            cola:queue,
            tocadas:played,
            show_revision:revision,
            show_writer:DEVICE_ID,
            updated_at:revision
          },
          {merge:true}
        );
      }catch(err){
        /*
         * Nunca romper el show local porque Internet falle.
         */
        console.warn(
          'Firebase cola pendiente; LAN sigue autoritativa:',
          err
        );
      }
    };

    egpQueueFirebaseMirrorChain=
      egpQueueFirebaseMirrorChain.then(run,run);

    return egpQueueFirebaseMirrorChain;
  }


  /*
   * EGP_CORE_TO_FIREBASE_FULL_MIRROR_V1
   *
   * Cualquier Panel que alcance Core y tenga Internet refleja
   * el snapshot completo de Core en Firebase.
   */
  function egpMirrorCoreSnapshotToFirebase(snapshot){
    if(
      EGP_AUDIT_LOCAL ||
      egpFirebaseStateBridgeActive ||
      egpFirebaseStateBridgeQueued>0 ||
      !snapshot ||
      !snapshot.show ||
      !snapshot.publicConfig
    ){
      return;
    }

    const pub=snapshot.publicConfig||{};
    const rows=Array.isArray(snapshot.queue)
      ? snapshot.queue
      : [];

    const queueRevision=rows.reduce(
      (max,row)=>Math.max(
        max,
        Number(row?.updated_at)||0
      ),
      0
    );

    const revision=Math.max(
      Number(pub.show_revision)||0,
      Number(pub.updated_at)||0,
      Number(snapshot.show?.updatedAt)||0,
      queueRevision
    );

    if(!revision)return;

    const active=snapshot.show?.active===true;

    /*
     * EGP_CORE_FIREBASE_SEMANTIC_MIRROR_V1
     *
     * No usar revision/updated_at como llave: Local Core puede tocar
     * esos timestamps aunque el show siga exactamente igual.
     * Firebase solo recibe otra escritura cuando cambia el estado
     * semantico que realmente importa.
     */
    const key=JSON.stringify({
      session:String(
        pub.show_session_id ||
        pub.show_id ||
        ''
      ),

      active,

      repertoire:String(
        pub.lista_activa ||
        pub.listaActiva ||
        'todas'
      ),

      repertoireName:String(
        pub.repertorio_nombre||''
      ),

      repertoireIds:Array.isArray(
        pub.repertorio_activo_ids
      )
        ? pub.repertorio_activo_ids.map(String)
        : [],

      requests:
        active &&
        pub.pedidos_panel===true,

      whatsapp:
        active &&
        pub.pedidos_whatsapp===true,

      requestsMode:
        pub.pedidos_modo==='uno_por_turno'
          ? 'uno_por_turno'
          : 'libre',

      publicQueue:
        pub.mostrar_cola!==false,

      venue:String(pub.lugar||''),

      profile:String(
        pub.perfil_clientes||'medio'
      ),

      advertising:
        pub.uso_publicidad===true,

      startedAt:
        active
          ? Number(
              pub.inicio_show ||
              pub.show_id ||
              0
            )
          : 0,

      timer:
        active
          ? [
              Number(pub.cronometro_schema)||0,
              pub.cronometro_running===true,
              pub.cronometro_running===true
                ? Number(pub.cronometro_started_at)||0
                : Math.max(
                    0,
                    Number(pub.cronometro_elapsed_ms)||0
                  )
            ]
          : [0,false,0],

      queue:
        active
          ? rows
              .slice()
              .sort(
                (a,b)=>
                  (Number(a?.position)||0)-
                  (Number(b?.position)||0)
              )
              .map(row=>[
                String(row?.id||''),
                Number(row?.position)||0,
                row?.played===true
              ])
          : []
    });

    if(
      key===egpCoreFirebaseMirrorKey ||
      egpCoreFirebaseMirrorBusy ||
      Date.now()<egpCoreFirebaseMirrorRetryAt
    ){
      return;
    }

    egpCoreFirebaseMirrorBusy=true;

    const queue=rows
      .slice()
      .sort(
        (a,b)=>
          (Number(a?.position)||0)-
          (Number(b?.position)||0)
      )
      .map(row=>String(row?.id||''))
      .filter(Boolean);

    const played=rows
      .filter(row=>row?.played===true)
      .map(row=>String(row?.id||''))
      .filter(Boolean);

    const payload={
      lista_activa:String(
        pub.lista_activa ||
        pub.listaActiva ||
        'todas'
      ),
      listaActiva:String(
        pub.listaActiva ||
        pub.lista_activa ||
        'todas'
      ),
      repertorio_nombre:String(
        pub.repertorio_nombre||''
      ),
      repertorio_activo_ids:Array.isArray(
        pub.repertorio_activo_ids
      )
        ? pub.repertorio_activo_ids.map(String)
        : [],
      repertorioActivoIds:Array.isArray(
        pub.repertorioActivoIds
      )
        ? pub.repertorioActivoIds.map(String)
        : (
            Array.isArray(pub.repertorio_activo_ids)
              ? pub.repertorio_activo_ids.map(String)
              : []
          ),
      pedidos_whatsapp:
        active && pub.pedidos_whatsapp===true,
      pedidos_panel:
        active && pub.pedidos_panel===true,
      pedidos_modo:
        pub.pedidos_modo==='uno_por_turno'
          ? 'uno_por_turno'
          : 'libre',
      mostrar_cola:
        pub.mostrar_cola!==false,
      lugar:String(pub.lugar||''),
      perfil_clientes:String(
        pub.perfil_clientes||'medio'
      ),
      uso_publicidad:
        pub.uso_publicidad===true,

      show_activo:active,
      show_id:String(pub.show_id||''),
      show_session_id:String(
        pub.show_session_id||''
      ),
      inicio_show:
        active
          ? Number(pub.inicio_show||pub.show_id||0)
          : 0,

      cronometro_schema:
        Number(pub.cronometro_schema)||SHOW_TIMER_SCHEMA,
      cronometro_elapsed_ms:
        active
          ? Math.max(
              0,
              Number(pub.cronometro_elapsed_ms)||0
            )
          : 0,
      cronometro_running:
        active && pub.cronometro_running===true,
      cronometro_started_at:
        active && pub.cronometro_running===true
          ? Number(pub.cronometro_started_at)||0
          : 0,

      cola:active?queue:[],
      tocadas:active?played:[],

      show_revision:revision,
      show_writer:String(
        pub.show_writer||DEVICE_ID
      ),
      updated_at:revision
    };

    (async()=>{
      try{
        if(!remoteStateRef){
          await initRemoteSync(true);
        }

        if(
          !remoteStateRef ||
          !window.__egmSetDoc
        ){
          throw new Error(
            'Firebase todavía no está listo'
          );
        }

        await window.__egmSetDoc(
          remoteStateRef,
          payload,
          {merge:true}
        );

        egpCoreFirebaseMirrorKey=key;
        egpCoreFirebaseMirrorRetryAt=0;

      }catch(err){
        egpCoreFirebaseMirrorRetryAt=
          Date.now()+3000;

      }finally{
        egpCoreFirebaseMirrorBusy=false;
      }
    })();
  }


  /*
   * EGP_CORE_USES_REMOTE_RULES_V2
   *
   * Local Core se convierte al MISMO contrato que config/estado de Firebase.
   * Desde aquí no existen dos reglas de interfaz.
   */
  function egpCoreSnapshotToPanelState(snapshot){
    const pub=
      snapshot?.publicConfig &&
      typeof snapshot.publicConfig==='object'
        ? snapshot.publicConfig
        : {};

    const show=
      snapshot?.show &&
      typeof snapshot.show==='object'
        ? snapshot.show
        : {};

    const rows=
      Array.isArray(snapshot?.queue)
        ? snapshot.queue
        : [];

    /*
     * EGP_SHOW_SEMANTIC_STATE_V3
     *
     * MUY IMPORTANTE:
     * la revisión del SHOW no puede incluir updated_at de la COLA.
     * Cola se sincroniza abajo por su propio camino.
     */
    const revision=Math.max(
      Number(pub.show_revision)||0,
      Number(pub.updated_at)||0,
      Number(show.updatedAt)||0
    );

    const active=show.active===true;

    const queue=rows
      .slice()
      .sort(
        (a,b)=>
          (Number(a?.position)||0)-
          (Number(b?.position)||0)
      )
      .map(row=>String(row?.id||''))
      .filter(Boolean);

    const played=rows
      .filter(row=>row?.played===true)
      .map(row=>String(row?.id||''))
      .filter(Boolean);

    return {
      ...pub,

      show_activo:active,
      show_active:active,

      lugar:String(
        pub.lugar ??
        show.venue ??
        ''
      ),

      lista_activa:String(
        pub.lista_activa ||
        pub.listaActiva ||
        'todas'
      ),

      listaActiva:String(
        pub.listaActiva ||
        pub.lista_activa ||
        'todas'
      ),

      inicio_show:Number(
        pub.inicio_show ||
        pub.show_id ||
        0
      )||0,

      cronometro_schema:
        Number(pub.cronometro_schema)||0,

      cronometro_elapsed_ms:
        Math.max(
          0,
          Number(pub.cronometro_elapsed_ms)||0
        ),

      cronometro_running:
        active &&
        pub.cronometro_running===true,

      cronometro_started_at:
        active
          ? Number(pub.cronometro_started_at)||0
          : 0,

      cola:active?queue:[],
      tocadas:active?played:[],

      show_revision:revision,
      updated_at:revision
    };
  }


  function applyLocalQueueSnapshot(snapshot,{force=false}={}){
    if(!snapshot||!Array.isArray(snapshot.queue))return false;

    /*
     * EGP_CORE_USES_REMOTE_RULES_V2
     *
     * Esta es la pieza central:
     * Core NO interpreta show/config/timer por una ruta distinta.
     * Se adapta y se entrega a applyRemotePanelState(), exactamente
     * como el snapshot de Internet.
     */
    const corePanelState=
      egpCoreSnapshotToPanelState(snapshot);

    applyRemotePanelState(
      corePanelState,
      {
        skipQueue:true,
        skipPlayed:true,
        allowWhileLocal:true,
        authority:'core'
      }
    );

    if(!force&&(queueDragState.active||queueDragState.saving))return false;

    const before=[...state.queue];
    const beforePlayed=[...state.played];
    const wasRemoteReady=remoteReady;

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

    const queueChanged=
      before.join('|')!==ids.join('|');

    const playedChanged=
      beforePlayed.join('|')!==played.join('|');

    /*
     * EGP_QUEUE_DOM_INTEGRITY_V1
     *
     * La cola puede seguir CORRECTA en state/Core pero Android puede
     * perder visualmente los nodos al destapar el Panel desde Ui24R.
     *
     * Antes, si ids/played no cambiaban, NO se llamaba renderQueue().
     * Resultado: DOM vacio hasta que una mutacion real cambiaba la cola.
     *
     * Ahora comprobamos también que el DOM represente exactamente
     * los pendientes que YA existen en memoria.
     */
    const expectedPending=
      ids.filter(id=>!state.played.has(id));

    const queueListEl=
      document.getElementById('queueList');

    const domPending=
      queueListEl
        ? [...queueListEl.querySelectorAll(
            '.queue-item[data-song-id]'
          )].map(
            el=>String(el.dataset.songId||'')
          ).filter(Boolean)
        : [];

    const queueDomOutOfSync=
      Boolean(queueListEl) &&
      document.body.classList.contains('live-mode') &&
      !queueDragState.active &&
      !queueDragState.saving &&
      expectedPending.join('|')!==domPending.join('|');

    if(queueDomOutOfSync){
      const diagnostic={
        at:new Date().toISOString(),
        expectedPending,
        domPending,
        queue:[...ids],
        played:[...played],
        coreUnchanged:
          !queueChanged && !playedChanged,
        ui24rOpen:
          document.getElementById('ui24rOverlay')
            ?.classList.contains('is-open')===true
      };

      console.warn(
        'EGP QUEUE DOM INTEGRITY: repintando cola',
        diagnostic
      );

      try{
        localStorage.setItem(
          'egp-panel-queue-dom-integrity-last-v1',
          JSON.stringify(diagnostic)
        );
      }catch(_){}
    }

    if(
      queueChanged ||
      playedChanged ||
      force ||
      queueDomOutOfSync
    ){
      renderQueue();

      /*
       * Las tarjetas de canciones solo necesitan repintarse si cambió
       * el ESTADO real de cola/tocadas. Un fallo puramente visual de
       * #queueList no debe reconstruir toda la lista de canciones.
       */
      if(queueChanged || playedChanged || force){
        renderSongs();
      }

      /*
       * Si el cambio vino por LAN desde otro Panel o Bridge,
       * reflejarlo tambien en Firebase sin frenar la LAN.
       *
       * Una reparación DOM nunca se publica: no cambió ningún dato.
       */
      if(LOCAL_QUEUE_MODE && (queueChanged || playedChanged)){
        egpMirrorQueueLanToFirebase();
      }
    }

    if(wasRemoteReady && (queueChanged || playedChanged)){
      processQueueHeadChange(
        before,
        ids,
        beforePlayed,
        played
      );
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

          /*
           * EGP_CORE_SHOW_AUTHORITY_V1
           * Core cayó: Firebase vuelve a ser failover del show.
           */
          applyRemotePanelState(
            latestRemoteState,
            {
              skipQueue:true,
              skipPlayed:true,
              allowWhileLocal:true,
              authority:'firebase'
            }
          );
        }

        return;
      }

      const enteringLocalQueueMode=
        LOCAL_QUEUE_MODE!==true;

      LOCAL_QUEUE_MODE=true;

      if(enteringLocalQueueMode){
        egpFirebaseQueueBridgeBaselineRevision=
          Math.max(
            egpFirebaseQueueBridgeBaselineRevision,
            egpFirebaseQueueRevision(
              latestRemoteState||{}
            )
          );

        egpFirebaseQueueBridgeLastImportedRevision=
          egpFirebaseQueueBridgeBaselineRevision;

        console.info(
          'EGP Firebase->Core bridge armado',
          {
            baseline:
              egpFirebaseQueueBridgeBaselineRevision
          }
        );
      }

      /*
       * EGP_FIREBASE_TO_CORE_FULL_SHOW_BRIDGE_V1
       *
       * Al ENTRAR a modo Core no descartamos a ciegas el último snapshot
       * Firebase. Si es semánticamente posterior, puede contener acciones
       * hechas por iPhone/Android durante el failover.
       */
      if(enteringLocalQueueMode && latestRemoteState){
        const remoteRevision=
          egpFirebaseStateRevision(
            latestRemoteState
          );

        const coreRevision=
          egpCoreSemanticRevision(
            snap
          );

        const remoteWriter=
          String(
            latestRemoteState?.show_writer||''
          );

        if(
          remoteRevision &&
          remoteRevision>coreRevision &&
          (!remoteWriter || remoteWriter!==DEVICE_ID)
        ){
          egpFirebaseStateBridgeBaselineRevision=
            Math.max(
              egpFirebaseStateBridgeBaselineRevision,
              coreRevision
            );

          egpFirebaseStateBridgeLastImportedRevision=
            Math.max(
              egpFirebaseStateBridgeLastImportedRevision,
              coreRevision
            );

          egpBridgeFirebaseStateToCore(
            latestRemoteState
          );

        }else{
          egpMarkFirebaseStateBridgeRevision(
            remoteRevision
          );

          if(
            remoteRevision &&
            remoteWriter &&
            remoteWriter!==DEVICE_ID
          ){
            egpCoreFirebaseMirrorKey='';
          }
        }
      }

      try{
        applyLocalQueueSnapshot(snap);

        /*
         * EGP_CORE_TO_FIREBASE_FULL_MIRROR_V1
         * Este dispositivo hace de puente si también tiene Internet.
         */
        egpMirrorCoreSnapshotToFirebase(snap);

      }catch(err){
        console.warn('Local Core conectado; error aplicando estado local:',err);
      }
    }finally{
      localQueueBusy=false;
    }
  }

  /*
   * EGP_UI24R_BACKGROUND_LIGHT_V1
   * Panel normal: 150 ms.
   * Ui24R abierta: 800 ms para liberar trabajo del hilo principal.
   */
  function localQueueSyncDelay(){
    const overlay=document.getElementById('ui24rOverlay');

    return overlay && overlay.classList.contains('is-open')
      ? 800
      : 150;
  }

  async function localQueueSyncLoop(){
    localQueueTimer=1;

    await refreshLocalQueue();

    localQueueTimer=setTimeout(
      localQueueSyncLoop,
      localQueueSyncDelay()
    );
  }

  function startLocalQueueSync(){
    if(localQueueTimer)return;
    localQueueSyncLoop();
  }

  setTimeout(startLocalQueueSync,50);
  function saveState(immediate=false){ saveStateLocalOnly(); return syncRemoteState(immediate); }

  function buildRepertoires(){
    const map = new Map(fallbackRepertoires.map(x=>[x.id,x.name]));
    state.customRepertoires.forEach(x=>map.set(x.id,x.name));
    state.songs.forEach(song => (song.listas||[]).forEach(id=>{
      if(!map.has(id)) map.set(id, titleFromId(id));
    }));
    const select=$('#repertoireSelect');
    const savedRepertoire=state.config?.repertoire||'';

    select.innerHTML='';

    /*
     * EGP_CONFIG_CAMPOS_DENTRO_V1
     * Sin show/configuración previa, "Repertorio" vive dentro del select.
     * Al elegir uno, desaparece y queda visible la selección.
     */
    const placeholder=new Option('Repertorio','');
    placeholder.disabled=true;
    placeholder.selected=!savedRepertoire;
    select.add(placeholder);

    [...map].sort((a,b)=>a[1].localeCompare(b[1],'es')).forEach(([id,name])=>{
      const count=state.songs.filter(song=>id==='todas'||(song.listas||[]).includes(id)).length;
      const option=new Option(`${name} · ${count} ${count===1?'canción':'canciones'}`,id);
      option.dataset.name=name;
      select.add(option);
    });

    const savedExists=
      savedRepertoire &&
      [...select.options].some(
        option=>option.value===savedRepertoire
      );

    select.value=
      savedExists
        ? savedRepertoire
        : '';
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

  /*
   * EGP_ANDROID_REPERTOIRE_STAY_CONFIG_V1
   *
   * En Android, mientras el usuario esta eligiendo repertorio dentro
   * de Configuracion, una confirmacion LAN de show_activo=true no debe
   * interpretar esa interaccion como permiso para volver a Control en vivo.
   *
   * Seleccionar repertorio = quedarse en Configuracion.
   * Solo el boton Continuar vuelve al show.
   */
  const egpRepertoireSelect=$('#repertoireSelect');

  const egpKeepConfigWhileChoosingRepertoire=()=>{
    if(
      state.config &&
      $('#configView')?.classList.contains('is-active')
    ){
      configOpenedFromLive=true;

      const continueBtn=$('#continueShowBtn');
      if(continueBtn) continueBtn.hidden=false;
    }
  };

  egpRepertoireSelect?.addEventListener(
    'pointerdown',
    egpKeepConfigWhileChoosingRepertoire,
    {passive:true}
  );

  egpRepertoireSelect?.addEventListener(
    'touchstart',
    egpKeepConfigWhileChoosingRepertoire,
    {passive:true}
  );

  $('#repertoireSelect').addEventListener('change',()=>{
    egpKeepConfigWhileChoosingRepertoire();
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

    const patchRepertorio={
      lista_activa:repertoire,
      listaActiva:repertoire,
      repertorio_nombre:repertoireName,
      repertorio_activo_ids:ids,
      repertorioActivoIds:ids,
      show_activo:true
    };

    // El cambio del repertorio siempre se publica directamente en LAN.
    // Firebase continúa como sincronización secundaria.
    egpPublicarConfigLan(patchRepertorio)
      .then(()=>toast('Repertorio sincronizado en la red local.'))
      .catch(err=>console.warn('No se pudo publicar repertorio en LAN:',err));

    publishShowPatch(patchRepertorio)
      .catch(err=>console.warn('Firebase pendiente; repertorio LAN ya intentado:',err));
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

  /*
   * EGP_SHOW_SEMANTIC_STATE_V3
   *
   * Firma SOLO de lo que cambia el significado/visual del show.
   * No incluye cola/tocadas: ellas ya tienen sincronización propia.
   */
  function egpShowSemanticSignature(data){
    if(!data||typeof data!=='object')return '';

    return JSON.stringify([
      data.show_activo===true,
      String(
        data.show_session_id ||
        data.show_id ||
        data.inicio_show ||
        ''
      ),
      String(
        data.lista_activa ||
        data.listaActiva ||
        'todas'
      ),
      String(data.repertorio_nombre||''),
      String(data.lugar||''),
      String(data.perfil_clientes||'medio'),
      data.pedidos_whatsapp===true,
      data.pedidos_panel===true,
      String(data.pedidos_modo||'libre'),
      data.mostrar_cola!==false,
      data.uso_publicidad===true,
      Number(data.inicio_show)||0,
      Number(data.cronometro_schema)||0,
      Number(data.cronometro_elapsed_ms)||0,
      data.cronometro_running===true,
      Number(data.cronometro_started_at)||0
    ]);
  }

  function applyRemotePanelState(data,options={}){
    if(!data||typeof data!=='object')return;

    const authority=
      options.authority==='core'
        ? 'core'
        : 'firebase';

    /*
     * EGP_CORE_USES_REMOTE_RULES_V2
     *
     * Core vivo bloquea snapshots de Firebase, pero el propio Core
     * entra deliberadamente por esta MISMA función.
     */
    if(
      authority==='firebase' &&
      LOCAL_QUEUE_MODE===true &&
      options.allowWhileLocal!==true
    ){
      return;
    }

    const revision=
      Number(
        data.show_revision ||
        data.updated_at ||
        0
      );

    if(authority==='core'){
      /*
       * EGP_SHOW_SEMANTIC_STATE_V3
       *
       * Para Core manda la FIRMA del show, no una revisión mezclada
       * accidentalmente con cambios de cola.
       */
      const semanticSignature=
        egpShowSemanticSignature(data);

      if(
        semanticSignature &&
        semanticSignature===lastAppliedCoreShowSignature
      ){
        return;
      }

      lastAppliedCoreShowSignature=
        semanticSignature;

      if(revision){
        lastAppliedCoreRevision=revision;
      }

    }else{
      if(
        revision &&
        revision<lastAppliedRemoteRevision
      ){
        return;
      }

      if(revision){
        lastAppliedRemoteRevision=revision;
      }
    }
    applyingRemoteShowState=true;
    try{
      const incomingQueue=Array.isArray(data.cola)?data.cola.map(String):[];
      const localQueueAuthoritative=LOCAL_QUEUE_MODE===true;

      if(!localQueueAuthoritative&&!options.skipQueue){
        applyRemoteQueueSnapshot(incomingQueue);
      }

      if(!localQueueAuthoritative&&!options.skipPlayed&&Array.isArray(data.tocadas)){
        state.played=new Set(data.tocadas.map(String));
      }

      if(!queueDragState.active&&!queueDragState.saving&&!localQueueAuthoritative){
        state.queue=canonicalQueueOrder(state.queue,state.played);
        if(!options.skipQueue)normalizeRemoteQueueIfNeeded(incomingQueue,state.played);
      }
      const remoteActive=data.show_activo===true;

      const incomingShowSession=String(
        data.show_session_id ||
        data.show_id ||
        data.inicio_show ||
        ''
      );

      const isNewShowSession=
        remoteActive &&
        incomingShowSession &&
        incomingShowSession!==currentAppliedShowSession;

      /*
       * EGP_NEW_SHOW_REARMS_UI_V3
       *
       * Un show NUEVO siempre rearma autoentrada.
       * Esto NO afecta Atrás dentro del mismo show.
       */
      if(isNewShowSession){
        currentAppliedShowSession=
          incomingShowSession;

        configOpenedFromLive=false;
        window.__egpAutoEntrarShowActivoLanV1=false;

        /*
         * Una transición local antigua jamás puede bloquear un show
         * nuevo iniciado desde otro dispositivo.
         */
        localDesiredShowActive=null;
        localShowTransitionUntil=0;
      }

      if(
        !isNewShowSession &&
        Date.now()<localShowTransitionUntil &&
        localDesiredShowActive!==null &&
        remoteActive!==localDesiredShowActive
      ){
        return;
      }

      if(remoteActive){
        showActiveConfirmed=true;
        const repertoire=data.lista_activa||data.listaActiva||'todas';
        const select=$('#repertoireSelect');
        const option=select?[...select.options].find(o=>o.value===repertoire):null;
        const remoteRequests=options.preserveLocalRequests&&state.config?state.config.requests===true:data.pedidos_panel===true;
        const remoteWhatsapp=remoteRequests?false:(data.pedidos_whatsapp===true);
        state.config={
          venue:data.lugar||'', repertoire,
          repertoireName:data.repertorio_nombre||option?.dataset?.name||option?.textContent?.replace(/ · .*$/,'')||titleFromId(repertoire),
          profile:data.perfil_clientes||'medio', whatsapp:remoteWhatsapp,
          requests:remoteRequests,
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
          runningPresent:Object.prototype.hasOwnProperty.call(data,'cronometro_running'),
          startedAt:Number(data.cronometro_started_at)||0
        });
        saveStateLocalOnly();

        /*
         * EGP_REMOTE_SHOW_IMMEDIATE_LIVE_V2
         *
         * Regla global:
         * cuando otro Panel publica un show_activo=true por Firebase,
         * cualquier Panel YA autenticado y todavía en Configuración
         * entra inmediatamente a Control en vivo.
         *
         * Única excepción:
         * configOpenedFromLive=true significa que el usuario abrió
         * Configuración voluntariamente DESDE este mismo show.
         * En ese caso se respeta su posición y se muestra Continuar show.
         */
        const egpContinueRemoteV2=$('#continueShowBtn');

        if(
          egpContinueRemoteV2 &&
          $('#configView')?.classList.contains('is-active')
        ){
          egpContinueRemoteV2.hidden=false;
        }

        if(
          panelAuthValid() &&
          $('#panelLogin').hidden &&
          !configOpenedFromLive &&
          !document.querySelector(
            '#imageEditorDialog[open],#songbookEditorDialog[open]'
          )
        ){
          showLive();

          refreshLocalQueue().catch(()=>{});
        }

        /*
         * EGP_AUTOENTRAR_SHOW_ACTIVO_LAN_V1
         *
         * Si este dispositivo acaba de conectarse y YA existe un show,
         * no crea ni reinicia nada: toma el show existente, carga la cola
         * real desde Core/LAN y, despues de autenticar, entra directamente
         * a Control en vivo.
         *
         * Solo se hace una vez por carga. Si despues el usuario pulsa
         * Configuracion, las sincronizaciones siguientes no lo devuelven.
         */
        if(!window.__egpAutoEntrarShowActivoLanV1){
          window.__egpAutoEntrarShowActivoLanV1=true;

          refreshLocalQueue().catch(err=>{
            console.warn('Cola LAN inicial pendiente:',err);
          });

          const egpIntentarEntradaShowActivoV1=()=>{
            if(!state.config)return false;
            if(
              panelAuthValid() &&
              $('#panelLogin').hidden &&
              !configOpenedFromLive &&
              !document.querySelector('#imageEditorDialog[open],#songbookEditorDialog[open]')
            ){
              showLive();
              refreshLocalQueue().catch(()=>{});
              return true;
            }
            return false;
          };

          if(!egpIntentarEntradaShowActivoV1()){
            const egpAutoEntradaTimerV1=setInterval(()=>{
              /*
               * No cancelar si la configuración LAN todavía no llegó.
               * El Local Core puede responder unos milisegundos después
               * de que la PWA terminó de abrir.
               */
              if(!state.config){
                return;
              }
              if(egpIntentarEntradaShowActivoV1()){
                clearInterval(egpAutoEntradaTimerV1);
              }
            },250);

            setTimeout(()=>clearInterval(egpAutoEntradaTimerV1),120000);
          }
        }
      }else if(data.show_activo===false){
        /*
         * EGP_REMOTE_SHOW_REARM_NEXT_V2
         *
         * La antigua autoentrada era de una sola vez por carga.
         * Al terminar un show se rearma para que el SIGUIENTE show,
         * aun sin recargar la PWA, vuelva a poder entrar automáticamente.
         */
        window.__egpAutoEntrarShowActivoLanV1=false;

        /*
         * EGP_CORE_USES_REMOTE_RULES_V2
         * Ese return solo protege contra un Firebase viejo.
         * Si quien habla es Core, se ejecuta la MISMA finalización global
         * que ya funciona por Internet.
         */
        if(
          LOCAL_QUEUE_MODE===true &&
          authority!=='core'
        ){
          saveStateLocalOnly();
          renderQueue();
          renderSongs();
          return;
        }

        /*
         * EGP_FINISH_ONCE_V3
         *
         * Finalizar es una transición, no un evento repetible por polling.
         */
        const wasActuallyInShow=
          showActiveConfirmed===true ||
          Boolean(currentAppliedShowSession) ||
          document.body.classList.contains('live-mode');

        showActiveConfirmed=false;
        currentAppliedShowSession='';
        configOpenedFromLive=false;
        localDesiredShowActive=null;
        localShowTransitionUntil=0;

        try{localStorage.removeItem(PANEL_AUTH_SESSION_KEY);}catch(_){}

        state.config=null;
        state.queue=[];
        state.played.clear();

        setStatus(false);

        applyRemoteShowTimer({
          schema:SHOW_TIMER_SCHEMA,
          elapsedMs:0,
          running:false,
          startedAt:0
        });

        saveStateLocalOnly();

        if(
          panelAuthValid() &&
          $('#panelLogin').hidden
        ){
          closeDialogsForRemoteShowEnd();
          showConfig(false);

          if(wasActuallyInShow){
            toast(
              'El show fue finalizado desde otro dispositivo.'
            );
          }
        }
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
    const config={venue,repertoire:$('#repertoireSelect').value,repertoireName:$('#repertoireSelect').selectedOptions[0].dataset.name||$('#repertoireSelect').selectedOptions[0].textContent,profile:$('#profileSelect').value,whatsapp:$('#whatsappToggle').checked===true,requests:$('#requestsToggle')?.checked===true,requestsMode:$('#requestsModeSelect')?.value==='uno_por_turno'?'uno_por_turno':'libre',publicQueue:$('#publicQueueToggle').checked,advertising:$('#advertisingToggle').checked,startedAt:new Date().toISOString()};
    if(config.requests===true){config.whatsapp=false;$('#whatsappToggle').checked=false;}
    askConfirm('Comenzar nuevo show','Se guardará esta configuración y se reiniciará la cola del show anterior.',()=>{
      // Entrada inmediata: no esperar una lectura de verificación para mostrar Control en vivo.
      remoteShowGeneration++;localDesiredShowActive=true;showActiveConfirmed=true;localShowTransitionUntil=Date.now()+10000;

      /*
       * EGP_NEW_SHOW_REARMS_UI_V3
       * Registrar la misma identidad que publicaremos a Core/Firebase.
       */
      currentAppliedShowSession=
        `show-${new Date(config.startedAt).getTime()}`;
      configOpenedFromLive=false;
      window.__egpAutoEntrarShowActivoLanV1=false;

      state.config=config;state.queue=[];state.played.clear();addVenueOption(venue);
      startNewShowTimer();
      saveStateLocalOnly();
      setStatus(true);showLive();egpPublicarConfigLan({show_activo:true,inicio_show:new Date(config.startedAt).getTime(),pedidos_whatsapp:config.whatsapp===true,pedidos_panel:config.requests===true,pedidos_modo:config.requestsMode});
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
    const toolbar=document.querySelector('.live-toolbar');
    const toolbarRight=document.querySelector('.live-toolbar-right');
    if(toolbar){toolbar.hidden=false;toolbar.removeAttribute('aria-hidden');}
    if(toolbarRight){toolbarRight.hidden=false;toolbarRight.removeAttribute('aria-hidden');}
    $('#liveRepertoireName').textContent=state.config.repertoireName || 'Repertorio';
    $('#songSearch').value='';filterSongs();renderQueue();
  }
  let configOpenedFromLive=false;
  function showConfig(fromLive=false){
    if(
      state.config &&
      fromLive!==true &&
      (showActiveConfirmed===true || localDesiredShowActive===true)
    ){
      showLive();
      return;
    }
    configOpenedFromLive=Boolean(fromLive&&state.config);
    document.documentElement.classList.remove('live-mode');document.body.classList.remove('live-mode');
    $('#liveView').classList.remove('is-active');$('#configView').classList.add('is-active');
    const continueBtn=$('#continueShowBtn');if(continueBtn)continueBtn.hidden=!configOpenedFromLive;
    if(!state.config){
      const w=document.getElementById('whatsappToggle');if(w)w.checked=false;
      const r=document.getElementById('requestsToggle');if(r)r.checked=false;
      try{localStorage.setItem('egp-pedidos-panel-enabled-v1','0');}catch(_){}
    }
    window.scrollTo({left:0,top:0,behavior:'smooth'});
  }

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
    const now=Date.now();
    const showStartedAt=state.config?.startedAt
      ? new Date(state.config.startedAt).getTime()
      : 0;
    const physicalMax=showStartedAt>0
      ? Math.max(0,now-showStartedAt)
      : null;

    /*
     * EGP_TIMER_SHOW_EXISTENTE_SYNC_V2
     *
     * Si otro dispositivo entra a un show que YA estaba activo, nunca debe
     * arrancar el cronometro desde cero solo porque el documento remoto viene
     * de un schema anterior.
     *
     * - Si el remoto dice explicitamente "pausado", se respeta la pausa.
     * - Si no existe cronometro_running en un formato antiguo, un show con
     *   inicio_show valido se considera corriendo.
     * - Para un reloj corriendo antiguo, inicio_show es el ancla fisica segura.
     */
    if(remoteSchema!==SHOW_TIMER_SCHEMA){
      const runningWasStored=remote.runningPresent===true;
      const keepRunning=runningWasStored
        ? remote.running===true
        : showStartedAt>0;

      if(showStartedAt>0 && keepRunning){
        showTimer={
          elapsedMs:0,
          running:true,
          startedAt:showStartedAt
        };
      }else{
        const safeElapsed=physicalMax===null
          ? Math.max(0,Number(remote.elapsedMs)||0)
          : Math.min(Math.max(0,Number(remote.elapsedMs)||0),physicalMax);

        showTimer={
          elapsedMs:safeElapsed,
          running:keepRunning,
          startedAt:keepRunning?(Number(remote.startedAt)||now):0
        };
      }

      saveShowTimer();
      showTimerLoop();

      if(state.config&&!legacyRemoteTimerResetPublished){
        legacyRemoteTimerResetPublished=true;
        const patch={
          show_activo:true,
          cronometro_schema:SHOW_TIMER_SCHEMA,
          cronometro_elapsed_ms:Math.max(0,Number(showTimer.elapsedMs)||0),
          cronometro_running:showTimer.running===true,
          cronometro_started_at:showTimer.running?showTimer.startedAt:0
        };

        setTimeout(()=>{
          publishShowPatch(patch)
            .catch(err=>console.warn('No se pudo migrar el cronometro del show existente',err));
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

    if(next.running&&!next.startedAt){
      next.startedAt=showStartedAt||now;
    }

    const incomingTotal=
      next.elapsedMs+
      (next.running?Math.max(0,now-next.startedAt):0);

    if(physicalMax!==null && incomingTotal>physicalMax+30000){
      next=next.running
        ? {elapsedMs:0,running:true,startedAt:showStartedAt}
        : {elapsedMs:Math.min(next.elapsedMs,physicalMax),running:false,startedAt:0};

      if(state.config){
        setTimeout(()=>publishShowPatch({
          show_activo:true,
          cronometro_schema:SHOW_TIMER_SCHEMA,
          cronometro_elapsed_ms:Math.max(0,Number(next.elapsedMs)||0),
          cronometro_running:next.running,
          cronometro_started_at:next.running?next.startedAt:0
        }).catch(err=>console.warn('No se pudo sanear el cronometro remoto',err)),0);
      }
    }

    const same=
      showTimer.elapsedMs===next.elapsedMs &&
      showTimer.running===next.running &&
      showTimer.startedAt===next.startedAt;

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
    state.config={...state.config,venue,repertoire,repertoireName,profile:$('#profileSelect').value,whatsapp:$('#whatsappToggle').checked===true,requests:$('#requestsToggle')?.checked===true,requestsMode:$('#requestsModeSelect')?.value==='uno_por_turno'?'uno_por_turno':'libre',publicQueue:$('#publicQueueToggle').checked,advertising:$('#advertisingToggle').checked};
    if(state.config.requests===true){state.config.whatsapp=false;$('#whatsappToggle').checked=false;}
    addVenueOption(venue);invalidateRepertoireCache();saveStateLocalOnly();
    const ids=(repertoire==='todas'?state.songs:state.songs.filter(song=>(song.listas||[]).includes(repertoire))).map(song=>song.id);
    showLive();toast('Configuración actualizada. El show continúa.');
    await egpPublicarConfigLan({show_activo:true,inicio_show:new Date(state.config.startedAt).getTime(),pedidos_whatsapp:state.config.whatsapp===true,pedidos_panel:state.config.requests===true,pedidos_modo:state.config.requestsMode});
    try{await publishShowPatch({show_activo:true,lugar:venue,lista_activa:repertoire,listaActiva:repertoire,repertorio_nombre:repertoireName,repertorio_activo_ids:ids,repertorioActivoIds:ids,perfil_clientes:state.config.profile,pedidos_whatsapp:state.config.whatsapp,pedidos_panel:state.config.requests===true,pedidos_modo:state.config.requestsMode==='uno_por_turno'?'uno_por_turno':'libre',mostrar_cola:state.config.publicQueue,uso_publicidad:state.config.advertising===true});}
    catch(err){console.warn('Configuración del show pendiente de sincronizar',err);toast('Cambios guardados localmente; sincronización pendiente.');}
  });

  // 6.36.69.4 · cierre global directo, independiente de colas antiguas.
  async function publishFinishedShow(){
    clearTimeout(remoteShowWriteTimer);
    remoteShowGeneration++;
    remoteShowWriteChain=Promise.resolve();
    const finishPayload={show_activo:false,cola:[],tocadas:[],pedidos_whatsapp:false,pedidos_panel:false,pedidos_modo:'libre',pedidos_panel_lista:[],cronometro_elapsed_ms:0,cronometro_running:false,cronometro_started_at:0,inicio_show:0};

    if(LOCAL_QUEUE_MODE){
      try{
        const cleared=await localQueueRequest('/api/queue/clear',{});
        applyLocalQueueSnapshot(cleared,{force:true});
      }catch(err){
        console.warn(
          'LAN caida al finalizar show; usando Firebase:',
          err
        );
        LOCAL_QUEUE_MODE=false;
      }
    }

    await egpCerrarPedidosPendientes();
    await publishShowPatch(finishPayload);
    // Segunda publicación corta para ganar ante una pestaña con una escritura vieja en vuelo.
    await new Promise(resolve=>setTimeout(resolve,180));
    await publishShowPatch(finishPayload);
    return finishPayload;
  }

  $('#finishShowBtn').addEventListener('click',()=>askConfirm('Finalizar show','Se cerrará el show actual y se limpiará la cola en todos los dispositivos.',async()=>{
    localDesiredShowActive=false;showActiveConfirmed=false;localShowTransitionUntil=Date.now()+15000;
    state.config=null;state.queue=[];state.played.clear();
    showTimer={elapsedMs:0,running:false,startedAt:0};saveShowTimer();showTimerLoop();
    saveStateLocalOnly();setStatus(false);showConfig();egpPublicarConfigLan({show_activo:false,inicio_show:0,pedidos_whatsapp:false,pedidos_panel:false,pedidos_modo:'libre'});toast('Finalizando show en todos los dispositivos…');
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
  /*
   * EGP_PANEL_SONG_LIST_WATCHDOG_V1
   *
   * Muy liviano: solo actua durante show, sin busqueda y con Ui24R cerrada.
   * No modifica datos; re-renderiza o fuerza un nuevo filtrado.
   */
  function egpSongListWatchdog(){
    if(!document.body.classList.contains('live-mode')) return;

    const search=$('#songSearch');
    if(!search || norm(search.value)) return;

    const overlay=document.getElementById('ui24rOverlay');
    if(overlay?.classList.contains('is-open')) return;

    const list=$('#songList');
    if(!list) return;

    if(
      Array.isArray(state.filtered) &&
      state.filtered.length>0 &&
      list.querySelectorAll('.song-card').length===0
    ){
      egpSongGuardDiagnostic(
        'dom_empty_with_filtered_data',
        {expectedCards:state.filtered.length}
      );

      renderSongs();
      return;
    }

    if(
      Array.isArray(state.songs) &&
      state.songs.length>0 &&
      Array.isArray(state.filtered) &&
      state.filtered.length===0
    ){
      egpScheduleSongRecovery(
        'filtered_empty_with_library_alive'
      );
    }
  }

  setInterval(egpSongListWatchdog,1000);

  window.addEventListener(
    'focus',
    ()=>setTimeout(egpSongListWatchdog,60)
  );

  document.addEventListener(
    'visibilitychange',
    ()=>{
      if(!document.hidden){
        setTimeout(egpSongListWatchdog,60);
      }
    }
  );

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
  /*
   * EGP_PANEL_SONG_LIST_GUARD_V1
   *
   * state.songs = biblioteca real en memoria.
   * state.filtered = lista visible.
   *
   * Un snapshot/config transitorio nunca debe convertir una lista sana
   * en una pantalla vacia durante un show.
   */
  let egpLastHealthySongList={
    repertoire:'',
    songs:[],
    savedAt:0
  };

  let egpSongRecoveryTimer=0;
  let egpSongRecoveryBusy=false;

  function egpSongGuardDiagnostic(reason,extra={}){
    const payload={
      at:new Date().toISOString(),
      reason,
      repertoire:String(state.config?.repertoire||'todas'),
      baseSongs:Array.isArray(state.songs)?state.songs.length:-1,
      filtered:Array.isArray(state.filtered)?state.filtered.length:-1,
      search:String($('#songSearch')?.value||''),
      localQueueMode:LOCAL_QUEUE_MODE===true,
      live:document.body.classList.contains('live-mode'),
      ...extra
    };

    console.warn('EGP SONG LIST GUARD',payload);

    try{
      localStorage.setItem(
        'egp-panel-song-list-guard-last-v1',
        JSON.stringify(payload)
      );
    }catch(_){}
  }

  function egpScheduleSongRecovery(reason){
    if(egpSongRecoveryTimer) return;

    egpSongGuardDiagnostic(reason);

    egpSongRecoveryTimer=setTimeout(()=>{
      egpSongRecoveryTimer=0;

      if(egpSongRecoveryBusy) return;

      egpSongRecoveryBusy=true;

      try{
        invalidateRepertoireCache();
        filterSongs();
      }finally{
        egpSongRecoveryBusy=false;
      }
    },300);
  }

  function filterSongs(){
    const q=norm($('#songSearch').value);
    let songs=repertoireSongs();

    const live=document.body.classList.contains('live-mode');
    const repertoire=String(state.config?.repertoire||'todas');

    if(
      !q &&
      live &&
      Array.isArray(state.songs) &&
      state.songs.length>0
    ){
      if(songs.length>0){
        egpLastHealthySongList={
          repertoire,
          songs:[...songs],
          savedAt:Date.now()
        };
      }else{
        /*
         * Si el mismo repertorio estaba sano hace un momento,
         * NO pintar cero de inmediato.
         *
         * Se conserva solo como proteccion transitoria y se vuelve
         * a calcular desde la biblioteca real cada 300 ms.
         */
        const healthy=
          egpLastHealthySongList.repertoire===repertoire &&
          egpLastHealthySongList.songs.length>0 &&
          Date.now()-egpLastHealthySongList.savedAt<15000;

        if(healthy){
          const liveIds=new Set(state.songs.map(song=>String(song.id)));

          const preserved=
            egpLastHealthySongList.songs.filter(
              song=>liveIds.has(String(song.id))
            );

          if(preserved.length>0){
            songs=preserved;
            egpScheduleSongRecovery(
              'repertoire_temporarily_empty'
            );
          }
        }else if(state.filtered.length>0){
          /*
           * Primer cero inesperado de un repertorio que aun no tiene
           * snapshot sano: mantener la pantalla actual durante el
           * primer reintento en vez de borrarla.
           */
          egpScheduleSongRecovery(
            'first_unexpected_empty'
          );
          return;
        }
      }
    }

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

      persistQueueStateMutation(
        song.id,
        wasQueued?'remove':'add'
      ).catch(()=>{});
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

      /*
       * EGP_CLEAR_SEARCH_AFTER_QUEUE_ADD_V1
       *
       * Al encontrar una canción y ponerla en cola, dejar el buscador
       * listo para la siguiente búsqueda y restaurar inmediatamente
       * la lista completa del repertorio.
       *
       * No altera la cola; solo limpia el filtro visual.
       */
      const searchInput=$('#songSearch');

      if(searchInput && searchInput.value){
        searchInput.value='';
        filterSongs();
      }
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

        try{
          const result=await localQueueRequest(path,body);

          applyLocalQueueSnapshot(result,{force:true});

          processQueueHeadChange(
            originalQueue,
            state.queue,
            originalPlayed,
            state.played
          );

          /*
           * Bridge/Musicos ya recibieron por LAN.
           * Firebase se actualiza despues, sin bloquear la accion.
           */
          egpMirrorQueueLanToFirebase();

          return result;

        }catch(err){
          /*
           * El Core cayo justo durante esta accion.
           * No revertir: continuar por Internet en la misma accion.
           */
          console.warn(
            'LAN caida durante cambio de cola; usando Firebase:',
            err
          );
          LOCAL_QUEUE_MODE=false;
        }
      }

      /*
       * FAILOVER INTERNET.
       * Intentar Firebase realmente aunque navigator.onLine sea enganoso.
       */
      if(!remoteStateRef)await initRemoteSync(true);
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

      processQueueHeadChange(
        originalQueue,
        state.queue,
        originalPlayed,
        state.played
      );
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
        try{
          const result=await localQueueRequest('/api/queue/reorder',{
            order:state.queue.map(String)
          });

          applyLocalQueueSnapshot(result,{force:true});
          queueDragState.pendingRemoteQueue=null;
          saveStateLocalOnly();

          egpMirrorQueueLanToFirebase();

          toast('Orden de cola guardado');
          return result;

        }catch(err){
          console.warn(
            'LAN caida durante reordenamiento; usando Firebase:',
            err
          );
          LOCAL_QUEUE_MODE=false;
        }
      }

      if(!remoteStateRef)await initRemoteSync(true);
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
    if(stage.__egpNoteWheelHandler){
      stage.removeEventListener(
        'wheel',
        stage.__egpNoteWheelHandler
      );
    }

    if(stage.__egpNoteGestureStartHandler){
      stage.removeEventListener(
        'gesturestart',
        stage.__egpNoteGestureStartHandler
      );
    }

    if(stage.__egpNoteGestureChangeHandler){
      stage.removeEventListener(
        'gesturechange',
        stage.__egpNoteGestureChangeHandler
      );
    }

    if(stage.__egpNoteGestureEndHandler){
      stage.removeEventListener(
        'gestureend',
        stage.__egpNoteGestureEndHandler
      );
    }

    const viewerPoint=e=>{
      const rect=stage.getBoundingClientRect();

      const hasX=
        Number.isFinite(Number(e.clientX));

      const hasY=
        Number.isFinite(Number(e.clientY));

      return {
        x:
          (hasX ? Number(e.clientX)-rect.left : stage.clientWidth/2)
          -stage.clientWidth/2,
        y:
          (hasY ? Number(e.clientY)-rect.top : stage.clientHeight/2)
          -stage.clientHeight/2
      };
    };

    let macNativeGestureActive=false;
    let macNativeGestureStartScale=1;

    const wheelHandler=e=>{
      if(!stage.classList.contains('is-note-viewer'))return;

      if(!isDesktopMac){
        e.preventDefault();

        const point=viewerPoint(e);
        const factor=e.deltaY<0 ? 1.12 : 0.88;

        setNoteScale(
          img,
          noteViewerState.scale*factor,
          point.x,
          point.y
        );

        return;
      }

      e.preventDefault();

      const unit=
        e.deltaMode===1
          ? 16
          : e.deltaMode===2
            ? Math.max(1,stage.clientHeight)
            : 1;

      const dx=e.deltaX*unit;
      const dy=e.deltaY*unit;

      if(e.ctrlKey){
        if(macNativeGestureActive)return;

        const point=viewerPoint(e);

        const delta=Math.max(
          -22,
          Math.min(22,dy)
        );

        if(Math.abs(delta)<0.001)return;

        const factor=Math.exp(
          -delta*0.012
        );

        setNoteScale(
          img,
          noteViewerState.scale*factor,
          point.x,
          point.y
        );

        return;
      }

      const panX=
        e.shiftKey && Math.abs(dx)<0.01
          ? dy
          : dx;

      const panY=
        e.shiftKey && Math.abs(dx)<0.01
          ? 0
          : dy;

      noteViewerState.x-=panX;
      noteViewerState.y-=panY;

      clampNotePosition(img);
      applyNoteTransform(img);
    };

    const gestureStart=e=>{
      if(!isDesktopMac)return;
      if(!stage.classList.contains('is-note-viewer'))return;

      e.preventDefault();

      macNativeGestureActive=true;
      macNativeGestureStartScale=
        noteViewerState.scale;
    };

    const gestureChange=e=>{
      if(!isDesktopMac)return;
      if(!stage.classList.contains('is-note-viewer'))return;

      e.preventDefault();

      const scale=
        Number.isFinite(Number(e.scale))
          ? Number(e.scale)
          : 1;

      const point=viewerPoint(e);

      setNoteScale(
        img,
        macNativeGestureStartScale*scale,
        point.x,
        point.y
      );
    };

    const gestureEnd=e=>{
      if(!isDesktopMac)return;

      if(e && typeof e.preventDefault==='function'){
        e.preventDefault();
      }

      macNativeGestureActive=false;
    };

    stage.__egpNoteWheelHandler=wheelHandler;
    stage.__egpNoteGestureStartHandler=gestureStart;
    stage.__egpNoteGestureChangeHandler=gestureChange;
    stage.__egpNoteGestureEndHandler=gestureEnd;

    stage.addEventListener(
      'wheel',
      wheelHandler,
      {passive:false}
    );

    stage.addEventListener(
      'gesturestart',
      gestureStart,
      {passive:false}
    );

    stage.addEventListener(
      'gesturechange',
      gestureChange,
      {passive:false}
    );

    stage.addEventListener(
      'gestureend',
      gestureEnd,
      {passive:false}
    );
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
  /* EGP GALERIA · CLOUDINARY · DRAG + PROGRESO */
  const EGP_GALLERY_CLOUD_NAME='wi4naurm';
  const EGP_GALLERY_UPLOAD_PRESET='egp_galeria';
  const EGP_GALLERY_ITEMS_KEY='egp-gallery-items-v1';
  const EGP_GALLERY_DELETE_PENDING_KEY='egp-gallery-delete-pending-v1';

  /* Límites actuales del plan Cloudinary Free */
  const EGP_GALLERY_MAX_IMAGE=10*1024*1024;
  const EGP_GALLERY_MAX_VIDEO=100*1024*1024;

  let egpGalleryUploading=false;
  let egpGalleryLastUrl='';
  let egpGalleryActiveTab='image';

  function egpGallerySize(bytes){
    if(bytes<1024*1024){
      return (bytes/1024).toFixed(1)+' KB';
    }
    return (bytes/(1024*1024)).toFixed(1)+' MB';
  }

  function egpGalleryStatus(text,error=false){
    const el=$('#galleryUploadStatus');
    if(!el)return;

    el.textContent=text;
    el.style.color=error?'#ff7b83':'';
  }

  function egpGalleryProgress(percent,show=true){
    const wrap=$('#galleryProgressWrap');
    const bar=$('#galleryUploadProgress');
    const text=$('#galleryProgressText');

    if(!wrap || !bar || !text)return;

    wrap.hidden=!show;

    const value=Math.max(0,Math.min(100,Math.round(percent)));

    bar.value=value;
    text.textContent=value+'%';
  }

  function egpGalleryBusy(value){
    egpGalleryUploading=value;

    const foto=$('#galleryUploadPhotoBtn');
    const video=$('#galleryUploadVideoBtn');
    const drop=$('#galleryDropZone');

    if(foto)foto.disabled=value;
    if(video)video.disabled=value;

    if(drop){
      drop.classList.toggle('is-busy',value);
    }
  }

  function egpGalleryType(file){
    const type=String(file?.type||'').toLowerCase();
    const name=String(file?.name||'').toLowerCase();

    if(
      type.startsWith('image/') ||
      /\.(jpg|jpeg|png|webp|gif|heic|heif|avif)$/i.test(name)
    ){
      return 'image';
    }

    if(
      type.startsWith('video/') ||
      /\.(mp4|mov|m4v|webm|avi|mpeg|mpg)$/i.test(name)
    ){
      return 'video';
    }

    return '';
  }

  function egpGalleryValidate(file){
    const type=egpGalleryType(file);

    if(!type){
      return 'Archivo no compatible: '+file.name;
    }

    if(type==='image' && file.size>EGP_GALLERY_MAX_IMAGE){
      return (
        file.name+' pesa '+egpGallerySize(file.size)+
        '. El máximo de imagen del plan actual es 10 MB.'
      );
    }

    if(type==='video' && file.size>EGP_GALLERY_MAX_VIDEO){
      return (
        file.name+' pesa '+egpGallerySize(file.size)+
        '. El plan gratuito de Cloudinary admite videos de hasta 100 MB.'
      );
    }

    return '';
  }

  function egpGalleryLoadItems(){
    try{
      const value=JSON.parse(
        localStorage.getItem(EGP_GALLERY_ITEMS_KEY)||'[]'
      );
      return Array.isArray(value)?value:[];
    }catch(_){
      return [];
    }
  }

  function egpGallerySaveItems(items){
    localStorage.setItem(
      EGP_GALLERY_ITEMS_KEY,
      JSON.stringify(items)
    );
  }

  function egpGalleryQueueDelete(item){
    try{
      const pending=JSON.parse(
        localStorage.getItem(
          EGP_GALLERY_DELETE_PENDING_KEY
        )||'[]'
      );

      pending.push({
        publicId:item.publicId||'',
        resourceType:item.type||'',
        url:item.url||'',
        deletedAt:Date.now()
      });

      localStorage.setItem(
        EGP_GALLERY_DELETE_PENDING_KEY,
        JSON.stringify(pending)
      );
    }catch(_){}
  }

  function egpGalleryThumb(url){
    if(!url)return '';

    return url.replace(
      '/upload/',
      '/upload/w_360,h_240,c_fill,q_auto,f_auto/'
    );
  }

  function egpGalleryVideoThumb(url){
    if(!url)return '';

    try{
      const u=new URL(url);

      /*
       * Fotograma al 10% del video.
       * JPG explícito para máxima compatibilidad del preview.
       */
      u.pathname=u.pathname.replace(
        '/video/upload/',
        '/video/upload/so_10p,w_480,h_320,c_fill,q_auto,f_jpg/'
      );

      /*
       * Conservamos el public ID y cambiamos únicamente
       * la extensión entregada a JPG.
       */
      u.pathname=u.pathname.replace(
        /\.[^/.]+$/i,
        '.jpg'
      );

      return u.toString();

    }catch(_){
      return url
        .replace(
          '/video/upload/',
          '/video/upload/so_10p,w_480,h_320,c_fill,q_auto,f_jpg/'
        )
        .replace(
          /\.[^/.]+$/i,
          '.jpg'
        );
    }
  }

  function egpGalleryRenderList(){
    const host=$('#galleryItems');
    const photoCount=$('#galleryPhotoCount');
    const videoCount=$('#galleryVideoCount');

    if(!host)return;

    const items=egpGalleryLoadItems();

    const photos=items.filter(item=>item.type==='image');
    const videos=items.filter(item=>item.type==='video');

    if(photoCount){
      photoCount.textContent=String(photos.length);
    }

    if(videoCount){
      videoCount.textContent=String(videos.length);
    }

    const visibles=
      egpGalleryActiveTab==='video'
        ? videos
        : photos;

    host.textContent='';

    if(!visibles.length){
      const empty=document.createElement('p');
      empty.className='module-note egp-gallery-empty';
      empty.textContent=
        egpGalleryActiveTab==='video'
          ? 'Todavía no hay videos.'
          : 'Todavía no hay fotos.';

      host.appendChild(empty);
      return;
    }

    [...visibles].reverse().forEach(item=>{
      const card=document.createElement('article');
      card.className='egp-gallery-item';
      card.dataset.galleryId=item.id;
      card.dataset.galleryType=item.type;

      const media=document.createElement('div');
      media.className='egp-gallery-item-media';

      if(item.type==='image'){
        const img=document.createElement('img');
        img.src=egpGalleryThumb(item.url);
        img.alt=item.name||'Foto';
        img.loading='lazy';

        const rotation=Number(item.rotation||0);

        img.style.transform=`rotate(${rotation}deg)`;

        if(rotation===90 || rotation===270){
          img.classList.add('is-rotated-sideways');
        }

        media.appendChild(img);
      }else{
        const wrap=document.createElement('div');
        wrap.className='egp-gallery-video-preview';

        const img=document.createElement('img');
        img.src=egpGalleryVideoThumb(item.url);
        img.alt=item.name||'Video';
        img.loading='lazy';

        const rotation=Number(item.rotation||0);

        img.style.transform=`rotate(${rotation}deg)`;

        if(rotation===90 || rotation===270){
          img.classList.add('is-rotated-sideways');
        }

        const play=document.createElement('span');
        play.className='egp-gallery-video-play';
        play.textContent='▶';

        img.addEventListener('error',()=>{
          img.hidden=true;
          play.classList.add('is-fallback');
          play.textContent='▶ VIDEO';
        });

        wrap.append(img,play);
        media.appendChild(wrap);
      }

      const info=document.createElement('div');
      info.className='egp-gallery-item-info';

      const name=document.createElement('strong');
      name.textContent=item.name||(
        item.type==='video'?'Video':'Foto'
      );

      const meta=document.createElement('span');

      const fecha=item.createdAt
        ? new Date(item.createdAt).toLocaleString('es-EC')
        : '';

      meta.textContent=[
        item.type==='video'?'VIDEO':'FOTO',
        item.bytes?egpGallerySize(item.bytes):'',
        `GIRO ${Number(item.rotation||0)}°`,
        fecha
      ].filter(Boolean).join(' · ');

      info.append(name,meta);

      const actions=document.createElement('div');
      actions.className='egp-gallery-item-actions';

      const ver=document.createElement('button');
      ver.type='button';
      ver.className='secondary-btn';
      ver.dataset.galleryAction='view';
      ver.textContent='VER';

      const girar=document.createElement('button');
      girar.type='button';
      girar.className='secondary-btn egp-gallery-rotate-btn';
      girar.dataset.galleryAction='rotate';
      girar.textContent='⟳';

      const borrar=document.createElement('button');
      borrar.type='button';
      borrar.className='secondary-btn egp-gallery-delete-btn';
      borrar.dataset.galleryAction='delete';
      borrar.textContent='BORRAR';

      actions.append(ver,girar,borrar);

      card.append(media,info,actions);
      host.appendChild(card);
    });
  }

  function egpGalleryRememberLast(data,file){
    egpGalleryLastUrl=data.secure_url||'';

    const item={
      id:
        String(Date.now())+'-'+
        Math.random().toString(36).slice(2,9),

      url:data.secure_url||'',
      publicId:data.public_id||'',
      type:data.resource_type||egpGalleryType(file)||'',
      format:data.format||'',
      name:file?.name||'',
      bytes:Number(data.bytes||file?.size||0),
      width:Number(data.width||0),
      height:Number(data.height||0),
      duration:Number(data.duration||0),
      rotation:0,
      createdAt:Date.now()
    };

    try{
      localStorage.setItem(
        'egp-gallery-last-upload-v1',
        JSON.stringify(item)
      );

      const items=egpGalleryLoadItems();
      items.push(item);
      egpGallerySaveItems(items);

    }catch(_){}

    const btn=$('#galleryOpenLastBtn');

    if(btn && egpGalleryLastUrl){
      btn.hidden=false;
    }

    egpGalleryRenderList();
  }

  function egpGalleryMigrateLast(){
    try{
      const items=egpGalleryLoadItems();

      if(items.length)return;

      const last=JSON.parse(
        localStorage.getItem(
          'egp-gallery-last-upload-v1'
        )||'null'
      );

      if(!last?.url)return;

      const item={
        id:last.id||('anterior-'+Date.now()),
        url:last.url,
        publicId:last.publicId||'',
        type:last.type||'',
        format:last.format||'',
        name:last.name||'Archivo anterior',
        bytes:Number(last.bytes||0),
        rotation:Number(last.rotation||0),
        createdAt:Number(last.createdAt||Date.now())
      };

      egpGallerySaveItems([item]);

    }catch(_){}
  }

  function egpGalleryFormatTime(seconds){
    if(!Number.isFinite(seconds) || seconds<0)return '0:00';

    const total=Math.floor(seconds);
    const mins=Math.floor(total/60);
    const secs=String(total%60).padStart(2,'0');

    return `${mins}:${secs}`;
  }

  function egpGalleryFitViewerMedia(media,rotation){
    const stage=$('#galleryViewerStage');

    if(!stage || !media)return;

    const isVideo=media.tagName==='VIDEO';

    const sourceW=isVideo
      ? media.videoWidth
      : media.naturalWidth;

    const sourceH=isVideo
      ? media.videoHeight
      : media.naturalHeight;

    if(!sourceW || !sourceH)return;

    const stageW=Math.max(1,stage.clientWidth-20);
    const stageH=Math.max(1,stage.clientHeight-20);

    const sideways=rotation===90 || rotation===270;

    const visualW=sideways ? sourceH : sourceW;
    const visualH=sideways ? sourceW : sourceH;

    const scale=Math.min(
      stageW/visualW,
      stageH/visualH,
      1
    );

    media.style.width=sourceW+'px';
    media.style.height=sourceH+'px';
    media.style.maxWidth='none';
    media.style.maxHeight='none';

    media.style.transform=
      `translate(-50%,-50%) rotate(${rotation}deg) scale(${scale})`;
  }

  function egpGallerySyncVideoControls(){
    const video=$('#galleryViewerVideo');
    const play=$('#galleryVideoPlayBtn');
    const progress=$('#galleryVideoProgress');
    const current=$('#galleryVideoCurrent');
    const duration=$('#galleryVideoDuration');
    const mute=$('#galleryVideoMuteBtn');

    if(!video)return;

    if(play){
      play.textContent=video.paused?'▶':'❚❚';
    }

    if(current){
      current.textContent=
        egpGalleryFormatTime(video.currentTime);
    }

    if(duration){
      duration.textContent=
        egpGalleryFormatTime(video.duration);
    }

    if(progress){
      progress.value=
        Number.isFinite(video.duration) && video.duration>0
          ? Math.round((video.currentTime/video.duration)*1000)
          : 0;
    }

    if(mute){
      mute.textContent=
        (video.muted || video.volume===0)
          ? '🔇'
          : '🔊';
    }
  }

  function egpGalleryToggleVideo(){
    const video=$('#galleryViewerVideo');

    if(!video || video.hidden)return;

    if(video.paused){
      video.play().catch(()=>{});
    }else{
      video.pause();
    }
  }

  function egpGalleryViewItem(item){
    if(!item?.url)return;

    const dialog=$('#galleryViewerDialog');
    const img=$('#galleryViewerImage');
    const video=$('#galleryViewerVideo');
    const controls=$('#galleryVideoControls');
    const label=$('#galleryViewerRotation');

    if(!dialog || !img || !video)return;

    const rotation=Number(item.rotation||0);

    img.hidden=true;
    video.hidden=true;

    if(controls){
      controls.hidden=true;
    }

    img.onload=null;
    video.onloadedmetadata=null;

    img.removeAttribute('src');

    video.pause();
    video.removeAttribute('src');
    video.load();

    if(label){
      label.textContent=`Orientación ${rotation}°`;
    }

    if(!dialog.open){
      dialog.showModal();
    }

    if(item.type==='video'){
      video.dataset.rotation=String(rotation);

      video.onloadedmetadata=()=>{
        egpGalleryFitViewerMedia(video,rotation);
        egpGallerySyncVideoControls();
      };

      video.src=item.url;
      video.hidden=false;

      if(controls){
        controls.hidden=false;
      }

      video.load();

      requestAnimationFrame(()=>{
        egpGalleryFitViewerMedia(video,rotation);
      });

    }else{
      img.dataset.rotation=String(rotation);

      img.onload=()=>{
        egpGalleryFitViewerMedia(img,rotation);
      };

      img.src=item.url;
      img.hidden=false;

      requestAnimationFrame(()=>{
        egpGalleryFitViewerMedia(img,rotation);
      });
    }
  }

  function egpGalleryRotateItem(id){
    const items=egpGalleryLoadItems();
    const index=items.findIndex(x=>x.id===id);

    if(index<0)return;

    const actual=Number(items[index].rotation||0);

    items[index].rotation=(actual+90)%360;

    egpGallerySaveItems(items);
    egpGalleryRenderList();

    egpGalleryStatus(
      `Orientación guardada · ${items[index].rotation}°`
    );
  }

  async function egpGalleryDeleteItem(id){
    const items=egpGalleryLoadItems();
    const item=items.find(x=>x.id===id);

    if(!item)return;

    const ok=window.confirm(
      '¿Borrar este archivo de la galería?'
    );

    if(!ok)return;

    const nuevos=items.filter(x=>x.id!==id);

    egpGallerySaveItems(nuevos);
    egpGalleryQueueDelete(item);
    egpGalleryRenderList();

    egpGalleryStatus(
      'Archivo quitado de la galería.'
    );
  }

  function egpGalleryUploadXHR(file,onProgress){
    return new Promise((resolve,reject)=>{
      const form=new FormData();

      form.append('file',file);
      form.append(
        'upload_preset',
        EGP_GALLERY_UPLOAD_PRESET
      );

      const xhr=new XMLHttpRequest();

      xhr.open(
        'POST',
        `https://api.cloudinary.com/v1_1/${EGP_GALLERY_CLOUD_NAME}/auto/upload`,
        true
      );

      xhr.upload.addEventListener('progress',event=>{
        if(
          event.lengthComputable &&
          typeof onProgress==='function'
        ){
          onProgress(event.loaded,event.total);
        }
      });

      xhr.addEventListener('load',()=>{
        let data={};

        try{
          data=JSON.parse(xhr.responseText||'{}');
        }catch(_){}

        if(
          xhr.status>=200 &&
          xhr.status<300 &&
          data.secure_url
        ){
          resolve(data);
          return;
        }

        reject(
          new Error(
            data?.error?.message ||
            `Cloudinary respondió HTTP ${xhr.status}`
          )
        );
      });

      xhr.addEventListener('error',()=>{
        reject(
          new Error('Error de red durante la subida')
        );
      });

      xhr.addEventListener('abort',()=>{
        reject(
          new Error('Subida cancelada')
        );
      });

      xhr.send(form);
    });
  }

  async function egpGalleryUploadFiles(fileList){
    if(egpGalleryUploading)return;

    const files=[...fileList];

    if(!files.length)return;

    egpGalleryBusy(true);
    egpGalleryProgress(0,true);

    let correctos=0;
    let rechazados=0;

    try{
      for(let i=0;i<files.length;i++){
        const file=files[i];
        const error=egpGalleryValidate(file);

        if(error){
          rechazados++;

          egpGalleryStatus(
            error,
            true
          );

          if(files.length===1){
            egpGalleryProgress(0,false);
            return;
          }

          continue;
        }

        egpGalleryStatus(
          `Subiendo ${i+1} de ${files.length} · ${file.name}`
        );

        const data=await egpGalleryUploadXHR(
          file,
          (loaded,total)=>{
            const archivoPct=total
              ? loaded/total
              : 0;

            const totalPct=
              ((i+archivoPct)/files.length)*100;

            egpGalleryProgress(totalPct,true);
          }
        );

        egpGalleryRememberLast(data,file);
        correctos++;

        egpGalleryProgress(
          ((i+1)/files.length)*100,
          true
        );
      }

      if(correctos && !rechazados){
        egpGalleryStatus(
          correctos===1
            ? 'Guardado exitosamente'
            : `Guardado exitosamente · ${correctos} archivos`
        );
      }else if(correctos && rechazados){
        egpGalleryStatus(
          `Guardados ${correctos} · No admitidos ${rechazados}`,
          true
        );
      }else if(rechazados){
        egpGalleryStatus(
          `${rechazados} archivo(s) no pudieron subirse.`,
          true
        );
      }

    }catch(err){
      console.error(
        'EGP Galería · error:',
        err
      );

      egpGalleryStatus(
        'No se pudo subir: '+
        (err?.message||'Error desconocido'),
        true
      );

    }finally{
      egpGalleryBusy(false);
    }
  }

  $$('.egp-gallery-tabs [data-gallery-tab]')
    .forEach(btn=>btn.addEventListener('click',()=>{
      egpGalleryActiveTab=btn.dataset.galleryTab||'image';

      $$('.egp-gallery-tabs [data-gallery-tab]')
        .forEach(tab=>{
          tab.classList.toggle(
            'is-active',
            tab===btn
          );
        });

      egpGalleryRenderList();
    }));

  function openGallery(){
    egpGalleryMigrateLast();

    try{
      const last=JSON.parse(
        localStorage.getItem(
          'egp-gallery-last-upload-v1'
        )||'null'
      );

      if(last?.url){
        egpGalleryLastUrl=last.url;
        $('#galleryOpenLastBtn').hidden=false;
      }
    }catch(_){}

    egpGalleryRenderList();
    egpGalleryProgress(0,false);
    $('#galleryDialog').showModal();
  }

  $('#galleryItems')?.addEventListener('click',async e=>{
    const btn=e.target.closest(
      '[data-gallery-action]'
    );

    if(!btn)return;

    const card=btn.closest(
      '[data-gallery-id]'
    );

    const id=card?.dataset.galleryId;

    if(!id)return;

    const item=egpGalleryLoadItems()
      .find(x=>x.id===id);

    if(!item)return;

    if(btn.dataset.galleryAction==='view'){
      egpGalleryViewItem(item);
      return;
    }

    if(btn.dataset.galleryAction==='rotate'){
      egpGalleryRotateItem(id);
      return;
    }

    if(btn.dataset.galleryAction==='delete'){
      await egpGalleryDeleteItem(id);
    }
  });

  $('#galleryUploadPhotoBtn')
    ?.addEventListener('click',()=>{
      if(!egpGalleryUploading){
        $('#galleryPhotoInput')?.click();
      }
    });

  $('#galleryUploadVideoBtn')
    ?.addEventListener('click',()=>{
      if(!egpGalleryUploading){
        $('#galleryVideoInput')?.click();
      }
    });

  $('#galleryPhotoInput')
    ?.addEventListener('change',async e=>{
      const files=[...(e.target.files||[])];
      e.target.value='';

      if(files.length){
        await egpGalleryUploadFiles(files);
      }
    });

  $('#galleryVideoInput')
    ?.addEventListener('change',async e=>{
      const files=[...(e.target.files||[])];
      e.target.value='';

      if(files.length){
        await egpGalleryUploadFiles(files);
      }
    });

  const egpGalleryDrop=$('#galleryDropZone');

  egpGalleryDrop?.addEventListener('dragenter',e=>{
    e.preventDefault();

    if(!egpGalleryUploading){
      egpGalleryDrop.classList.add('is-dragover');
    }
  });

  egpGalleryDrop?.addEventListener('dragover',e=>{
    e.preventDefault();

    if(e.dataTransfer){
      e.dataTransfer.dropEffect='copy';
    }

    if(!egpGalleryUploading){
      egpGalleryDrop.classList.add('is-dragover');
    }
  });

  egpGalleryDrop?.addEventListener('dragleave',e=>{
    e.preventDefault();
    egpGalleryDrop.classList.remove('is-dragover');
  });

  egpGalleryDrop?.addEventListener('drop',async e=>{
    e.preventDefault();

    egpGalleryDrop.classList.remove('is-dragover');

    if(egpGalleryUploading)return;

    const files=[...(e.dataTransfer?.files||[])];

    if(files.length){
      await egpGalleryUploadFiles(files);
    }
  });

  egpGalleryDrop?.addEventListener('click',()=>{
    if(!egpGalleryUploading){
      $('#galleryPhotoInput')?.click();
    }
  });

  egpGalleryDrop?.addEventListener('keydown',e=>{
    if(
      !egpGalleryUploading &&
      (e.key==='Enter' || e.key===' ')
    ){
      e.preventDefault();
      $('#galleryPhotoInput')?.click();
    }
  });

  $('#galleryVideoPlayBtn')?.addEventListener('click',()=>{
    egpGalleryToggleVideo();
  });

  $('#galleryViewerVideo')?.addEventListener('click',()=>{
    egpGalleryToggleVideo();
  });

  $('#galleryViewerVideo')?.addEventListener('play',()=>{
    egpGallerySyncVideoControls();
  });

  $('#galleryViewerVideo')?.addEventListener('pause',()=>{
    egpGallerySyncVideoControls();
  });

  $('#galleryViewerVideo')?.addEventListener('timeupdate',()=>{
    egpGallerySyncVideoControls();
  });

  $('#galleryViewerVideo')?.addEventListener('durationchange',()=>{
    egpGallerySyncVideoControls();
  });

  $('#galleryViewerVideo')?.addEventListener('ended',()=>{
    egpGallerySyncVideoControls();
  });

  $('#galleryVideoProgress')?.addEventListener('input',e=>{
    const video=$('#galleryViewerVideo');

    if(
      !video ||
      !Number.isFinite(video.duration) ||
      video.duration<=0
    )return;

    video.currentTime=
      (Number(e.target.value)/1000)*video.duration;

    egpGallerySyncVideoControls();
  });

  $('#galleryVideoMuteBtn')?.addEventListener('click',()=>{
    const video=$('#galleryViewerVideo');

    if(!video)return;

    video.muted=!video.muted;
    egpGallerySyncVideoControls();
  });

  $('#galleryVideoFullscreenBtn')?.addEventListener('click',async()=>{
    const card=$('#galleryViewerCard');

    if(!card)return;

    try{
      if(document.fullscreenElement){
        await document.exitFullscreen();
      }else if(card.requestFullscreen){
        await card.requestFullscreen();
      }
    }catch(_){}
  });

  window.addEventListener('resize',()=>{
    const dialog=$('#galleryViewerDialog');

    if(!dialog?.open)return;

    const video=$('#galleryViewerVideo');
    const img=$('#galleryViewerImage');

    if(video && !video.hidden){
      egpGalleryFitViewerMedia(
        video,
        Number(video.dataset.rotation||0)
      );
    }

    if(img && !img.hidden){
      egpGalleryFitViewerMedia(
        img,
        Number(img.dataset.rotation||0)
      );
    }
  });

  $('#galleryViewerCloseBtn')?.addEventListener('click',()=>{
    const dialog=$('#galleryViewerDialog');
    const video=$('#galleryViewerVideo');

    if(video){
      video.pause();
    }

    if(dialog?.open){
      dialog.close();
    }
  });

  $('#galleryOpenLastBtn')
    ?.addEventListener('click',()=>{
      if(egpGalleryLastUrl){
        window.open(
          egpGalleryLastUrl,
          '_blank',
          'noopener'
        );
      }
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
    if(btn.dataset.module==='gallery') return openGallery();
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

  /*
   * EGP_REPERTOIRE_DRAFT_SELECTION_V1
   *
   * La selección se conserva aunque el usuario busque/filtre canciones.
   * El contador representa TODO el repertorio en edición, no solo
   * los checkboxes actualmente visibles.
   */
  let repertoireDraftIds=null;

  function repertoireSongIds(repId){
    if(repId==='todas') return new Set(state.songs.map(song=>song.id));
    return new Set(state.songs.filter(song=>(song.listas||[]).includes(repId)).map(song=>song.id));
  }

  function resetRepertoireDraft(repId=activeRepertoireId){
    repertoireDraftIds=repertoireSongIds(repId);
  }

  function openRepertoires(){
    const reps=allRepertoires();
    activeRepertoireId = reps.find(r=>r.id!=='todas')?.id || 'todas';
    resetRepertoireDraft();
    $('#newRepertoireName').value='';
    $('#repertoireSongSearch').value='';
    renderRepertoireManager();
    $('#repertoiresDialog').showModal();
    rememberDialogState($('#repertoiresDialog'));
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
          askConfirm('Cambios sin guardar','Se perderán los cambios del repertorio actual.',()=>{activeRepertoireId=rep.id;resetRepertoireDraft();renderRepertoireManager();rememberDialogState($('#repertoiresDialog'));},'Continuar');
        }else{activeRepertoireId=rep.id;resetRepertoireDraft();renderRepertoireManager();rememberDialogState($('#repertoiresDialog'));}
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

    if(!(repertoireDraftIds instanceof Set)){
      resetRepertoireDraft(rep.id);
    }

    const selected=repertoireDraftIds;
    const q=norm($('#repertoireSongSearch').value);
    const songs=state.songs.filter(song=>!q||norm(song.titulo).includes(q)||norm(song.artista).includes(q));
    $('#selectedRepertoireCount').textContent=selected.size;
    $('#repertoireSongsVisibleCount').textContent=`${songs.length} visibles`;
    const list=$('#repertoireSongsList');list.innerHTML='';
    songs.forEach(song=>{
      const label=document.createElement('label');label.className='repertoire-song-item';
      label.innerHTML=`<input type="checkbox" value="${esc(song.id)}" ${selected.has(song.id)?'checked':''} ${rep.id==='todas'?'disabled':''}><span class="repertoire-song-copy"><strong>${esc(song.titulo)}</strong><small>${esc(song.artista||'Artista no indicado')}</small></span><em>${String(song.numero||'').padStart(2,'0')}</em>`;
      label.querySelector('input').addEventListener('change',event=>{
        if(rep.id==='todas')return;

        const input=event.currentTarget;

        if(input.checked){
          repertoireDraftIds.add(song.id);
        }else{
          repertoireDraftIds.delete(song.id);
        }

        $('#selectedRepertoireCount').textContent=
          repertoireDraftIds.size;
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
    activeRepertoireId=id;
    repertoireDraftIds=new Set();
    $('#newRepertoireName').value='';
    saveLibraryState();buildRepertoires();renderRepertoireManager();rememberDialogState($('#repertoiresDialog'));toast('Guardado exitosamente');
  });

  $('#saveRepertoireBtn').addEventListener('click',()=>{
    const rep=allRepertoires().find(r=>r.id===activeRepertoireId);if(!rep||rep.id==='todas')return;
    const name=$('#selectedRepertoireName').value.trim();if(!name)return toast('Escribe un nombre');
    if(allRepertoires().some(r=>r.id!==rep.id&&norm(r.name)===norm(name)))return toast('Ese repertorio ya existe');
    const checked=new Set(
      repertoireDraftIds instanceof Set
        ? repertoireDraftIds
        : repertoireSongIds(rep.id)
    );
    askConfirm('Guardar repertorio',`Se actualizará “${name}” con ${checked.size} canciones.`,()=>{
      let item=state.customRepertoires.find(r=>r.id===rep.id);
      if(!item){item={id:rep.id,name:rep.name};state.customRepertoires.push(item);}
      item.name=name;
      const listasRevision=Date.now();

      state.songs.forEach(song=>{
        const listas=new Set(song.listas||[]);listas.add('todas');
        checked.has(song.id)?listas.add(rep.id):listas.delete(rep.id);
        song.listas=[...listas];

        const ci=state.customSongs.findIndex(s=>s.id===song.id);

        if(ci>=0){
          state.customSongs[ci]={...song};
        }else{
          /*
           * EGP_EXPLICIT_REPERTOIRE_LISTS_V1
           * Este cambio SÍ proviene del editor de repertorios.
           */
          state.songEdits[song.id]={
            ...song,
            _listasRevision:listasRevision
          };
        }
      });
      if(state.config?.repertoire===rep.id)state.config.repertoireName=name;
      invalidateRepertoireCache();
      saveLibraryState(true);
      buildRepertoires();
      resetRepertoireDraft(rep.id);
      renderRepertoireManager();
      rememberDialogState($('#repertoiresDialog'));
      if(state.config)filterSongs();
      toast('Guardado exitosamente');
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
      const listasRevision=Date.now();

      state.songs.forEach(song=>{
        const listas=new Set(song.listas||[]);listas.add('todas');
        if(sourceIds.has(song.id))listas.add(id);
        song.listas=[...listas];

        const ci=state.customSongs.findIndex(s=>s.id===song.id);

        if(ci>=0){
          state.customSongs[ci]={...song};
        }else{
          state.songEdits[song.id]={
            ...song,
            _listasRevision:listasRevision
          };
        }
      });
      activeRepertoireId=id;
      resetRepertoireDraft(id);
      invalidateRepertoireCache();
      saveLibraryState(true);buildRepertoires();renderRepertoireManager();rememberDialogState($('#repertoiresDialog'));toast('Guardado exitosamente');
    },'Duplicar');
  });

  $('#deleteSelectedRepertoireBtn').addEventListener('click',()=>{
    const rep=allRepertoires().find(r=>r.id===activeRepertoireId);if(!rep||rep.id==='todas')return;
    askConfirm('Eliminar repertorio',`Se quitará “${rep.name}” de todas las canciones. Las canciones no serán eliminadas.`,()=>{
      state.customRepertoires=state.customRepertoires.filter(r=>r.id!==rep.id);

      const listasRevision=Date.now();

      state.songs.forEach(song=>{
        song.listas=[
          ...new Set([
            'todas',
            ...(song.listas||[])
              .filter(
                id=>
                  id!==rep.id &&
                  id!=='todas'
              )
          ])
        ];

        const ci=
          state.customSongs.findIndex(
            s=>s.id===song.id
          );

        if(ci>=0){
          state.customSongs[ci]={...song};
        }else{
          state.songEdits[song.id]={
            ...song,
            _listasRevision:listasRevision
          };
        }
      });

      if(state.config?.repertoire===rep.id){state.config.repertoire='todas';state.config.repertoireName='Todas las canciones';}
      activeRepertoireId=allRepertoires().find(r=>r.id!=='todas')?.id||'todas';
      saveLibraryState();buildRepertoires();renderRepertoireManager();rememberDialogState($('#repertoiresDialog'));toast('Guardado exitosamente');
    },'Eliminar');
  });

  function toast(msg){
    const el=$('#toast');
    if(!el)return;

    /*
     * Un <dialog> abierto pertenece al top layer.
     * El toast debe estar DENTRO del dialog para verse delante.
     */
    const dialog=document.querySelector('dialog[open]');

    if(dialog && !dialog.contains(el)){
      if(!toast.home){
        toast.home={
          parent:el.parentNode,
          next:el.nextSibling
        };
      }
      dialog.appendChild(el);
    }

    el.textContent=msg;
    el.classList.add('show');

    clearTimeout(toast.t);

    toast.t=setTimeout(()=>{
      el.classList.remove('show');

      setTimeout(()=>{
        if(toast.home && toast.home.parent){
          if(toast.home.next && toast.home.next.parentNode===toast.home.parent){
            toast.home.parent.insertBefore(el,toast.home.next);
          }else{
            toast.home.parent.appendChild(el);
          }
        }
      },200);
    },2800);
  }
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
  let activePhotoSlot='portada',photoDrafts={},dragState=null;
  const PHOTO_DEFAULTS={x:50,y:50,zoom:100,intensity:55,direction:'to bottom',color:'#000000',opacity:70};

  // ========================================================
  // EGP FOTOS RESPONSIVAS — DESKTOP / MOBILE
  // ========================================================

  let egpPhotoTargetMode =
    localStorage.getItem('egm-photo-target-mode') || 'auto';

  function egpPhotoDeviceIsMobile(){
    return /iPhone|iPad|iPod|Android|Mobile|Windows Phone/i
      .test(navigator.userAgent || '');
  }

  function egpPhotoResolvedTarget(){
    if(egpPhotoTargetMode === 'desktop') return 'desktop';
    if(egpPhotoTargetMode === 'mobile') return 'mobile';

    return egpPhotoDeviceIsMobile()
      ? 'mobile'
      : 'desktop';
  }

  function photoStorageKey(slot){
    return String(slot || '') + '__' + egpPhotoResolvedTarget();
  }

  function egpPhotoClone(value){
    try{
      return structuredClone(value);
    }catch(_){
      try{
        return JSON.parse(JSON.stringify(value));
      }catch(__){
        return value;
      }
    }
  }

  function egpPhotoPrepareVariants(data){
    const target = egpPhotoResolvedTarget();
    const result = data && typeof data === 'object'
      ? data
      : {};

    Object.keys(result).forEach(key => {
      if(
        key.endsWith('__desktop') ||
        key.endsWith('__mobile')
      ){
        return;
      }

      const variant = key + '__' + target;

      if(result[variant] === undefined){
        result[variant] = egpPhotoClone(result[key]);
      }
    });

    return result;
  }

  function egpPhotoSyncTargetUI(){
    const resolved = egpPhotoResolvedTarget();

    document
      .querySelectorAll('input[name="egpPhotoTarget"]')
      .forEach(input => {
        input.checked = input.value === egpPhotoTargetMode;
      });

    const status =
      document.getElementById('egpPhotoTargetStatus');

    if(status){
      const automatic =
        egpPhotoTargetMode === 'auto'
          ? 'Automático detectó: '
          : 'Destino seleccionado: ';

      status.textContent =
        automatic +
        (resolved === 'mobile'
          ? 'MÓVIL'
          : 'COMPUTADORA');
    }
  }

  document.addEventListener('change', event => {
    const input = event.target;

    if(
      !input ||
      input.name !== 'egpPhotoTarget'
    ){
      return;
    }

    egpPhotoTargetMode = input.value;

    localStorage.setItem(
      'egm-photo-target-mode',
      egpPhotoTargetMode
    );

    egpPhotoSyncTargetUI();

    /*
     * Cambiar de variante SIN cerrar el modal.
     * Así evitamos que aparezca por un instante
     * la Configuración que está debajo.
     */
    try{
      syncPhotoControls();
      renderPhotoPreview();
    }catch(_){}
  });

  document.addEventListener(
    'DOMContentLoaded',
    egpPhotoSyncTargetUI
  );


  const EGP_PHOTO_PENDING_KEY=
    'egm-photo-sync-pending-v1';

  let egpPhotoSyncBusy=false;


  function egpPhotoAllowedKeys(){
    return new Set([
      'portada__desktop',
      'portada__mobile',
      'info__desktop',
      'info__mobile',
      'bio__desktop',
      'bio__mobile',
      'carta1__desktop',
      'carta1__mobile',
      'carta2__desktop',
      'carta2__mobile'
    ]);
  }


  function egpPhotoLoadPending(){
    try{
      const value=JSON.parse(
        localStorage.getItem(EGP_PHOTO_PENDING_KEY)||'{}'
      );

      return value && typeof value==='object'
        ? value
        : {};
    }catch(_){
      return {};
    }
  }


  function egpPhotoSavePending(value){
    try{
      const clean=value && typeof value==='object'
        ? value
        : {};

      if(Object.keys(clean).length){
        localStorage.setItem(
          EGP_PHOTO_PENDING_KEY,
          JSON.stringify(clean)
        );
      }else{
        localStorage.removeItem(
          EGP_PHOTO_PENDING_KEY
        );
      }
    }catch(err){
      console.warn(
        'No se pudo guardar el estado pendiente de fotos',
        err
      );
    }
  }


  function egpPhotoMarkPending(
    key,
    updatedAt,
    targets={core:true,firebase:true}
  ){
    const pending=egpPhotoLoadPending();

    pending[key]={
      updatedAt:Number(updatedAt)||Date.now(),
      core:targets.core===true,
      firebase:targets.firebase===true
    };

    egpPhotoSavePending(pending);
  }


  function egpPhotoApplySyncResult(
    key,
    updatedAt,
    target,
    ok
  ){
    const pending=egpPhotoLoadPending();
    const item=pending[key];

    if(!item)return;

    if(
      Number(item.updatedAt)!==
      Number(updatedAt)
    ){
      return;
    }

    item[target]=!ok;

    if(
      item.core!==true &&
      item.firebase!==true
    ){
      delete pending[key];
    }else{
      pending[key]=item;
    }

    egpPhotoSavePending(pending);
  }


  function egpPhotoBuildPayload(
    key,
    updatedAt=Date.now()
  ){
    if(!egpPhotoAllowedKeys().has(key)){
      throw new Error(
        'Destino de foto no permitido'
      );
    }

    const sources=loadPhotoSources();
    const settings=loadPhotoSettings();
    const saved=settings[key]||{};
    const src=sources[key]||saved.src||'';

    if(!src){
      throw new Error(
        'La foto activa no tiene imagen'
      );
    }

    return {
      type:'site-photo',
      key,
      src,
      x:saved.x ?? 50,
      y:saved.y ?? 50,
      zoom:saved.zoom ?? 100,
      intensity:saved.intensity ?? 55,
      direction:saved.direction || 'to bottom',
      color:saved.color || '#000000',
      opacity:saved.opacity ?? 70,
      fileName:saved.fileName || '',
      updatedAt:Number(updatedAt)||Date.now()
    };
  }


  async function egpLoadPhotosFromCore(){
    const controller=new AbortController();

    const timer=setTimeout(
      ()=>controller.abort(),
      2500
    );

    try{
      const response=await fetch(
        EGP_PHOTOS_CORE_URL+'/api/photos',
        {
          cache:'no-store',
          signal:controller.signal
        }
      );

      if(!response.ok){
        throw new Error(
          'Core de fotos no respondió'
        );
      }

      const data=await response.json();

      if(
        !data?.ok ||
        !data.photos ||
        typeof data.photos!=='object'
      ){
        throw new Error(
          'Respuesta inválida del Core de fotos'
        );
      }

      return data.photos;

    }finally{
      clearTimeout(timer);
    }
  }


  async function egpLoadPhotosFromFirebase(){
    if(!navigator.onLine){
      throw new Error(
        'Sin conexión a Internet'
      );
    }

    await initRemoteSync();

    if(
      !remoteDb ||
      !remoteDoc ||
      !remoteGetDoc
    ){
      throw new Error(
        'Firebase todavía no está listo'
      );
    }

    const keys=[
      ...egpPhotoAllowedKeys()
    ];

    const entries=await Promise.all(
      keys.map(async key=>{
        const ref=remoteDoc(
          remoteDb,
          'imageEdits',
          'site-photo-' + key
        );

        const snap=await remoteGetDoc(ref);

        if(!snap.exists()){
          return null;
        }

        const value=snap.data()||{};

        if(!value.src){
          return null;
        }

        return [key,value];
      })
    );

    return Object.fromEntries(
      entries.filter(Boolean)
    );
  }


  async function egpSavePhotoToFirebase(
    key,
    payload
  ){
    if(!payload?.src){
      throw new Error(
        'La foto no tiene imagen'
      );
    }

    if(payload.src.length>850000){
      throw new Error(
        'La foto supera el límite de Firebase'
      );
    }

    if(!navigator.onLine){
      throw new Error(
        'Sin conexión a Internet'
      );
    }

    await initRemoteSync();

    if(
      !remoteDb ||
      !remoteDoc ||
      !remoteSetDoc
    ){
      throw new Error(
        'Firebase todavía no está listo'
      );
    }

    const ref=remoteDoc(
      remoteDb,
      'imageEdits',
      'site-photo-' + key
    );

    await remoteSetDoc(
      ref,
      payload,
      {merge:false}
    );

    return true;
  }


  async function egpSavePhotoToCore(
    key,
    payload
  ){
    const controller=new AbortController();

    const timer=setTimeout(
      ()=>controller.abort(),
      5000
    );

    try{
      const photos={};
      photos[key]=payload;

      const response=await fetch(
        EGP_PHOTOS_CORE_URL+'/api/photos',
        {
          method:'POST',
          headers:{
            'Content-Type':'application/json'
          },
          body:JSON.stringify({photos}),
          signal:controller.signal
        }
      );

      const data=await response.json();

      if(
        !response.ok ||
        data?.ok===false
      ){
        throw new Error(
          data?.error ||
          'No se pudo guardar la foto en Core'
        );
      }

      return true;

    }finally{
      clearTimeout(timer);
    }
  }


  async function egpSyncPhotoKey(
    key,
    {
      updatedAt=Date.now(),
      core=true,
      firebase=true
    }={}
  ){
    const stamp=Number(updatedAt)||Date.now();
    const payload=egpPhotoBuildPayload(
      key,
      stamp
    );

    const corePromise=core
      ? egpSavePhotoToCore(
          key,
          payload
        )
      : Promise.resolve(true);

    const firebasePromise=firebase
      ? egpSavePhotoToFirebase(
          key,
          payload
        )
      : Promise.resolve(true);

    const results=await Promise.allSettled([
      corePromise,
      firebasePromise
    ]);

    const coreOK=
      !core ||
      results[0].status==='fulfilled';

    const firebaseOK=
      !firebase ||
      results[1].status==='fulfilled';

    if(core){
      egpPhotoApplySyncResult(
        key,
        stamp,
        'core',
        coreOK
      );
    }

    if(firebase){
      egpPhotoApplySyncResult(
        key,
        stamp,
        'firebase',
        firebaseOK
      );
    }

    if(!coreOK){
      console.warn(
        'Foto pendiente de Core',
        results[0].reason
      );
    }

    if(!firebaseOK){
      console.warn(
        'Foto pendiente de Firebase',
        results[1].reason
      );
    }

    return {
      coreOK,
      firebaseOK,
      updatedAt:stamp
    };
  }


  async function egpFlushPendingPhotoSync(){
    if(egpPhotoSyncBusy)return;

    const pending=egpPhotoLoadPending();
    const entries=Object.entries(pending);

    if(!entries.length)return;

    egpPhotoSyncBusy=true;

    try{
      for(const [key,item] of entries){
        const current=
          egpPhotoLoadPending()[key];

        if(!current)continue;

        if(
          Number(current.updatedAt)!==
          Number(item.updatedAt)
        ){
          continue;
        }

        try{
          await egpSyncPhotoKey(
            key,
            {
              updatedAt:item.updatedAt,
              core:item.core===true,
              firebase:item.firebase===true
            }
          );
        }catch(err){
          console.warn(
            'Foto pendiente de sincronización',
            key,
            err
          );
        }
      }
    }finally{
      egpPhotoSyncBusy=false;
    }
  }


  window.addEventListener(
    'online',
    ()=>{
      setTimeout(
        egpFlushPendingPhotoSync,
        500
      );
    }
  );


  document.addEventListener(
    'visibilitychange',
    ()=>{
      if(!document.hidden){
        setTimeout(
          egpFlushPendingPhotoSync,
          300
        );
      }
    }
  );


  setTimeout(
    egpFlushPendingPhotoSync,
    2500
  );


  setInterval(
    ()=>{
      if(
        Object.keys(
          egpPhotoLoadPending()
        ).length
      ){
        egpFlushPendingPhotoSync();
      }
    },
    30000
  );


  function loadPhotoSettings(){
    try{
      return egpPhotoPrepareVariants(
        JSON.parse(
          localStorage.getItem('egm-photo-settings') || '{}'
        )
      );
    }catch(_){
      return {};
    }
  }
  function loadPhotoSources(){
    try{
      return egpPhotoPrepareVariants(
        JSON.parse(
          localStorage.getItem('egm-photo-originals') || '{}'
        )
      );
    }catch(_){
      return {};
    }
  }
  function currentPhotoDraft(){
    if(!photoDrafts[photoStorageKey(activePhotoSlot)]){
      const saved=loadPhotoSettings()[photoStorageKey(activePhotoSlot)]||{},sources=loadPhotoSources();
      photoDrafts[photoStorageKey(activePhotoSlot)]={...PHOTO_DEFAULTS,...saved,src:sources[photoStorageKey(activePhotoSlot)]||saved.src||''};
    }
    return photoDrafts[photoStorageKey(activePhotoSlot)];
  }
  function syncPhotoControls(){
    const d=currentPhotoDraft();
    $('#photoPosX').value=d.x;$('#photoPosY').value=d.y;$('#photoZoom').value=d.zoom;
    $('#gradientIntensity').value=d.intensity;$('#gradientDirection').value=d.direction;
    $('#gradientColor').value=d.color;$('#gradientOpacity').value=d.opacity;
    const preview=$('#photoPreview');
    const photoLabels={
      portada:'INICIO',
      info:'1 INFO',
      bio:'BIO',
      carta1:'1 CARTA',
      carta2:'2 CARTA'
    };
    $('#photoPreviewLabel').textContent=photoLabels[activePhotoSlot]||activePhotoSlot;
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
  async function openPhotoManager(){
    egpPhotoSyncTargetUI();/* EGP TARGET */

    const settings=structuredClone(loadPhotoSettings());
    const sources=loadPhotoSources();
    photoDrafts={};

    ['portada','info','bio','carta1','carta2'].forEach(slot=>{
      const saved=settings[slot]||{};
      photoDrafts[slot]={
        ...PHOTO_DEFAULTS,
        ...saved,
        src:sources[slot]||saved.src||''
      };
    });

    let remotePhotos=null;

    try{
      /*
       * Durante un show la infraestructura local manda.
       */
      remotePhotos=await egpLoadPhotosFromCore();

    }catch(coreError){
      console.warn(
        'Core de fotos no disponible; intentando Firebase',
        coreError
      );

      try{
        /*
         * Fuera de la red EGP, Firebase mantiene
         * el acceso compartido entre dispositivos.
         */
        remotePhotos=await egpLoadPhotosFromFirebase();

      }catch(firebaseError){
        console.warn(
          'Firebase de fotos no disponible; usando copia local',
          firebaseError
        );
      }
    }

    Object.entries(remotePhotos||{}).forEach(([key,value])=>{
      if(!value || typeof value!=='object') return;

      const localSaved=settings[key]||{};
      const localSrc=
        sources[key]||
        localSaved.src||
        '';

      const localUpdated=
        Number(localSaved.updatedAt)||0;

      const remoteUpdated=
        Number(value.updatedAt)||0;

      if(
        localSrc &&
        localUpdated>remoteUpdated
      ){
        photoDrafts[key]={
          ...PHOTO_DEFAULTS,
          ...localSaved,
          src:localSrc
        };

        return;
      }

      photoDrafts[key]={
        ...PHOTO_DEFAULTS,
        ...value
      };
    });

    activePhotoSlot='portada';
    $$('[data-photo-slot]').forEach(
      b=>b.classList.toggle('is-active',b.dataset.photoSlot===activePhotoSlot)
    );

    syncPhotoControls();
    $('#photoSourceInput').value='';
    $('#photoSourceStatus').textContent=
      currentPhotoDraft().fileName||'Ninguna imagen seleccionada';

    $('#photoManagerDialog').showModal();
    rememberDialogState($('#photoManagerDialog'));
  }
  $$('[data-photo-slot]').forEach(b=>b.addEventListener('click',()=>{activePhotoSlot=b.dataset.photoSlot;$$('[data-photo-slot]').forEach(x=>x.classList.toggle('is-active',x===b));syncPhotoControls();$('#photoSourceInput').value='';$('#photoSourceStatus').textContent=currentPhotoDraft().fileName||'Ninguna imagen seleccionada';}));
  const photoSourceInput=$('#photoSourceInput');
  const photoSourceStatus=$('#photoSourceStatus');
  $('#choosePhotoSourceBtn').addEventListener('click',()=>{photoSourceInput.value='';photoSourceInput.click();});

  const photoLibrary=$('#photoLibrary');
  const choosePhotoLibraryBtn=$('#choosePhotoLibraryBtn');
  const closePhotoLibraryBtn=$('#closePhotoLibraryBtn');

  if(choosePhotoLibraryBtn){
    choosePhotoLibraryBtn.addEventListener('click',()=>{
      if(photoLibrary) photoLibrary.hidden=false;
    });
  }

  if(closePhotoLibraryBtn){
    closePhotoLibraryBtn.addEventListener('click',()=>{
      if(photoLibrary) photoLibrary.hidden=true;
    });
  }

  $$('.photo-library-item').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      const src=btn.dataset.photoLibrary;
      if(!src) return;

      try{
        const response=await fetch(src,{cache:'no-store'});

        if(!response.ok){
          throw new Error('No se pudo abrir la foto de biblioteca');
        }

        const blob=await response.blob();

        const file=new File(
          [blob],
          src.split('/').pop() || 'foto.jpg',
          {type:blob.type || 'image/jpeg'}
        );

        const prepared=await preparePhotoForPanel(file);

        currentPhotoDraft().src=prepared;
        currentPhotoDraft().fileName=file.name;

        photoSourceStatus.textContent=file.name;

        renderPhotoPreview();

        if(photoLibrary) photoLibrary.hidden=true;

        toast('Foto de biblioteca lista para guardar');

      }catch(err){
        toast(err?.message || 'No se pudo cargar la foto');
      }
    });
  });

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
  $('#resetPhotoFrameBtn').addEventListener('click',()=>askConfirm('Restablecer encuadre','La imagen original se conservará y solo se restablecerán los ajustes de esta foto.',()=>{const src=currentPhotoDraft().src,fileName=currentPhotoDraft().fileName;photoDrafts[photoStorageKey(activePhotoSlot)]={...PHOTO_DEFAULTS,src,fileName};syncPhotoControls();},'Restablecer'));
  const preview=$('#photoPreview');
  preview.addEventListener('pointerdown',e=>{if(!currentPhotoDraft().src)return;preview.setPointerCapture(e.pointerId);dragState={id:e.pointerId,startX:e.clientX,startY:e.clientY,x:Number(currentPhotoDraft().x),y:Number(currentPhotoDraft().y)};});
  preview.addEventListener('pointermove',e=>{if(!dragState||dragState.id!==e.pointerId)return;const rect=preview.getBoundingClientRect(),d=currentPhotoDraft();d.x=Math.max(0,Math.min(100,dragState.x+((e.clientX-dragState.startX)/rect.width)*100));d.y=Math.max(0,Math.min(100,dragState.y+((e.clientY-dragState.startY)/rect.height)*100));$('#photoPosX').value=Math.round(d.x);$('#photoPosY').value=Math.round(d.y);renderPhotoPreview();});
  const endDrag=e=>{if(dragState&&(!e||dragState.id===e.pointerId))dragState=null;};preview.addEventListener('pointerup',endDrag);preview.addEventListener('pointercancel',endDrag);
  $('#savePhotoSettingsBtn').addEventListener('click',()=>askConfirm('Guardar fotografías','Se conservarán las imágenes originales y se guardarán por separado únicamente los parámetros de encuadre.',()=>{
    /*
     * Conservar TODO lo que ya existe.
     * Solo actualizar las variantes editadas en esta sesión.
     * Así COMPUTADORA y MÓVIL nunca se borran entre sí.
     */
    const sources=loadPhotoSources();
    const settings=loadPhotoSettings();

    const activeKey=
      photoStorageKey(activePhotoSlot);

    const syncStamp=Date.now();

    if(photoDrafts[activeKey]){
      photoDrafts[activeKey].updatedAt=
        syncStamp;
    }else{
      const active=currentPhotoDraft();
      active.updatedAt=syncStamp;
    }

    Object.entries(photoDrafts).forEach(([slot,d])=>{
      sources[slot]=d.src||'';
      const {src,fileName,...params}=d;
      settings[slot]={
        ...params,
        fileName:fileName||''
      };
    });

    try{
      localStorage.setItem(
        'egm-photo-originals',
        JSON.stringify(sources)
      );

      localStorage.setItem(
        'egm-photo-settings',
        JSON.stringify(settings)
      );

      egpPhotoMarkPending(
        activeKey,
        syncStamp,
        {
          core:true,
          firebase:true
        }
      );

      rememberDialogState(
        $('#photoManagerDialog')
      );

      egpSyncPhotoKey(
        activeKey,
        {
          updatedAt:syncStamp,
          core:true,
          firebase:true
        }
      ).then(result=>{
        if(
          result.coreOK &&
          result.firebaseOK
        ){
          toast(
            'Guardado exitosamente · Firebase + Core'
          );

        }else if(result.coreOK){
          toast(
            'Guardado exitosamente · Core · Firebase pendiente'
          );

        }else if(result.firebaseOK){
          toast(
            'Guardado exitosamente · Firebase · Core pendiente'
          );

        }else{
          toast(
            'Guardado local · sincronización pendiente'
          );
        }
      }).catch(err=>{
        console.warn(
          'Sincronización de foto pendiente',
          err
        );

        toast(
          'Guardado local · sincronización pendiente'
        );
      });
    }
    catch(_){
      toast('La imagen es demasiado grande. Usa una imagen más liviana.');
    }
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


  /*
   * EGP CONFIG LAN CONSOLIDADA V86
   * EGP_CORE_SHOW_AUTHORITY_V1
   *
   * 8788 recibe configuración + sesión + revisión + cronómetro.
   * 8790 conserva su contrato histórico de pedidos.
   */
  const EGP_REQUESTS_LAN_URL=EGP_AUDIT_LOCAL?'http://10.10.10.2:8796':(location.hostname==='elenagirjoaba.com'?location.origin+'/__egp_lan':'http://10.10.10.2:8790');

  async function egpPublicarConfigLan(data={}){
    const cfg=state.config||{};
    const active=
      ('show_activo' in data)
        ? data.show_activo===true
        : Boolean(state.config);

    const explicitStart=
      ('inicio_show' in data)
        ? Number(data.inicio_show)||0
        : 0;

    const configStart=
      cfg.startedAt
        ? new Date(cfg.startedAt).getTime()
        : 0;

    const rememberedStart=
      Number(
        latestRemoteState?.inicio_show ||
        latestRemoteState?.show_id ||
        0
      )||0;

    const startValue=
      active
        ? (
            explicitStart ||
            configStart ||
            rememberedStart ||
            Date.now()
          )
        : 0;

    const showId=String(
      startValue ||
      latestRemoteState?.show_id ||
      ''
    );

    const sessionId=String(
      data.show_session_id ||
      (
        showId && showId!=='0'
          ? `show-${showId}`
          : ''
      )
    );

    const enabled=
      ('pedidos_panel' in data)
        ? (
            active &&
            data.pedidos_panel===true
          )
        : (
            active &&
            cfg.requests===true
          );

    const mode=
      ('pedidos_modo' in data)
        ? (
            data.pedidos_modo==='uno_por_turno'
              ? 'uno_por_turno'
              : 'libre'
          )
        : (
            cfg.requestsMode==='uno_por_turno'
              ? 'uno_por_turno'
              : 'libre'
          );

    const repertoire=
      ('lista_activa' in data)
        ? String(data.lista_activa||'todas')
        : String(cfg.repertoire||'todas');

    const repertoireName=
      ('repertorio_nombre' in data)
        ? String(data.repertorio_nombre||'')
        : String(cfg.repertoireName||'');

    const ids=
      Array.isArray(data.repertorio_activo_ids)
        ? data.repertorio_activo_ids.map(String)
        : (
            repertoire==='todas'
              ? state.songs
              : state.songs.filter(
                  song=>
                    (song.listas||[]).includes(
                      repertoire
                    )
                )
          ).map(song=>String(song.id));

    const whatsappRequested=
      ('pedidos_whatsapp' in data)
        ? data.pedidos_whatsapp===true
        : cfg.whatsapp===true;

    const whatsapp=
      active &&
      !enabled &&
      whatsappRequested;

    const publicQueue=
      ('mostrar_cola' in data)
        ? data.mostrar_cola!==false
        : cfg.publicQueue!==false;

    const venue=
      ('lugar' in data)
        ? String(data.lugar||'')
        : String(cfg.venue||'');

    const profile=
      ('perfil_clientes' in data)
        ? String(
            data.perfil_clientes||'medio'
          )
        : String(cfg.profile||'medio');

    const advertising=
      ('uso_publicidad' in data)
        ? data.uso_publicidad===true
        : cfg.advertising===true;

    const timerElapsed=
      active
        ? Math.max(
            0,
            Number(
              ('cronometro_elapsed_ms' in data)
                ? data.cronometro_elapsed_ms
                : showTimer.elapsedMs
            )||0
          )
        : 0;

    const timerRunning=
      active &&
      (
        ('cronometro_running' in data)
          ? data.cronometro_running===true
          : showTimer.running===true
      );

    const timerStarted=
      timerRunning
        ? Number(
            ('cronometro_started_at' in data)
              ? data.cronometro_started_at
              : showTimer.startedAt
          )||0
        : 0;

    const revision=
      Number(data.show_revision)||Date.now();

    const publicConfigPayload={
      show_active:active,
      show_activo:active,
      show_id:showId,
      show_session_id:sessionId,
      show_revision:revision,
      show_writer:DEVICE_ID,

      pedidos_panel:enabled,
      pedidos_modo:mode,
      pedidos_whatsapp:whatsapp,
      mostrar_cola:publicQueue,

      lista_activa:repertoire,
      listaActiva:repertoire,
      repertorio_nombre:repertoireName,
      repertorio_activo_ids:ids,
      repertorioActivoIds:ids,

      lugar:venue,
      perfil_clientes:profile,
      uso_publicidad:advertising,

      inicio_show:startValue,
      cronometro_schema:SHOW_TIMER_SCHEMA,
      cronometro_elapsed_ms:timerElapsed,
      cronometro_running:timerRunning,
      cronometro_started_at:timerStarted
    };

    let coreResult=null;
    let legacyOk=false;

    try{
      const coreResponse=await fetch(
        `${LOCAL_CORE_URL}/api/public-config`,
        {
          method:'POST',
          headers:{
            'Content-Type':'application/json'
          },
          cache:'no-store',
          body:JSON.stringify(
            publicConfigPayload
          )
        }
      );

      const coreJson=await coreResponse.json();

      if(
        !coreResponse.ok ||
        coreJson?.ok===false
      ){
        throw new Error(
          coreJson?.error ||
          `Local Core HTTP ${coreResponse.status}`
        );
      }

      coreResult=coreJson;
      LOCAL_QUEUE_MODE=true;

    }catch(coreErr){
      console.warn(
        'Core 8788 no disponible para configuración:',
        coreErr
      );
    }

    const legacyPayload={
      show_active:active,
      show_id:showId,
      pedidos_panel:enabled,
      pedidos_modo:mode,
      pedidos_whatsapp:whatsapp,
      mostrar_cola:publicQueue,
      lista_activa:repertoire,
      repertorio_nombre:repertoireName,
      repertorio_activo_ids:ids,
      lugar:venue,
      perfil_clientes:profile,
      uso_publicidad:advertising
    };

    try{
      const legacyResponse=await fetch(
        `${EGP_REQUESTS_LAN_URL}/api/config`,
        {
          method:'POST',
          headers:{
            'Content-Type':'application/json'
          },
          cache:'no-store',
          body:JSON.stringify(
            legacyPayload
          )
        }
      );

      if(!legacyResponse.ok){
        throw new Error(
          `LAN 8790 HTTP ${legacyResponse.status}`
        );
      }

      legacyOk=true;

    }catch(err){
      console.warn(
        'Fallback LAN de Pedidos no disponible:',
        err
      );
    }

    if(!coreResult&&!legacyOk){
      throw new Error(
        'No se pudo publicar configuración en Core ni LAN pedidos'
      );
    }

    return coreResult||{
      ok:true,
      publicConfig:publicConfigPayload
    };
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
        toggle.checked=false; // EGP_DEFAULT_PEDIDOS_OFF_V1: solo un show remoto activo puede volver a encenderlo
        mode.value=state.config?.requestsMode==='uno_por_turno'?'uno_por_turno':'libre';
        const publishCurrent=async()=>{
          if(toggle.checked===true&&whatsapp)whatsapp.checked=false;
          localStorage.setItem(EGP_PEDIDOS_PANEL_KEY,toggle.checked?'1':'0');
          if(state.config){
            state.config.requests=toggle.checked===true;
            state.config.whatsapp=state.config.requests?false:(whatsapp?.checked===true);
            state.config.requestsMode=mode.value==='uno_por_turno'?'uno_por_turno':'libre';
            saveStateLocalOnly();
            const pedidosPatch={pedidos_whatsapp:state.config.whatsapp===true,pedidos_panel:state.config.requests,pedidos_modo:state.config.requestsMode};
            await egpPublicarConfigLan({show_activo:true,inicio_show:new Date(state.config.startedAt).getTime(),...pedidosPatch});
            if(!EGP_AUDIT_LOCAL){
              try{await publishShowPatch(pedidosPatch);}catch(err){console.warn('Pedidos pendientes de sincronizar',err);}
            }
          }
        };
        toggle.addEventListener('change',publishCurrent);
        mode.addEventListener('change',publishCurrent);

        if(whatsapp&&!whatsapp.dataset.egpPedidosExclusion){
          whatsapp.dataset.egpPedidosExclusion='1';
          whatsapp.addEventListener('change',async()=>{
            if(whatsapp.checked===true)toggle.checked=false;
            localStorage.setItem(EGP_PEDIDOS_PANEL_KEY,toggle.checked?'1':'0');
            if(state.config){
              state.config.whatsapp=whatsapp.checked===true;
              state.config.requests=state.config.whatsapp?false:(toggle.checked===true);
              state.config.requestsMode=mode.value==='uno_por_turno'?'uno_por_turno':'libre';
              saveStateLocalOnly();
              const pedidosPatch={pedidos_whatsapp:state.config.whatsapp===true,pedidos_panel:state.config.requests===true,pedidos_modo:state.config.requestsMode};
              try{await egpPublicarConfigLan({show_activo:true,inicio_show:new Date(state.config.startedAt).getTime(),...pedidosPatch});}catch(err){console.warn('Pedidos LAN pendientes',err);}
              if(!EGP_AUDIT_LOCAL){
                try{await publishShowPatch(pedidosPatch);}catch(err){console.warn('Pedidos pendientes de sincronizar',err);}
              }
            }
          });
        }
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

      // 8790 es autoridad únicamente para las órdenes/pedidos LAN.
      // La configuración del show y sus switches vienen de 8788/Firebase.
      // Nunca reescribir state.config desde /api/config de 8790.
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
        if(!remoteStateRef)await initRemoteSync(true);
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

  // La autorización dura únicamente durante esta sesión de la app.
  // Sobrevive a recargas y al cambiar temporalmente a otra app,
  // pero desaparece al cerrar completamente esta ventana/app.
  const PANEL_AUTH_SESSION_KEY='egm-panel-auth-session-v1';

  /*
   * Migración de seguridad:
   * versiones anteriores guardaban por error la autorización en localStorage.
   * Se elimina ese residuo; NO concede acceso a la sesión actual.
   */
  try{
    localStorage.removeItem(PANEL_AUTH_SESSION_KEY);
  }catch(_){}

  function rememberPanelAuth(){
    try{
      /*
       * Autorización SOLO de esta sesión real.
       * Una recarga dentro de la misma app conserva sessionStorage.
       * Una nueva sesión de la app vuelve a pedir contraseña.
       */
      sessionStorage.setItem(PANEL_AUTH_SESSION_KEY,'1');

      /*
       * Limpieza de la implementación anterior.
       * No usamos más este permiso persistente.
       */
      localStorage.removeItem(PANEL_AUTH_SESSION_KEY);
    }catch(_){}
  }

  function panelAuthSessionValid(){
    try{
      /*
       * IMPORTANTE:
       * No leer localStorage aquí.
       * El permiso persistente era la causa de que Android entrara
       * incluso después de reinstalar la PWA.
       */
      return sessionStorage.getItem(PANEL_AUTH_SESSION_KEY)==='1';
    }catch(_){
      return false;
    }
  }

  // Android/iPhone: permitir siempre el desplazamiento vertical normal.
  // La prevención global de touchmove podía bloquear el scroll en PWA/Android.
  // El rebote/recarga se controla por CSS con overscroll-behavior.

  const login=$('#panelLogin'),loginForm=$('#panelLoginForm'),loginPassword=$('#panelLoginPassword'),loginError=$('#panelLoginError');

  // Contraseña una vez por sesión real de la app.
  // Una recarga, actualización del Service Worker o cambio temporal a otra app
  // no debe volver a pedirla.
  if(panelAuthSessionValid()){
    login.hidden=true;
    login.setAttribute('aria-hidden','true');
  }else{
    login.removeAttribute('hidden');
    login.setAttribute('aria-hidden','false');
    login.hidden=false;
  }

  loginForm.addEventListener('submit',e=>{
    e.preventDefault();
    const security=JSON.parse(localStorage.getItem('egm-security-settings')||'{}');

    if(loginPassword.value===(security.password||'2907')){
      rememberPanelAuth();
      login.hidden=true;
      login.setAttribute('aria-hidden','true');
      loginError.hidden=true;
      loginPassword.value='';

      if(
        LOCAL_QUEUE_MODE &&
        showActiveConfirmed &&
        state.config
      ){
        showLive();
      }else if(latestRemoteState){
        applyRemotePanelState(latestRemoteState);
      }else{
        showConfig();
      }
    }else{
      loginError.hidden=false;
    }
  });
  loadData().then(async()=>{
    let sharedStateResolved=false;

    try{
      await initRemoteSync(true);

      if(remoteGetDoc&&remoteStateRef){
        const snap=await remoteGetDoc(remoteStateRef);

        if(snap.exists()){
          latestRemoteState=snap.data()||{};
          sharedStateResolved=true;
          applyRemotePanelState(latestRemoteState);
        }
      }
    }catch(err){
      console.warn('No se pudo leer todavía el estado compartido del show.',err);
    }

    egpPedidosLanPanelV85();

    // Pedidos de clientes con Internet llegan por Firebase.
    // Reintentar el listener aunque navigator.onLine sea enganoso en la red EGP.
    let egpFirebasePedidosEnsureTimerV1=0;
    const egpAsegurarFirebasePedidosV1=async()=>{
      clearTimeout(egpFirebasePedidosEnsureTimerV1);
      if(!remoteStateRef&&!EGP_AUDIT_LOCAL){
        try{
          await initRemoteSync(true);
          console.log('Firebase pedidos: listener listo');
        }catch(err){
          console.warn('Firebase pedidos todavia no disponible:',err);
        }
      }
      egpFirebasePedidosEnsureTimerV1=setTimeout(egpAsegurarFirebasePedidosV1,5000);
    };
    egpFirebasePedidosEnsureTimerV1=setTimeout(egpAsegurarFirebasePedidosV1,1200);
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
