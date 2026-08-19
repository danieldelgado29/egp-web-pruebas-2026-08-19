# Entrega 6.36.47 — Guardado iPhone

- Restaura el flujo de guardado confirmado que funcionaba antes de 6.36.46.
- Muestra “Guardando…” al confirmar.
- Guarda primero en IndexedDB y luego en `imageEdits`.
- El editor solo se cierra después de confirmar la copia local.
- Si no hay conexión, conserva la edición pendiente de sincronización.
