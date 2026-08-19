# Entrega 6.36.69.4 — Estado único del show

- Versionado unificado en panel, PWA, service worker y version.json.
- Finalizar show publica directamente el cierre global y no depende de colas anteriores.
- Cualquier dispositivo vuelve a Configuración al recibir show_activo=false.
- Cambio de repertorio durante un show se sincroniza sin reiniciar cola ni cronómetro.
- El cronómetro publica solo sus campos y no sobrescribe otros datos del show.
- Con internet, imageEdits remoto es la fuente compartida entre dispositivos.
