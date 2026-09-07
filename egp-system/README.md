# EGP_UPDATE_AUTHORITY_V1

Fuente de versión del sistema fuerte EGP.

## Autoridad de actualización
Internet/GitHub es la autoridad de release.

## Qué pertenece al SYSTEM RELEASE
- Web pública fuerte
- Panel
- EGP Músicos
- Caddy web / variantes declaradas
- Local Core
- Cloud Sync
- Caddyfile

## Bridge
Bridge NO se actualiza automáticamente con SYSTEM RELEASE.
Sí participa en la verificación de compatibilidad mediante
`bridge/compatibility.json`.

## Reglas
1. Ninguna release se considera completa si una superficie afectada queda en otra versión.
2. Toda variante debe estar declarada en `release.json`.
3. Caddy no puede conservar una modificación manual no declarada.
4. LAN no puede conservar una copia vieja independiente.
5. Si no hay Internet, se conserva la última release completa.
6. Primero se descarga/stagea toda la release y se verifican hashes.
7. Solo después se aplica.
8. Si falla la aplicación o verificación, se revierte.
9. Las PWAs deben actualizarse sin limpieza manual de caché ni reinstalación.
10. Bridge se bloquea solo si el contrato Core requerido deja de ser compatible.

## Descarga inmutable

`release.json` se descubre desde `main`, pero los archivos de una release
se descargan exclusivamente desde `payload_ref`, que es un commit Git
inmutable. El agente nunca instala archivos directamente desde el `main`
móvil. Cada archivo debe coincidir con su SHA-256 declarado antes de aplicar.

Esto evita una release mezclada si `main` cambia mientras una Mac está
descargando una actualización.

