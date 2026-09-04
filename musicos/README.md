# EGP MÚSICOS — sistema fuerte (.com)

URL canónica: `https://elenagirjoaba.com/musicos/`

- Esta app pertenece únicamente al sistema fuerte `.com`.
- La versión 1.6 está congelada y no participa en esta app.
- Conectada al router EGP: `Local Core` es la fuente prioritaria.
- Fuera del router: `Firebase` fuerte funciona como fallback/sincronización.
- Si Core está disponible, Firebase no debe pintar por encima del estado de Core.
- La app es de solo lectura para la cola/show; no incluye controles administrativos.
- El Service Worker mantiene la base necesaria para abrir la PWA sin Internet.
- Android: instalación desde Chrome.
- iPhone: Compartir → Agregar a inicio.

Flujo esperado:

`Panel LAN → Local Core → EGP Músicos`

`Panel Internet → Firebase → Local Core → EGP Músicos`

La PWA fuerte nunca debe usar rutas, Firebase ni almacenamiento pertenecientes a 1.6.
