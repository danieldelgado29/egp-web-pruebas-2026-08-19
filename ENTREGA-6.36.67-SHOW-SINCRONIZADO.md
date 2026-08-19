# Entrega 6.36.67 — Show activo sincronizado

- El show activo en Firestore es la fuente única para todos los dispositivos.
- Tras ingresar la contraseña, un dispositivo entra directo al Control en vivo si ya existe un show activo.
- Cola, tocadas, configuración y cronómetro se actualizan con onSnapshot.
- Comenzar show abre Control en vivo inmediatamente y sincroniza en segundo plano.
- Finalizar show devuelve todos los dispositivos a configuración y reinicia el cronómetro.
