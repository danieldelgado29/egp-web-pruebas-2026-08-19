/*
 * EGP — GALERIA PUBLICA FIREBASE V2
 *
 * Firebase = fuente compartida.
 * localStorage = respaldo local/offline.
 *
 * IMPORTANTE:
 * NO usa onSnapshot.
 * NO recarga continuamente.
 * Solo sincroniza al entrar/recargar la pagina.
 */

(async function(){

  const STORAGE_KEY='egp-gallery-items-v1';
  const APPLIED_KEY='egp-gallery-firebase-applied-v2';
  const DOC_ID='site-gallery-public-v1';

  function readLocalJSON(){
    try{
      const value=JSON.parse(
        localStorage.getItem(STORAGE_KEY)||'[]'
      );

      return JSON.stringify(
        Array.isArray(value)?value:[]
      );
    }catch(_){
      return '[]';
    }
  }

  try{

    const [
      {
        initializeApp,
        getApps,
        getApp
      },
      {
        getFirestore,
        doc,
        getDoc
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
      '../configuracion.json?galeriaFirebase='+Date.now(),
      {cache:'no-store'}
    );

    if(!response.ok){
      throw new Error('No se pudo leer configuracion.json');
    }

    const cfg=await response.json();

    const appName='egp-galeria-publica';

    const app=getApps().some(
      app=>app.name===appName
    )
      ? getApp(appName)
      : initializeApp(cfg.firebase,appName);

    const db=getFirestore(app);

    const ref=doc(
      db,
      'imageEdits',
      DOC_ID
    );

    const snap=await getDoc(ref);

    if(!snap.exists()){
      return;
    }

    const data=snap.data()||{};

    if(!Array.isArray(data.items)){
      return;
    }

    const remoteJSON=JSON.stringify(data.items);
    const localJSON=readLocalJSON();

    if(remoteJSON===localJSON){
      return;
    }

    /*
     * Guardamos los datos nuevos.
     */
    localStorage.setItem(
      STORAGE_KEY,
      remoteJSON
    );

    /*
     * Una sola recarga puede ser necesaria porque script.js
     * ya renderizo antes de que Firebase respondiera.
     *
     * El marcador evita cualquier bucle de recargas.
     */
    const version=String(
      data.updatedAt ||
      remoteJSON.length
    );

    const applied=sessionStorage.getItem(APPLIED_KEY);

    if(applied!==version){
      sessionStorage.setItem(
        APPLIED_KEY,
        version
      );

      location.reload();
    }

  }catch(err){

    console.warn(
      'EGP GALERIA PUBLICA: usando respaldo local',
      err
    );

  }

})();
