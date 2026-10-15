const streamPath = new URL("./webdav-stream", self.registration.scope).pathname;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function requestAuthorization(clientId, url) {
  return new Promise((resolve, reject) => {
    self.clients.get(clientId).then((client) => {
      if (!client) {
        reject(new Error("The WebDAV client is no longer available"));
        return;
      }
      const channel = new MessageChannel();
      const timeout = setTimeout(() => {
        channel.port1.close();
        reject(new Error("The WebDAV client did not provide authorization"));
      }, 10000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timeout);
        channel.port1.close();
        if (event.data?.authorization) resolve(event.data.authorization);
        else reject(new Error("The WebDAV connection is not active"));
      };
      client.postMessage({ type: "webdav-auth-request", url }, [channel.port2]);
    }).catch(reject);
  });
}

function streamResponse(request) {
  return (async () => {
    const url = new URL(request.url);
    const sourceUrl = url.searchParams.get("url");
    if (!sourceUrl || !["GET", "HEAD"].includes(request.method)) {
      return new Response("Invalid stream request", { status: 400 });
    }

    const authorization = await requestAuthorization(request.clientId, sourceUrl);
    const headers = new Headers({ Authorization: authorization });
    for (const name of ["accept", "range", "if-range", "if-none-match", "if-modified-since"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    const upstream = await fetch(sourceUrl, {
      method: request.method,
      headers,
      mode: "cors",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    const responseHeaders = new Headers();
    for (const name of ["accept-ranges", "cache-control", "content-length", "content-range", "content-type", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  })().catch((error) => {
    console.error("WebDAV stream proxy failed:", error);
    return new Response("WebDAV stream request failed", { status: 502 });
  });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname !== streamPath) return;
  event.respondWith(streamResponse(event.request));
});
