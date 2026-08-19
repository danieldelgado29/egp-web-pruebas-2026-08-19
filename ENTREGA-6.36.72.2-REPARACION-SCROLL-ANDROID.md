# Entrega 6.36.72.2 — Reparación scroll Android

Base: 6.36.72.1.

## Cambio

Se eliminó el bloque CSS final de la 6.36.72.1 que reasignaba el scroll al `body`, cambiaba `touch-action` y volvía a declarar las barras sticky. El panel vuelve a usar el flujo de desplazamiento original y las reglas sticky ya existentes.

## Conservado

- Cancionero Elena visual.
- Cancionero Daniel visual.
- Letra cliente.
- Sincronización del show.
- Cronómetro.
- Editor Imagen.

## Prueba rápida

1. Abrir panel en Android/PWA.
2. Iniciar show.
3. Desplazar la lista hacia abajo y arriba.
4. Confirmar que Cola activa y buscador permanecen fijos.
5. Abrir y cerrar Imagen/Letra/Daniel y repetir el desplazamiento.
