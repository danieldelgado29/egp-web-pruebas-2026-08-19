# Entrega 6.36.73 — Reparación de sincronización

- Evita que un snapshot remoto antiguo saque al panel de Control en vivo justo después de comenzar un show.
- Finalizar show vuelve a publicar `show_activo: false`, vacía cola y reinicia cronómetro para todos los dispositivos.
- La verificación remota comprueba ahora tanto `show_activo` como el repertorio.
- Con internet, `imageEdits` remoto vuelve a ser la fuente compartida; se elimina la comparación de relojes locales entre dispositivos que podía mantener una copia antigua.
- No se modificó la interfaz del editor.
