# Entrega 6.36.83 — Titileo real de cola en cliente

- Base: 6.36.80 estable proporcionada por el usuario.
- La animación se activa con una clase independiente calculada directamente desde `config/estado.cola`.
- Los IDs se comparan como texto para evitar diferencias de tipo.
- El pulso se dibuja en `::after`, por lo que no compite con `cardIn`, selección ni otras animaciones de la tarjeta.
- No se modifica el panel, los editores, Músicos, `index.html` ni la navegación.
