# Entrega 6.36.69.1 — Reparación de infraestructura

Base: 6.36.69.

Cambios limitados a sincronización y PWA:

- Nueva versión de caché `egm-v6.36.69.1-repair` para retirar código antiguo de la app instalada.
- Estado del show, cola y cronómetro se escriben sin volver a enviar la biblioteca completa.
- Biblioteca/repertorios usan una cola de escritura independiente.
- Las escrituras de show se ejecutan en orden para evitar que una respuesta anterior sobrescriba otra nueva.
- Protección temporal al comenzar/finalizar para que un snapshot remoto antiguo no cambie de pantalla.
- Finalizar show confirma `show_activo: false`, vacía cola/tocadas y reinicia cronómetro.
- `imageEdits` permanece independiente y no fue modificado.
- Marcador de versión: `6.36.69.1`.
