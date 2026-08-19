# Entrega 6.36.89 — Cronómetro corregido

Base: 6.36.88.

## Cambio funcional
Solo se reparó la semántica de sincronización del cronómetro.

- `elapsedMs` remoto ahora significa únicamente tiempo acumulado antes del tramo actual.
- `startedAt` representa el comienzo del tramo que está corriendo.
- Ya no se publica `showTimerTotalMs()` junto con el mismo `startedAt`.
- Se introduce `cronometro_schema: 2`.
- Estado local antiguo sin schema 2 se sanea sin tocar cola/show/repertorio.
- Estado remoto antiguo se migra reiniciando únicamente el cronómetro a 00:00:00.
- Si el show estaba corriendo, continúa corriendo desde 00:00:00; si estaba pausado, queda pausado.

## No modificado
- index.html
- panel.css
- script.js
- Cola activa
- reordenamiento Mac/iPhone/Android
- Bridge Logic
- repertorios
- editores Elena/Daniel
- buscador
- navegación
- Firebase Rules

## Validaciones
- `node --check panel.js`
- `node --check pwa.js`
- `node --check script.js`
- panel.css, script.js e index.html comparados byte a byte contra 6.36.88
- versionado PWA coherente en 6.36.89

## Primera apertura
Como el reloj remoto actual está en formato antiguo y ya está inflado, 6.36.89 lo reiniciará una sola vez a 00:00:00. No reinicia el show ni la cola.
