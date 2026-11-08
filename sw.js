const APP_URL = new URL('./', self.location).href;
const ICON_URL = new URL('./icon.svg?v=4', self.location).href;
const NOTIFICATION_DB = 'fffinance-notifications';

function openNotificationDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NOTIFICATION_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function setUnreadNotifications(value) {
  const database = await openNotificationDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('state', 'readwrite');
    transaction.objectStore('state').put({ key: 'has-unread', value });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }).finally(() => database.close());
}

async function hasUnreadNotifications() {
  const database = await openNotificationDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction('state', 'readonly').objectStore('state').get('has-unread');
      request.onsuccess = () => resolve(Boolean(request.result?.value));
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach(client => client.postMessage(message));
}

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
    payload = { title: 'FFinance', body: 'Você tem uma conta pendente.' };
  }

  event.waitUntil((async () => {
    await self.registration.showNotification(payload.title || 'FFinance', {
      body: payload.body || 'Você tem uma conta pendente.',
      icon: ICON_URL,
      badge: ICON_URL,
      tag: payload.tag || 'account-reminder',
      data: { url: payload.url || APP_URL }
    });
    try {
      await setUnreadNotifications(true);
      await notifyClients({ type: 'push-received' });
    } catch (error) {
      console.error('Could not update unread notification state.', error);
    }
  })());
});

self.addEventListener('message', event => {
  const replyPort = event.ports[0];
  if (!replyPort) return;

  if (event.data?.type === 'get-notification-state') {
    event.waitUntil(hasUnreadNotifications()
      .then(hasUnread => replyPort.postMessage({ type: 'notification-state', hasUnread }))
      .catch(error => {
        console.error('Could not read notification state.', error);
        replyPort.postMessage({ type: 'notification-state', hasUnread: false });
      }));
  } else if (event.data?.type === 'mark-notifications-read') {
    event.waitUntil(setUnreadNotifications(false)
      .then(() => {
        replyPort.postMessage({ type: 'notifications-read' });
        return notifyClients({ type: 'notifications-read' });
      })
      .catch(error => {
        console.error('Could not clear unread notification state.', error);
        replyPort.postMessage({ type: 'notification-state', hasUnread: true });
      }));
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || APP_URL);
  event.waitUntil((async () => {
    try {
      await setUnreadNotifications(false);
      await notifyClients({ type: 'notifications-read' });
    } catch (error) {
      console.error('Could not mark notifications as read.', error);
    }
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
