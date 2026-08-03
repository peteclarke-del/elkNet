import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { addGame, addPublisher, editGame, generateContent, readGames, readPublishers, removeGame, setGameEnabled } from "./catalog.mjs";
import { readStats, recordDownload } from "./stats.mjs";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const publicRoot = resolve(projectRoot, "src", "web");
const archiveRoot = resolve(projectRoot, "storage", "uefarchive");
const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const adminUser = process.env.ELKNET_ADMIN_USER ?? "admin";
const adminPassword = process.env.ELKNET_ADMIN_PASSWORD ?? "elknet";

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".uef", "application/octet-stream"]
]);

function safePath(root, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  const candidate = resolve(root, `.${decoded}`);
  return candidate === root || candidate.startsWith(`${root}${sep}`)
    ? candidate
    : null;
}

async function sendFile(request, response, root, requestPath, legacy = false) {
  const filePath = safePath(root, requestPath);
  if (!filePath) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad request\n");
    return null;
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return null;
    }
    throw error;
  }

  if (!fileStat.isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found\n");
    return null;
  }

  const headers = {
    "Content-Length": fileStat.size,
    "Content-Type": legacy
      ? "application/octet-stream"
      : contentTypes.get(extname(filePath).toLowerCase()) ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff"
  };

  if (legacy) {
    // The ROM reads a finite raw response into paged RAM. Keep this endpoint
    // uncompressed and make the end of the response unambiguous.
    headers.Connection = "close";
    headers["Cache-Control"] = "public, max-age=3600";
  }

  response.writeHead(200, headers);
  if (request.method === "HEAD") {
    response.end();
    return { size: fileStat.size, filePath };
  }
  createReadStream(filePath).pipe(response);
  return { size: fileStat.size, filePath };
}

function isAuthorized(request) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Basic ")) return false;
  try {
    const [user, password] = Buffer.from(authorization.slice(6), "base64").toString("utf8").split(":");
    return user === adminUser && password === adminPassword;
  } catch {
    return false;
  }
}

function requireAdmin(request, response) {
  if (isAuthorized(request)) return true;
  response.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="elkNet admin"',
    "Content-Type": "text/plain; charset=utf-8"
  });
  response.end("Authentication required\n");
  return false;
}

function sendJson(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 3 * 1024 * 1024) throw new Error("Request exceeds the 3 MiB limit");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function clientHost(request) {
  const forwarded = request.headers["x-forwarded-for"]?.split(",")[0].trim();
  return forwarded || request.socket.remoteAddress || "unknown";
}

async function handleAdminApi(request, response, url) {
  if (url.pathname === "/api/admin/dashboard" && request.method === "GET") {
    const [games, publishers, stats] = await Promise.all([readGames(), readPublishers(), readStats()]);
    sendJson(response, 200, { games, publishers, stats });
    return;
  }
  if (url.pathname === "/api/admin/games" && request.method === "POST") {
    sendJson(response, 201, await addGame(await readJson(request)));
    return;
  }
  if (url.pathname === "/api/admin/games" && request.method === "PATCH") {
    sendJson(response, 200, await editGame(await readJson(request)));
    return;
  }
  if (url.pathname === "/api/admin/games/status" && request.method === "PATCH") {
    const body = await readJson(request);
    sendJson(response, 200, await setGameEnabled(body.path, body.enabled));
    return;
  }
  if (url.pathname === "/api/admin/publishers" && request.method === "POST") {
    const body = await readJson(request);
    sendJson(response, 201, await addPublisher(body.name));
    return;
  }
  if (url.pathname === "/api/admin/games" && request.method === "DELETE") {
    const body = await readJson(request);
    await removeGame(body.path);
    sendJson(response, 200, { removed: body.path });
    return;
  }
  sendJson(response, 404, { error: "Admin endpoint not found" });
}

export const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");

    if (url.pathname === "/admin") {
      response.writeHead(308, { Location: "/admin/" });
      response.end();
      return;
    }

    if (url.pathname.startsWith("/admin/") || url.pathname.startsWith("/api/admin/")) {
      if (!requireAdmin(request, response)) return;
      if (url.pathname.startsWith("/api/admin/")) {
        await handleAdminApi(request, response, url);
        return;
      }
      const adminPath = url.pathname === "/admin/" ? "/admin/index.html" : url.pathname;
      await sendFile(request, response, publicRoot, adminPath);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, {
        Allow: "GET, HEAD",
        "Content-Type": "text/plain; charset=utf-8"
      });
      response.end("Method not allowed\n");
      return;
    }

    if (url.pathname.startsWith("/uefarchive/")) {
      const result = await sendFile(
        request,
        response,
        archiveRoot,
        url.pathname.slice("/uefarchive".length),
        true
      );
      if (result && request.method === "GET" && url.pathname.toLowerCase().endsWith(".uef")) {
        void recordDownload({
          mac: request.headers["x-elknet-mac"],
          ip: clientHost(request),
          forwardedFor: request.headers["x-forwarded-for"] ?? null,
          remoteAddress: request.socket.remoteAddress ?? null,
          userAgent: request.headers["user-agent"] ?? null,
          acceptLanguage: request.headers["accept-language"] ?? null,
          path: decodeURIComponent(url.pathname.slice("/uefarchive/".length)),
          bytes: result.size
        }).catch(console.error);
      }
      return;
    }

    if (url.pathname === "/catalog.json" && request.method === "GET") {
      const games = await readGames();
      sendJson(response, 200, games.map(({ title, filename, publisher, path, enabled }) => ({
        title,
        filename,
        publisher,
        path,
        enabled
      })));
      return;
    }

    const publicPath = url.pathname === "/" ? "/index.html" : url.pathname;
    await sendFile(request, response, publicRoot, publicPath);
  } catch (error) {
    if (!response.headersSent) {
      const clientError = /required|invalid|unsupported|not found|already exists|limit|available|long|safe filename/i.test(error.message);
      if (request.url?.startsWith("/api/admin/")) {
        if (!clientError) console.error(error);
        sendJson(response, clientError ? 400 : 500, { error: error.message });
        return;
      }
      console.error(error);
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    }
    response.end("Internal server error\n");
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await generateContent();
  server.listen(port, () => {
    console.log(`elkNet listening on http://localhost:${port}`);
  });
}
