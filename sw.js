const APP_URL = new URL('./', self.location).href;
const ICON_URL = new URL('./img/logo.png', self.location).href;

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    console.error('Push payload is not valid JSON.', error);
    payload = { title: 'Lembrete financeiro', body: 'Você tem uma conta pendente.' };
  }

  event.waitUntil(self.registration.showNotification(payload.title || 'Meu Controle', {
    body: payload.body || 'Você tem uma conta pendente.',
    icon: ICON_URL,
    badge: ICON_URL,
    tag: payload.tag || 'account-reminder',
    data: { url: payload.url || APP_URL }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || APP_URL);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === targetUrl.origin) {
        await client.navigate(targetUrl.href);
        return client.focus();
      }
    }
    return self.clients.openWindow(targetUrl.href);
  })());
});
