# Entrega 6.36.72.9 — Tabla dentro de contenedor de scroll

- Se añadió `song-table-region` para separar encabezado y cuerpo.
- El scroll vive en `song-scroll-region`, no en la tabla/lista.
- La lista usa filas `max-content` y `align-content:start` para evitar que las canciones se compriman o estiren.
- Se conserva fija la barra superior, Cola activa, buscador y encabezado.
- No se modificó Firebase, editores, cronómetro ni sincronización.
