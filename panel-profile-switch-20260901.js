"use strict";

/*
 * EGP_PROFILE_SWITCH_HEADER_V1
 * Usa el mismo panelUserSelect existente.
 * No crea otra configuración de usuario.
 */
(function(){

  function instalar(){
    const configView=document.getElementById("configView");
    const heading=configView?.querySelector(".section-heading");
    const select=document.getElementById("panelUserSelect");

    if(!configView || !heading || !select) return false;

    /* Quitar visualmente el sector viejo */
    const oldField=select.closest("label.field");
    if(oldField){
      oldField.hidden=true;
      oldField.setAttribute("aria-hidden","true");
    }

    if(document.getElementById("panelUserQuickSwitch")){
      return true;
    }

    const wrap=document.createElement("div");
    wrap.id="panelUserQuickSwitch";
    wrap.className="panel-user-quick-switch";
    wrap.setAttribute("role","group");
    wrap.setAttribute("aria-label","Perfil de este dispositivo");

    wrap.innerHTML=`
      <button
        id="panelUserElenaQuick"
        class="panel-user-name"
        type="button"
        aria-pressed="false"
      >Elena</button>

      <label
        class="panel-profile-switch"
        aria-label="Cambiar entre Elena y Daniel"
      >
        <input
          id="panelUserToggleQuick"
          type="checkbox"
          role="switch"
          aria-label="Perfil Daniel"
        >
        <span
          class="panel-profile-switch__track"
          aria-hidden="true"
        ></span>
      </label>

      <button
        id="panelUserDanielQuick"
        class="panel-user-name"
        type="button"
        aria-pressed="false"
      >Daniel</button>
    `;

    heading.appendChild(wrap);

    const style=document.createElement("style");
    style.id="EGP_PROFILE_SWITCH_HEADER_V1_STYLE";

    style.textContent=`
      #configView .section-heading{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:14px;
      }

      #panelUserQuickSwitch{
        margin-left:auto;
        display:flex;
        align-items:center;
        justify-content:flex-end;
        gap:7px;
        flex:0 0 auto;
      }

      #panelUserQuickSwitch .panel-user-name{
        -webkit-appearance:none;
        appearance:none;
        border:1px solid transparent;
        background:transparent;
        color:var(--muted,#949aa7);
        padding:6px 8px;
        border-radius:10px;
        font:850 13px/1 -apple-system,BlinkMacSystemFont,
          "SF Pro Display","Segoe UI",sans-serif;
        cursor:pointer;
        opacity:.48;
        transition:
          color .16s ease,
          background .16s ease,
          border-color .16s ease,
          box-shadow .16s ease,
          text-shadow .16s ease,
          opacity .16s ease;
      }

      #panelUserQuickSwitch .panel-user-name.is-active{
        color:#fff0b4;
        background:rgba(242,201,109,.13);
        border-color:rgba(242,201,109,.48);
        box-shadow:
          0 0 17px rgba(242,201,109,.22),
          inset 0 0 10px rgba(242,201,109,.05);
        text-shadow:0 0 11px rgba(242,201,109,.78);
        opacity:1;
      }

      #panelUserQuickSwitch .panel-profile-switch{
        position:relative;
        display:block;
        width:50px;
        height:28px;
        flex:0 0 50px;
        cursor:pointer;
        -webkit-tap-highlight-color:transparent;
      }

      #panelUserQuickSwitch .panel-profile-switch input{
        position:absolute;
        width:1px;
        height:1px;
        opacity:0;
        pointer-events:none;
      }

      #panelUserQuickSwitch .panel-profile-switch__track{
        position:absolute;
        inset:0;
        border-radius:999px;
        border:1px solid #3b404a;
        background:#20232a;
        box-shadow:inset 0 1px 3px rgba(0,0,0,.48);
        transition:.18s ease;
      }

      #panelUserQuickSwitch
      .panel-profile-switch__track::after{
        content:"";
        position:absolute;
        width:22px;
        height:22px;
        left:2px;
        top:2px;
        border-radius:50%;
        background:#ffffff;
        box-shadow:0 2px 7px rgba(0,0,0,.42);
        transition:.18s ease;
      }

      #panelUserQuickSwitch
      .panel-profile-switch input:checked
      + .panel-profile-switch__track{
        background:#20232a;
        border-color:#3b404a;
        box-shadow:inset 0 1px 3px rgba(0,0,0,.48);
      }

      #panelUserQuickSwitch
      .panel-profile-switch input:checked
      + .panel-profile-switch__track::after{
        transform:translateX(22px);
        background:#ffffff;
        box-shadow:0 2px 7px rgba(0,0,0,.42);
      }

      @media(max-width:520px){
        #configView .section-heading{
          gap:7px;
        }

        #configView .section-heading h2{
          font-size:20px;
          white-space:nowrap;
        }

        #panelUserQuickSwitch{
          gap:4px;
        }

        #panelUserQuickSwitch .panel-user-name{
          font-size:12px;
          padding:5px;
        }

        #panelUserQuickSwitch .panel-profile-switch{
          width:44px;
          height:26px;
          flex-basis:44px;
        }

        #panelUserQuickSwitch
        .panel-profile-switch__track::after{
          width:20px;
          height:20px;
        }

        #panelUserQuickSwitch
        .panel-profile-switch input:checked
        + .panel-profile-switch__track::after{
          transform:translateX(18px);
        }
      }

      @media(max-width:360px){
        #configView .section-heading h2{
          font-size:18px;
        }

        #panelUserQuickSwitch .panel-user-name{
          font-size:11px;
          padding:4px;
        }
      }
    `;

    document.head.appendChild(style);

    const toggle=document.getElementById("panelUserToggleQuick");
    const elena=document.getElementById("panelUserElenaQuick");
    const daniel=document.getElementById("panelUserDanielQuick");

    function render(){
      const isDaniel=select.value==="daniel";

      toggle.checked=isDaniel;

      elena.classList.toggle("is-active",!isDaniel);
      daniel.classList.toggle("is-active",isDaniel);

      elena.setAttribute(
        "aria-pressed",
        String(!isDaniel)
      );

      daniel.setAttribute(
        "aria-pressed",
        String(isDaniel)
      );
    }

    function elegir(perfil){
      const nuevo=perfil==="daniel"
        ? "daniel"
        : "elena";

      if(select.value!==nuevo){
        select.value=nuevo;

        /*
         * El Panel original recibe el mismo change que recibía
         * cuando se usaba el selector viejo.
         */
        select.dispatchEvent(
          new Event("change",{bubbles:true})
        );
      }

      render();
      requestAnimationFrame(render);
      setTimeout(render,80);
    }

    toggle.addEventListener("change",function(){
      elegir(
        toggle.checked
          ? "daniel"
          : "elena"
      );
    });

    elena.addEventListener("click",function(){
      elegir("elena");
    });

    daniel.addEventListener("click",function(){
      elegir("daniel");
    });

    select.addEventListener("change",render);

    /*
     * refreshPanelProfileControls() del Panel también actualiza
     * data-panel-user. Esto mantiene la indicación sincronizada.
     */
    new MutationObserver(render).observe(
      document.body,
      {
        attributes:true,
        attributeFilter:["data-panel-user"]
      }
    );

    render();

    console.info(
      "EGP_PROFILE_SWITCH_HEADER_V1 activo"
    );

    return true;
  }

  function iniciar(){
    if(instalar()) return;

    let intentos=0;

    const timer=setInterval(function(){
      intentos++;

      if(instalar() || intentos>40){
        clearInterval(timer);
      }
    },100);
  }

  if(document.readyState==="loading"){
    document.addEventListener(
      "DOMContentLoaded",
      iniciar,
      {once:true}
    );
  }else{
    iniciar();
  }

})();
