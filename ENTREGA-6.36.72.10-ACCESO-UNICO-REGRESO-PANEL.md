# Entrega 6.36.72.10

- El acceso secreto valida la contraseña una sola vez.
- `panel.html` recibe la autorización de la misma pestaña y no vuelve a pedir contraseña.
- Al cerrar el panel con X, la página pública muestra `← Panel`.
- Esa flecha solo aparece cuando se regresó desde el panel (`?panel=1`).
- La flecha vuelve al panel sin pedir contraseña dentro de la misma pestaña.
- No se modificó el módulo de scroll estable de la 6.36.72.9.
