// Notificações da Central pelo navegador (Web Push): chegam mesmo com a aba fechada.
self.addEventListener('push', e => {
  let p = {};
  try { p = e.data.json(); } catch (x) { p = { title: 'Miados Central', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(p.title || 'Miados Central', {
    body: p.body || '', icon: '/icone.png', badge: '/favicon-32.png', tag: p.tag || undefined, data: { url: p.url || '/' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(l => {
    for (const c of l) if ('focus' in c && c.url.startsWith(self.location.origin) && url.startsWith('/')) return c.focus();
    return clients.openWindow(url);
  }));
});
