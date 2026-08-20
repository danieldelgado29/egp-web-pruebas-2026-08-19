(()=>{
  const STORAGE_KEY="egp_aux_monitor_names_v1";
  const REMOTE_DOC="egp-system-monitoreo-v1";

  const ROUTES={
    stereo:["1-2","3-4","5-6","7-8"],
    mono:["1","2","3","4","5","6","7","8"]
  };

  const DEFAULTS={
    stereo:["Elena","Batería","Bajo","Piano"],
    mono:["Elena","Batería","Bajo","Piano","AUX 5","AUX 6","AUX 7","AUX 8"]
  };

  let dirty=false;
  let loadGeneration=0;

  const $=id=>document.getElementById(id);

  function cleanNames(data){
    const stereo=Array.isArray(data?.stereo)?data.stereo:[];
    const mono=Array.isArray(data?.mono)?data.mono:[];

    return {
      stereo:DEFAULTS.stereo.map(
        (fallback,i)=>String(stereo[i]??fallback).trim()||fallback
      ),
      mono:DEFAULTS.mono.map(
        (fallback,i)=>String(mono[i]??fallback).trim()||fallback
      )
    };
  }

  function localNames(){
    try{
      return cleanNames(
        JSON.parse(localStorage.getItem(STORAGE_KEY)||"null")
      );
    }catch(_){
      return cleanNames(null);
    }
  }

  function saveLocal(data){
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(cleanNames(data))
    );
  }

  function fillForm(data){
    const clean=cleanNames(data);

    clean.stereo.forEach((name,i)=>{
      const input=$(`auxStereo${i+1}`);
      if(input) input.value=name;
    });

    clean.mono.forEach((name,i)=>{
      const input=$(`auxMono${i+1}`);
      if(input) input.value=name;
    });
  }

  function readForm(){
    return cleanNames({
      stereo:ROUTES.stereo.map(
        (_,i)=>$(`auxStereo${i+1}`)?.value
      ),
      mono:ROUTES.mono.map(
        (_,i)=>$(`auxMono${i+1}`)?.value
      )
    });
  }

  function profiles(data){
    const clean=cleanNames(data);

    return {
      stereo:ROUTES.stereo.map((aux,i)=>({
        id:`stereo-${aux}`,
        nombre:clean.stereo[i],
        aux
      })),
      mono:ROUTES.mono.map((aux,i)=>({
        id:`mono-${aux}`,
        nombre:clean.mono[i],
        aux
      }))
    };
  }

  async function firebaseConfig(){
    const response=await fetch(
      "configuracion.json",
      {cache:"no-store"}
    );

    if(!response.ok){
      throw new Error(
        `configuracion.json HTTP ${response.status}`
      );
    }

    const cfg=await response.json();
    const fb=cfg?.firebase;

    if(!fb?.projectId||!fb?.apiKey){
      throw new Error("Configuración Firebase incompleta");
    }

    return fb;
  }

  async function requestFirebase(method,body){
    const fb=await firebaseConfig();

    const url=
      "https://firestore.googleapis.com/v1/projects/" +
      encodeURIComponent(fb.projectId) +
      "/databases/(default)/documents/imageEdits/" +
      REMOTE_DOC +
      "?key=" +
      encodeURIComponent(fb.apiKey);

    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),10000);

    try{
      const options={
        method,
        cache:"no-store",
        signal:controller.signal
      };

      if(body!==undefined){
        options.headers={
          "Content-Type":"application/json"
        };
        options.body=JSON.stringify(body);
      }

      return await fetch(url,options);
    }finally{
      clearTimeout(timer);
    }
  }

  function firestoreList(field){
    const values=field?.arrayValue?.values;

    if(!Array.isArray(values)){
      return [];
    }

    return values.map(item=>{
      const f=item?.mapValue?.fields||{};

      return {
        id:String(f.id?.stringValue||""),
        nombre:String(f.nombre?.stringValue||""),
        aux:String(f.aux?.stringValue||"")
      };
    }).filter(item=>item.aux&&item.nombre);
  }

  function parseRemote(raw,fallback){
    const root=
      raw
        ?.fields
        ?.monitoreo_perfiles
        ?.mapValue
        ?.fields
      ||{};

    const stereo=new Map(
      firestoreList(root.stereo)
        .map(item=>[item.aux,item.nombre])
    );

    const mono=new Map(
      firestoreList(root.mono)
        .map(item=>[item.aux,item.nombre])
    );

    const base=cleanNames(fallback);

    return cleanNames({
      stereo:ROUTES.stereo.map(
        (aux,i)=>stereo.get(aux)||base.stereo[i]
      ),
      mono:ROUTES.mono.map(
        (aux,i)=>mono.get(aux)||base.mono[i]
      )
    });
  }

  async function readRemote(fallback){
    if(!navigator.onLine){
      return null;
    }

    const response=await requestFirebase("GET");

    if(response.status===404){
      return null;
    }

    if(!response.ok){
      const text=await response.text();
      throw new Error(
        `Firebase GET ${response.status}: ${text.slice(0,200)}`
      );
    }

    return parseRemote(
      await response.json(),
      fallback
    );
  }

  function stringValue(value){
    return {
      stringValue:String(value??"")
    };
  }

  function profileValue(item){
    return {
      mapValue:{
        fields:{
          id:stringValue(item.id),
          nombre:stringValue(item.nombre),
          aux:stringValue(item.aux)
        }
      }
    };
  }

  async function writeRemote(data){
    const p=profiles(data);

    const body={
      fields:{
        kind:{
          stringValue:"egp_monitor_config_v1"
        },
        updated_at:{
          integerValue:String(Date.now())
        },
        monitoreo_perfiles:{
          mapValue:{
            fields:{
              stereo:{
                arrayValue:{
                  values:p.stereo.map(profileValue)
                }
              },
              mono:{
                arrayValue:{
                  values:p.mono.map(profileValue)
                }
              }
            }
          }
        }
      }
    };

    const response=await requestFirebase(
      "PATCH",
      body
    );

    if(!response.ok){
      const text=await response.text();

      throw new Error(
        `Firebase PATCH ${response.status}: ${text.slice(0,200)}`
      );
    }

    const verify=await readRemote(data);

    if(!verify){
      throw new Error(
        "Firebase guardó pero no devolvió la configuración"
      );
    }

    const expected=cleanNames(data);

    if(
      JSON.stringify(verify)!==
      JSON.stringify(expected)
    ){
      throw new Error(
        "La verificación Firebase no coincide con los nombres guardados"
      );
    }
  }

  function cloneElement(id){
    const old=$(id);

    if(!old){
      return null;
    }

    const fresh=old.cloneNode(true);
    old.replaceWith(fresh);

    return fresh;
  }

  function setButton(btn,text,state){
    if(!btn) return;

    btn.textContent=text;

    btn.classList.remove(
      "is-saving",
      "is-saved"
    );

    if(state){
      btn.classList.add(state);
    }
  }

  function install(){
    const dialog=$("auxMonitorsDialog");
    const oldForm=$("auxMonitorsForm");

    if(!dialog||!oldForm){
      console.error(
        "AUX aprobado: faltan elementos del Panel"
      );
      return;
    }

    const openBtn=
      cloneElement("openAuxMonitorsBtn");

    const closeBtn=
      cloneElement("closeAuxMonitorsBtn");

    const form=
      oldForm.cloneNode(true);

    oldForm.replaceWith(form);

    dialog.addEventListener(
      "cancel",
      event=>{
        event.preventDefault();
      }
    );

    form.addEventListener(
      "input",
      ()=>{
        dirty=true;
      }
    );

    openBtn?.addEventListener(
      "click",
      async()=>{
        const menu=$("toolsMenu");

        if(menu?.open){
          menu.close();
        }

        const generation=
          ++loadGeneration;

        const local=
          localNames();

        dirty=false;
        fillForm(local);

        if(!dialog.open){
          dialog.showModal();
        }

        try{
          const remote=
            await readRemote(local);

          if(
            !remote ||
            generation!==loadGeneration ||
            dirty ||
            !dialog.open
          ){
            return;
          }

          saveLocal(remote);
          fillForm(remote);
        }catch(error){
          console.warn(
            "AUX aprobado: usando copia local",
            error
          );
        }
      }
    );

    closeBtn?.addEventListener(
      "click",
      ()=>{
        if(
          dirty &&
          !window.confirm(
            "Hay cambios sin guardar. ¿Cerrar de todas formas?"
          )
        ){
          return;
        }

        loadGeneration++;
        dirty=false;
        dialog.close();
      }
    );

    form.addEventListener(
      "submit",
      async event=>{
        event.preventDefault();

        const data=readForm();

        if(
          !window.confirm(
            "¿Deseas guardar estos nombres de monitores?"
          )
        ){
          return;
        }

        const btn=
          form.querySelector(".aux-save-btn");

        if(btn){
          btn.disabled=true;
        }

        setButton(
          btn,
          "Guardando…",
          "is-saving"
        );

        saveLocal(data);

        try{
          await writeRemote(data);

          dirty=false;

          setButton(
            btn,
            "✓ Sincronizado",
            "is-saved"
          );

          setTimeout(()=>{
            if(btn){
              btn.disabled=false;
            }

            setButton(
              btn,
              "Guardar",
              ""
            );
          },1600);

        }catch(error){
          console.error(
            "AUX aprobado: error de sincronización",
            error
          );

          if(btn){
            btn.disabled=false;
          }

          setButton(
            btn,
            "⚠ Reintentar",
            ""
          );
        }
      }
    );

    console.log(
      "AUX aprobado instalado",
      ROUTES
    );
  }

  if(document.readyState==="complete"){
    install();
  }else{
    window.addEventListener(
      "load",
      install,
      {once:true}
    );
  }
})();
