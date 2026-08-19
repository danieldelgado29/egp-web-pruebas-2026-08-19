# Entrega 6.36.54 — Refresco al cerrar el editor

- El visor abierto debajo se redibuja en el evento real `close` del editor.
- Cubre Guardar y luego X.
- Invalida lecturas antiguas para evitar que reaparezca la versión anterior.
- No modifica guardado, zoom ni herramientas.
