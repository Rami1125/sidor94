const CACHE_NAME = 'deliverymaster-driver-v2'; // העליתי את מספר הגרסה
// This list should include all the core files needed for the app to run offline.
const urlsToCache = [
  './', // The root of the directory
  './index.html',
  './manifest.json',
  'https://i.postimg.cc/ryPT3r29/image.png' // The app logo
];

// Install event: Fires when the service worker is first installed.
self.addEventListener('install', event => {
  // We wait until the installation is complete.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache and caching core files.');
        // Add all the specified URLs to the cache.
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

// NEW & CRITICAL: Activate event to manage old caches
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    // Get all the cache keys (cacheNames)
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // If a cacheName is not in our whitelist, delete it
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // This line ensures the new service worker takes control of the page immediately.
  return self.clients.claim();
});


// Fetch event: Fires every time the app requests a resource (like a page, script, or image).
self.addEventListener('fetch', event => {
  // Strategy: Cache first, then network.
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // If we found a match in the cache, return it.
        // Otherwise, fetch it from the network.
        return response || fetch(event.request);
      })
  );
});

