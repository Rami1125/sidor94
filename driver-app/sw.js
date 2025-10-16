const CACHE_NAME = 'deliverymaster-driver-v1';
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
    // Open the cache by name.
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache and caching core files.');
        // Add all the specified URLs to the cache.
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting();
});

// Fetch event: Fires every time the app requests a resource (like a page, script, or image).
self.addEventListener('fetch', event => {
  // We respond to the request with a cached resource or by fetching it from the network.
  event.respondWith(
    // Check if the request exists in our cache.
    caches.match(event.request)
      .then(response => {
        // If we found a match in the cache, return the cached version.
        if (response) {
          return response;
        }
        // If the resource is not in the cache, fetch it from the network.
        return fetch(event.request);
      }
    )
  );
});

