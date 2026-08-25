/*
 * EGP — GALERIA COMPARTIDA FIREBASE V1
 *
 * El administrador de Galeria continúa trabajando exactamente
 * como antes con localStorage.
 *
 * Este módulo sincroniza esa lista con Firebase para que
 * otros dispositivos y la página pública reciban los cambios.
 */

(async function(){

  const STORAGE_KEY='egp-gallery-items-v1';
  const DOC_ID='site-gallery-public-v1';

  let firestore=null;
  let galleryRef=null;
  let firebaseReady=false;
  let bootstrapPromise=null;
  let syncing=false;
  let lastLocal='';

  function readLocal(){
    try{
      const value=JSON.parse(
        localStorage.getItem(STORAGE_KEY)||'[]'
      );

      return Array.isArray(value)?value:[];
    }catch(_){
      return [];
    }
  }

  function serialize(items){
    try{
      return JSON.stringify(
        Array.isArray(items)?items:[]
      );
    }catch(_){
      return '[]';
    }
  }

  function writeLocal(items){
    const clean=Array.isArray(items)?items:[];

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(clean)
    );

    lastLocal=serialize(clean);
  }

  async function prepareFirebase(){

    if(firestore && galleryRef){
      return;
    }

    const [
      {
        initializeApp,
        getApps,
        getApp
      },
      {
        getFirestore,
        doc
      }
    ]=await Promise.all([
      import(
        'https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js'
      ),
      import(
        'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js'
      )
    ]);

    const response=await fetch(
      './configuracion.json?galeriaFirebase='+Date.now(),
      {cache:'no-store'}
    );

    if(!response.ok){
      throw new Error(
        'No se pudo leer configuracion.json'
      );
    }

    const cfg=await response.json();

    if(!cfg.firebase){
      throw new Error(
        'Configuracion Firebase no encontrada'
      );
    }

    const appName='egp-galeria-panel-sync';

    const app=getApps().some(
      app=>app.name===appName
    )
      ? getApp(appName)
      : initializeApp(
          cfg.firebase,
          appName
        );

    firestore=getFirestore(app);

    galleryRef=doc(
      firestore,
      'imageEdits',
      DOC_ID
    );
  }

  async function bootstrap(){

    if(bootstrapPromise){
      return bootstrapPromise;
    }

    bootstrapPromise=(async()=>{

      try{

        await prepareFirebase();

        const {
          getDoc,
          setDoc
        }=await import(
          'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js'
        );

        const localItems=readLocal();

        const snap=await getDoc(
          galleryRef
        );

        /*
         * Si Firebase todavía no tiene Galeria:
         * la lista que YA existe en este Panel es la semilla.
         *
         * Así las fotos/videos subidos antes de este parche
         * NO necesitan volver a subirse.
         */
        if(!snap.exists()){

          await setDoc(
            galleryRef,
            {
              items:localItems,
              updatedAt:Date.now(),
              version:1
            }
          );

          lastLocal=serialize(localItems);

          console.log(
            'EGP GALERIA: Firebase sembrado con',
            localItems.length,
            'elementos'
          );

        }else{

          const remote=snap.data()||{};

          if(Array.isArray(remote.items)){

            /*
             * Cuando Firebase ya existe, manda el estado
             * compartido para evitar que otro dispositivo
             * antiguo sobrescriba la Galeria.
             */
            writeLocal(remote.items);

          }else{

            lastLocal=serialize(localItems);

          }
        }

        firebaseReady=true;

      }catch(err){

        firebaseReady=false;

        console.warn(
          'EGP GALERIA: Firebase no disponible; continúa local',
          err
        );

      }finally{

        bootstrapPromise=null;

      }

    })();

    return bootstrapPromise;
  }

  async function syncLocalChanges(){

    if(syncing){
      return;
    }

    if(!navigator.onLine){
      return;
    }

    if(!firebaseReady){

      await bootstrap();

      if(!firebaseReady){
        return;
      }
    }

    const items=readLocal();
    const current=serialize(items);

    if(current===lastLocal){
      return;
    }

    syncing=true;

    try{

      const {
        setDoc
      }=await import(
        'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js'
      );

      await setDoc(
        galleryRef,
        {
          items,
          updatedAt:Date.now(),
          version:1
        }
      );

      lastLocal=current;

      console.log(
        'EGP GALERIA: sincronizados',
        items.length,
        'elementos'
      );

    }catch(err){

      console.warn(
        'EGP GALERIA: pendiente de sincronizar',
        err
      );

    }finally{

      syncing=false;

    }
  }

  /*
   * Primero publica/recupera la Galeria existente.
   */
  await bootstrap();

  /*
   * El administrador actual modifica localStorage.
   * Detectamos esos cambios sin alterar panel.js.
   */
  setInterval(
    syncLocalChanges,
    700
  );

  window.addEventListener(
    'online',
    ()=>{
      bootstrap()
        .then(syncLocalChanges)
        .catch(()=>{});
    }
  );

  document.addEventListener(
    'visibilitychange',
    ()=>{
      if(document.visibilityState==='visible'){
        syncLocalChanges();
      }
    }
  );

})();
