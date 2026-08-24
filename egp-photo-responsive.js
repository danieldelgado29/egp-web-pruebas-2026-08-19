/*
 EGP FOTO RESPONSIVE
 Resuelve automáticamente las variantes __desktop / __mobile
 para TODO código existente que lea:
 - egm-photo-originals
 - egm-photo-settings

 No modifica los datos guardados.
*/

(function(){

  const nativeGetItem =
    Storage.prototype.getItem;

  function isMobileDevice(){
    return /iPhone|iPad|iPod|Android|Mobile|Windows Phone/i
      .test(navigator.userAgent || '');
  }

  const target =
    isMobileDevice()
      ? 'mobile'
      : 'desktop';

  function resolveVariants(raw){
    let data;

    try{
      data = JSON.parse(raw || '{}');
    }catch(_){
      return raw;
    }

    if(
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data)
    ){
      return raw;
    }

    const result = {...data};

    /*
     * Cada clave antigua sigue funcionando como fallback.
     * Si existe variante específica, tiene prioridad.
     */
    Object.keys(data).forEach(key => {

      if(
        key.endsWith('__desktop') ||
        key.endsWith('__mobile')
      ){
        return;
      }

      const variant =
        key + '__' + target;

      if(data[variant] !== undefined){
        result[key] = data[variant];
      }
    });

    return JSON.stringify(result);
  }

  Storage.prototype.getItem = function(key){

    const raw =
      nativeGetItem.call(this,key);

    if(
      key === 'egm-photo-originals' ||
      key === 'egm-photo-settings'
    ){
      return resolveVariants(raw);
    }

    return raw;
  };

})();
