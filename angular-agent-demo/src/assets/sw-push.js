self.toPlainText = (input) => {
  if (typeof input !== 'string') return '';

  const decoded = input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1');

  return decoded
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

self.addEventListener('push', (event) => {
  let payload = {
    title: 'Alerta medica',
    body: 'Se recibio un nuevo evento del agente.',
    tag: 'medical-agent',
    requireInteraction: false,
  };

  if (event.data) {
    try {
      const data = event.data.json();
      payload = {
        title: self.toPlainText(data.title || payload.title),
        body: self.toPlainText(data.body || payload.body),
        tag: self.toPlainText(data.tag || payload.tag),
        requireInteraction: Boolean(data.requireInteraction),
      };
    } catch {
      // Ignora payloads no JSON para no romper el servicio.
    }
  }

  const options = {
    body: self.toPlainText(payload.body),
    tag: self.toPlainText(payload.tag),
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    requireInteraction: payload.requireInteraction,
    data: {
      url: '/',
    },
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.focus();
          return;
        }
      }

      if (clients.openWindow) {
        clients.openWindow('/');
      }
    })
  );
});
