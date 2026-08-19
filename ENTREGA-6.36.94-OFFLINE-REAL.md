# 6.36.94 — Offline real restaurado

- Panel vuelve a precargar interfaz, datos, letras y todas las imágenes/anotaciones para abrir sin red después de una primera carga completa desde HTTPS.
- Se eliminó el borrado automático de caché introducido en 6.36.93.
- EGP MÚSICOS ya no depende de importar Firebase para poder arrancar offline; conserva el último estado recibido.
- Las canciones tocadas no se muestran en Cola activa de EGP MÚSICOS.
- El Bridge/Local Core no es requisito para abrir las apps.
- Local Core se mantiene como capa de sincronización cuando la red EGP está disponible; esta entrega prioriza recuperar primero la apertura offline independiente.
