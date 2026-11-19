// CredFlux: recebe as notificações do celular (Web Push) e abre o aplicativo no toque.
// Não guarda páginas nem dados: o aplicativo continua sempre atualizado.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { texto: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'CredFlux', {
    body: d.texto || '',
    tag: d.tag || 'credflux',
    renotify: true,
    icon: 'icon-192.png',
    badge: 'badge-96.png',
    lang: 'pt-BR',
    data: { url: d.url || './' },
  }));
});

// Toque na notificação: com o CredFlux aberto, mostra o resumo nele; senão, abre o aplicativo no resumo.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const alvo = new URL(e.notification.data?.url || './', self.registration.scope);
  const aviso = alvo.searchParams.get('aviso') || 'hoje';
  e.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const j = janelas.find(c => c.url.startsWith(self.registration.scope));
    if (j) { j.postMessage({ aviso }); return j.focus(); }
    return self.clients.openWindow(alvo.href);
  })());
});
