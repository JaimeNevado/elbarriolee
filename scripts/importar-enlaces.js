// Añade a cada reseña el enlace de su publicación de Instagram: npm run importar-enlaces [archivo] [--simular]
// El archivo lo genera scripts/consola-instagram.js (por defecto, ~/Downloads/elbarriolee-enlaces.json).
// Cada publicación se empareja con la de instagram/publicaciones.json por su texto y, si no, por la fecha.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REVIEWS_FILE = path.join(ROOT, 'data', 'resenas.json');
const args = process.argv.slice(2);
const simulate = args.includes('--simular');
const source = args.find((a) => !a.startsWith('--')) || path.join(os.homedir(), 'Downloads', 'elbarriolee-enlaces.json');

// Compara textos sin acentos, mayúsculas, signos ni espacios: solo letras y números.
const key = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 150);
const dayDiff = (a, b) => Math.abs(new Date(a.slice(0, 10)) - new Date(b.slice(0, 10))) / 86400000;

if (!fs.existsSync(source)) {
  console.error(`No encuentro ${source}. Genera antes la lista con scripts/consola-instagram.js.`);
  process.exit(1);
}
const online = JSON.parse(fs.readFileSync(source, 'utf8'));
const archive = JSON.parse(fs.readFileSync(path.join(ROOT, 'instagram', 'publicaciones.json'), 'utf8')).filter((p) => p.resena);
const reviews = JSON.parse(fs.readFileSync(REVIEWS_FILE, 'utf8'));

const byText = new Map(online.filter((p) => key(p.texto)).map((p) => [key(p.texto), p]));
const used = new Set();
const found = [];
const missing = [];

for (const pub of archive) {
  let match = byText.get(key(pub.texto));
  // Si el texto se editó en Instagram después de descargar el archivo, se busca un post del mismo día que empiece igual.
  if (!match) {
    const start = key(pub.texto).slice(0, 40);
    match = online.find((p) => !used.has(p) && dayDiff(p.fecha, pub.fecha) <= 1 && key(p.texto).startsWith(start));
  }
  if (match && !used.has(match)) {
    used.add(match);
    found.push({ id: pub.resena, enlace: match.enlace });
  } else {
    missing.push(pub);
  }
}

let changed = 0;
for (const { id, enlace } of found) {
  const review = reviews.find((r) => r.id === id);
  if (review && review.instagram !== enlace) {
    review.instagram = enlace;
    changed++;
  }
}

console.log(`Publicaciones leídas de Instagram: ${online.length}`);
console.log(`Reseñas emparejadas con su post: ${found.length} de ${archive.length} (${changed} con enlace nuevo o distinto)`);
if (missing.length) {
  console.log('\nSin emparejar (pon el enlace a mano desde «Editar»):');
  for (const pub of missing) console.log(`  - ${pub.fecha}  ${pub.texto.split('\n')[0].slice(0, 70)}`);
}

if (simulate) {
  console.log('\nSimulación: no se ha guardado nada.');
} else if (changed) {
  fs.copyFileSync(REVIEWS_FILE, `${REVIEWS_FILE}.antes-de-enlaces`);
  fs.writeFileSync(REVIEWS_FILE, JSON.stringify(reviews, null, 2));
  console.log('\nGuardado en data/resenas.json (copia anterior en data/resenas.json.antes-de-enlaces).');
}
