# 6.36.90

Base: 6.36.89.

## Cola activa
- primera pendiente = protegida;
- futuras reordenables solo debajo;
- Tocadas siempre al final;
- una Tocada nueva baja al final;
- quitar Tocada devuelve la canción como última pendiente;
- una canción nueva entra al final de pendientes, antes de Tocadas;
- Tocadas y canción protegida no son arrastrables;
- la transacción Firestore vuelve a validar la cabeza protegida;
- si el Bridge cambia `tocadas`, el panel normaliza pendientes + Tocadas al recibir el snapshot.

## Cronómetro
6.36.89 todavía podía aceptar un valor inflado ya etiquetado como schema 2.
6.36.90:
- schema 3;
- saneamiento físico usando `inicio_show`;
- si el reloj recibido excede el tiempo posible del show por más de 30 s,
  reinicia SOLO el cronómetro a 00:00:00 y publica el estado saneado.

## Intacto
- index.html byte por byte;
- script.js byte por byte;
- Bridge;
- EGP MÚSICOS;
- editores;
- repertorios;
- navegación.

## Prueba prioritaria
1. Abrir panel: el reloj inflado debe sanearse.
2. Cola A/B/C: A muestra Actual y no se puede arrastrar.
3. Mover B/C: nunca por encima de A.
4. Marcar A Tocada: A baja al final y B pasa a Actual.
5. Quitar Tocada a A: A vuelve al final de pendientes.
