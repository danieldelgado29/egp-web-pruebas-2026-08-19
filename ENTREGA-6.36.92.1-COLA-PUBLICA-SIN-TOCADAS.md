# Entrega 6.36.92.1 — Cola pública sin Tocadas

Base: 6.36.92.

## Cambio único funcional

En la interfaz pública del cliente, la sección **Canciones a la cola** ahora muestra:

`cola - tocadas`

Por tanto, cuando el Bridge/Panel marca una canción como Tocada y Firebase actualiza
`config/estado.tocadas`, esa canción desaparece inmediatamente de la lista pública
**Canciones a la cola**, aunque su ID siga existiendo dentro de `cola`.

## No modificado

- `index.html`
- navegación
- diseño/CSS
- Panel
- Firebase/schema
- repertorios
- buscador
- WhatsApp
- EGP Músicos
- Bridge Logic
- PWA/service worker
- resto de `script.js`
