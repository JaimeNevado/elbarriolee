// Genera en _site/ la versión pública de la web para GitHub Pages: npm run web-publica
// Solo archivos fijos (páginas, datos y fotos). No incluye el servidor, la administración ni la contraseña.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_site');
const DATA = path.join(ROOT, 'data');

// En los datos las fotos van como «/imagenes/…»; en relativo funcionan también en usuario.github.io/repo/.
const relative = (url) => (typeof url === 'string' ? url.replace(/^\/(?=imagenes\/|encuentros\/)/, '') : url);
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(path.join(OUT, 'datos', file), JSON.stringify(value));

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
fs.cpSync(path.join(DATA, 'imagenes'), path.join(OUT, 'imagenes'), { recursive: true });
fs.cpSync(path.join(DATA, 'encuentros'), path.join(OUT, 'encuentros'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'datos'));

const reviews = readJson('resenas.json').map(({ opiniones, ...r }) => ({
  ...r, imagen: relative(r.imagen), galeria: (r.galeria || []).map(relative),
}));
const encounters = readJson('encuentros.json').map((e) => ({
  ...e, portada: relative(e.portada), medios: e.medios.map((m) => ({ ...m, src: relative(m.src), poster: relative(m.poster) })),
}));
writeJson('resenas.json', reviews);
writeJson('encuentros.json', encounters);

// La marca data-static hace que la web lea estos archivos en lugar de pedir los datos al servidor.
const index = path.join(OUT, 'index.html');
fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('<html lang="es">', '<html lang="es" data-static="1">'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

console.log(`Web pública lista en _site/: ${reviews.length} reseñas y ${encounters.length} encuentros.`);
