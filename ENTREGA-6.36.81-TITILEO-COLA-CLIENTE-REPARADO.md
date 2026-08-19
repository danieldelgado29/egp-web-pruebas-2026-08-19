# Entrega 6.36.81 — Titileo de cola en cliente reparado

- La tarjeta pública recibe una clase explícita cuando su estado sincronizado es `cola`.
- La animación se inyecta también desde `script.js`, evitando depender únicamente de una hoja CSS que pueda permanecer cacheada en una PWA instalada.
- La animación se elimina automáticamente cuando la canción deja la cola porque las tarjetas se vuelven a renderizar con el estado remoto.
- Se actualiza el Service Worker del panel para forzar la renovación de recursos sin interferir con la PWA independiente EGP MUSICOS.
- `index.html` y la navegación no fueron modificados.
