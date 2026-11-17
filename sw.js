/* Cisza offline support.
   The page itself is fetched fresh when there is a connection and from the cache when there is not.
   Recordings are saved by the page into the "cisza-audio" cache; this worker serves them from there,
   including the byte ranges Safari asks for when it plays audio. */
var SHELL = "cisza-shell-v1";
var AUDIO = "cisza-audio";
var FONTS = "cisza-fonts";
var FILES = ["./", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png", "audio/bell.wav"];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("cisza-shell-") === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function ranged(request, response) {
  var header = request.headers.get("range");
  var m = header && /bytes=(\d*)-(\d*)/.exec(header);
  if (!m) return Promise.resolve(response);
  return response.blob().then(function (blob) {
    var size = blob.size;
    var start = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]);
    var end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (start >= size || start > end) return new Response("", { status: 416, headers: { "Content-Range": "bytes */" + size } });
    return new Response(blob.slice(start, end + 1), {
      status: 206,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "audio/mp4",
        "Content-Range": "bytes " + start + "-" + end + "/" + size,
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes"
      }
    });
  });
}

function fromCache(request, cacheName) {
  return caches.open(cacheName).then(function (c) { return c.match(request.url, { ignoreSearch: true }); });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url = new URL(request.url);

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(caches.open(FONTS).then(function (c) {
      return c.match(request).then(function (hit) {
        var fresh = fetch(request).then(function (r) { if (r && (r.ok || r.type === "opaque")) c.put(request, r.clone()); return r; });
        if (hit) { fresh.catch(function () {}); return hit; }
        return fresh;
      });
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (url.pathname.indexOf("/audio/") >= 0) {
    var bell = /bell\.wav$/.test(url.pathname);
    event.respondWith(fromCache(request, bell ? SHELL : AUDIO).then(function (hit) {
      return hit ? ranged(request, hit) : fetch(request);
    }));
    return;
  }

  // Page and small files: newest version when online, saved copy otherwise.
  event.respondWith(fetch(request).then(function (r) {
    if (r && r.ok) { var copy = r.clone(); caches.open(SHELL).then(function (c) { c.put(request.mode === "navigate" ? "./" : request, copy); }); }
    return r;
  }).catch(function () {
    return fromCache(request, SHELL).then(function (hit) {
      return hit || (request.mode === "navigate" ? caches.open(SHELL).then(function (c) { return c.match("./"); }) : Response.error());
    });
  }));
});
