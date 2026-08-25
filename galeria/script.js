(() => {

  const STORAGE_KEY='egp-gallery-items-v1';

  const $=s=>document.querySelector(s);
  const $$=s=>[...document.querySelectorAll(s)];

  let activeTab='image';
  let currentItem=null;

  function loadItems(){
    try{
      const data=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');
      return Array.isArray(data)?data:[];
    }catch(_){
      return [];
    }
  }

  function videoThumb(url){
    if(!url)return '';

    return url
      .replace(
        '/video/upload/',
        '/video/upload/so_10p,w_700,h_520,c_fill,q_auto,f_jpg/'
      )
      .replace(/\.[^/.]+$/i,'.jpg');
  }

  function render(){

    const items=loadItems();

    const photos=items.filter(x=>x.type==='image');
    const videos=items.filter(x=>x.type==='video');

    $('#photoCount').textContent=photos.length;
    $('#videoCount').textContent=videos.length;

    const visible=
      activeTab==='video'
        ? videos
        : photos;

    const grid=$('#galleryGrid');
    grid.textContent='';

    if(!visible.length){
      const empty=document.createElement('div');
      empty.className='empty';
      empty.textContent=
        activeTab==='video'
          ? 'Todavía no hay videos.'
          : 'Todavía no hay fotos.';
      grid.appendChild(empty);
      return;
    }

    [...visible].reverse().forEach(item=>{

      const card=document.createElement('article');
      card.className='gallery-item';

      const media=document.createElement('div');
      media.className='media';

      const img=document.createElement('img');

      img.src=
        item.type==='video'
          ? videoThumb(item.url)
          : item.url;

      img.alt=item.name||'Galería';
      img.loading='lazy';

      const rotation=Number(item.rotation||0);
      img.style.transform=`rotate(${rotation}deg)`;

      media.appendChild(img);

      if(item.type==='video'){
        const play=document.createElement('span');
        play.className='play-badge';
        play.textContent='▶';
        media.appendChild(play);
      }

      const info=document.createElement('div');
      info.className='item-info';

      const name=document.createElement('strong');
      name.textContent=item.name||(
        item.type==='video'?'Video':'Foto'
      );

      const meta=document.createElement('span');
      meta.textContent=
        item.type==='video'
          ? 'VIDEO'
          : 'FOTO';

      info.append(name,meta);

      card.append(media,info);

      card.addEventListener('click',()=>{
        openViewer(item);
      });

      grid.appendChild(card);
    });
  }


  function formatTime(sec){
    if(!Number.isFinite(sec))return '0:00';

    const total=Math.floor(sec);

    return (
      Math.floor(total/60)+
      ':'+
      String(total%60).padStart(2,'0')
    );
  }


  function fitMedia(media,rotation){

    media.dataset.rotation=String(rotation);

    const stage=$('#viewerStage');

    const isVideo=media.tagName==='VIDEO';

    const sourceW=isVideo
      ? media.videoWidth
      : media.naturalWidth;

    const sourceH=isVideo
      ? media.videoHeight
      : media.naturalHeight;

    if(!sourceW || !sourceH)return;

    const w=Math.max(1,stage.clientWidth-30);
    const h=Math.max(1,stage.clientHeight-30);

    const sideways=
      rotation===90 ||
      rotation===270;

    const visualW=sideways?sourceH:sourceW;
    const visualH=sideways?sourceW:sourceH;

    const scale=Math.min(
      w/visualW,
      h/visualH,
      1
    );

    media.style.width=sourceW+'px';
    media.style.height=sourceH+'px';

    media.style.transform=
      `translate(-50%,-50%) rotate(${rotation}deg) scale(${scale})`;
  }


  function syncControls(){

    const video=$('#viewerVideo');

    $('#playBtn').textContent=
      video.paused?'▶':'❚❚';

    $('#currentTime').textContent=
      formatTime(video.currentTime);

    $('#durationTime').textContent=
      formatTime(video.duration);

    $('#videoProgress').value=
      Number.isFinite(video.duration) && video.duration
        ? Math.round(video.currentTime/video.duration*1000)
        : 0;

    $('#muteBtn').textContent=
      video.muted?'🔇':'🔊';
  }


  function openViewer(item){

    currentItem=item;

    const viewer=$('#viewer');
    const img=$('#viewerImage');
    const video=$('#viewerVideo');
    const controls=$('#videoControls');

    const rotation=Number(item.rotation||0);

    img.hidden=true;
    video.hidden=true;
    controls.hidden=true;

    img.removeAttribute('src');

    video.pause();
    video.removeAttribute('src');
    video.load();

    viewer.showModal();

    if(item.type==='video'){

      video.onloadedmetadata=()=>{
        fitMedia(video,rotation);
        syncControls();
      };

      video.src=item.url;
      video.hidden=false;
      controls.hidden=false;
      video.load();

    }else{

      img.onload=()=>{
        fitMedia(img,rotation);
      };

      img.src=item.url;
      img.hidden=false;
    }
  }



  /* EGP-GALERIA-LIVE-REFRESH-V3 */
  function egpGalleryRefreshFromSharedState(){

    const freshItems=loadItems();
    const viewer=$('#viewer');

    /*
     * Si hay una foto/video abierto, conservamos el visor.
     * Solo actualizamos sus datos, incluido rotation.
     */
    if(currentItem && viewer?.open){

      const fresh=freshItems.find(
        item=>String(item.id)===String(currentItem.id)
      );

      if(fresh){

        currentItem=fresh;

        const rotation=
          Number(fresh.rotation||0);

        const video=$('#viewerVideo');
        const img=$('#viewerImage');

        if(video && !video.hidden){
          fitMedia(video,rotation);
        }

        if(img && !img.hidden){
          fitMedia(img,rotation);
        }

      }else{

        $('#viewerVideo')?.pause();

        if(viewer.open){
          viewer.close();
        }

        currentItem=null;
      }
    }

    /*
     * Actualizamos miniaturas y contadores sin recargar.
     */
    render();
  }

  window.addEventListener(
    'egp-gallery-updated',
    egpGalleryRefreshFromSharedState
  );

  $$('.tabs button').forEach(btn=>{
    btn.addEventListener('click',()=>{

      activeTab=btn.dataset.tab;

      $$('.tabs button').forEach(x=>{
        x.classList.toggle('is-active',x===btn);
      });

      render();
    });
  });


  $('#viewerClose').addEventListener('click',()=>{
    $('#viewerVideo').pause();
    $('#viewer').close();
  });


  $('#playBtn').addEventListener('click',()=>{
    const video=$('#viewerVideo');

    if(video.paused){
      video.play().catch(()=>{});
    }else{
      video.pause();
    }
  });


  $('#viewerVideo').addEventListener('play',syncControls);
  $('#viewerVideo').addEventListener('pause',syncControls);
  $('#viewerVideo').addEventListener('timeupdate',syncControls);


  $('#videoProgress').addEventListener('input',e=>{

    const video=$('#viewerVideo');

    if(!Number.isFinite(video.duration))return;

    video.currentTime=
      Number(e.target.value)/1000*video.duration;
  });


  $('#muteBtn').addEventListener('click',()=>{
    const video=$('#viewerVideo');
    video.muted=!video.muted;
    syncControls();
  });


  /* EGP FULLSCREEN IPHONE V1 */
  function egpGalleryRefitViewer(){
    if(!$('#viewer').open || !currentItem)return;

    const rotation=Number(currentItem.rotation||0);

    if(currentItem.type==='video'){
      fitMedia($('#viewerVideo'),rotation);
    }else{
      fitMedia($('#viewerImage'),rotation);
    }
  }

  function egpGalleryIsIOS(){
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (
        navigator.platform==='MacIntel' &&
        navigator.maxTouchPoints>1
      );
  }

  $('#fullscreenBtn').addEventListener('click',async()=>{
    const viewer=$('#viewer');
    const card=$('.viewer-card');

    /*
     * En iPhone usamos pantalla completa visual.
     * Asi conservamos la rotacion aplicada al video.
     */
    if(
      egpGalleryIsIOS() ||
      typeof card.requestFullscreen!=='function'
    ){
      const active=
        viewer.classList.toggle(
          'egp-ios-fullscreen'
        );

      document.documentElement.classList.toggle(
        'egp-gallery-fullscreen-lock',
        active
      );

      document.body.classList.toggle(
        'egp-gallery-fullscreen-lock',
        active
      );

      requestAnimationFrame(()=>{
        requestAnimationFrame(
          egpGalleryRefitViewer
        );
      });

      return;
    }

    try{
      if(document.fullscreenElement){
        await document.exitFullscreen();
      }else{
        await card.requestFullscreen();
      }
    }catch(_){}
  });

  document.addEventListener(
    'fullscreenchange',
    ()=>{
      requestAnimationFrame(
        egpGalleryRefitViewer
      );
    }
  );


  window.addEventListener('resize',()=>{

    if(!$('#viewer').open || !currentItem)return;

    const rotation=Number(currentItem.rotation||0);

    if(currentItem.type==='video'){
      fitMedia($('#viewerVideo'),rotation);
    }else{
      fitMedia($('#viewerImage'),rotation);
    }
  });


  render();

})();
