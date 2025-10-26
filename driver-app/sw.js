const CACHE_NAME = 'deliverymaster-driver-v50'; // עדכון גרסת מטמון
const urlsToCache = [
  './', // עמוד הבסיס
  './index.html', // הקובץ הראשי
  './manifest.json', // קובץ ה-Manifest
  'https://i.postimg.cc/ryPT3r29/image.png', // לוגו האפליקציה
  // קבצים חיצוניים חיוניים (ניתן להוסיף עוד אם צריך)
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js',
  'https://unpkg.com/feather-icons'
  // כדאי לשקול להוסיף גם קבצי פונטים אם הם קריטיים
];

// Install event: מטמון הקבצים הבסיסיים
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Opened cache and caching core assets:', urlsToCache);
        // חשוב: addAll יכשל אם אחד הקבצים לא זמין
        return cache.addAll(urlsToCache).catch(error => {
            console.error('[SW] Failed to cache core assets during install:', error);
            // לא זורקים שגיאה כדי לא לעצור את התקנת ה-SW
        });
      })
      .then(() => self.skipWaiting()) // הפעל את ה-SW החדש מיידית
  );
});

// Activate event: ניקוי מטמונים ישנים
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
    .then(() => self.clients.claim()) // השתלט על כל הלקוחות הפתוחים
  );
});


// Fetch event: אסטרטגיית Cache first, then network
self.addEventListener('fetch', event => {
    // אל תנסה לטמון בקשות שאינן GET (למשל POST ל-Firestore)
    if (event.request.method !== 'GET') {
        // console.log('[SW] Ignoring non-GET request:', event.request.method, event.request.url);
        return; // תן לבקשה להמשיך לרשת כרגיל
    }

    // אל תנסה לטמון קריאות ל-Firebase Firestore/Auth/Functions
    if (event.request.url.includes('firestore.googleapis.com') ||
        event.request.url.includes('firebaseapp.com') ||
        event.request.url.includes('identitytoolkit.googleapis.com') ||
         event.request.url.includes('google.com/maps') || // אל תטמון מפות גוגל
         event.request.url.includes('openstreetmap.org') // אל תטמון שכבות מפה (אלא אם רוצים מפות אופליין - מסובך יותר)
        ) {
       // console.log('[SW] Ignoring Firebase/Map API request:', event.request.url);
        return; // תן לבקשה להמשיך לרשת
    }


    event.respondWith(
        caches.match(event.request)
          .then(cachedResponse => {
            // אם נמצא במטמון, החזר אותו
            if (cachedResponse) {
              // console.log('[SW] Serving from cache:', event.request.url);
              return cachedResponse;
            }

            // אם לא נמצא, לך לרשת
            // console.log('[SW] Fetching from network:', event.request.url);
            return fetch(event.request).then(
              networkResponse => {
                // אופציונלי: טמון את התשובה מהרשת לשימוש עתידי
                // צריך להיזהר לא לטמון תשובות שגויות או דינמיות מדי
                // if (networkResponse && networkResponse.status === 200 && urlsToCache.includes(event.request.url)) {
                //     const responseToCache = networkResponse.clone();
                //     caches.open(CACHE_NAME)
                //         .then(cache => {
                //             cache.put(event.request, responseToCache);
                //         });
                // }
                return networkResponse;
              }
            ).catch(error => {
                 console.error('[SW] Fetch failed; returning offline fallback if available (currently none).', error);
                 // כאן אפשר להחזיר עמוד "אופליין" גנרי אם רוצים
                 // return caches.match('/offline.html');
            });
          })
      );
});
