# Entrega 6.36.48 – Refresco inmediato del visor

- El guardado devuelve la edición recién persistida.
- El editor se cierra antes de reconstruir el visor.
- El visor usa inmediatamente la copia local recién guardada, sin esperar otra lectura de Firestore.
- Se conserva la sincronización remota en segundo plano.
