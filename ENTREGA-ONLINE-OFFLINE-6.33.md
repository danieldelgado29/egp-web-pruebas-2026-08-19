# Entrega 6.33 — actualización automática PWA

- Comprueba una versión nueva al abrir, volver a la app, recuperar conexión y cada 5 minutos.
- Fuerza la consulta sin caché de `version.json` y del Service Worker.
- Descarga la nueva versión completa antes de activarla.
- Activa el nuevo Service Worker automáticamente y recarga una sola vez.
- Conserva la última versión almacenada para funcionar sin internet.
- Mantiene los cambios de la entrega 6.32, incluido el icono EGP y los dobles toques.
