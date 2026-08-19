# Entrega 6.36.27 — Guardado independiente de anotaciones

- Cada edición se guarda en su propio documento: `imageEdits/{owner-songId}`.
- El editor y el visor leen la misma fuente remota.
- Se mantiene lectura de compatibilidad del campo antiguo `config/estado.imageEdits` para migración.
- `localStorage` queda como respaldo local, no como fuente oficial al abrir o visualizar.
- No se guardan PNG ni Base64 en Firestore.
- Incluye `firestore.rules`; estas reglas deben publicarse en Firebase Console para permitir la colección nueva.
