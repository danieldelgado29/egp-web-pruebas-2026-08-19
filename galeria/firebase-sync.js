/*
 * EGP — GALERIA PUBLICA FIREBASE V1
 *
 * Firebase es la fuente compartida.
 * localStorage queda como respaldo offline.
 */

(async function(){

  const STORAGE_KEY='egp-gallery-items-v1';
  const DOC_ID='site-gallery-public-v1';

  function currentJSON(){
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
        onSnapshot
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
      throw new Error(
        'No se pudo leer configuracion.json'
      );
    }

    const cfg=await response.json();

    const appName='egp-galeria-publica';

    const app=getApps().some(
      app=>app.name===appName
    )
      ? getApp(appName)
      : initializeApp(
          cfg.firebase,
          appName
        );

    const db=getFirestore(app);

    const ref=doc(
      db,
      'imageEdits',
      DOC_ID
    );

    onSnapshot(
      ref,
      snap=>{

        if(!snap.exists()){
          return;
        }

        const data=snap.data()||{};

        if(!Array.isArray(data.items)){
          return;
        }

        const remoteJSON=
          JSON.stringify(data.items);

        if(remoteJSON===currentJSON()){
          return;
        }

        localStorage.setItem(
          STORAGE_KEY,
          remoteJSON
        );

        /*
         * El script original de Galeria está encapsulado.
         * Una sola recarga hace que renderice inmediatamente
         * la lista nueva desde localStorage.
         *
         * No genera bucle:
         * después de recargar ambos JSON ya son iguales.
         */
        location.reload();

      },
      err=>{
        console.warn(
          'EGP GALERIA PUBLICA: usando respaldo local',
          err
        );
      }
    );

  }catch(err){

    console.warn(
      'EGP GALERIA PUBLICA: Firebase no disponible; usando local',
      err
    );

  }

})();
