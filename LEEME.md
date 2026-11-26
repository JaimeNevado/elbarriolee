# El Barrio · Web de reseñas

Web de reseñas y encuentros del club. Se administra en el ordenador del administrador y se publica en GitHub Pages. No necesita base de datos ni instalar dependencias: solo Node 18 o superior.

## Arrancar

```
npm start
```

Después abre <http://localhost:3000>. Esta es la copia de trabajo, con administración. Para pararla, pulsa `Ctrl + C` en la terminal.

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
2. Sube los cambios a GitHub:
   ```
   git add -A && git commit -m "Nueva reseña" && git push
   ```
3. GitHub ejecuta `.github/workflows/pages.yml`, que genera la versión pública con `npm run web-publica` y la publica en uno o dos minutos. El progreso se ve en la pestaña **Actions** del repositorio.

Para ver en local la versión pública: `npm run web-publica` la deja en `_site/`.

Qué **no** se sube a GitHub (`.gitignore`): la contraseña (`data/admin.json`), el export de Instagram (`instagram/`) y los archivos de prueba del principio.
