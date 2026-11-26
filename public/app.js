'use strict';

const PAGE_SIZE = 9;
const NONE = 'Sin especificar';
const app = document.getElementById('app');
let reviews = [];
let encounters = [];
// Solo cambia qué botones se ven; el servidor comprueba la sesión en cada operación.
let admin = false;
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

async function staticData(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error('No se pudieron cargar los datos.');
  return res.json();
}

async function loadAdmin() {
  if (STATIC) return setAdmin(false);
  const state = await api('GET', '/api/admin');
  setAdmin(state.admin);
  return state;
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
const isAdminRoute = (parts) => parts[0] === 'nueva' || parts[0] === 'editar'
  || (parts[0] === 'literatura-3d' && (parts[1] === 'nuevo' || parts[2] === 'editar'));

function route() {
  const { parts, params } = parseHash();
  if (STATIC && (parts[0] === 'admin' || isAdminRoute(parts))) renderNotFound();
  else if (parts[0] === 'admin') renderLogin(params.get('volver'));
  else if (isAdminRoute(parts) && !admin) renderLogin(location.hash);
  else if (parts[0] === 'resena' && parts[1]) renderDetail(parts[1]);
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
      <div class="card-media"><img src="${esc(r.imagen)}" alt="Imagen de la reseña de ${esc(r.titulo)}" loading="lazy"></div>
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
    if (!confirm(`¿Eliminar la reseña de «${r.titulo}»? No se puede deshacer.`)) return;
    try {
      await api('DELETE', `/api/resenas/${encodeURIComponent(r.id)}`);
      await loadReviews();
      toast('Reseña eliminada');
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
      <div class="card-media"><img src="${esc(e.portada || 'img/logo.jpg')}" alt="${esc(e.titulo)}" loading="lazy"></div>
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
    if (!confirm(`¿Eliminar «${e.titulo}» con todas sus fotos y vídeos? No se puede deshacer.`)) return;
    try {
      await api('DELETE', `/api/encuentros/${encodeURIComponent(e.id)}`);
      toast('Encuentro eliminado');
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
          <a class="btn btn-ghost" href="${backLink}">Cancelar</a>
          <button class="btn btn-primary" type="submit">${existing ? 'Guardar cambios' : 'Publicar encuentro'}</button>
        </div>
      </form>
    </div>`;

  const form = app.querySelector('form');
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
        <p>Todas las reseñas de libros del club, de la más reciente a la primera.</p>
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
  let imageData = null;

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
            <input type="file" accept="image/*" aria-label="Imagen de la reseña">
            ${r.imagen ? `<img src="${esc(r.imagen)}" alt="">` : ''}
            <div class="dz-text">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>
              <strong>Arrastra aquí la imagen</strong>o haz clic para elegirla
            </div>
          </div>
          <p class="dz-change">${r.imagen ? 'Haz clic en la imagen para cambiarla.' : 'JPG, PNG o WebP. Se optimiza automáticamente.'}</p>
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
            <a class="btn btn-ghost" href="${existing ? reviewLink(existing) : '#/'}">Cancelar</a>
            <button class="btn btn-primary" type="submit">${existing ? 'Guardar cambios' : 'Publicar reseña'}</button>
          </div>
        </div>
        ${['autor', 'nacionalidad', 'genero', 'tema', 'ambientacion', 'editorial', 'idioma'].map(datalist).join('')}
      </form>
    </div>`;

  const form = app.querySelector('form');
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

  // --- Imagen ---
  const dropzone = form.querySelector('.dropzone');
  const fileInput = dropzone.querySelector('input[type="file"]');
  const showImage = async (file) => {
    if (!file || !file.type.startsWith('image/')) return toast('Elige un archivo de imagen', true);
    try {
      imageData = await optimizeImage(file);
    } catch {
      return toast('No hemos podido leer esa imagen', true);
    }
    let img = dropzone.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      img.alt = '';
      dropzone.insertBefore(img, dropzone.querySelector('.dz-text'));
    }
    img.src = imageData;
    dropzone.classList.add('has-image');
    form.querySelector('.dz-change').textContent = 'Haz clic en la imagen para cambiarla.';
  };
  fileInput.addEventListener('change', () => showImage(fileInput.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, () => dropzone.classList.remove('is-over')));
  dropzone.addEventListener('drop', (e) => { e.preventDefault(); showImage(e.dataTransfer.files[0]); });

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
      [!existing && !imageData, 'una imagen', null],
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
    if (imageData) payload.imagen = imageData;

    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = 'Guardando…';
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
    const missingInstagram = sortedReviews().filter((r) => !r.instagram);
    if (next) {
      location.hash = next;
      return;
    }
    app.innerHTML = `
      <div class="form-page login-page fade-in">
        <h1>Administración</h1>
        <div class="form-card">
          <p>Has entrado como administrador. Mientras la sesión esté abierta verás en la web los botones para:</p>
          <ul class="admin-perms">
            <li>Publicar reseñas y encuentros nuevos.</li>
            <li>Editar o eliminar reseñas y encuentros de Literatura en 3D.</li>
            <li>Enlazar cada reseña con su publicación de Instagram, donde comentan los lectores.</li>
          </ul>
          <div class="form-actions">
            <a class="btn btn-primary" href="#/nueva">Nueva reseña</a>
            <a class="btn btn-primary" href="#/literatura-3d/nuevo">Nuevo encuentro</a>
            <a class="btn" href="#/">Ir a la portada</a>
          </div>
        </div>
        ${missingInstagram.length ? `
        <div class="form-card admin-todo">
          <h2>Reseñas sin enlace a Instagram <span class="hint">${missingInstagram.length} de ${reviews.length}</span></h2>
          <p>En estas, el botón de comentar lleva al perfil en lugar de a su publicación. Pulsa una para editarla y pegar el enlace.</p>
          <ul>${missingInstagram.map((r) => `<li><a href="#/editar/${encodeURIComponent(r.id)}">${esc(r.titulo)}</a> <span class="hint">${fmtDate(r.fecha)}</span></li>`).join('')}</ul>
        </div>` : ''}
      </div>`;
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
  Promise.all([loadReviews(), loadEncounters(), loadAdmin()])
    .then(route)
    .catch(() => {
      app.innerHTML = `<div class="empty"><h2>No se pudo conectar con el servidor</h2><p>Vuelve a intentarlo dentro de un momento.</p></div>`;
    });
}

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
