const CLOUD_NAME = "wi4naurm";
const UPLOAD_PRESET = "egp_galeria";

const $ = s => document.querySelector(s);

async function iniciarGaleriaAdmin(){

  const menu = $("#adminMenuLateral");
  if(!menu) return;

  /* BOTÓN GALERÍA: preferir el que ya existe físicamente */
  let boton = $("#egpGaleriaMenuBtn");

  if(!boton){
    boton = document.createElement("button");
    boton.id = "egpGaleriaMenuBtn";
    boton.type = "button";
    boton.textContent = "Galería · Fotos y videos";
    menu.appendChild(boton);
  }

  /* DIALOG */
  const dialog = document.createElement("dialog");
  dialog.id = "egpGaleriaAdminDialog";
  dialog.className = "egp-galeria-admin";

  dialog.innerHTML = `
    <div class="egp-galeria-head">
      <div>
        <small>ELENA GIRJOABA MUSIC</small>
        <h2>Galería</h2>
      </div>
      <button id="egpGaleriaCerrar" type="button" aria-label="Cerrar">×</button>
    </div>

    <p class="egp-galeria-intro">
      Sube fotos y videos de los shows.
    </p>

    <div class="egp-galeria-actions">
      <button id="egpSubirFoto" type="button">SUBIR FOTO</button>
      <button id="egpSubirVideo" type="button">SUBIR VIDEO</button>
    </div>

    <input id="egpGaleriaInputFoto"
           type="file"
           accept="image/jpeg,image/png,image/webp"
           hidden>

    <input id="egpGaleriaInputVideo"
           type="file"
           accept="video/*"
           hidden>

    <div id="egpGaleriaEstado" class="egp-galeria-estado"></div>

    <div id="egpGaleriaAdminLista" class="egp-galeria-lista"></div>
  `;

  document.body.appendChild(dialog);

  /* FIREBASE SEPARADO DEL NÚCLEO DEL PANEL */
  const cfg = await fetch("configuracion.json").then(r => r.json());

  const [
    { initializeApp },
    {
      getFirestore,
      doc,
      getDoc,
      setDoc,
      runTransaction
    }
  ] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js")
  ]);

  const app = initializeApp(cfg.firebase, "egp-galeria-admin");
  const db = getFirestore(app);
  const ref = doc(db, "config", "estado");

  const estado = $("#egpGaleriaEstado");
  const lista = $("#egpGaleriaAdminLista");


  function mensaje(t){
    estado.textContent = t;
  }


  async function leerGaleria(){
    const snap = await getDoc(ref);
    const data = snap.exists() ? snap.data() : {};
    return Array.isArray(data.galeria_media)
      ? data.galeria_media
      : [];
  }


  async function render(){
    let items=[];

    try{
      items = await leerGaleria();
    }catch(e){
      mensaje("No se pudo cargar la galería.");
      return;
    }

    items.sort(
      (a,b) => Number(b.createdAt||0)-Number(a.createdAt||0)
    );

    if(!items.length){
      lista.innerHTML =
        `<div class="egp-galeria-vacia">
           Todavía no hay fotos ni videos.
         </div>`;
      return;
    }

    lista.innerHTML = items.map(item => `
      <article class="egp-galeria-item">
        ${
          item.tipo === "video"
          ? `<video src="${item.url}" preload="metadata"></video>`
          : `<img src="${item.url}" alt="">`
        }

        <div>
          <strong>
            ${item.tipo === "video" ? "VIDEO" : "FOTO"}
          </strong>
          <small>
            ${new Date(Number(item.createdAt||Date.now()))
              .toLocaleDateString("es-EC")}
          </small>
        </div>

        <button
          type="button"
          class="egp-quitar-media"
          data-id="${item.id}">
          QUITAR
        </button>
      </article>
    `).join("");
  }


  async function subir(file, tipo){

    if(!navigator.onLine){
      mensaje("Necesitas Internet para subir a la galería.");
      return;
    }

    mensaje("Subiendo…");

    const fd = new FormData();
    fd.append("file", file);
    fd.append("upload_preset", UPLOAD_PRESET);

    const endpoint =
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${tipo}/upload`;

    const res = await fetch(endpoint,{
      method:"POST",
      body:fd
    });

    const data = await res.json();

    if(!res.ok || !data.secure_url){
      throw new Error(data?.error?.message || "Falló la subida");
    }

    const item = {
      id:
        (crypto.randomUUID
          ? crypto.randomUUID()
          : String(Date.now())+"-"+Math.random()),
      tipo,
      url:data.secure_url,
      publicId:data.public_id || "",
      createdAt:Date.now()
    };

    await runTransaction(db, async tx => {

      const snap = await tx.get(ref);

      const actual =
        snap.exists() &&
        Array.isArray(snap.data().galeria_media)
          ? snap.data().galeria_media
          : [];

      tx.set(
        ref,
        {
          galeria_media:[
            ...actual,
            item
          ]
        },
        {merge:true}
      );

    });

    mensaje("Guardado exitosamente");
    await render();
  }


  boton.addEventListener("click", async ()=>{

    menu.hidden = true;

    dialog.showModal();

    mensaje("Cargando…");

    await render();

    mensaje("");
  });


  $("#egpGaleriaCerrar").addEventListener("click", ()=>{

    if(confirm("¿Cerrar la galería?")){
      dialog.close();
    }

  });


  $("#egpSubirFoto").addEventListener(
    "click",
    ()=>$("#egpGaleriaInputFoto").click()
  );


  $("#egpSubirVideo").addEventListener(
    "click",
    ()=>$("#egpGaleriaInputVideo").click()
  );


  $("#egpGaleriaInputFoto").addEventListener(
    "change",
    async e => {

      const file=e.target.files?.[0];
      if(!file)return;

      try{
        await subir(file,"image");
      }catch(err){
        mensaje("Error: "+(err.message||"No se pudo subir"));
      }

      e.target.value="";
    }
  );


  $("#egpGaleriaInputVideo").addEventListener(
    "change",
    async e => {

      const file=e.target.files?.[0];
      if(!file)return;

      try{
        await subir(file,"video");
      }catch(err){
        mensaje("Error: "+(err.message||"No se pudo subir"));
      }

      e.target.value="";
    }
  );


  lista.addEventListener("click", async e => {

    const b=e.target.closest(".egp-quitar-media");
    if(!b)return;

    if(!confirm(
      "¿Quitar este archivo de la galería pública?"
    )) return;

    const id=b.dataset.id;

    await runTransaction(db, async tx => {

      const snap=await tx.get(ref);

      const actual =
        snap.exists() &&
        Array.isArray(snap.data().galeria_media)
          ? snap.data().galeria_media
          : [];

      tx.set(
        ref,
        {
          galeria_media:
            actual.filter(x=>x.id!==id)
        },
        {merge:true}
      );

    });

    mensaje("Guardado exitosamente");
    await render();
  });
}

window.addEventListener(
  "DOMContentLoaded",
  ()=>iniciarGaleriaAdmin().catch(console.error)
);
