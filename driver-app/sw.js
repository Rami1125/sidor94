/**
 * This is the Service Worker file for the Driver's PWA.
 * It handles background tasks like caching and push notifications.
 */

self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  // You can add logic here to pre-cache essential app assets
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
});

self.addEventListener('fetch', (event) => {
  // This event fires for every network request.
  // You can add caching strategies here (e.g., cache-first for static assets).
  event.respondWith(fetch(event.request));
});

// Listen for push notifications from OneSignal
self.addEventListener('push', (event) => {
  console.log('Service Worker: Push received.', event.data.text());
  
  const data = event.data.json();
  const title = data.title || 'התראה חדשה';
  const options = {
    body: data.body,
    icon: '/assets/icon-192.png', // You'll need to add an icon
    badge: '/assets/badge.png',   // and a badge
  };

  event.waitUntil(self.registration.showNotification(title, options));
});
