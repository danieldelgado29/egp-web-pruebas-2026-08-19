# Entrega 6.36.26

- El visor espera primero la edición remota de Firestore antes de mostrar la foto base.
- El guardado escribe directamente el campo específico de la canción en `config/estado.imageEdits`.
- Las ediciones remotas se incorporan al estado del panel al recibir cambios de Firestore.
- Zoom de trackpad y rueda suavizado, con límites por evento para evitar saltos bruscos.
- Se retiraron etiquetas visibles/accesibles de capa que podían aparecer en la interfaz.
