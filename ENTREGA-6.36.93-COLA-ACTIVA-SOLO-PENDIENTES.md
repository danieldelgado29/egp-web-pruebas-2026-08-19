# 6.36.93 — Cola activa solo pendientes

Cambio:
- La lista **Cola activa** del Panel muestra únicamente canciones pendientes.
- Una canción marcada **Tocada** desaparece de esa lista inmediatamente.
- Las Tocadas NO se borran de Firebase; siguen disponibles como estado/historial.
- Una canción nueva aparece al final de las pendientes visibles, nunca debajo de Tocadas visibles.
- El reordenamiento conserva internamente las Tocadas ocultas.

Compatibilidad revisada por código:
- iPhone / iPad: Pointer Events y doble toque existentes intactos.
- Android: Pointer Events, long press y pointer capture intactos.
- macOS: mouse, trackpad y teclado Alt+flechas intactos.
- Windows: mouse, touchpad y teclado Alt+flechas intactos.
- PWA/cache: versión 6.36.93 fuerza actualización coherente.

No modificado:
- Bridge Logic
- Firebase/schema
- cliente público (se conserva la corrección cola - tocadas)
- repertorios
- cronómetro
- editores
- diseño/CSS
- EGP Músicos
