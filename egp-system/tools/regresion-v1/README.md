# EGP REGRESION V1

Comprobador post-cambio.

- Producción se inspecciona en modo solo lectura.
- Antes del primer POST, el Core temporal debe demostrar por `/api/health` que su SQLite está dentro del directorio temporal y fuera de la SQLite viva; si no puede demostrarlo, la prueba aborta sin mutaciones.
- Los POST están bloqueados por código salvo hacia `127.0.0.1` en un puerto distinto de `8788` y únicamente a endpoints autorizados del sandbox.
- Las mutaciones (show, publicConfig, fotos, cola, tocada, reorder, custom songs, finalizar) se ejecutan únicamente contra una copia temporal de Local Core con SQLite temporal y puertos temporales.
- `/api/public-config` es POST-only en el contrato actual; su lectura se verifica mediante `/api/state.publicConfig`.
- Bridge se verifica por contrato/hash y nunca se modifica.
- 1.6 se verifica congelada.
- Las pruebas físicas quedan explícitamente marcadas MANUAL.

Flujo obligatorio:
1. EGP-PRE-CAMBIO antes de tocar.
2. Hacer el cambio.
3. Desplegar todas las superficies afectadas.
4. Ejecutar EGP-REGRESION.
5. Si falla, el cambio no se considera terminado.
6. Cerrar release/post-check.

