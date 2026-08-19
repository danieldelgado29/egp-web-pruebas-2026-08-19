# Entrega 6.36.75.4 · Reparación de regresiones

- Panel Android: se conserva intacta la estructura de scroll estable 6.36.72.9 y se corrige la mezcla de builds PWA/caché que podía servir CSS/JS antiguos.
- Service Workers: el panel ya no desregistra el Service Worker de `/musicos/`; cada PWA mantiene su propio registro y caché.
- Daniel: la apertura automática de Imagen solo considera foto original real, trazos de lápiz reales o cajas con texto. `composite` y `overlay` no cuentan como contenido.
- EGP MUSICOS: caché 1.1.3, primera canción con pulso más evidente y canciones tocadas más delgadas, grises y al final.
- No se modifica index.html ni la navegación.
