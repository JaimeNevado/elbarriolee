# El Barrio · Web de reseñas

Web de reseñas y encuentros del club. Se administra en el ordenador del administrador y se publica en GitHub Pages. No necesita base de datos ni instalar dependencias: solo Node 18 o superior.

## Panel de edición (lo normal)

Doble clic en **«El Barrio - Panel»** del escritorio. Arranca la web en este ordenador y abre el panel en Chrome, sin contraseña:

1. Crea o edita reseñas y encuentros con los botones de la barra verde y de cada página.
2. Cuando esté todo listo, pulsa **«Subir cambios a la web»**. Antes de subir enseña la lista de cambios; al confirmar, se suben a GitHub y elbarriolee.club se actualiza en uno o dos minutos.

Mientras no pulses el botón, nada de lo que cambies se ve en la web. El número rojo del botón indica cuántos cambios hay pendientes.

- Si el icono no está, se crea con `bash scripts/crear-app.sh`.
- El panel se queda funcionando en segundo plano hasta que se apaga el ordenador; volver a pulsar el icono solo abre la ventana.
- Si algo falla, los detalles quedan en `~/Library/Logs/elbarrio-panel.log`.
- Solo responde a este ordenador (`localhost`): ni otros equipos de la red ni otras webs pueden usarlo.

## Arrancar a mano (desarrollo)

| Orden | Para qué |
|---|---|
| `npm run panel` | El panel sin contraseña en <http://localhost:3000>. |
| `npm start` | La web local con contraseña de administración. |
| `npm run web-publica` | Genera en `_site/` la versión que se publica. |

## Dónde se guarda todo

- `data/resenas.json`: las reseñas y las opiniones de los lectores.
- `data/imagenes/`: las imágenes de cada reseña.
- `data/encuentros.json` y `data/encuentros/`: la sección «Literatura en 3D» (encuentros con autores y charlas), con las fotos y vídeos de cada entrada.
- `instagram/`: archivo de las publicaciones de Instagram (posts y reels). `publicaciones.json` tiene el texto de cada una y, si es una reseña, el `id` con el que aparece en `data/resenas.json`.

Para hacer una copia de seguridad basta con copiar la carpeta `data/`.

## Administración

La administración solo existe en la copia local (`npm start`); la web publicada no la tiene. Desde ella el administrador puede:

- publicar reseñas nuevas (botón «Nueva reseña» arriba o en «A la búsqueda del Grial»),
- crear encuentros nuevos en «Literatura en 3D», con sus fotos y vídeos (botón «Nuevo encuentro»),
- editar o eliminar reseñas y encuentros, y añadir o quitar fotos y vídeos de un encuentro,
- enlazar cada reseña con su publicación de Instagram: el botón «Comentar en Instagram» de la reseña lleva ahí, y es donde comentan los lectores.

**Crear o cambiar la contraseña** (mínimo 10 caracteres):

```
npm run contrasena
```

Se guarda solo su huella cifrada (scrypt) en `data/admin.json`, que no se sube a GitHub (está en `.gitignore`). Mientras no exista, nadie puede editar.

**Entrar:** enlace «Administración» al pie de la página (o `/#/admin`). Al entrar aparecen los botones de «Nueva reseña», «Nuevo encuentro», «Editar», «Eliminar» y «Salir». Las fotos se optimizan al subirlas; los vídeos admiten MP4, WebM o MOV de hasta 400 MB. La sesión dura 7 días y se cierra si se reinicia el servidor.

Protecciones incluidas: el servidor comprueba la sesión en cada operación (ocultar botones no basta), cookie `HttpOnly` y `SameSite=Strict`, bloqueo de 15 minutos tras 5 contraseñas fallidas y cabeceras de seguridad (CSP, anti-iframe).

## Publicar en internet

La web pública es una versión sin servidor ni administración, que GitHub Pages sirve como archivos fijos. Se genera sola:

1. Haz los cambios en la copia local (`npm start` → modo administrador).
2. Sube los cambios a GitHub con el botón «Subir cambios a la web» del panel o, a mano:
   ```
   git add -A && git commit -m "Nueva reseña" && git push
   ```
3. GitHub ejecuta `.github/workflows/pages.yml`, que genera la versión pública con `npm run web-publica` y la publica en uno o dos minutos. El progreso se ve en la pestaña **Actions** del repositorio.

Para ver en local la versión pública: `npm run web-publica` la deja en `_site/`.

Qué **no** se sube a GitHub (`.gitignore`): la contraseña (`data/admin.json`), el export de Instagram (`instagram/`) y los archivos de prueba del principio.
