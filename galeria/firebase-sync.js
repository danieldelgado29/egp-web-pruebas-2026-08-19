/*
 * EGP — GALERIA PUBLICA FIREBASE V3
 *
 * Firebase actualiza la Galeria en vivo.
 * NO recarga la pagina.
 * NO cierra fotos ni videos abiertos.
 */

(async function(){

  const STORAGE_KEY='egp-gallery-items-v1';
  const DOC_ID='site-gallery-public-v1';

  function localJSON(){
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

    if(!cfg.firebase){
      throw new Error(
        'Configuracion Firebase no encontrada'
      );
    }

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

        if(remoteJSON===localJSON()){
          return;
        }

        localStorage.setItem(
          STORAGE_KEY,
          remoteJSON
        );

        /*
         * Avisamos al script original que hay datos nuevos.
         * NO location.reload().
         */
        window.dispatchEvent(
          new CustomEvent(
            'egp-gallery-updated',
            {
              detail:{
                updatedAt:data.updatedAt||Date.now()
              }
            }
          )
        );

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
