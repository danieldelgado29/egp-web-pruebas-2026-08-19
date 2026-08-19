# Entrega 6.36.87 — Reordenar Cola activa

Base: ZIP recibido 2026-08-10.

Cambio único funcional:
- Pulsación/click sostenido de 500 ms sobre el nombre de una canción de Cola activa.
- Arrastrar arriba/abajo y soltar para cambiar el orden.
- Compatible mediante Pointer Events con iPhone, Android, mouse/trackpad Mac y mouse/touchpad Windows.
- Los botones Tocada/Quitar quedan fuera del gesto.
- Un drag no dispara click/doble-click residual.
- Guardado con transacción Firestore contra la cola remota más reciente.
- Si otro dispositivo retiró la canción durante el gesto, no se vuelve a insertar.
- Si otro dispositivo añadió/quitó canciones, se conservan al calcular la nueva posición.
- Snapshots remotos de cola se aplazan mientras se arrastra/guarda para evitar que la tarjeta desaparezca.
- Atajo accesible: Alt + Flecha Arriba/Abajo con el nombre enfocado.

No se modificó index.html, panel.html estructural, script.js, editores, cronómetro, repertorios ni Bridge.

Versionado PWA coherente a 6.36.87 únicamente para asegurar que panel.js/panel.css nuevos lleguen a los dispositivos.
