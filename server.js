// Servidor de El Barrio. Sin dependencias: solo Node.
// Las reseñas se guardan en data/resenas.json y las imágenes en data/imagenes/.
// Leer es público; publicar, editar y borrar opiniones exige la contraseña de administración.

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
// En local solo escucha en este ordenador; en un servidor público se arranca con HOST=0.0.0.0.
const HOST = process.env.HOST || '127.0.0.1';
// Detrás de un proxy con HTTPS (Render, Railway, nginx…) la IP real y el protocolo llegan en cabeceras.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const IMAGES_DIR = path.join(DATA_DIR, 'imagenes');
const DB_FILE = path.join(DATA_DIR, 'resenas.json');
const ENCOUNTERS_DIR = path.join(DATA_DIR, 'encuentros');
const ENCOUNTERS_FILE = path.join(DATA_DIR, 'encuentros.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const MAX_BODY = 25 * 1024 * 1024;
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

async function saveImage(dataUrl, baseName) {
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/s.exec(dataUrl || '');
  if (!match) throw httpError(400, 'La imagen no tiene un formato válido (JPG, PNG, WebP o GIF).');
  const file = `${baseName}-${Date.now().toString(36)}${IMAGE_EXT[match[1]]}`;
  await fsp.writeFile(path.join(IMAGES_DIR, file), Buffer.from(match[2], 'base64'));
  return `/imagenes/${file}`;
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
  if (!action && req.method === 'GET') return send(res, 200, { admin: isAdmin(req), configurada: Boolean(adminSecret()) });
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
  // Todo lo que no sea leer o dejar una opinión queda reservado al administrador.
  const publicWrite = req.method === 'POST' && resource === 'resenas' && sub === 'opiniones' && !subId;
  if (req.method !== 'GET' && !publicWrite) requireAdmin(req);
  if (resource === 'encuentros') return handleEncounters(req, res, id, sub);
  if (resource !== 'resenas') throw httpError(404, 'Ruta no encontrada.');

  if (!id) {
    if (req.method === 'GET') return send(res, 200, await loadReviews());
    if (req.method === 'POST') {
      const body = await readJson(req);
      const review = cleanReview(body);
      const newId = `${slugify(review.titulo)}-${crypto.randomBytes(3).toString('hex')}`;
      if (!body.imagen) throw httpError(400, 'Añade una imagen para ilustrar la reseña.');
      const imagen = await saveImage(body.imagen, newId);
      const created = await mutate((list) => {
        const item = { id: newId, ...review, imagen, opiniones: [], creado: new Date().toISOString() };
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
      const imagen = body.imagen ? await saveImage(body.imagen, id) : null;
      let oldImage = null;
      const updated = await mutate((list) => {
        const item = list.find((r) => r.id === id);
        if (!item) throw httpError(404, 'Reseña no encontrada.');
        if (imagen) {
          oldImage = item.imagen;
          item.imagen = imagen;
        }
        Object.assign(item, review, { editado: new Date().toISOString() });
        return item;
      });
      await removeImage(oldImage);
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
  if (!adminSecret()) console.log('  Aún no hay contraseña de administración: créala con «npm run contrasena».\n');
});
