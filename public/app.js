'use strict';

const PAGE_SIZE = 9;
const NONE = 'Sin especificar';
const app = document.getElementById('app');
let reviews = [];
let encounters = [];
let authors = [];
// Solo cambia qué botones se ven; el servidor comprueba la sesión en cada operación.
let admin = false;
// Panel local (icono del escritorio): sin contraseña y con el botón «Subir cambios a la web».
let localMode = false;
let pending = [];
let lastUpload = null;
// La versión publicada en GitHub Pages no tiene servidor: lee los datos de archivos y no tiene administración.
const STATIC = document.documentElement.dataset.static === '1';

// Criterios por los que se pueden agrupar y filtrar las reseñas.
const GROUPS = {
  nacionalidad: { label: 'Nacionalidad', get: (r) => [r.nacionalidad] },
  tema: { label: 'Temática', get: (r) => r.temas || [] },
  genero: { label: 'Género', get: (r) => [r.genero] },
  autor: { label: 'Autor', get: (r) => [r.autor] },
  ambientacion: { label: 'Ambientación', get: (r) => [r.ambientacion] },
  editorial: { label: 'Editorial', get: (r) => [r.editorial] },
  idioma: { label: 'Idioma original', get: (r) => [r.idioma] },
  decada: { label: 'Década', get: (r) => (r.anio ? [`Años ${Math.floor(r.anio / 10) * 10}`] : []), ordered: true },
  valoracion: { label: 'Valoración', get: (r) => (r.valoracion ? [starsLabel(r.valoracion)] : []), ordered: true },
  anioResena: { label: 'Año de la reseña', get: (r) => [r.fecha && r.fecha.slice(0, 4)], ordered: true },
};

// ---------- Utilidades ----------

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (value) => String(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const today = () => new Date().toISOString().slice(0, 10);
const INSTAGRAM_PROFILE = 'https://www.instagram.com/elbarriolee/';
const reviewLink = (r) => `#/resena/${encodeURIComponent(r.id)}`;

function starsLabel(n) {
  return `${n} ${n === 1 ? 'estrella' : 'estrellas'}`;
}

function stars(n) {
  if (!n) return '';
  return `<span class="stars" aria-label="${starsLabel(n)}">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;
}

function fmtDate(iso, withTime = false) {
  if (!iso) return '';
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  const opts = { day: 'numeric', month: 'long', year: 'numeric' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString('es-ES', opts);
}

function values(r, key) {
  return GROUPS[key].get(r).filter((v) => v != null && String(v).trim() !== '');
}

function matches(r, key, value) {
  const vals = values(r, key);
  if (value === NONE) return vals.length === 0;
  return vals.some((v) => norm(v) === norm(value));
}

function sortedReviews() {
  return [...reviews].sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.creado || '').localeCompare(a.creado || ''));
}

// Separa el cuerpo de la reseña de las preguntas finales para el club (párrafos «¿…?»).
function splitText(text) {
  const paragraphs = String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const questions = [];
  while (paragraphs.length > 1 && /^¿[\s\S]*\?$/.test(paragraphs[paragraphs.length - 1])) {
    questions.unshift(paragraphs.pop());
  }
  return { body: paragraphs, questions };
}

function excerpt(text, max = 170) {
  const first = splitText(text).body[0] || '';
  if (first.length <= max) return first;
  return first.slice(0, first.lastIndexOf(' ', max)).replace(/[,;:.]$/, '') + '…';
}

function readingTime(text) {
  const words = String(text || '').split(/\s+/).length;
  return `${Math.max(1, Math.round(words / 200))} min de lectura`;
}

function distinct(key) {
  const counts = new Map();
  for (const r of reviews) {
    for (const v of values(r, key)) {
      const k = norm(v);
      if (!counts.has(k)) counts.set(k, { label: v, n: 0 });
      counts.get(k).n++;
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'es'));
}

function avatarColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 45% 45%)`;
}

let toastTimer;
function toast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && admin) setAdmin(false);
  if (!res.ok) throw new Error(data.error || 'Algo ha fallado. Inténtalo de nuevo.');
  return data;
}

async function loadReviews() {
  reviews = STATIC ? await staticData('datos/resenas.json') : await api('GET', '/api/resenas');
}

async function loadEncounters() {
  encounters = STATIC ? await staticData('datos/encuentros.json') : await api('GET', '/api/encuentros');
}

async function loadAuthors() {
  authors = STATIC ? await staticData('datos/autores.json').catch(() => []) : await api('GET', '/api/autores');
}

// Igual que en el servidor: la semblanza de cada autor se guarda con este identificador.
function slugify(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'resena';
}

const authorBio = (name) => authors.find((a) => a.id === slugify(name));

async function staticData(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error('No se pudieron cargar los datos.');
  return res.json();
}

async function loadAdmin() {
  if (STATIC) return setAdmin(false);
  const state = await api('GET', '/api/admin');
  localMode = Boolean(state.local);
  document.querySelectorAll('[data-local-only]').forEach((el) => { el.hidden = !localMode; });
  document.querySelectorAll('[data-remote-only]').forEach((el) => { el.hidden = localMode; });
  if (localMode) {
    document.querySelector('.admin-bar-label strong').textContent = 'Panel de edición';
    document.querySelector('.admin-bar-hint').textContent = 'Lo que cambies aquí no sale en la web hasta que pulses «Subir cambios a la web».';
  }
  setAdmin(state.admin);
  if (localMode) await loadPending();
  return state;
}

async function loadPending() {
  const state = await api('GET', '/api/publicar').catch(() => ({ cambios: [] }));
  pending = state.cambios;
  lastUpload = state.ultimaSubida;
  const count = document.querySelector('.publish-count');
  count.textContent = pending.length;
  count.hidden = !pending.length;
}

async function publishChanges(button) {
  await loadPending();
  if (!pending.length) return toast('No hay cambios pendientes: la web ya está al día.');
  if (!confirm(`Se subirán a elbarriolee.club estos cambios:\n\n${pending.map((c) => `• ${c.texto}`).join('\n')}\n\n¿Subirlos ahora?`)) return;
  const label = button.innerHTML;
  document.querySelectorAll('[data-action="publish"]').forEach((b) => { b.disabled = true; });
  button.textContent = 'Subiendo…';
  try {
    await api('POST', '/api/publicar');
    toast('¡Subido! La web se actualizará en uno o dos minutos.');
  } catch (err) {
    toast(err.message, true);
  } finally {
    button.innerHTML = label;
    document.querySelectorAll('[data-action="publish"]').forEach((b) => { b.disabled = false; });
    await loadPending();
    if (parseHash().parts[0] === 'admin') route();
  }
}

function setAdmin(value) {
  admin = Boolean(value);
  document.body.classList.toggle('is-admin', admin);
  document.querySelectorAll('[data-admin-only]').forEach((el) => { el.hidden = !admin; });
  markTitle();
}

// En modo administrador la pestaña del navegador también lo indica.
const ADMIN_TITLE = '✎ Admin · ';
function markTitle() {
  const plain = document.title.replace(ADMIN_TITLE, '');
  document.title = admin ? ADMIN_TITLE + plain : plain;
}

// ---------- Rutas ----------

function parseHash() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, query] = hash.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(query || '') };
}

function homeLink(params) {
  const qs = params.toString();
  return `#/${qs ? `?${qs}` : ''}`;
}

function withParams(params, changes) {
  const next = new URLSearchParams(params);
  for (const [k, v] of Object.entries(changes)) {
    if (v == null || v === '') next.delete(k);
    else next.set(k, v);
  }
  return homeLink(next);
}

function filterLink(key, value) {
  return homeLink(new URLSearchParams({ [key]: value }));
}

function setActiveNav(name) {
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('is-active', a.dataset.nav === name));
}

// Rutas de edición: sin sesión se muestra el acceso y, al entrar, se vuelve a la misma página.
const isAdminRoute = (parts) => parts[0] === 'nueva' || parts[0] === 'editar' || parts[0] === 'autor'
  || (parts[0] === 'literatura-3d' && (parts[1] === 'nuevo' || parts[2] === 'editar'));

function route() {
  const { parts, params } = parseHash();
  if (STATIC && (parts[0] === 'admin' || isAdminRoute(parts))) renderNotFound();
  else if (parts[0] === 'admin') renderLogin(params.get('volver'));
  else if (isAdminRoute(parts) && !admin) renderLogin(location.hash);
  else if (parts[0] === 'resena' && parts[1]) renderDetail(parts[1]);
  else if (parts[0] === 'autor' && parts[1]) renderAuthorForm(parts[1]);
  else if (parts[0] === 'aviso-legal') renderLegal();
  else if (parts[0] === 'grial') renderGrail();
  else if (parts[0] === 'literatura-3d' && parts[1] === 'nuevo') renderEncounterForm(null);
  else if (parts[0] === 'literatura-3d' && parts[1] && parts[2] === 'editar') renderEncounterForm(parts[1]);
  else if (parts[0] === 'literatura-3d' && parts[1]) renderEncounter(parts[1]);
  else if (parts[0] === 'literatura-3d') renderEncounters();
  else if (parts[0] === 'nueva') renderForm(null);
  else if (parts[0] === 'editar' && parts[1]) renderForm(reviews.find((r) => r.id === parts[1]) || null, parts[1]);
  else renderHome(params);
  markTitle();
  window.scrollTo(0, 0);
}

// ---------- Portada ----------

function renderHome(params) {
  const agrupar = GROUPS[params.get('agrupar')] ? params.get('agrupar') : '';
  setActiveNav(agrupar ? 'explorar' : 'inicio');
  document.title = 'El Barrio · Reseñas';

  const authors = new Set(reviews.map((r) => norm(r.autor))).size;
  const nationalities = distinct('nacionalidad').length;
  const stat = (n, one, many) => `<div class="stat"><strong>${n}</strong><span>${n === 1 ? one : many}</span></div>`;

  app.innerHTML = `
    <section class="intro fade-in">
      <h1>Lo que leemos <em>en El Barrio</em></h1>
      <div class="stats">
        ${stat(reviews.length, 'reseña', 'reseñas')}
        ${stat(authors, 'autor', 'autores')}
        ${stat(nationalities, 'nacionalidad', 'nacionalidades')}
        ${stat(encounters.length, 'encuentro', 'encuentros')}
      </div>
    </section>
    <nav class="home-sections fade-in" aria-label="Secciones">
      <a class="section-btn" href="#/grial">
        <span class="section-btn-title">A la búsqueda del Grial</span>
        <span class="section-btn-text">Un recorrido por todos los libros leídos en busca de la lectura perfecta para nuestros encuentros.</span>
        <span class="section-btn-arrow" aria-hidden="true">→</span>
      </a>
      <a class="section-btn" href="#/literatura-3d">
        <span class="section-btn-title">Literatura en 3D</span>
        <span class="section-btn-text">Encuentros con autores y charlas en lugares especiales: fotos, vídeos y crónicas.</span>
        <span class="section-btn-arrow" aria-hidden="true">→</span>
      </a>
    </nav>
    <div class="toolbar">
      <label class="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" placeholder="Buscar por título, autor, tema, lugar…" aria-label="Buscar reseñas" value="${esc(params.get('q') || '')}">
      </label>
    </div>
    <nav class="quick-groups" aria-label="Agrupar reseñas">
      <a class="pill${agrupar ? '' : ' is-active'}" href="${withParams(params, { agrupar: null, page: null })}">Cronológico</a>
      ${Object.entries(GROUPS).map(([key, g]) => `
        <a class="pill${agrupar === key ? ' is-active' : ''}" href="${withParams(params, { agrupar: key, page: null })}">${g.label}</a>`).join('')}
    </nav>
    <div id="filters"></div>
    <div id="results"></div>`;

  const input = app.querySelector('.search input');
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const current = parseHash().params;
      const link = withParams(current, { q: input.value.trim(), page: null });
      history.replaceState(null, '', link);
      renderResults(parseHash().params);
    }, 150);
  });

  renderResults(params);
}

// Encabezado de la página de un autor: su semblanza, tal como la publica su editorial.
function authorBlock(name) {
  const bio = authorBio(name);
  const edit = admin ? `<a class="btn btn-sm" href="#/autor/${encodeURIComponent(slugify(name))}/editar">${bio ? 'Editar semblanza' : 'Añadir semblanza'}</a>` : '';
  if (!bio) return admin ? `<section class="author-bio is-empty fade-in"><p>${esc(name)} aún no tiene semblanza.</p>${edit}</section>` : '';
  const source = bio.editorial || bio.url
    ? `<p class="bio-source">Semblanza publicada por ${bio.url ? `<a href="${esc(bio.url)}" target="_blank" rel="noopener">${esc(bio.editorial || 'su editorial')}</a>` : esc(bio.editorial)}</p>`
    : '';
  return `
    <section class="author-bio fade-in">
      <span class="badge">Sobre el autor</span>
      <h2>${esc(bio.autor)}</h2>
      <div class="prose">${bio.semblanza.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}</div>
      <div class="bio-foot">${source}${edit}</div>
    </section>`;
}

function activeFilters(params) {
  return Object.keys(GROUPS).filter((k) => params.has(k)).map((k) => [k, params.get(k)]);
}

function renderResults(params) {
  const q = norm(params.get('q') || '');
  const agrupar = GROUPS[params.get('agrupar')] ? params.get('agrupar') : '';
  const filters = activeFilters(params);

  const list = sortedReviews().filter((r) => {
    if (!filters.every(([k, v]) => matches(r, k, v))) return false;
    if (!q) return true;
    const haystack = [r.titulo, r.autor, r.texto, r.nacionalidad, r.genero, r.editorial, r.ambientacion, r.idioma, ...(r.temas || [])].join(' ');
    return norm(haystack).includes(q);
  });

  const filtersEl = document.getElementById('filters');
  filtersEl.innerHTML = filters.length || q ? `
    <div class="active-filters">
      <span>Mostrando:</span>
      ${filters.map(([k, v]) => `
        <a class="filter-chip" href="${withParams(params, { [k]: null, page: null })}" title="Quitar filtro">
          ${esc(GROUPS[k].label)}: <b>${esc(v)}</b><span aria-hidden="true">×</span></a>`).join('')}
      ${q ? `<a class="filter-chip" href="${withParams(params, { q: null, page: null })}" title="Quitar búsqueda">Búsqueda: <b>${esc(params.get('q'))}</b><span aria-hidden="true">×</span></a>` : ''}
    </div>` : '';

  if (params.get('autor')) filtersEl.insertAdjacentHTML('beforeend', authorBlock(params.get('autor')));

  const results = document.getElementById('results');

  if (!reviews.length) {
    results.innerHTML = `
      <div class="empty fade-in">
        <h2>Todavía no hay reseñas</h2>
        <p>Publica la primera y empieza a construir la biblioteca del barrio.</p>
        ${admin ? '<a class="btn btn-primary" href="#/nueva">Escribir una reseña</a>' : ''}
      </div>`;
    return;
  }
  if (!list.length) {
    results.innerHTML = `
      <div class="empty fade-in">
        <h2>Sin resultados</h2>
        <p>Ninguna reseña coincide con lo que buscas.</p>
        <a class="btn" href="#/">Ver todas las reseñas</a>
      </div>`;
    return;
  }

  if (agrupar) results.innerHTML = renderGroups(list, agrupar, params);
  else results.innerHTML = renderChronological(list, params, !filters.length && !q);
}

function renderChronological(list, params, showFeatured) {
  const pages = Math.ceil(list.length / PAGE_SIZE);
  const page = Math.min(Math.max(1, parseInt(params.get('page'), 10) || 1), pages);
  const items = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const featured = showFeatured && page === 1 ? items.shift() : null;

  let html = '';
  if (featured) html += featuredCard(featured);
  if (items.length) {
    const title = showFeatured ? 'Reseñas anteriores' : `${list.length} ${list.length === 1 ? 'reseña' : 'reseñas'}`;
    html += `
      <div class="section-title"><h2>${title}</h2>${pages > 1 ? `<small>Página ${page} de ${pages}</small>` : ''}</div>
      <div class="grid">${items.map(card).join('')}</div>`;
  }
  html += pagination(page, pages, params);
  return html;
}

function pagination(page, pages, params) {
  if (pages <= 1) return '';
  const link = (p) => withParams(params, { page: p === 1 ? null : p });
  const nums = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return `
    <nav class="pagination" aria-label="Páginas">
      ${page > 1 ? `<a href="${link(page - 1)}">← Más recientes</a>` : '<span class="disabled">← Más recientes</span>'}
      ${nums.map((p) => (p === '…' ? '<span class="gap">…</span>'
        : p === page ? `<span class="current" aria-current="page">${p}</span>` : `<a href="${link(p)}">${p}</a>`)).join('')}
      ${page < pages ? `<a href="${link(page + 1)}">Más antiguas →</a>` : '<span class="disabled">Más antiguas →</span>'}
    </nav>`;
}

function renderGroups(list, key, params) {
  const groups = new Map();
  for (const r of list) {
    const vals = values(r, key);
    for (const v of vals.length ? vals : [NONE]) {
      const k = norm(v);
      if (!groups.has(k)) groups.set(k, { label: v, items: [] });
      groups.get(k).items.push(r);
    }
  }
  const sorted = [...groups.values()].sort((a, b) => {
    if (a.label === NONE) return 1;
    if (b.label === NONE) return -1;
    if (GROUPS[key].ordered) return b.label.localeCompare(a.label, 'es', { numeric: true });
    return a.label.localeCompare(b.label, 'es', { sensitivity: 'base' });
  });

  const showAll = (g) => withParams(params, { [key]: g.label, agrupar: null, page: null });
  return `
    <div class="section-title"><h2>Por ${GROUPS[key].label.toLowerCase()}</h2><small>${sorted.length} ${sorted.length === 1 ? 'grupo' : 'grupos'}</small></div>
    <div class="group-overview">
      ${sorted.map((g) => `<a class="group-tile" href="${showAll(g)}"><span>${esc(g.label)}</span><span>${g.items.length}</span></a>`).join('')}
    </div>
    ${sorted.map((g) => `
      <section class="group">
        <div class="group-head">
          <h2>${esc(g.label)} <span class="count">${g.items.length}</span></h2>
          ${g.items.length > 4 ? `<a href="${showAll(g)}">Ver las ${g.items.length} →</a>` : ''}
        </div>
        <div class="grid">${g.items.slice(0, 4).map(card).join('')}</div>
      </section>`).join('')}`;
}

function featuredCard(r) {
  return `
    <a class="featured fade-in" href="${reviewLink(r)}">
      <div class="featured-media"><img src="${esc(r.imagen)}" alt="Imagen de la reseña de ${esc(r.titulo)}"></div>
      <div class="featured-body">
        <span class="badge">Última reseña</span>
        <div class="meta-line">
          <span>${fmtDate(r.fecha)}</span>
          ${r.genero ? `<span class="dot"></span><span>${esc(r.genero)}</span>` : ''}
          ${r.nacionalidad ? `<span class="dot"></span><span>${esc(r.nacionalidad)}</span>` : ''}
        </div>
        <h2>${esc(r.titulo)}</h2>
        <div class="byline">de ${esc(r.autor)}</div>
        <p class="excerpt">${esc(excerpt(r.texto, 320))}</p>
        <div class="tags">${(r.temas || []).slice(0, 4).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        <span class="read-more">Leer la reseña</span>
      </div>
    </a>`;
}

function card(r) {
  return `
    <a class="card fade-in" href="${reviewLink(r)}">
      <div class="card-media">${pendingBadge(`resena:${r.id}`)}<img src="${esc(r.imagen)}" alt="Imagen de la reseña de ${esc(r.titulo)}" loading="lazy"></div>
      <div class="card-body">
        <div class="meta-line">
          <span>${fmtDate(r.fecha)}</span>
          ${r.genero ? `<span class="dot"></span><span>${esc(r.genero)}</span>` : ''}
        </div>
        <h3>${esc(r.titulo)}</h3>
        <div class="byline">${esc(r.autor)}${r.nacionalidad ? ` · ${esc(r.nacionalidad)}` : ''}</div>
        <p class="excerpt">${esc(excerpt(r.texto))}</p>
        <div class="card-foot">
          <div class="tags">${(r.temas || []).slice(0, 2).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
          ${stars(r.valoracion)}
        </div>
      </div>
    </a>`;
}

// ---------- Detalle ----------

function renderDetail(id) {
  setActiveNav('');
  const list = sortedReviews();
  const index = list.findIndex((r) => r.id === id);
  const r = list[index];
  if (!r) {
    app.innerHTML = `<div class="empty"><h2>No encontramos esta reseña</h2><p>Puede que se haya eliminado.</p><a class="btn" href="#/">Volver a las reseñas</a></div>`;
    return;
  }
  document.title = `${r.titulo} · El Barrio`;
  const { body, questions } = splitText(r.texto);
  // La lista va de más reciente a más antigua: las anteriores van detrás y las posteriores delante.
  // En ambos bloques se muestran primero las más cercanas a la reseña actual.
  const older = list.slice(index + 1, index + 5);
  const newer = list.slice(Math.max(0, index - 4), index).reverse();
  const position = list.length - index;

  const fact = (label, value, key) => (value ? `
    <div><dt>${label}</dt><dd>${key ? `<a href="${filterLink(key, value)}">${esc(value)}</a>` : value}</dd></div>` : '');

  app.innerHTML = `
    <nav class="review-nav" aria-label="Navegar entre reseñas">
      ${older[0] ? `<a class="prev" href="${reviewLink(older[0])}" title="${esc(older[0].titulo)}">← Anterior</a>` : '<span class="prev disabled">← Anterior</span>'}
      <a class="back" href="#/">Todas las reseñas</a>
      ${newer[0] ? `<a class="next" href="${reviewLink(newer[0])}" title="${esc(newer[0].titulo)}">Siguiente →</a>` : '<span class="next disabled">Siguiente →</span>'}
    </nav>
    <article class="detail fade-in">
      <div class="detail-media">
        ${carousel([r.imagen, ...(r.galeria || [])], `la reseña de ${r.titulo}`)}
        ${admin ? `
        <div class="actions">
          <a class="btn btn-sm" href="#/editar/${encodeURIComponent(r.id)}">Editar</a>
          <button class="btn btn-sm btn-danger" type="button" data-action="delete">Eliminar</button>
        </div>` : ''}
      </div>
      <div class="detail-content">
        <header class="detail-head">
          <span class="badge">${esc(r.genero || 'Reseña')}</span>
          <h1>${esc(r.titulo)}</h1>
          <div class="byline">de <a href="${filterLink('autor', r.autor)}">${esc(r.autor)}</a></div>
          <div class="meta-line">
            <span>${fmtDate(r.fecha)}</span><span class="dot"></span>
            <span>${readingTime(r.texto)}</span><span class="dot"></span>
            <a href="#opiniones" data-action="to-opinions">Comentar</a>
          </div>
        </header>
        <dl class="facts">
          ${fact('Nacionalidad', r.nacionalidad, 'nacionalidad')}
          ${fact('Género', r.genero, 'genero')}
          ${fact('Ambientación', r.ambientacion, 'ambientacion')}
          ${fact('Editorial', r.editorial, 'editorial')}
          ${fact('Idioma original', r.idioma, 'idioma')}
          ${fact('Publicado en', r.anio ? String(r.anio) : '')}
          ${fact('Valoración', stars(r.valoracion))}
        </dl>
        <div class="prose">${body.map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}</div>
        ${questions.length ? `
          <aside class="questions">
            <h3>Para comentar en el club</h3>
            ${questions.map((q) => `<p>${esc(q)}</p>`).join('')}
          </aside>` : ''}
        ${(r.temas || []).length ? `
          <div class="detail-tags">
            <h3>Temáticas</h3>
            <div class="tags">${r.temas.map((t) => `<a class="tag" href="${filterLink('tema', t)}">${esc(t)}</a>`).join('')}</div>
          </div>` : ''}

        <section class="opinions" id="opiniones">
          <h2>¿Lo has leído?</h2>
          <p>La conversación sobre cada libro está en Instagram. Cuéntanos qué te ha parecido en la publicación de esta reseña.</p>
          <a class="btn btn-primary btn-instagram" href="${esc(r.instagram || INSTAGRAM_PROFILE)}" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/></svg>
            ${r.instagram ? 'Comentar en Instagram' : 'Ir a @elbarriolee en Instagram'}</a>
          ${admin && !r.instagram ? '<p class="admin-note">Esta reseña aún no tiene enlace a su publicación: el botón lleva al perfil. Añádelo desde «Editar».</p>' : ''}
        </section>
      </div>
    </article>

    <section class="sequence" aria-label="Otras reseñas">
      <div class="section-title">
        <h2>Seguir leyendo</h2>
        <small>Estás en la reseña ${position} de ${list.length}</small>
      </div>
      ${sequenceBlock('← Reseñas anteriores', 'Publicadas justo antes de esta', older, 'Esta es la primera reseña publicada.')}
      ${sequenceBlock('Reseñas posteriores →', 'Publicadas justo después de esta', newer, 'Esta es la reseña más reciente.')}
    </section>`;

  bindStarClear(app);
  bindCarousel(app.querySelector('.carousel'));

  app.querySelector('[data-action="to-opinions"]').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('opiniones').scrollIntoView({ behavior: 'smooth' });
  });

  app.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    try {
      if (!await deleteEntry(`resena:${r.id}`, r.titulo)) return;
      location.hash = '#/';
    } catch (err) {
      toast(err.message, true);
    }
  });

}

// Carrusel de fotos: la primera es la portada y las flechas recorren el resto.
function carousel(images, label) {
  if (images.length < 2) return `<img src="${esc(images[0])}" alt="Imagen de ${esc(label)}">`;
  return `
    <div class="carousel" tabindex="0" aria-roledescription="carrusel" aria-label="Fotos de ${esc(label)}">
      <div class="carousel-track">
        ${images.map((src, i) => `<img src="${esc(src)}" alt="Foto ${i + 1} de ${images.length} de ${esc(label)}" ${i ? 'loading="lazy"' : ''}>`).join('')}
      </div>
      <button type="button" class="carousel-btn prev" aria-label="Foto anterior">‹</button>
      <button type="button" class="carousel-btn next" aria-label="Foto siguiente">›</button>
      <span class="carousel-count" aria-live="polite">1 / ${images.length}</span>
      <div class="carousel-dots">
        ${images.map((_, i) => `<button type="button" aria-label="Ver foto ${i + 1}"${i ? '' : ' aria-current="true"'}></button>`).join('')}
      </div>
    </div>`;
}

function bindCarousel(root) {
  if (!root) return;
  const track = root.querySelector('.carousel-track');
  const dots = [...root.querySelectorAll('.carousel-dots button')];
  const count = root.querySelector('.carousel-count');
  const total = dots.length;
  let index = 0;
  const go = (i) => {
    index = (i + total) % total;
    track.style.transform = `translateX(-${index * 100}%)`;
    count.textContent = `${index + 1} / ${total}`;
    dots.forEach((d, k) => (k === index ? d.setAttribute('aria-current', 'true') : d.removeAttribute('aria-current')));
  };
  root.querySelector('.prev').addEventListener('click', () => go(index - 1));
  root.querySelector('.next').addEventListener('click', () => go(index + 1));
  dots.forEach((d, k) => d.addEventListener('click', () => go(k)));
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') go(index - 1);
    if (e.key === 'ArrowRight') go(index + 1);
  });
  // Deslizar con el dedo en el móvil.
  let startX = null;
  root.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  root.addEventListener('touchend', (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
    startX = null;
  });
}

function sequenceBlock(title, hint, items, emptyText) {
  return `
    <div class="sequence-block">
      <div class="sequence-head"><h3>${title}</h3><small>${items.length ? hint : ''}</small></div>
      ${items.length ? `<div class="grid">${items.map(card).join('')}</div>` : `<p class="sequence-empty">${emptyText}</p>`}
    </div>`;
}

// ---------- Literatura en 3D ----------

const encounterLink = (e) => `#/literatura-3d/${encodeURIComponent(e.id)}`;

function mediaSummary(e) {
  const photos = e.medios.filter((m) => m.tipo === 'imagen').length;
  const videos = e.medios.length - photos;
  return [photos && `${photos} ${photos === 1 ? 'foto' : 'fotos'}`, videos && `${videos} ${videos === 1 ? 'vídeo' : 'vídeos'}`]
    .filter(Boolean).join(' · ') || 'Sin fotos';
}

function encounterCard(e) {
  return `
    <a class="card fade-in" href="${encounterLink(e)}">
      <div class="card-media">${pendingBadge(`encuentro:${e.id}`)}<img src="${esc(e.portada || 'img/logo.jpg')}" alt="${esc(e.titulo)}" loading="lazy"></div>
      <div class="card-body">
        <div class="meta-line"><span>${fmtDate(e.fecha)}</span><span class="dot"></span><span>${esc(e.lugar)}</span></div>
        <h3>${esc(e.titulo)}</h3>
        <p class="excerpt">${esc(excerpt(e.texto))}</p>
        <div class="card-foot"><span>${mediaSummary(e)}</span></div>
      </div>
    </a>`;
}

function renderEncounters() {
  setActiveNav('');
  document.title = 'Literatura en 3D · El Barrio';
  app.innerHTML = `
    <a class="back" href="#/">← Todas las reseñas</a>
    <section class="intro intro-3d fade-in">
      <div>
        <h1>Literatura <em>en 3D</em></h1>
        <p>Cuando los libros salen del papel: encuentros con autores y charlas en lugares especiales.</p>
        ${admin ? '<a class="btn btn-primary" href="#/literatura-3d/nuevo">+ Nuevo encuentro</a>' : ''}
      </div>
      <div class="stats"><div class="stat"><strong>${encounters.length}</strong><span>encuentros</span></div></div>
    </section>
    ${encounters.length
    ? `<div class="grid">${encounters.map(encounterCard).join('')}</div>`
    : '<div class="empty"><h2>Todavía no hay encuentros</h2></div>'}`;
}

function renderEncounter(id) {
  setActiveNav('');
  const index = encounters.findIndex((e) => e.id === id);
  const e = encounters[index];
  if (!e) {
    app.innerHTML = `<div class="empty"><h2>No encontramos este encuentro</h2><a class="btn" href="#/literatura-3d">Volver a Literatura en 3D</a></div>`;
    return;
  }
  document.title = `${e.titulo} · Literatura en 3D · El Barrio`;
  // Igual que en las reseñas: la lista va de más reciente a más antiguo.
  const older = encounters[index + 1];
  const newer = encounters[index - 1];

  app.innerHTML = `
    <nav class="review-nav" aria-label="Navegar entre encuentros">
      ${older ? `<a class="prev" href="${encounterLink(older)}" title="${esc(older.titulo)}">← Anterior</a>` : '<span class="prev disabled">← Anterior</span>'}
      <a class="back" href="#/literatura-3d">Literatura en 3D</a>
      ${newer ? `<a class="next" href="${encounterLink(newer)}" title="${esc(newer.titulo)}">Siguiente →</a>` : '<span class="next disabled">Siguiente →</span>'}
    </nav>
    <article class="encounter fade-in">
      <header class="detail-head">
        <span class="badge">Literatura en 3D</span>
        <h1>${esc(e.titulo)}</h1>
        <div class="meta-line"><span>${fmtDate(e.fecha)}</span><span class="dot"></span><span>${esc(e.lugar)}</span><span class="dot"></span><span>${mediaSummary(e)}</span></div>
        ${admin ? `<div class="actions"><a class="btn btn-sm" href="${encounterLink(e)}/editar">Editar</a>
          <button class="btn btn-sm btn-danger" type="button" data-action="delete-encounter">Eliminar</button></div>` : ''}
      </header>
      <div class="gallery">
        ${e.medios.map((m, i) => (m.tipo === 'video'
    ? `<video class="gallery-item is-video" src="${esc(m.src)}" poster="${esc(m.poster)}" controls playsinline preload="none"></video>`
    : `<button class="gallery-item" type="button" data-zoom="${i}"><img src="${esc(m.src)}" alt="Foto ${i + 1} de ${esc(e.titulo)}" loading="lazy"></button>`)).join('')}
      </div>
      <div class="prose encounter-text">${e.texto.split(/\n{2,}/).map((p) => `<p>${linkify(esc(p)).replace(/\n/g, '<br>')}</p>`).join('')}</div>
    </article>
    <dialog class="lightbox" aria-label="Foto ampliada">
      <img alt="">
      <button type="button" class="lightbox-close" aria-label="Cerrar">×</button>
      <button type="button" class="lightbox-nav prev" aria-label="Foto anterior">‹</button>
      <button type="button" class="lightbox-nav next" aria-label="Foto siguiente">›</button>
      <span class="lightbox-count" aria-live="polite"></span>
    </dialog>`;

  app.querySelector('[data-action="delete-encounter"]')?.addEventListener('click', async () => {
    try {
      if (!await deleteEntry(`encuentro:${e.id}`, e.titulo)) return;
      location.hash = '#/literatura-3d';
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Visor ampliado: recorre solo las fotos de la entrada (los vídeos se ven en la propia página).
  const dialog = app.querySelector('.lightbox');
  const big = dialog.querySelector('img');
  const count = dialog.querySelector('.lightbox-count');
  const zoomButtons = [...app.querySelectorAll('[data-zoom]')];
  const photos = zoomButtons.map((btn) => ({ src: e.medios[Number(btn.dataset.zoom)].src, alt: btn.querySelector('img').alt }));
  let current = 0;
  const show = (i) => {
    current = (i + photos.length) % photos.length;
    big.src = photos[current].src;
    big.alt = photos[current].alt;
    count.textContent = `${current + 1} / ${photos.length}`;
  };
  dialog.classList.toggle('single', photos.length < 2);
  zoomButtons.forEach((btn, i) => btn.addEventListener('click', () => {
    show(i);
    dialog.showModal();
  }));
  dialog.querySelector('.prev').addEventListener('click', () => show(current - 1));
  dialog.querySelector('.next').addEventListener('click', () => show(current + 1));
  dialog.querySelector('.lightbox-close').addEventListener('click', () => dialog.close());
  // También se cierra con Esc o pulsando en el fondo oscuro.
  dialog.addEventListener('click', (ev) => { if (ev.target === dialog) dialog.close(); });
  dialog.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowLeft') show(current - 1);
    if (ev.key === 'ArrowRight') show(current + 1);
  });
  let startX = null;
  dialog.addEventListener('touchstart', (ev) => { startX = ev.touches[0].clientX; }, { passive: true });
  dialog.addEventListener('touchend', (ev) => {
    if (startX === null) return;
    const dx = ev.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) show(current + (dx < 0 ? 1 : -1));
    startX = null;
  });
}

// Crear (id vacío) o editar un encuentro: textos, fotos y vídeos, y la portada.
function renderEncounterForm(id) {
  setActiveNav('');
  const existing = id ? encounters.find((x) => x.id === id) : null;
  if (id && !existing) {
    app.innerHTML = `<div class="empty"><h2>No encontramos este encuentro</h2><a class="btn" href="#/literatura-3d">Volver a Literatura en 3D</a></div>`;
    return;
  }
  document.title = `${existing ? 'Editar encuentro' : 'Nuevo encuentro'} · El Barrio`;
  const e = existing || { titulo: '', lugar: '', fecha: today(), texto: '', medios: [] };
  const backLink = existing ? encounterLink(existing) : '#/literatura-3d';

  // Cada elemento es un archivo ya publicado ({ src, poster }) o uno nuevo pendiente de subir ({ file }).
  let nextKey = 0;
  let items = e.medios.map((m) => ({ ...m, key: nextKey++, preview: coverOf(m) }));
  let coverKey = items.find((it) => it.preview && it.preview === e.portada)?.key ?? null;

  app.innerHTML = `
    <div class="form-page fade-in">
      <a class="back" href="${backLink}">← ${existing ? 'Volver al encuentro' : 'Volver a Literatura en 3D'}</a>
      <h1>${existing ? 'Editar encuentro' : 'Nuevo encuentro'}</h1>
      <p>${existing ? 'Adapta el título, el lugar y el texto al formato de la web, añade o quita fotos y vídeos y elige la portada.' : 'Cuenta el encuentro y añade sus fotos y vídeos. La primera foto será la portada, salvo que elijas otra.'}</p>
      <form class="form-card encounter-form" novalidate>
        <div class="field-row">
          <div class="field"><label for="e-titulo">Título <span class="req">*</span></label>
            <input id="e-titulo" name="titulo" maxlength="200" value="${esc(e.titulo)}" autocomplete="off"></div>
          <div class="field"><label for="e-fecha">Fecha <span class="req">*</span></label>
            <input id="e-fecha" name="fecha" type="date" value="${esc(e.fecha)}"></div>
        </div>
        <div class="field"><label for="e-lugar">Lugar</label>
          <input id="e-lugar" name="lugar" maxlength="200" value="${esc(e.lugar)}" autocomplete="off"></div>
        <div class="field"><label for="e-texto">Texto <span class="req">*</span>
          <span class="hint">Deja una línea en blanco entre párrafos.</span></label>
          <textarea id="e-texto" name="texto" class="tall">${esc(e.texto)}</textarea></div>
        <div class="field"><span class="label">Fotos y vídeos <span class="hint">Pulsa una imagen para hacerla portada</span></span>
          <div class="media-manager"></div>
          <label class="media-drop">
            <input type="file" accept="image/*,video/mp4,video/webm,video/quicktime,.mov" multiple>
            <strong>Añadir fotos o vídeos</strong>
            <span>Arrástralos aquí o haz clic. Las fotos se optimizan solas; los vídeos, hasta 400 MB (MP4 o MOV).</span>
          </label></div>
        <div class="form-actions">
          ${existing ? '<button type="button" class="btn btn-ghost btn-danger-text form-delete" data-form-delete>Eliminar encuentro</button>' : ''}
          <a class="btn btn-ghost" href="${backLink}">Cancelar</a>
          <button class="btn btn-primary" type="submit">${existing ? 'Guardar cambios' : 'Publicar encuentro'}</button>
        </div>
      </form>
    </div>`;

  const form = app.querySelector('form');
  form.querySelector('[data-form-delete]')?.addEventListener('click', async () => {
    try {
      if (await deleteEntry(`encuentro:${existing.id}`, existing.titulo)) location.hash = '#/literatura-3d';
    } catch (err) {
      toast(err.message, true);
    }
  });
  const manager = form.querySelector('.media-manager');
  const drop = form.querySelector('.media-drop');
  const fileInput = drop.querySelector('input');

  const drawMedia = () => {
    if (coverKey === null || !items.some((it) => it.key === coverKey && it.preview)) {
      coverKey = items.find((it) => it.preview)?.key ?? null;
    }
    manager.innerHTML = items.length ? items.map((it) => `
      <div class="media-tile${it.key === coverKey ? ' is-cover' : ''}">
        <button type="button" class="media-pick" data-pick="${it.key}" ${it.preview ? '' : 'disabled'}
          aria-pressed="${it.key === coverKey}" title="${it.preview ? 'Usar como portada' : 'Este vídeo no tiene imagen para portada'}">
          ${it.preview ? `<img src="${esc(it.preview)}" alt="">` : '<span class="media-noimg">Vídeo</span>'}
        </button>
        ${it.tipo === 'video' ? '<span class="media-badge">▶ Vídeo</span>' : ''}
        ${it.key === coverKey ? '<span class="media-badge is-cover">Portada</span>' : ''}
        ${it.file ? '<span class="media-badge is-new">Nuevo</span>' : ''}
        <button type="button" class="media-remove" data-remove="${it.key}" aria-label="Quitar">×</button>
      </div>`).join('') : '<p class="media-empty">Todavía no hay fotos ni vídeos.</p>';
  };
  drawMedia();

  manager.addEventListener('click', (ev) => {
    const pick = ev.target.closest('[data-pick]');
    const remove = ev.target.closest('[data-remove]');
    if (pick) coverKey = Number(pick.dataset.pick);
    if (remove) {
      const it = items.find((x) => x.key === Number(remove.dataset.remove));
      if (!it.file && !confirm('¿Quitar este archivo del encuentro? Se borrará al guardar.')) return;
      if (it.file && it.preview) URL.revokeObjectURL(it.preview);
      items = items.filter((x) => x !== it);
    }
    drawMedia();
  });

  const addFiles = async (files) => {
    for (const file of files) {
      const type = mediaType(file);
      if (!type) {
        toast(`«${file.name}» no es una foto ni un vídeo compatible`, true);
        continue;
      }
      const it = { key: nextKey++, tipo: type.startsWith('video/') ? 'video' : 'imagen', file, type };
      if (it.tipo === 'video') {
        it.posterBlob = await videoPoster(file).catch(() => null);
        it.preview = it.posterBlob ? URL.createObjectURL(it.posterBlob) : '';
      } else {
        it.preview = URL.createObjectURL(file);
      }
      items.push(it);
    }
    drawMedia();
  };
  fileInput.addEventListener('change', () => {
    addFiles([...fileInput.files]);
    fileInput.value = '';
  });
  ['dragenter', 'dragover'].forEach((n) => drop.addEventListener(n, (ev) => { ev.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((n) => drop.addEventListener(n, () => drop.classList.remove('is-over')));
  drop.addEventListener('drop', (ev) => {
    ev.preventDefault();
    addFiles([...ev.dataTransfer.files]);
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    const payload = {
      titulo: String(data.get('titulo') || '').trim(),
      lugar: String(data.get('lugar') || '').trim(),
      fecha: data.get('fecha'),
      texto: String(data.get('texto') || '').trim(),
    };
    if (!payload.titulo) return toast('Falta el título del encuentro', true);
    if (!payload.fecha) return toast('Falta la fecha', true);
    if (!payload.texto) return toast('Falta el texto', true);

    const button = form.querySelector('[type="submit"]');
    const label = button.textContent;
    button.disabled = true;
    const cover = items.find((it) => it.key === coverKey);
    const pending = items.filter((it) => it.file);
    let saved = null;
    try {
      button.textContent = 'Guardando…';
      saved = existing
        ? await api('PUT', `/api/encuentros/${encodeURIComponent(existing.id)}`, {
          ...payload, medios: items.filter((it) => !it.file).map((it) => it.src), portada: cover && !cover.file ? coverOf(cover) : undefined,
        })
        : await api('POST', '/api/encuentros', payload);
      const base = `/api/encuentros/${encodeURIComponent(saved.id)}/medios`;
      for (const [i, it] of pending.entries()) {
        button.textContent = `Subiendo ${i + 1} de ${pending.length}…`;
        const body = it.tipo === 'imagen' && it.type !== 'image/gif' ? await imageBlob(it.file) : it.file.slice(0, it.file.size, it.type);
        const medio = await uploadFile(base, body);
        if (it.posterBlob) Object.assign(medio, await uploadFile(`${base}?para=${encodeURIComponent(medio.src)}`, it.posterBlob));
        it.uploaded = medio;
      }
      // La portada elegida entre los archivos nuevos solo tiene dirección una vez subida.
      if (cover && cover.file && cover.uploaded) {
        saved = await api('PUT', `/api/encuentros/${encodeURIComponent(saved.id)}`, { ...payload, portada: coverOf(cover.uploaded) });
      }
      items.forEach((it) => { if (it.file && it.preview) URL.revokeObjectURL(it.preview); });
      toast(existing ? 'Cambios guardados' : 'Encuentro publicado');
      location.hash = encounterLink(saved);
    } catch (err) {
      button.disabled = false;
      button.textContent = label;
      if (saved && !existing) {
        // El texto ya está publicado: se sigue desde la edición para no duplicar la entrada.
        toast(`Se guardó el encuentro, pero falló una subida: ${err.message}`, true);
        location.hash = `${encounterLink(saved)}/editar`;
        return;
      }
      toast(err.message, true);
    }
  });
}

const coverOf = (m) => (m.tipo === 'video' ? m.poster : m.src);

// Algunos navegadores no informan del tipo de los .mov; se deduce por la extensión.
function mediaType(file) {
  if (/^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime))$/.test(file.type)) return file.type;
  if (/\.mov$/i.test(file.name)) return 'video/quicktime';
  if (/\.mp4$/i.test(file.name)) return 'video/mp4';
  if (/^image\//.test(file.type)) return 'image/jpeg';
  return '';
}

async function uploadFile(url, blob) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && admin) setAdmin(false);
  if (!res.ok) throw new Error(data.error || 'No se pudo subir el archivo.');
  return data;
}

// Fotograma de cerca del principio del vídeo, para usarlo de carátula.
async function videoPoster(file) {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.src = url;
    const once = (name) => new Promise((resolve, reject) => {
      video.addEventListener(name, resolve, { once: true });
      video.addEventListener('error', reject, { once: true });
      setTimeout(() => reject(new Error('timeout')), 15000);
    });
    await once('loadeddata');
    video.currentTime = Math.min(1, (video.duration || 0) / 2);
    await once('seeked');
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) throw new Error('sin imagen');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- A la búsqueda del Grial ----------

function renderGrail() {
  setActiveNav('');
  document.title = 'A la búsqueda del Grial · El Barrio';
  const list = sortedReviews();
  app.innerHTML = `
    <a class="back" href="#/">← Inicio</a>
    <section class="intro intro-3d fade-in">
      <div>
        <h1>A la búsqueda <em>del Grial</em></h1>
        <p>Un recorrido por todos los libros leídos en busca de la lectura perfecta para nuestros encuentros.</p>
        ${admin ? '<a class="btn btn-primary" href="#/nueva">+ Nueva reseña</a>' : ''}
      </div>
      <div class="stats"><div class="stat"><strong>${list.length}</strong><span>reseñas</span></div></div>
    </section>
    <div class="toolbar">
      <label class="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" placeholder="Buscar por título, autor, tema, lugar…" aria-label="Buscar reseñas">
      </label>
    </div>
    <div class="grid grail-grid">${list.map(card).join('')}</div>
    <p class="sequence-empty grail-empty" hidden>Ninguna reseña coincide con la búsqueda.</p>`;

  // Filtra las tarjetas ya pintadas sin volver a cargar la página.
  const cards = [...app.querySelectorAll('.grail-grid .card')];
  const haystacks = list.map((r) => norm([r.titulo, r.autor, r.texto, r.nacionalidad, r.genero, r.editorial, r.ambientacion, r.idioma, ...(r.temas || [])].join(' ')));
  const input = app.querySelector('.search input');
  input.addEventListener('input', () => {
    const terms = norm(input.value).split(/\s+/).filter(Boolean);
    let shown = 0;
    cards.forEach((c, i) => {
      const ok = terms.every((t) => haystacks[i].includes(t));
      c.hidden = !ok;
      if (ok) shown++;
    });
    app.querySelector('.grail-empty').hidden = shown > 0;
  });
}

// Convierte en enlace las direcciones web que aparecen en las crónicas.
function linkify(html) {
  return html.replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
}

function starInput(name, value) {
  let html = `<div class="star-row"><div class="star-input" role="radiogroup" aria-label="Valoración">`;
  for (let i = 5; i >= 1; i--) {
    html += `<input type="radio" id="${name}-${i}" name="${name}" value="${i}" aria-label="${starsLabel(i)}"${value === i ? ' checked' : ''}>
      <label for="${name}-${i}" title="${starsLabel(i)}">★</label>`;
  }
  return `${html}</div><button type="button" class="clear" data-clear="${name}">Sin valorar</button></div>`;
}

function bindStarClear(root) {
  root.querySelectorAll('[data-clear]').forEach((btn) => btn.addEventListener('click', () => {
    root.querySelectorAll(`input[name="${btn.dataset.clear}"]`).forEach((input) => { input.checked = false; });
  }));
}

// ---------- Formulario de reseña ----------

function renderForm(existing, missingId) {
  setActiveNav(existing ? '' : 'nueva');
  if (missingId && !existing) {
    app.innerHTML = `<div class="empty"><h2>No encontramos esta reseña</h2><p>Puede que se haya eliminado.</p><a class="btn" href="#/">Volver a las reseñas</a></div>`;
    return;
  }
  document.title = `${existing ? 'Editar reseña' : 'Nueva reseña'} · El Barrio`;
  const r = existing || { fecha: today(), temas: [] };
  let temas = [...(r.temas || [])];
  // Portada y galería: cada foto es una que ya tiene la reseña ({ src }) o una nueva ({ data }).
  let cover = r.imagen ? { src: r.imagen } : null;
  let gallery = (r.galeria || []).map((src) => ({ src }));

  const datalist = (key) => `<datalist id="dl-${key}">${distinct(key).map((d) => `<option value="${esc(d.label)}">`).join('')}</datalist>`;
  const input = (name, label, opts = {}) => `
    <div class="field">
      <label for="f-${name}">${label}${opts.required ? ' <span class="req">*</span>' : ''}${opts.hint ? ` <span class="hint">${opts.hint}</span>` : ''}</label>
      <input id="f-${name}" name="${name}" value="${esc(r[name] ?? '')}" ${opts.list ? `list="dl-${opts.list}"` : ''}
        ${opts.attrs || ''} autocomplete="off">
    </div>`;

  app.innerHTML = `
    <div class="form-page fade-in">
      <a class="back" href="${existing ? reviewLink(existing) : '#/'}">← ${existing ? 'Volver a la reseña' : 'Volver a las reseñas'}</a>
      <h1>${existing ? 'Editar reseña' : 'Nueva reseña'}</h1>
      <p>La nacionalidad, las temáticas y el resto de datos sirven para agrupar las reseñas.</p>
      <form class="form-layout" novalidate>
        <div>
          <div class="dropzone${r.imagen ? ' has-image' : ''}">
            <input type="file" accept="image/*" multiple aria-label="Portada de la reseña">
            ${r.imagen ? `<img src="${esc(r.imagen)}" alt="">` : ''}
            <div class="dz-text">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>
              <strong>Arrastra aquí la portada</strong>o haz clic para elegirla. Si eliges varias fotos, el resto irá a la galería.
            </div>
          </div>
          <p class="dz-change">${r.imagen ? 'Haz clic en la imagen para cambiarla.' : 'JPG, PNG o WebP. Se optimiza automáticamente.'}</p>
          <div class="review-gallery">
            <span class="label">Más fotos <span class="hint">Salen en el carrusel, después de la portada</span></span>
            <div class="gallery-manager"></div>
            <label class="media-drop">
              <input type="file" accept="image/*" multiple aria-label="Añadir fotos a la galería">
              <strong>Añadir fotos</strong>
              <span>Arrástralas aquí o haz clic. Puedes elegir varias a la vez.</span>
            </label>
          </div>
        </div>

        <div class="form-card">
          <div class="field-row">
            ${input('titulo', 'Título del libro', { required: true, attrs: 'maxlength="200"' })}
            ${input('autor', 'Autor o autora', { required: true, list: 'autor', attrs: 'maxlength="200"' })}
          </div>
          <div class="field-row">
            ${input('nacionalidad', 'Nacionalidad del autor', { list: 'nacionalidad', attrs: 'placeholder="Española, Argentina…"' })}
            ${input('genero', 'Género', { list: 'genero', attrs: 'placeholder="Novela, Ensayo, Poesía…"' })}
          </div>
          <div class="field">
            <span class="label">Temáticas <span class="hint">Pulsa Intro o coma para añadir cada una</span></span>
            <div class="tag-input"><input aria-label="Añadir temática" placeholder="Memoria, Guerra civil, Familia…" list="dl-tema"></div>
            <div class="suggestions"></div>
          </div>
          <div class="field-row">
            ${input('ambientacion', 'Ambientación', { list: 'ambientacion', attrs: 'placeholder="Lugar donde transcurre"' })}
            ${input('editorial', 'Editorial', { list: 'editorial' })}
          </div>
          <div class="field-row">
            ${input('idioma', 'Idioma original', { list: 'idioma' })}
            ${input('anio', 'Año de publicación', { attrs: 'inputmode="numeric" maxlength="4" placeholder="2024"' })}
            ${input('fecha', 'Fecha de la reseña', { attrs: 'type="date"' })}
          </div>
          ${input('instagram', 'Enlace al post de Instagram', { hint: 'Ahí comentan los lectores. En Instagram: ··· › Copiar enlace', attrs: 'type="url" placeholder="https://www.instagram.com/p/…"' })}
          <div class="field"><span class="label">Valoración del club <span class="hint">(opcional)</span></span>${starInput('valoracion', r.valoracion)}</div>
          <div class="field">
            <label for="f-texto">Texto de la reseña <span class="req">*</span>
              <span class="hint">Puedes pegarlo tal cual. Si empieza por «Título, de Autor» rellenamos esos campos, y las preguntas finales (¿…?) se destacan.</span></label>
            <textarea id="f-texto" name="texto">${esc(r.texto || '')}</textarea>
          </div>
          <div class="form-actions">
            ${existing ? '<button type="button" class="btn btn-ghost btn-danger-text form-delete" data-form-delete>Eliminar reseña</button>' : ''}
            <a class="btn btn-ghost" href="${existing ? reviewLink(existing) : '#/'}">Cancelar</a>
            <button class="btn btn-primary" type="submit">${existing ? 'Guardar cambios' : 'Publicar reseña'}</button>
          </div>
        </div>
        ${['autor', 'nacionalidad', 'genero', 'tema', 'ambientacion', 'editorial', 'idioma'].map(datalist).join('')}
      </form>
    </div>`;

  const form = app.querySelector('form');
  form.querySelector('[data-form-delete]')?.addEventListener('click', async () => {
    try {
      if (await deleteEntry(`resena:${existing.id}`, existing.titulo)) location.hash = '#/';
    } catch (err) {
      toast(err.message, true);
    }
  });
  bindStarClear(form);

  // --- Temáticas ---
  const tagBox = form.querySelector('.tag-input');
  const tagInput = tagBox.querySelector('input');
  const suggestions = form.querySelector('.suggestions');
  const renderTags = () => {
    tagBox.querySelectorAll('.tag').forEach((t) => t.remove());
    temas.forEach((t, i) => {
      const chip = document.createElement('span');
      chip.className = 'tag';
      chip.innerHTML = `${esc(t)}<button type="button" aria-label="Quitar ${esc(t)}">×</button>`;
      chip.querySelector('button').addEventListener('click', () => { temas.splice(i, 1); renderTags(); });
      tagBox.insertBefore(chip, tagInput);
    });
    const used = new Set(temas.map(norm));
    const options = distinct('tema').filter((d) => !used.has(norm(d.label))).slice(0, 12);
    suggestions.innerHTML = options.map((d) => `<button type="button">+ ${esc(d.label)}</button>`).join('');
    suggestions.querySelectorAll('button').forEach((b, i) => b.addEventListener('click', () => {
      if (tagInput.value.trim()) addTag(tagInput.value);
      addTag(options[i].label);
    }));
  };
  const addTag = (value) => {
    const v = value.trim().replace(/,$/, '').trim();
    if (v && !temas.some((t) => norm(t) === norm(v))) temas.push(v);
    tagInput.value = '';
    renderTags();
  };
  tagBox.addEventListener('click', () => tagInput.focus());
  // Sin esto, el blur del campo redibuja las sugerencias y el clic se pierde.
  suggestions.addEventListener('mousedown', (e) => e.preventDefault());
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagInput.value);
    } else if (e.key === 'Backspace' && !tagInput.value && temas.length) {
      temas.pop();
      renderTags();
    }
  });
  tagInput.addEventListener('change', () => { if (tagInput.value.includes(',') || distinct('tema').some((d) => d.label === tagInput.value)) addTag(tagInput.value); });
  tagInput.addEventListener('blur', () => { if (tagInput.value.trim()) addTag(tagInput.value); });
  renderTags();

  // --- Portada y galería ---
  const dropzone = form.querySelector('.dropzone');
  const fileInput = dropzone.querySelector('input[type="file"]');
  const galleryBox = form.querySelector('.gallery-manager');
  const galleryDrop = form.querySelector('.review-gallery .media-drop');
  const galleryInput = galleryDrop.querySelector('input');
  const preview = (photo) => photo.data || photo.src;

  const drawCover = () => {
    let img = dropzone.querySelector('img');
    if (!cover) {
      img?.remove();
      dropzone.classList.remove('has-image');
      return;
    }
    if (!img) {
      img = document.createElement('img');
      img.alt = '';
      dropzone.insertBefore(img, dropzone.querySelector('.dz-text'));
    }
    img.src = preview(cover);
    dropzone.classList.add('has-image');
    form.querySelector('.dz-change').textContent = 'Haz clic en la portada para cambiarla.';
  };

  const drawGallery = () => {
    galleryBox.innerHTML = gallery.length ? gallery.map((photo, i) => `
      <div class="media-tile">
        <img class="media-thumb" src="${esc(preview(photo))}" alt="Foto ${i + 2}">
        ${photo.data ? '<span class="media-badge is-new">Nueva</span>' : ''}
        <button type="button" class="media-remove" data-remove="${i}" aria-label="Quitar foto" title="Quitar">×</button>
        <span class="media-tools">
          <button type="button" data-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Mover a la izquierda" title="Mover a la izquierda">‹</button>
          <button type="button" data-cover="${i}" title="Usar como portada">Portada</button>
          <button type="button" data-move="${i}" data-dir="1" ${i === gallery.length - 1 ? 'disabled' : ''} aria-label="Mover a la derecha" title="Mover a la derecha">›</button>
        </span>
      </div>`).join('') : '<p class="media-empty">Solo la portada. Añade aquí el resto de fotos de la reseña.</p>';
  };
  drawCover();
  drawGallery();

  const readPhotos = async (files) => {
    const photos = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        toast(`«${file.name}» no es una imagen`, true);
        continue;
      }
      try {
        photos.push({ data: await optimizeImage(file) });
      } catch {
        toast(`No hemos podido leer «${file.name}»`, true);
      }
    }
    return photos;
  };
  // En la portada: la primera foto la sustituye y, si hay más, van a la galería.
  const setCover = async (files) => {
    const photos = await readPhotos([...files]);
    if (!photos.length) return;
    cover = photos[0];
    gallery.push(...photos.slice(1));
    drawCover();
    drawGallery();
  };
  const addToGallery = async (files) => {
    const photos = await readPhotos([...files]);
    gallery.push(...photos);
    if (!cover && gallery.length) cover = gallery.shift();
    drawCover();
    drawGallery();
  };

  fileInput.addEventListener('change', () => {
    setCover(fileInput.files);
    fileInput.value = '';
  });
  galleryInput.addEventListener('change', () => {
    addToGallery(galleryInput.files);
    galleryInput.value = '';
  });
  for (const [zone, handler] of [[dropzone, setCover], [galleryDrop, addToGallery]]) {
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, () => zone.classList.remove('is-over')));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      handler(e.dataTransfer.files);
    });
  }
  galleryBox.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    if (btn.dataset.remove) gallery.splice(Number(btn.dataset.remove), 1);
    if (btn.dataset.move) {
      const i = Number(btn.dataset.move);
      const j = i + Number(btn.dataset.dir);
      [gallery[i], gallery[j]] = [gallery[j], gallery[i]];
    }
    if (btn.dataset.cover) {
      // La portada anterior pasa a ocupar el sitio de la foto elegida.
      const i = Number(btn.dataset.cover);
      const chosen = gallery[i];
      if (cover) gallery[i] = cover;
      else gallery.splice(i, 1);
      cover = chosen;
      drawCover();
    }
    drawGallery();
  });

  // --- Autorrelleno de título y autor desde el texto pegado ---
  const texto = form.querySelector('#f-texto');
  const autofill = () => {
    const [first, ...rest] = texto.value.split('\n');
    const m = /^\s*(.{1,150}?),\s+de\s+(.{1,100}?)\s*$/i.exec(first || '');
    if (!m || !rest.join('').trim()) return;
    const titulo = form.querySelector('#f-titulo');
    const autor = form.querySelector('#f-autor');
    if (titulo.value.trim() || autor.value.trim()) return;
    titulo.value = m[1].trim();
    autor.value = m[2].trim();
    texto.value = rest.join('\n').replace(/^\s*\n/, '');
    toast('Hemos rellenado el título y el autor a partir del texto');
  };
  texto.addEventListener('paste', () => setTimeout(autofill, 0));
  texto.addEventListener('blur', autofill);

  // --- Envío ---
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (tagInput.value.trim()) addTag(tagInput.value);
    const data = new FormData(form);
    const payload = {
      titulo: data.get('titulo'),
      autor: data.get('autor'),
      nacionalidad: data.get('nacionalidad'),
      genero: data.get('genero'),
      temas,
      ambientacion: data.get('ambientacion'),
      editorial: data.get('editorial'),
      idioma: data.get('idioma'),
      anio: data.get('anio'),
      fecha: data.get('fecha'),
      valoracion: data.get('valoracion'),
      texto: data.get('texto'),
      instagram: data.get('instagram'),
    };
    const missing = [
      [!String(payload.titulo).trim(), 'el título', '#f-titulo'],
      [!String(payload.autor).trim(), 'el autor', '#f-autor'],
      [!String(payload.texto).trim(), 'el texto de la reseña', '#f-texto'],
      [!cover, 'la portada (una imagen)', null],
    ].find(([cond]) => cond);
    if (missing) {
      toast(`Falta ${missing[1]}`, true);
      if (missing[2]) form.querySelector(missing[2]).focus();
      return;
    }
    if (payload.anio && !/^\d{3,4}$/.test(String(payload.anio).trim())) {
      toast('El año de publicación debe ser un número, por ejemplo 2024', true);
      form.querySelector('#f-anio').focus();
      return;
    }
    payload.imagen = cover.data || cover.src;
    payload.galeria = gallery.map((photo) => photo.data || photo.src);

    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = gallery.some((p) => p.data) || cover.data ? 'Subiendo fotos…' : 'Guardando…';
    try {
      const saved = existing
        ? await api('PUT', `/api/resenas/${encodeURIComponent(existing.id)}`, payload)
        : await api('POST', '/api/resenas', payload);
      await loadReviews();
      toast(existing ? 'Cambios guardados' : '¡Reseña publicada!');
      location.hash = reviewLink(saved);
    } catch (err) {
      toast(err.message, true);
      button.disabled = false;
      button.textContent = existing ? 'Guardar cambios' : 'Publicar reseña';
    }
  });
}

// Reduce la imagen a 1600 px como máximo y la convierte a JPEG para que pese poco.
async function optimizeImage(file) {
  return (await scaledCanvas(file, 1600)).toDataURL('image/jpeg', 0.86);
}

async function imageBlob(file) {
  const canvas = await scaledCanvas(file, 2000);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
}

async function scaledCanvas(file, max) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- Aviso legal y privacidad ----------

const CONTACT_EMAIL = 'elbarriolee@gmail.com';

function renderLegal() {
  setActiveNav('');
  document.title = 'Aviso legal y privacidad · El Barrio';
  const mail = `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`;
  app.innerHTML = `
    <article class="legal-page fade-in">
      <a class="back" href="#/">← Inicio</a>
      <h1>Aviso legal y privacidad</h1>
      <p class="hint">Última actualización: 28 de noviembre de 2026</p>
      <div class="prose">
        <h2>Quién está detrás de esta web</h2>
        <ul>
          <li><strong>Titular:</strong> Tomás Nevado</li>
          <li><strong>Contacto:</strong> ${mail}</li>
          <li><strong>Web:</strong> elbarriolee.club</li>
        </ul>
        <p>El Barrio es un club de lectura de Ronda. Esta web es un proyecto cultural sin ánimo de lucro: reúne las reseñas de los libros que leemos y la crónica de nuestros encuentros. No vende productos ni servicios y no contiene publicidad.</p>

        <h2>Tus datos personales</h2>
        <ul>
          <li><strong>No recogemos datos.</strong> La web no tiene formularios, registro de usuarios ni comentarios.</li>
          <li><strong>No usamos cookies</strong> ni herramientas de estadísticas o seguimiento, y la web no guarda nada en tu navegador.</li>
          <li><strong>Alojamiento.</strong> La web está alojada en GitHub Pages, un servicio de GitHub, Inc. Como cualquier servidor, GitHub registra la dirección IP de quien la visita por motivos técnicos y de seguridad. Ese registro lo hace GitHub según su <a href="https://docs.github.com/es/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener">declaración de privacidad</a>.</li>
          <li><strong>Enlaces a Instagram.</strong> El botón «Comentar en Instagram» y otros enlaces llevan a Instagram o a otras webs, que aplican sus propias políticas de privacidad y de cookies. Lo que publiques allí queda sujeto a sus condiciones.</li>
          <li><strong>Si nos escribes,</strong> usaremos tu dirección y lo que nos cuentes solo para responderte, y no lo cederemos a nadie.</li>
        </ul>

        <h2>Fotos y personas que aparecen en la web</h2>
        <p>En «Literatura en 3D» publicamos fotos y vídeos de nuestros encuentros, en los que pueden aparecer asistentes. Si sales en alguna y prefieres que la retiremos, o quieres que corrijamos o eliminemos cualquier dato tuyo, escríbenos a ${mail} indicando cuál y la quitaremos lo antes posible.</p>
        <p>En esa misma dirección puedes ejercer los derechos que te reconoce el Reglamento General de Protección de Datos (acceso, rectificación, supresión y oposición, entre otros). Si consideras que no los hemos atendido, puedes reclamar ante la <a href="https://www.aepd.es" target="_blank" rel="noopener">Agencia Española de Protección de Datos</a>.</p>

        <h2>Propiedad intelectual</h2>
        <ul>
          <li>Las reseñas, las crónicas y las fotos propias son de El Barrio, © Tomás Nevado 2026. Puedes citarlas indicando su procedencia y enlazando a esta web; para cualquier otro uso, escríbenos.</li>
          <li>Las semblanzas que encabezan la página de cada autor son las que publican sus editoriales. Se reproducen con fines informativos, indicando siempre la editorial y enlazando a su página.</li>
          <li>Las portadas de los libros pertenecen a sus editoriales y demás titulares, y se muestran solo para ilustrar la reseña de cada obra.</li>
          <li>Si eres titular de algún contenido de esta web y prefieres que lo retiremos, escríbenos y lo haremos.</li>
        </ul>

        <h2>Enlaces a otras webs</h2>
        <p>Esta web enlaza a editoriales, a Instagram y a otras páginas. No controlamos su contenido ni respondemos de él.</p>
      </div>
    </article>`;
}

// ---------- Semblanzas de autores ----------

function reviewedAuthors() {
  const byId = new Map();
  for (const r of sortedReviews()) {
    const id = slugify(r.autor);
    if (!byId.has(id)) byId.set(id, { id, autor: r.autor, editorial: r.editorial || '', libros: 0 });
    byId.get(id).libros++;
  }
  return [...byId.values()].sort((a, b) => a.autor.localeCompare(b.autor, 'es'));
}

function renderAuthorForm(id) {
  setActiveNav('');
  const bio = authors.find((a) => a.id === id);
  const known = reviewedAuthors().find((a) => a.id === id);
  if (!bio && !known) return renderNotFound();
  const a = bio || { autor: known.autor, semblanza: '', editorial: known.editorial, url: '' };
  const back = filterLink('autor', known ? known.autor : a.autor);
  document.title = `Semblanza de ${a.autor} · El Barrio`;

  app.innerHTML = `
    <div class="form-page fade-in">
      <a class="back" href="${back}">← Volver a ${esc(a.autor)}</a>
      <h1>Semblanza de ${esc(a.autor)}</h1>
      <p>Encabeza la página del autor. Copia la que publica su editorial e indica de dónde sale.</p>
      <form class="form-card encounter-form" novalidate>
        <div class="field"><label for="b-texto">Semblanza <span class="req">*</span>
          <span class="hint">Deja una línea en blanco entre párrafos.</span></label>
          <textarea id="b-texto" name="semblanza" class="tall">${esc(a.semblanza)}</textarea></div>
        <div class="field-row">
          <div class="field"><label for="b-ed">Editorial</label>
            <input id="b-ed" name="editorial" maxlength="120" value="${esc(a.editorial)}" autocomplete="off"></div>
          <div class="field"><label for="b-url">Página de donde se ha tomado</label>
            <input id="b-url" name="url" type="url" value="${esc(a.url)}" placeholder="https://…" autocomplete="off"></div>
        </div>
        <div class="form-actions">
          ${bio ? '<button type="button" class="btn btn-ghost btn-danger-text form-delete" data-form-delete>Eliminar semblanza</button>' : ''}
          <a class="btn btn-ghost" href="${back}">Cancelar</a>
          <button class="btn btn-primary" type="submit">Guardar semblanza</button>
        </div>
      </form>
    </div>`;

  const form = app.querySelector('form');
  form.querySelector('[data-form-delete]')?.addEventListener('click', async () => {
    try {
      if (await deleteEntry(`autor:${id}`, a.autor)) location.hash = back;
    } catch (err) {
      toast(err.message, true);
    }
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    const semblanza = String(data.get('semblanza') || '').trim();
    if (!semblanza) return toast('Escribe la semblanza', true);
    try {
      await api('PUT', `/api/autores/${encodeURIComponent(id)}`, {
        autor: a.autor, semblanza, editorial: data.get('editorial'), url: data.get('url'),
      });
      toast('Semblanza guardada');
      location.hash = back;
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------- Panel ----------

let panelTab = 'resenas';
let panelQuery = '';

const pendingFor = (clave) => pending.find((c) => c.clave === clave);
const ACTION_LABEL = { nuevo: 'Nuevo', editado: 'Editado', eliminado: 'Eliminado' };

function pendingBadge(clave) {
  const change = localMode && pendingFor(clave);
  return change ? `<span class="pending-badge is-${change.accion}">${ACTION_LABEL[change.accion]} · sin subir</span>` : '';
}

function undoLabel(change) {
  return { nuevo: 'Borrar', editado: 'Deshacer cambios', eliminado: 'Recuperar' }[change.accion];
}

function undoQuestion(change) {
  if (change.accion === 'nuevo') return `¿Borrar «${change.titulo}»? Es nueva y aún no está en la web, así que desaparecerá del todo.`;
  if (change.accion === 'editado') return `¿Deshacer los cambios en «${change.titulo}»? Volverá a estar como en la web.`;
  return `¿Recuperar «${change.titulo}»? Volverá a estar como en la web.`;
}

function pendingRow(change) {
  if (change.archivos) {
    return `
      <li class="pending-row">
        <details>
          <summary>${esc(change.texto)}</summary>
          <ul class="file-list">${change.archivos.map((f) => `<li><code>${esc(f)}</code></li>`).join('')}</ul>
          ${change.tipo === 'programa' ? '<p class="hint">Son cambios en el aspecto o el funcionamiento de la web, no en las reseñas. Los hace quien mantiene la web y se suben junto con lo demás.</p>' : ''}
        </details>
      </li>`;
  }
  if (!change.accion) return `<li class="pending-row"><span>${esc(change.texto)}</span></li>`;
  const link = { resena: `#/resena/${encodeURIComponent(change.id)}`, encuentro: `#/literatura-3d/${encodeURIComponent(change.id)}`, autor: filterLink('autor', change.titulo) }[change.tipo];
  return `
    <li class="pending-row">
      <span class="pending-badge is-${change.accion}">${ACTION_LABEL[change.accion]}</span>
      <span class="pending-title">${{ resena: 'Reseña', encuentro: 'Encuentro', autor: 'Semblanza' }[change.tipo]}: <strong>${esc(change.titulo)}</strong></span>
      <span class="row-actions">
        ${change.accion !== 'eliminado' ? `<a class="btn btn-sm btn-ghost" href="${link}">Ver</a>` : ''}
        <button type="button" class="btn btn-sm" data-undo="${esc(change.clave)}">${undoLabel(change)}</button>
      </span>
    </li>`;
}

function contentRows() {
  const terms = norm(panelQuery).split(/\s+/).filter(Boolean);
  const items = panelTab === 'resenas'
    ? sortedReviews().map((r) => ({ clave: `resena:${r.id}`, id: r.id, titulo: r.titulo, sub: r.autor, fecha: r.fecha, img: r.imagen, ver: reviewLink(r), editar: `#/editar/${encodeURIComponent(r.id)}` }))
    : encounters.map((e) => ({ clave: `encuentro:${e.id}`, id: e.id, titulo: e.titulo, sub: e.lugar, fecha: e.fecha, img: e.portada || 'img/logo.jpg', ver: encounterLink(e), editar: `${encounterLink(e)}/editar` }));
  if (panelTab === 'autores') {
    items.splice(0, items.length, ...reviewedAuthors().map((au) => {
      const bio = authorBio(au.autor);
      return {
        clave: `autor:${au.id}`, titulo: au.autor, sub: `${au.libros} ${au.libros === 1 ? 'libro' : 'libros'} · ${bio ? 'con semblanza' : 'sin semblanza'}`,
        img: (sortedReviews().find((r) => r.autor === au.autor) || {}).imagen, ver: filterLink('autor', au.autor),
        editar: `#/autor/${encodeURIComponent(au.id)}/editar`, noDelete: !bio, editLabel: bio ? 'Editar' : 'Añadir semblanza',
      };
    }));
  }
  const shown = items.filter((it) => terms.every((t) => norm(`${it.titulo} ${it.sub}`).includes(t)));
  if (!shown.length) return '<p class="hint">Nada coincide con la búsqueda.</p>';
  return `<ul class="content-list">${shown.map((it) => `
    <li>
      <img src="${esc(it.img)}" alt="" loading="lazy">
      <span class="content-text"><strong>${esc(it.titulo)}</strong><span class="hint">${esc(it.sub || '')}${it.fecha ? ` · ${fmtDate(it.fecha)}` : ''}</span>${pendingBadge(it.clave)}</span>
      <span class="row-actions">
        <a class="btn btn-sm btn-ghost" href="${it.ver}">Ver</a>
        <a class="btn btn-sm" href="${it.editar}">${it.editLabel || 'Editar'}</a>
        ${it.noDelete ? '' : `<button type="button" class="btn btn-sm btn-danger" data-delete="${esc(it.clave)}" data-title="${esc(it.titulo)}">Eliminar</button>`}
      </span>
    </li>`).join('')}</ul>`;
}

function renderPanel() {
  document.title = `${localMode ? 'Panel de edición' : 'Administración'} · El Barrio`;
  const missingInstagram = sortedReviews().filter((r) => !r.instagram);
  const content = pending.filter((c) => c.accion || c.tipo === 'fotos');

  app.innerHTML = `
    <div class="panel-page fade-in">
      <h1>${localMode ? 'Panel de edición' : 'Administración'}</h1>
      ${localMode ? `
      <section class="form-card panel-card">
        <div class="panel-head">
          <h2>Cambios sin subir <span class="hint">${pending.length ? `${pending.length}` : ''}</span></h2>
          <a class="hint" href="https://elbarriolee.club" target="_blank" rel="noopener">Ver la web publicada ↗</a>
        </div>
        ${pending.length ? `
          <p class="hint">Esto es lo que cambiará en elbarriolee.club al subir. Cualquier cambio se puede deshacer antes.</p>
          <ul class="pending-list">${pending.map(pendingRow).join('')}</ul>
          <div class="form-actions panel-actions">
            ${content.length ? '<button type="button" class="btn btn-ghost btn-danger-text" data-action="discard">Descartar todos los cambios de contenido</button>' : ''}
            <button type="button" class="btn btn-primary" data-action="publish">Subir cambios a la web</button>
          </div>`
    : '<p>Todo está subido: elbarriolee.club muestra lo mismo que este panel.</p>'}
        ${lastUpload ? `<p class="hint last-upload">Última subida: ${fmtDate(lastUpload, true)}</p>` : ''}
      </section>` : ''}

      <section class="form-card panel-card">
        <div class="panel-head">
          <h2>Contenido</h2>
          <span class="row-actions">
            <a class="btn btn-sm btn-primary" href="#/nueva">+ Nueva reseña</a>
            <a class="btn btn-sm btn-primary" href="#/literatura-3d/nuevo">+ Nuevo encuentro</a>
          </span>
        </div>
        <div class="panel-tools">
          <div class="pills" role="tablist">
            <button type="button" class="pill${panelTab === 'resenas' ? ' is-active' : ''}" data-tab="resenas">Reseñas (${reviews.length})</button>
            <button type="button" class="pill${panelTab === 'encuentros' ? ' is-active' : ''}" data-tab="encuentros">Encuentros (${encounters.length})</button>
            <button type="button" class="pill${panelTab === 'autores' ? ' is-active' : ''}" data-tab="autores">Autores (${authors.length} de ${reviewedAuthors().length} con semblanza)</button>
          </div>
          <input type="search" class="panel-search" placeholder="Buscar por título, autor o lugar…" value="${esc(panelQuery)}" aria-label="Buscar en el contenido">
        </div>
        <div class="content-rows">${contentRows()}</div>
      </section>

      ${missingInstagram.length ? `
      <section class="form-card panel-card admin-todo">
        <h2>Reseñas sin enlace a Instagram <span class="hint">${missingInstagram.length} de ${reviews.length}</span></h2>
        <p>En estas, el botón de comentar lleva al perfil en lugar de a su publicación. Pulsa una para editarla y pegar el enlace.</p>
        <ul>${missingInstagram.map((r) => `<li><a href="#/editar/${encodeURIComponent(r.id)}">${esc(r.titulo)}</a> <span class="hint">${fmtDate(r.fecha)}</span></li>`).join('')}</ul>
      </section>` : ''}
    </div>`;

  const rows = app.querySelector('.content-rows');
  const search = app.querySelector('.panel-search');
  search.addEventListener('input', () => {
    panelQuery = search.value;
    rows.innerHTML = contentRows();
  });
  app.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => {
    panelTab = tab.dataset.tab;
    app.querySelectorAll('[data-tab]').forEach((t) => t.classList.toggle('is-active', t === tab));
    rows.innerHTML = contentRows();
  }));

}

async function refreshPanel() {
  const y = window.scrollY;
  await Promise.all([loadReviews(), loadEncounters(), loadAuthors(), localMode ? loadPending() : null]);
  if (parseHash().parts[0] !== 'admin') return;
  renderPanel();
  window.scrollTo(0, y);
}

async function deleteEntry(clave, titulo) {
  const [tipo, id] = [clave.slice(0, clave.indexOf(':')), clave.slice(clave.indexOf(':') + 1)];
  const what = { resena: 'la reseña', encuentro: 'el encuentro', autor: 'la semblanza de' }[tipo];
  const endpoint = { resena: 'resenas', encuentro: 'encuentros', autor: 'autores' }[tipo];
  const note = localMode
    ? '\n\nDesaparecerá de este panel ahora y de la web al pulsar «Subir cambios». Hasta entonces se puede recuperar desde «Cambios sin subir».'
    : '\n\nNo se puede deshacer.';
  if (!confirm(`¿Eliminar ${what} «${titulo}»${tipo === 'autor' ? '' : ' con sus fotos'}?${note}`)) return false;
  await api('DELETE', `/api/${endpoint}/${encodeURIComponent(id)}`);
  toast({ resena: 'Reseña eliminada', encuentro: 'Encuentro eliminado', autor: 'Semblanza eliminada' }[tipo]);
  return true;
}

async function panelClick(ev) {
  const undo = ev.target.closest('[data-undo]');
  const del = ev.target.closest('[data-delete]');
  const discard = ev.target.closest('[data-action="discard"]');
  try {
    if (undo) {
      const change = pendingFor(undo.dataset.undo);
      if (!change || !confirm(undoQuestion(change))) return;
      undo.disabled = true;
      const { mensaje } = await api('POST', '/api/publicar/deshacer', { clave: change.clave });
      toast(mensaje);
    } else if (del) {
      del.disabled = true;
      if (!await deleteEntry(del.dataset.delete, del.dataset.title)) {
        del.disabled = false;
        return;
      }
    } else if (discard) {
      if (!confirm('¿Descartar todos los cambios en reseñas, encuentros y fotos?\n\nTodo volverá a estar exactamente como en la web. No se puede deshacer.')) return;
      await api('POST', '/api/publicar/descartar');
      toast('Cambios descartados: todo está como en la web');
    } else {
      return;
    }
    await refreshPanel();
  } catch (err) {
    toast(err.message, true);
    await refreshPanel();
  }
}

// ---------- Administración ----------

function renderNotFound() {
  setActiveNav('');
  app.innerHTML = `<div class="empty"><h2>Página no encontrada</h2><a class="btn" href="#/">Ir a la portada</a></div>`;
}

function renderLogin(volver) {
  setActiveNav('');
  document.title = 'Administración · El Barrio';
  // Solo se vuelve a rutas internas de la web.
  const next = volver && volver.startsWith('#/') && !volver.startsWith('#/admin') ? volver : '';

  if (admin) {
    if (next) location.hash = next;
    else renderPanel();
    return;
  }

  app.innerHTML = `
    <div class="form-page login-page fade-in">
      <h1>Administración</h1>
      <p>${next ? 'Esta página es solo para el administrador. ' : ''}Entra con la contraseña para publicar, editar y moderar la web.</p>
      <form class="form-card login-form" novalidate>
        <div class="field"><label for="a-pass">Contraseña</label>
          <input id="a-pass" name="password" type="password" autocomplete="current-password" required></div>
        <div class="form-actions">
          <button class="btn btn-primary" type="submit">Entrar</button>
          <a class="btn btn-ghost" href="#/">Cancelar</a>
        </div>
      </form>
    </div>`;

  const form = app.querySelector('.login-form');
  form.password.focus();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await api('POST', '/api/admin/entrar', { password: form.password.value });
      setAdmin(true);
      toast('Sesión iniciada');
      if (next) location.hash = next;
      else {
        renderLogin('');
        markTitle();
      }
    } catch (err) {
      toast(err.message, true);
      form.password.select();
      button.disabled = false;
    }
  });
}

// ---------- Arranque ----------

// Se recargan los datos en cada navegación para ver también lo publicado desde otra pestaña.
if (STATIC) document.querySelector('.admin-link')?.remove();

function start() {
  Promise.all([loadReviews(), loadEncounters(), loadAuthors(), loadAdmin()])
    .then(route)
    .catch(() => {
      app.innerHTML = `<div class="empty"><h2>No se pudo conectar con el servidor</h2><p>Vuelve a intentarlo dentro de un momento.</p></div>`;
    });
}

// Botones del panel (deshacer, eliminar, descartar): un único escuchador, aunque el panel se repinte.
app.addEventListener('click', (ev) => {
  if (parseHash().parts[0] === 'admin' && admin) panelClick(ev);
});

// Delegado: el botón está en la barra verde y también en el panel, que se vuelve a pintar.
document.addEventListener('click', (ev) => {
  const button = ev.target.closest('[data-action="publish"]');
  if (button) publishChanges(button);
});

document.querySelectorAll('[data-action="logout"]').forEach((btn) => btn.addEventListener('click', async () => {
  try {
    await api('POST', '/api/admin/salir');
    setAdmin(false);
    toast('Sesión cerrada');
    if (isAdminRoute(parseHash().parts)) location.hash = '#/';
    else route();
  } catch (err) {
    toast(err.message, true);
  }
}));
window.addEventListener('hashchange', start);
start();
