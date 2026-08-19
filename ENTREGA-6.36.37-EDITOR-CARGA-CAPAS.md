# Entrega 6.36.37 — Editor carga las capas guardadas

- Editor y visor usan `imageEdits/{owner-songId}` como fuente oficial.
- Las capas remotas prevalecen sobre copias antiguas del objeto canción.
- El editor reconstruye foto, trazos, borrados y cajas de texto.
- Un lienzo blanco también reproduce las operaciones guardadas.
- Se evita usar la previsualización compuesta como foto base editable.
