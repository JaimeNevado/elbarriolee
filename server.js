// Servidor de El Barrio. Sin dependencias: solo Node.
// Las reseñas se guardan en data/resenas.json y las imágenes en data/imagenes/.
// Leer es público; publicar, editar y borrar opiniones exige la contraseña de administración.

const http = require('http');
const { execFile } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
// En local solo escucha en este ordenador; en un servidor público se arranca con HOST=0.0.0.0.
const HOST = process.env.HOST || '127.0.0.1';
// Detrás de un proxy con HTTPS (Render, Railway, nginx…) la IP real y el protocolo llegan en cabeceras.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
// Panel local (npm run panel o el icono del escritorio): quien use este ordenador edita sin contraseña.
// Solo se permite escuchando en el propio ordenador; la web pública es la de GitHub Pages.
const LOCAL_ADMIN = process.env.ADMIN_LOCAL === '1';
const LOOPBACK = ['127.0.0.1', 'localhost', '::1'];
if (LOCAL_ADMIN && !LOOPBACK.includes(HOST)) {
  console.error('ADMIN_LOCAL=1 solo puede usarse con HOST=127.0.0.1.');
  process.exit(1);
}
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const IMAGES_DIR = path.join(DATA_DIR, 'imagenes');
const DB_FILE = path.join(DATA_DIR, 'resenas.json');
const ENCOUNTERS_DIR = path.join(DATA_DIR, 'encuentros');
const ENCOUNTERS_FILE = path.join(DATA_DIR, 'encuentros.json');
// Semblanza de cada autor reseñado (la que publica su editorial), para encabezar su página.
const AUTHORS_FILE = path.join(DATA_DIR, 'autores.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
// Una reseña con su portada y su galería viaja en una sola petición (las fotos ya llegan reducidas).
const MAX_BODY = 80 * 1024 * 1024;
const MAX_GALLERY = 40;
const MAX_PUBLIC_BODY = 32 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};
const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const VIDEO_EXT = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov' };
const MAX_IMAGE_UPLOAD = 20 * 1024 * 1024;
const MAX_VIDEO_UPLOAD = 400 * 1024 * 1024;

// ---------- Almacenamiento ----------

async function loadList(file = DB_FILE) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function saveList(list, file = DB_FILE) {
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(list, null, 2));
  await fsp.rename(tmp, file);
}

const loadReviews = () => loadList(DB_FILE);

// Las escrituras se encadenan para que dos peticiones simultáneas no se pisen.
let queue = Promise.resolve();
function mutate(fn, file = DB_FILE) {
  const run = queue.then(async () => {
    const list = await loadList(file);
    const result = await fn(list);
    await saveList(list, file);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

function decodeImage(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/s.exec(dataUrl || '');
  if (!match) throw httpError(400, 'La imagen no tiene un formato válido (JPG, PNG, WebP o GIF).');
  return { ext: IMAGE_EXT[match[1]], data: Buffer.from(match[2], 'base64') };
}

async function saveImage(dataUrl, baseName) {
  const { ext, data } = decodeImage(dataUrl);
  const file = `${baseName}-${Date.now().toString(36)}${ext}`;
  await fsp.writeFile(path.join(IMAGES_DIR, file), data);
  return `/imagenes/${file}`;
}

// Las fotos de la galería van en una carpeta por reseña: data/imagenes/<id>/.
async function saveGalleryImage(dataUrl, id) {
  const { ext, data } = decodeImage(dataUrl);
  const dir = path.join(IMAGES_DIR, id);
  await fsp.mkdir(dir, { recursive: true });
  const file = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}${ext}`;
  await fsp.writeFile(path.join(dir, file), data);
  return `/imagenes/${id}/${file}`;
}

// Portada y galería de una reseña. Cada foto es una que ya tenía la reseña (su dirección) o una nueva
// (data:…); así se pueden añadir, quitar, reordenar o cambiar la portada en un solo guardado.
async function resolveReviewImages(body, id, item) {
  const known = new Set(item ? [item.imagen, ...(item.galeria || [])] : []);
  const saved = [];
  const resolve = async (value, asCover) => {
    if (known.has(value)) return value;
    if (typeof value !== 'string' || !value.startsWith('data:')) throw httpError(400, 'Una de las fotos no es válida.');
    const url = asCover ? await saveImage(value, id) : await saveGalleryImage(value, id);
    saved.push(url);
    return url;
  };
  try {
    const imagen = body.imagen ? await resolve(body.imagen, true) : item && item.imagen;
    if (!imagen) throw httpError(400, 'Añade una imagen para ilustrar la reseña.');
    let galeria = item ? item.galeria || [] : [];
    if (Array.isArray(body.galeria)) {
      if (body.galeria.length > MAX_GALLERY) throw httpError(400, `Como mucho ${MAX_GALLERY} fotos además de la portada.`);
      galeria = [];
      for (const value of body.galeria) galeria.push(await resolve(value, false));
      galeria = [...new Set(galeria)].filter((url) => url !== imagen);
    }
    return { imagen, galeria, saved };
  } catch (err) {
    for (const url of saved) await removeImage(url);
    throw err;
  }
}

async function removeImage(url) {
  if (!url || !url.startsWith('/imagenes/')) return;
  const file = path.normalize(path.join(IMAGES_DIR, url.slice('/imagenes/'.length)));
  if (!file.startsWith(IMAGES_DIR + path.sep)) return;
  await fsp.unlink(file).catch(() => {});
  // Las fotos de la galería viven en una carpeta por reseña; si queda vacía, se quita.
  const dir = path.dirname(file);
  if (dir !== IMAGES_DIR) await fsp.rmdir(dir).catch(() => {});
}

// Fotos y vídeos de los encuentros: una carpeta por entrada en data/encuentros/<id>/.
function encounterFile(url) {
  if (!url || !url.startsWith('/encuentros/')) return null;
  const file = path.normalize(path.join(ENCOUNTERS_DIR, url.slice('/encuentros/'.length)));
  return file.startsWith(ENCOUNTERS_DIR + path.sep) ? file : null;
}

async function removeEncounterMedia(medio) {
  for (const url of [medio.src, medio.poster]) {
    const file = encounterFile(url);
    if (file) await fsp.unlink(file).catch(() => {});
  }
}

const coverOf = (m) => (m.tipo === 'video' ? m.poster : m.src);

// Guarda el cuerpo de la petición tal cual en disco, sin cargarlo entero en memoria.
function receiveFile(req, file, limit) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > limit) {
      reject(httpError(413, `El archivo supera el máximo de ${Math.round(limit / 1048576)} MB.`));
      req.resume();
      return;
    }
    const tmp = file + '.part';
    const out = fs.createWriteStream(tmp);
    let size = 0;
    const fail = (err) => {
      out.destroy();
      fsp.unlink(tmp).catch(() => {});
      reject(err);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        fail(httpError(413, `El archivo supera el máximo de ${Math.round(limit / 1048576)} MB.`));
      }
    });
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => {
      if (!size) return fail(httpError(400, 'El archivo está vacío.'));
      fsp.rename(tmp, file).then(resolve, fail);
    });
    req.pipe(out);
  });
}

function cleanEncounter(body) {
  const changes = {
    titulo: str(body.titulo, 200),
    lugar: str(body.lugar, 200),
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(body.fecha || '') ? body.fecha : '',
    texto: str(body.texto, 20000),
  };
  if (!changes.titulo) throw httpError(400, 'Falta el título del encuentro.');
  if (!changes.fecha) throw httpError(400, 'La fecha no es válida.');
  if (!changes.texto) throw httpError(400, 'Falta el texto del encuentro.');
  return changes;
}

async function handleEncounters(req, res, id, sub) {
  const sortByDate = (list) => list.sort((a, b) => b.fecha.localeCompare(a.fecha));

  if (!id) {
    if (req.method === 'GET') return send(res, 200, await loadList(ENCOUNTERS_FILE));
    if (req.method === 'POST') {
      const changes = cleanEncounter(await readJson(req, MAX_PUBLIC_BODY));
      const newId = `${slugify(changes.titulo)}-${crypto.randomBytes(3).toString('hex')}`;
      await fsp.mkdir(path.join(ENCOUNTERS_DIR, newId), { recursive: true });
      const created = await mutate((list) => {
        const item = { id: newId, ...changes, portada: '', medios: [], creado: new Date().toISOString() };
        list.push(item);
        sortByDate(list);
        return item;
      }, ENCOUNTERS_FILE);
      return send(res, 201, created);
    }
    throw httpError(405, 'Método no permitido.');
  }

  if (!sub && req.method === 'PUT') {
    const body = await readJson(req, MAX_PUBLIC_BODY);
    const changes = cleanEncounter(body);
    let removed = [];
    const updated = await mutate((list) => {
      const item = list.find((e) => e.id === id);
      if (!item) throw httpError(404, 'Encuentro no encontrado.');
      // «medios» es la lista de archivos que se conservan, en su orden; los que faltan se borran.
      if (Array.isArray(body.medios)) {
        const kept = body.medios.map((src) => item.medios.find((m) => m.src === src)).filter(Boolean);
        removed = item.medios.filter((m) => !kept.includes(m));
        item.medios = [...new Set(kept)];
      }
      // La portada solo puede ser una de las fotos o carátulas de vídeo que ya tiene la entrada.
      const covers = item.medios.map(coverOf).filter(Boolean);
      changes.portada = [body.portada, item.portada].find((c) => covers.includes(c)) || covers[0] || '';
      Object.assign(item, changes, { editado: new Date().toISOString() });
      sortByDate(list);
      return item;
    }, ENCOUNTERS_FILE);
    for (const m of removed) await removeEncounterMedia(m);
    return send(res, 200, updated);
  }

  if (!sub && req.method === 'DELETE') {
    await mutate((list) => {
      const index = list.findIndex((e) => e.id === id);
      if (index === -1) throw httpError(404, 'Encuentro no encontrado.');
      list.splice(index, 1);
    }, ENCOUNTERS_FILE);
    const dir = path.normalize(path.join(ENCOUNTERS_DIR, id));
    if (dir.startsWith(ENCOUNTERS_DIR + path.sep)) await fsp.rm(dir, { recursive: true, force: true });
    return send(res, 200, { ok: true });
  }

  // Subida de una foto o un vídeo: el cuerpo es el archivo. Con ?para=<vídeo>, la imagen es su carátula.
  if (sub === 'medios' && req.method === 'POST') {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim();
    const isVideo = Boolean(VIDEO_EXT[type]);
    if (!isVideo && !IMAGE_EXT[type]) throw httpError(415, 'Solo se admiten fotos (JPG, PNG, WebP, GIF) y vídeos (MP4, WebM, MOV).');
    const para = new URL(req.url, 'http://x').searchParams.get('para');
    if (isVideo && para) throw httpError(400, 'La carátula de un vídeo debe ser una imagen.');
    const items = await loadList(ENCOUNTERS_FILE);
    const current = items.find((e) => e.id === id);
    if (!current) throw httpError(404, 'Encuentro no encontrado.');
    if (para && !current.medios.some((m) => m.tipo === 'video' && m.src === para)) throw httpError(404, 'Vídeo no encontrado.');

    const dir = path.join(ENCOUNTERS_DIR, id);
    await fsp.mkdir(dir, { recursive: true });
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}${VIDEO_EXT[type] || IMAGE_EXT[type]}`;
    await receiveFile(req, path.join(dir, name), isVideo ? MAX_VIDEO_UPLOAD : MAX_IMAGE_UPLOAD);
    const url = `/encuentros/${id}/${name}`;

    let oldPoster = null;
    const medio = await mutate((list) => {
      const item = list.find((e) => e.id === id);
      if (!item) throw httpError(404, 'Encuentro no encontrado.');
      if (para) {
        const video = item.medios.find((m) => m.tipo === 'video' && m.src === para);
        if (!video) throw httpError(404, 'Vídeo no encontrado.');
        oldPoster = video.poster;
        video.poster = url;
        if (!item.portada || item.portada === oldPoster) item.portada = url;
        return video;
      }
      const added = isVideo ? { tipo: 'video', src: url } : { tipo: 'imagen', src: url };
      item.medios.push(added);
      if (!item.portada && !isVideo) item.portada = url;
      return added;
    }, ENCOUNTERS_FILE).catch(async (err) => {
      await fsp.unlink(path.join(dir, name)).catch(() => {});
      throw err;
    });
    if (oldPoster) await removeEncounterMedia({ src: oldPoster });
    return send(res, 201, medio);
  }

  throw httpError(405, 'Método no permitido.');
}

// Semblanzas: una por autor, con su procedencia (editorial y enlace a la página de donde se tomó).
async function handleAuthors(req, res, id) {
  if (!id && req.method === 'GET') return send(res, 200, await loadList(AUTHORS_FILE));
  if (id && req.method === 'PUT') {
    const body = await readJson(req, MAX_PUBLIC_BODY);
    const entry = {
      id,
      autor: str(body.autor, 200),
      semblanza: str(body.semblanza, 8000),
      editorial: str(body.editorial, 120),
      url: /^https?:\/\/\S+$/.test(str(body.url, 500)) ? str(body.url, 500) : '',
    };
    if (!entry.autor) throw httpError(400, 'Falta el nombre del autor.');
    if (!entry.semblanza) throw httpError(400, 'Escribe la semblanza o elimínala.');
    if (slugify(entry.autor) !== id) throw httpError(400, 'El autor no coincide con la dirección.');
    const saved = await mutate((list) => {
      const index = list.findIndex((a) => a.id === id);
      const item = { ...entry, actualizado: new Date().toISOString() };
      if (index === -1) list.push(item);
      else list[index] = item;
      list.sort((a, b) => a.autor.localeCompare(b.autor, 'es'));
      return item;
    }, AUTHORS_FILE);
    return send(res, 200, saved);
  }
  if (id && req.method === 'DELETE') {
    await mutate((list) => {
      const index = list.findIndex((a) => a.id === id);
      if (index === -1) throw httpError(404, 'Ese autor no tiene semblanza.');
      list.splice(index, 1);
    }, AUTHORS_FILE);
    return send(res, 200, { ok: true });
  }
  throw httpError(405, 'Método no permitido.');
}

// ---------- Validación ----------

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function str(value, max = 300) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// «británica» y «Británica» deben agruparse y mostrarse igual.
function capitalize(text) {
  return text.charAt(0).toLocaleUpperCase('es') + text.slice(1);
}

function slugify(text) {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'resena';
}

function rating(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

function instagramUrl(value) {
  const match = /^https?:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(p|reel|tv)\/([A-Za-z0-9_-]+)/.exec(str(value, 300));
  return match ? `https://www.instagram.com/${match[1]}/${match[2]}/` : '';
}

function cleanReview(input) {
  const review = {
    titulo: str(input.titulo, 200),
    autor: str(input.autor, 200),
    nacionalidad: capitalize(str(input.nacionalidad, 80)),
    genero: capitalize(str(input.genero, 80)),
    temas: (Array.isArray(input.temas) ? input.temas : [])
      .map((t) => capitalize(str(t, 60))).filter(Boolean).slice(0, 12),
    editorial: str(input.editorial, 120),
    anio: /^\d{3,4}$/.test(String(input.anio || '').trim()) ? Number(input.anio) : null,
    ambientacion: capitalize(str(input.ambientacion, 120)),
    idioma: capitalize(str(input.idioma, 60)),
    valoracion: rating(input.valoracion),
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(input.fecha || '') ? input.fecha : new Date().toISOString().slice(0, 10),
    texto: str(input.texto, 20000),
    // Publicación de Instagram de la reseña: ahí es donde comentan los lectores.
    instagram: instagramUrl(input.instagram),
  };
  if (input.instagram && String(input.instagram).trim() && !review.instagram) {
    throw httpError(400, 'El enlace de Instagram debe ser de una publicación, como https://www.instagram.com/p/…');
  }
  if (!review.titulo) throw httpError(400, 'Falta el título del libro.');
  if (!review.autor) throw httpError(400, 'Falta el nombre del autor o autora.');
  if (!review.texto) throw httpError(400, 'Falta el texto de la reseña.');
  return review;
}

// ---------- Administración ----------

// La contraseña se guarda como hash scrypt en data/admin.json (se crea con `npm run contrasena`).
// Si existe la variable ADMIN_PASSWORD, tiene prioridad: útil en servicios donde no hay terminal.
const hashPassword = (password, salt) => crypto.scryptSync(password, salt, 64);

let envSecret = null;
function adminSecret() {
  if (process.env.ADMIN_PASSWORD) {
    envSecret = envSecret || { salt: 'env', hash: hashPassword(process.env.ADMIN_PASSWORD, 'env') };
    return envSecret;
  }
  try {
    const { salt, hash } = JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8'));
    return { salt, hash: Buffer.from(hash, 'hex') };
  } catch {
    return null;
  }
}

function checkPassword(password) {
  const secret = adminSecret();
  if (!secret || typeof password !== 'string' || !password) return false;
  return crypto.timingSafeEqual(hashPassword(password, secret.salt), secret.hash);
}

// Sesiones en memoria: al reiniciar el servidor hay que volver a entrar.
const SESSION_DAYS = 7;
const sessions = new Map();

function sessionToken(req) {
  const match = /(?:^|;\s*)eb_admin=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return match ? match[1] : null;
}

function isAdmin(req) {
  if (LOCAL_ADMIN) return true;
  const token = sessionToken(req);
  const expires = token && sessions.get(token);
  if (!expires) return false;
  if (expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function requireAdmin(req) {
  if (!isAdmin(req)) throw httpError(401, 'Necesitas entrar como administrador.');
}

function isHttps(req) {
  return req.socket.encrypted || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
}

function sessionCookie(req, token, maxAge) {
  return `eb_admin=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}

function clientIp(req) {
  const forwarded = TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || '';
}

// Límite de intentos por IP: frena a quien intente adivinar la contraseña o llenar de spam las opiniones.
function limiter(max, windowMs) {
  const hits = new Map();
  return {
    blocked(ip) {
      const entry = hits.get(ip);
      if (entry && entry.until < Date.now()) hits.delete(ip);
      return (hits.get(ip)?.count || 0) >= max;
    },
    hit(ip) {
      const entry = hits.get(ip);
      if (entry && entry.until >= Date.now()) entry.count++;
      else hits.set(ip, { count: 1, until: Date.now() + windowMs });
    },
    reset(ip) { hits.delete(ip); },
  };
}
const loginLimit = limiter(5, 15 * 60 * 1000);
const opinionLimit = limiter(5, 10 * 60 * 1000);

async function handleAdmin(req, res, action) {
  if (!action && req.method === 'GET') return send(res, 200, { admin: isAdmin(req), local: LOCAL_ADMIN, configurada: LOCAL_ADMIN || Boolean(adminSecret()) });
  if (action === 'entrar' && req.method === 'POST') {
    const ip = clientIp(req);
    if (loginLimit.blocked(ip)) throw httpError(429, 'Demasiados intentos. Espera 15 minutos y vuelve a probar.');
    if (!adminSecret()) throw httpError(503, 'Aún no hay contraseña de administración. Créala con «npm run contrasena».');
    const body = await readJson(req, MAX_PUBLIC_BODY);
    if (!checkPassword(body.password)) {
      loginLimit.hit(ip);
      throw httpError(401, 'Contraseña incorrecta.');
    }
    loginLimit.reset(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_DAYS * 86400000);
    res.setHeader('Set-Cookie', sessionCookie(req, token, SESSION_DAYS * 86400));
    return send(res, 200, { admin: true });
  }
  if (action === 'salir' && req.method === 'POST') {
    const token = sessionToken(req);
    if (token) sessions.delete(token);
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    return send(res, 200, { admin: false });
  }
  throw httpError(405, 'Método no permitido.');
}

// ---------- Subir cambios a la web (git) ----------

// La web pública se regenera en GitHub cada vez que llega un cambio a main (ver .github/workflows/pages.yml).
function git(args, timeout = 60000) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: __dirname, timeout, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.output = `${stdout}${stderr}`.trim();
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

async function committedList(file) {
  try {
    return JSON.parse(await git(['show', `HEAD:data/${file}`]));
  } catch {
    return [];
  }
}

// Qué se puede deshacer de cada tipo de contenido y qué archivos usa cada entrada.
const CONTENT = {
  resena: {
    file: 'resenas.json',
    load: () => loadReviews(),
    path: () => DB_FILE,
    labels: { nuevo: 'Nueva reseña', editado: 'Reseña editada', eliminado: 'Reseña eliminada' },
    media: (r) => [r.imagen, ...(r.galeria || [])].filter(Boolean).map((url) => path.join(IMAGES_DIR, url.slice('/imagenes/'.length))),
    folder: (id) => path.join(IMAGES_DIR, id),
    sort: () => {},
  },
  autor: {
    file: 'autores.json',
    load: () => loadList(AUTHORS_FILE),
    path: () => AUTHORS_FILE,
    labels: { nuevo: 'Semblanza nueva', editado: 'Semblanza editada', eliminado: 'Semblanza eliminada' },
    media: () => [],
    folder: null,
    sort: (list) => list.sort((a, b) => a.autor.localeCompare(b.autor, 'es')),
  },
  encuentro: {
    file: 'encuentros.json',
    load: () => loadList(ENCOUNTERS_FILE),
    path: () => ENCOUNTERS_FILE,
    labels: { nuevo: 'Nuevo encuentro', editado: 'Encuentro editado', eliminado: 'Encuentro eliminado' },
    media: (e) => (e.medios || []).flatMap((m) => [m.src, m.poster]).filter(Boolean).map(encounterFile).filter(Boolean),
    folder: (id) => path.join(ENCOUNTERS_DIR, id),
    sort: (list) => list.sort((a, b) => b.fecha.localeCompare(a.fecha)),
  },
};

async function changedFiles() {
  const status = (await git(['status', '--porcelain', '--untracked-files=all'])).split('\n').filter(Boolean);
  return status.map((line) => line.slice(3).replace(/^"|"$/g, ''));
}

// Lista de lo que cambiaría en la web, entrada a entrada, para enseñarla antes de subir y poder deshacerla.
async function pendingChanges() {
  const files = await changedFiles();
  const changes = [];
  const owned = new Set();
  for (const [tipo, kind] of Object.entries(CONTENT)) {
    const current = await kind.load();
    if (!files.includes(`data/${kind.file}`)) {
      current.forEach((item) => kind.media(item).forEach((f) => owned.add(path.relative(__dirname, f))));
      continue;
    }
    const before = new Map((await committedList(kind.file)).map((x) => [x.id, x]));
    const after = new Map(current.map((x) => [x.id, x]));
    const add = (accion, item) => changes.push({
      clave: `${tipo}:${item.id}`, tipo, accion, id: item.id, titulo: item.titulo || item.autor, texto: `${kind.labels[accion]}: ${item.titulo || item.autor}`,
    });
    for (const [id, item] of after) {
      if (!before.has(id)) add('nuevo', item);
      else if (JSON.stringify(before.get(id)) !== JSON.stringify(item)) add('editado', item);
    }
    for (const [id, item] of before) if (!after.has(id)) add('eliminado', item);
    // Las fotos de las entradas cambiadas van con su entrada; así no se cuentan dos veces.
    for (const item of [...after.values(), ...before.values()]) kind.media(item).forEach((f) => owned.add(path.relative(__dirname, f)));
  }
  const loose = files.filter((f) => /^data\/(imagenes|encuentros)\//.test(f) && !owned.has(f));
  if (loose.length) {
    changes.push({ clave: 'fotos', tipo: 'fotos', archivos: loose, texto: `${loose.length} ${loose.length === 1 ? 'foto o vídeo suelto' : 'fotos y vídeos sueltos'}` });
  }
  const program = files.filter((f) => !/^data\//.test(f));
  if (program.length) {
    changes.push({
      clave: 'programa', tipo: 'programa', archivos: program,
      texto: `${program.length} ${program.length === 1 ? 'archivo' : 'archivos'} del diseño o del programa de la web`,
    });
  }
  // Cambios ya guardados en un intento anterior que no llegó a subirse (por ejemplo, sin internet).
  const ahead = Number((await git(['rev-list', '--count', 'origin/main..HEAD']).catch(() => '0')).trim());
  if (ahead) {
    changes.push({ clave: 'envios', tipo: 'envios', texto: `Cambios de ${ahead === 1 ? 'un envío anterior' : `${ahead} envíos anteriores`} que no llegaron a subirse` });
  }
  return { changes, dirty: files.length > 0 };
}

async function lastPublished() {
  const out = await git(['log', '-1', '--format=%cI', 'origin/main']).catch(() => '');
  return out.trim() || null;
}

// Operaciones que tocan datos y git: una detrás de otra, nunca a la vez que una edición.
function exclusive(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

async function inHead(file) {
  return git(['cat-file', '-e', `HEAD:${path.relative(__dirname, file)}`]).then(() => true, () => false);
}

// Devuelve una entrada a como está en la web: la nueva se borra, la editada o eliminada se recupera,
// con sus fotos y vídeos.
async function undoChange(tipo, id) {
  const kind = CONTENT[tipo];
  if (!kind) throw httpError(400, 'Ese cambio no se puede deshacer desde aquí.');
  const head = await committedList(kind.file);
  const before = head.find((x) => x.id === id);
  const list = await kind.load();
  const index = list.findIndex((x) => x.id === id);
  const current = list[index];
  if (!before && !current) throw httpError(404, 'No hay ningún cambio que deshacer en esa entrada.');

  if (index !== -1) list.splice(index, 1);
  if (before) list.splice(index !== -1 ? index : Math.min(head.indexOf(before), list.length), 0, before);
  kind.sort(list);
  await saveList(list, kind.path());
  // Si ya no queda ningún cambio, se deja el archivo idéntico al de la web (mismo formato incluido).
  if (JSON.stringify(list) === JSON.stringify(head)) await git(['checkout', 'HEAD', '--', `data/${kind.file}`]);

  const files = new Set([...(current ? kind.media(current) : []), ...(before ? kind.media(before) : [])]);
  for (const file of files) {
    if (await inHead(file)) await git(['checkout', 'HEAD', '--', path.relative(__dirname, file)]);
    else await fsp.unlink(file).catch(() => {});
  }
  // Carpeta de fotos de una entrada nueva: se quita entera (solo lo que no está ya en la web).
  if (!before && kind.folder) {
    const folder = kind.folder(id);
    if (fs.existsSync(folder)) await git(['clean', '-fdq', '--', path.relative(__dirname, folder)]);
    await fsp.rmdir(folder).catch(() => {});
  }
  const name = (x) => x.titulo || x.autor;
  return before ? `Vuelve a estar como en la web: ${name(before)}` : `Borrado del todo (no estaba en la web): ${name(current)}`;
}

// Deja reseñas, encuentros y fotos exactamente como están en la web. No toca el programa.
async function discardAll() {
  await git(['checkout', 'HEAD', '--', 'data']);
  await git(['clean', '-fdq', '--', 'data']);
}

let publishing = false;
async function publish() {
  if (publishing) throw httpError(409, 'Ya se están subiendo los cambios. Espera un momento.');
  publishing = true;
  try {
    await queue; // que no quede ninguna edición a medio guardar
    const { changes, dirty } = await pendingChanges();
    if (!changes.length) throw httpError(409, 'No hay cambios pendientes de subir.');
    if (dirty) {
      await git(['add', '-A']);
      const fecha = new Date().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
      await git(['commit', '-m', `Cambios desde el panel (${fecha})\n\n${changes.map((c) => `- ${c.texto}`).join('\n')}`]);
    }
    try {
      await git(['push', 'origin', 'HEAD'], 15 * 60 * 1000);
    } catch {
      // Si alguien subió cambios desde otro ordenador, se incorporan y se vuelve a intentar.
      try {
        await git(['pull', '--rebase', 'origin', 'main'], 5 * 60 * 1000);
      } catch (err) {
        await git(['rebase', '--abort']).catch(() => {});
        console.error(err.output);
        throw httpError(500, 'Hay cambios en GitHub que chocan con los de este ordenador. Los tuyos están guardados aquí; pide ayuda para juntarlos.');
      }
      try {
        await git(['push', 'origin', 'HEAD'], 15 * 60 * 1000);
      } catch (err) {
        console.error(err.output);
        throw httpError(502, 'No se pudo conectar con GitHub. Comprueba la conexión a internet y vuelve a intentarlo: los cambios están guardados.');
      }
    }
    return changes;
  } finally {
    publishing = false;
  }
}

async function handlePublish(req, res, action) {
  requireAdmin(req);
  if (!action && req.method === 'GET') {
    const [{ changes }, ultima] = await Promise.all([pendingChanges(), lastPublished()]);
    return send(res, 200, { cambios: changes, ultimaSubida: ultima });
  }
  if (!action && req.method === 'POST') return send(res, 200, { cambios: await publish() });
  if (publishing) throw httpError(409, 'Se están subiendo los cambios. Espera a que termine.');
  if (action === 'deshacer' && req.method === 'POST') {
    const body = await readJson(req, MAX_PUBLIC_BODY);
    const [tipo, ...rest] = String(body.clave || '').split(':');
    return send(res, 200, { mensaje: await exclusive(() => undoChange(tipo, rest.join(':'))) });
  }
  if (action === 'descartar' && req.method === 'POST') {
    await exclusive(discardAll);
    return send(res, 200, { ok: true });
  }
  throw httpError(405, 'Método no permitido.');
}

// ---------- HTTP ----------

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function readJson(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(httpError(413, limit === MAX_BODY ? 'La imagen es demasiado grande.' : 'El texto es demasiado largo.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(httpError(400, 'Petición mal formada.'));
      }
    });
    req.on('error', reject);
  });
}

async function serveFile(req, res, root, relPath) {
  const file = path.normalize(path.join(root, relPath));
  if (!file.startsWith(root + path.sep)) return send(res, 403, { error: 'Prohibido' });
  let stat;
  try {
    stat = await fsp.stat(file);
    if (!stat.isFile()) throw new Error();
  } catch {
    return send(res, 404, 'No encontrado', 'text/plain; charset=utf-8');
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  // Los vídeos se piden por trozos (Range) para poder adelantarlos sin descargarlos enteros.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, stat.size - 1);
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, {
      'Content-Type': type, 'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1,
    });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': stat.size });
  fs.createReadStream(file).pipe(res);
}

async function handleApi(req, res, parts) {
  // parts: ['api', 'resenas', id?, 'opiniones'?, opinionId?]
  const [, resource, id, sub, subId] = parts;
  if (resource === 'admin') return handleAdmin(req, res, id);
  if (resource === 'publicar') return handlePublish(req, res, id);
  // Todo lo que no sea leer o dejar una opinión queda reservado al administrador.
  const publicWrite = req.method === 'POST' && resource === 'resenas' && sub === 'opiniones' && !subId;
  if (req.method !== 'GET' && !publicWrite) requireAdmin(req);
  if (resource === 'encuentros') return handleEncounters(req, res, id, sub);
  if (resource === 'autores') return handleAuthors(req, res, id);
  if (resource !== 'resenas') throw httpError(404, 'Ruta no encontrada.');

  if (!id) {
    if (req.method === 'GET') return send(res, 200, await loadReviews());
    if (req.method === 'POST') {
      const body = await readJson(req);
      const review = cleanReview(body);
      const newId = `${slugify(review.titulo)}-${crypto.randomBytes(3).toString('hex')}`;
      const { imagen, galeria } = await resolveReviewImages(body, newId, null);
      const created = await mutate((list) => {
        const item = { id: newId, ...review, imagen, galeria, opiniones: [], creado: new Date().toISOString() };
        list.push(item);
        return item;
      });
      return send(res, 201, created);
    }
    throw httpError(405, 'Método no permitido.');
  }

  if (!sub) {
    if (req.method === 'GET') {
      const item = (await loadReviews()).find((r) => r.id === id);
      return item ? send(res, 200, item) : send(res, 404, { error: 'Reseña no encontrada.' });
    }
    if (req.method === 'PUT') {
      const body = await readJson(req);
      const review = cleanReview(body);
      const current = (await loadReviews()).find((r) => r.id === id);
      if (!current) throw httpError(404, 'Reseña no encontrada.');
      const { imagen, galeria, saved } = await resolveReviewImages(body, id, current);
      let unused = [];
      const updated = await mutate((list) => {
        const item = list.find((r) => r.id === id);
        if (!item) throw httpError(404, 'Reseña no encontrada.');
        const before = [item.imagen, ...(item.galeria || [])];
        Object.assign(item, review, { imagen, galeria, editado: new Date().toISOString() });
        unused = before.filter((url) => url !== imagen && !galeria.includes(url));
        return item;
      }).catch(async (err) => {
        for (const url of saved) await removeImage(url);
        throw err;
      });
      // Las fotos que se han quitado de la reseña se borran del disco.
      for (const url of unused) await removeImage(url);
      return send(res, 200, updated);
    }
    if (req.method === 'DELETE') {
      const removed = await mutate((list) => {
        const index = list.findIndex((r) => r.id === id);
        if (index === -1) throw httpError(404, 'Reseña no encontrada.');
        return list.splice(index, 1)[0];
      });
      await removeImage(removed.imagen);
      for (const url of removed.galeria || []) await removeImage(url);
      return send(res, 200, { ok: true });
    }
    throw httpError(405, 'Método no permitido.');
  }

  if (sub === 'opiniones') {
    if (req.method === 'POST' && !subId) {
      const ip = clientIp(req);
      if (!isAdmin(req) && opinionLimit.blocked(ip)) throw httpError(429, 'Has publicado varias opiniones seguidas. Espera unos minutos.');
      const body = await readJson(req, MAX_PUBLIC_BODY);
      const opinion = {
        id: crypto.randomBytes(4).toString('hex'),
        nombre: str(body.nombre, 80) || 'Anónimo',
        texto: str(body.texto, 4000),
        valoracion: rating(body.valoracion),
        fecha: new Date().toISOString(),
      };
      if (!opinion.texto) throw httpError(400, 'Escribe tu opinión antes de publicarla.');
      opinionLimit.hit(ip);
      await mutate((list) => {
        const item = list.find((r) => r.id === id);
        if (!item) throw httpError(404, 'Reseña no encontrada.');
        item.opiniones = item.opiniones || [];
        item.opiniones.push(opinion);
      });
      return send(res, 201, opinion);
    }
    if (req.method === 'DELETE' && subId) {
      await mutate((list) => {
        const item = list.find((r) => r.id === id);
        if (!item) throw httpError(404, 'Reseña no encontrada.');
        item.opiniones = (item.opiniones || []).filter((o) => o.id !== subId);
      });
      return send(res, 200, { ok: true });
    }
  }
  throw httpError(405, 'Método no permitido.');
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    const parts = decodeURIComponent(pathname).split('/').filter(Boolean);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    // Sin contraseña, solo se atiende a quien escribe localhost: así otra web no puede usar el panel a escondidas.
    if (LOCAL_ADMIN && !LOOPBACK.includes(String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, ''))) {
      throw httpError(403, 'Este panel solo funciona en este ordenador.');
    }
    if (parts[0] === 'api') {
      // Las peticiones que cambian algo solo se aceptan desde la propia web.
      const origin = req.headers.origin;
      if (req.method !== 'GET' && origin && origin.replace(/^https?:\/\//, '') !== req.headers.host) throw httpError(403, 'Origen no permitido.');
      return await handleApi(req, res, parts);
    }
    if (req.method !== 'GET') throw httpError(405, 'Método no permitido.');
    if (parts[0] === 'imagenes') return await serveFile(req, res, IMAGES_DIR, parts.slice(1).join('/'));
    if (parts[0] === 'encuentros') return await serveFile(req, res, ENCOUNTERS_DIR, parts.slice(1).join('/'));
    return await serveFile(req, res, PUBLIC_DIR, parts.length ? parts.join('/') : 'index.html');
  } catch (err) {
    if (!err.status) console.error(err);
    send(res, err.status || 500, { error: err.status ? err.message : 'Error interno del servidor.' });
  }
});

fs.mkdirSync(IMAGES_DIR, { recursive: true });
fs.mkdirSync(ENCOUNTERS_DIR, { recursive: true });
// Los vídeos grandes pueden tardar en subir con una conexión lenta.
server.requestTimeout = 30 * 60 * 1000;
server.listen(PORT, HOST, () => {
  console.log(`\n  El Barrio está en marcha → http://localhost:${PORT}\n`);
  if (LOCAL_ADMIN) console.log('  Panel de edición sin contraseña (solo en este ordenador).\n');
  else if (!adminSecret()) console.log('  Aún no hay contraseña de administración: créala con «npm run contrasena».\n');
});
