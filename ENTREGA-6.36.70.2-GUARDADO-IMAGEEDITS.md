# Entrega 6.36.70.2 — Guardado seguro de imageEdits

- Elimina estado temporal del DOM antes de guardar cajas en Firestore.
- Una copia remota antigua no reemplaza cambios locales pendientes.
- Unifica la escala del texto entre editor, visor y reapertura.
- Conserva trazos, cajas, formato, posición, giro y alineación.
- No modifica el estado del show, cronómetro ni repertorios.
