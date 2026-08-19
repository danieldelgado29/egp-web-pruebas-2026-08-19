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


  $('#fullscreenBtn').addEventListener('click',async()=>{
    const card=$('.viewer-card');

    try{
      if(document.fullscreenElement){
        await document.exitFullscreen();
      }else{
        await card.requestFullscreen();
      }
    }catch(_){}
  });


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
