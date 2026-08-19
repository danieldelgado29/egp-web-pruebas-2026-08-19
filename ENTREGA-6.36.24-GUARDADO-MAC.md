# Entrega 6.36.24 - Guardado Mac y Firestore

- Las capas de imagen se guardan dentro de `config/estado.imageEdits`, ruta permitida por las reglas actuales.
- Se eliminó la escritura en documentos `config/imageEdit_*`, que Firestore bloqueaba por permisos.
- Guardar espera confirmación remota con límite de 15 segundos.
- Tras guardar correctamente, el editor limpia el estado de cambios y se cierra.
- Caché PWA actualizada.
