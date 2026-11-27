// Descarga la lista de publicaciones de @elbarriolee con su enlace, para enlazar cada reseña con su post.
// No se ejecuta con Node: se pega en la consola de Chrome.
//
// 1. Abre https://www.instagram.com con la sesión de @elbarriolee iniciada.
// 2. Abre la consola: Cmd + Opción + J.
// 3. Si Chrome avisa de que no pegues código, escribe «allow pasting» (o «permitir pegar») y pulsa Intro.
// 4. Pega todo este archivo y pulsa Intro. Al terminar se descarga «elbarriolee-enlaces.json».
// 5. Después, en la carpeta del proyecto: npm run importar-enlaces

(async () => {
  const USERNAME = 'elbarriolee';
  const headers = { 'X-IG-App-ID': '936619743392459' };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const profile = await fetch(`/api/v1/users/web_profile_info/?username=${USERNAME}`, { headers }).then((r) => r.json());
  const userId = profile.data.user.id;

  const posts = [];
  let maxId = '';
  do {
    const page = await fetch(`/api/v1/feed/user/${userId}/?count=33${maxId ? `&max_id=${maxId}` : ''}`, { headers }).then((r) => r.json());
    for (const item of page.items || []) {
      posts.push({
        enlace: `https://www.instagram.com/${item.product_type === 'clips' ? 'reel' : 'p'}/${item.code}/`,
        fecha: new Date(item.taken_at * 1000).toISOString(),
        texto: item.caption ? item.caption.text : '',
      });
    }
    console.log(`Leídas ${posts.length} publicaciones…`);
    maxId = page.more_available ? page.next_max_id : '';
    await sleep(1200);
  } while (maxId);

  const file = new Blob([JSON.stringify(posts, null, 2)], { type: 'application/json' });
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: 'elbarriolee-enlaces.json' });
  link.click();
  console.log(`Listo: ${posts.length} publicaciones guardadas en Descargas/elbarriolee-enlaces.json`);
})();
