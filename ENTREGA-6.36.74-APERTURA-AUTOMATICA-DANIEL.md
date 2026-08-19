# Entrega 6.36.74 — Apertura automática Imagen Daniel

- La detección ya no depende del campo antiguo `notasDaniel`.
- Consulta primero la copia en memoria y luego `imageEdits/daniel-<songId>` mediante Firestore/IndexedDB.
- Espera la carga antes de decidir si abre el visor.
- Abre cuando existe foto, dibujo o caja de texto.
- Conserva compatibilidad temporal con datos antiguos.
- No modifica scroll, cola, cronómetro, editores ni app de músicos.
