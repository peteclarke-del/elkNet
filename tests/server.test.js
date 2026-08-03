import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { server } from "../src/server/server.mjs";
import { buildMenu, originalMenuTitle, readGames, readPublishers } from "../src/server/catalog.mjs";

async function request(path, options) {
  if (!server.listening) await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return fetch(`http://127.0.0.1:${port}${path}`, options);
}

test.after(() => server.close());

test("serves the browser site", async () => {
  const response = await request("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/);
  assert.match(await response.text(), /elkNet/);
});

test("reproduces the original menu title rendering", () => {
  assert.equal(originalMenuTitle("ReturnOfFlint"), "Return Of Flint");
  assert.equal(originalMenuTitle("FSS2-ReturnOfFlint"), "F S S2 Return Of Flint");
});

test("rebuilds the original MENU while allowing another publisher", async () => {
  const publishers = await readPublishers();
  const currentMenu = await readFile(new URL("../storage/uefarchive/MENU", import.meta.url));
  assert.deepEqual(await buildMenu(publishers), currentMenu);
  const expandedMenu = await buildMenu([...publishers, "ZzzTestPublisher"].sort());
  assert.ok(expandedMenu.length > currentMenu.length);
  assert.notDeepEqual(expandedMenu, currentMenu);
});

test("publishes title, publisher and enabled state for catalogue downloads", async () => {
  const response = await request("/catalog.json");
  assert.equal(response.status, 200);
  const catalogue = await response.json();
  assert.equal(catalogue.length, (await readGames()).length);
  assert.ok(catalogue.every((game) => game.title && game.publisher && typeof game.enabled === "boolean"));
});

test("renders sortable catalogue headings", async () => {
  const response = await request("/");
  const html = await response.text();
  assert.match(html, /data-sort="title"/);
  assert.match(html, /data-sort="publisher"/);
  assert.match(html, /data-sort="enabled"/);
});

test("does not expose files outside configured roots", async () => {
  const response = await request("/..%2Fpackage.json");
  assert.equal(response.status, 400);
});

test("legacy files are byte responses with a finite length", async () => {
  const fixtureName = "TEST-FIXTURE";
  const fixturePath = new URL(`../storage/uefarchive/${fixtureName}`, import.meta.url);
  await writeFile(fixturePath, Buffer.from([0x00, 0xff, 0x42]));
  try {
    const response = await request(`/uefarchive/${fixtureName}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/octet-stream");
    assert.equal(response.headers.get("content-length"), "3");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from([0x00, 0xff, 0x42]));
  } finally {
    await unlink(fixturePath);
  }
});

test("rejects unsupported methods", async () => {
  const response = await request("/", { method: "POST" });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
});

test("protects the administration area", async () => {
  const response = await request("/admin/");
  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate"), /Basic/);
});

test("serves the admin dashboard to an authenticated user", async () => {
  const authorization = `Basic ${Buffer.from("admin:elknet").toString("base64")}`;
  const response = await request("/api/admin/dashboard", { headers: { authorization } });
  assert.equal(response.status, 200);
  const dashboard = await response.json();
  assert.equal(dashboard.games.length, (await readGames()).length);
  assert.ok(dashboard.publishers.length > 0);
  assert.ok(dashboard.games.every((game) => game.title && game.filename));
  assert.ok(dashboard.games.every((game) => typeof game.enabled === "boolean"));
});

test("protects and serves the comprehensive hosts report", async () => {
  assert.equal((await request("/admin/hosts.html")).status, 401);
  const authorization = `Basic ${Buffer.from("admin:elknet").toString("base64")}`;
  const response = await request("/admin/hosts.html", { headers: { authorization } });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Host details/);
  assert.match(html, /DOWNLOAD HISTORY/);
});

test("shows add-game feedback inside the modal", async () => {
  const authorization = `Basic ${Buffer.from("admin:elknet").toString("base64")}`;
  const response = await request("/admin/", { headers: { authorization } });
  const html = await response.text();
  assert.match(html, /id="dialog-notice"/);
  assert.match(html, /id="save-game"/);
  assert.doesNotMatch(html, /pattern=/);
});

test("loads shared sorting for every admin table", async () => {
  const authorization = `Basic ${Buffer.from("admin:elknet").toString("base64")}`;
  const response = await request("/admin/admin-sort.js", { headers: { authorization } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /refreshSortableTables/);
});

test("rejects a game upload whose UEF content already exists", async () => {
  const authorization = `Basic ${Buffer.from("admin:elknet").toString("base64")}`;
  const existing = await readFile(new URL("../storage/uefarchive/Aardvark/FrakV11_E.uef", import.meta.url));
  const response = await request("/api/admin/games", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({
      title: "Duplicate test",
      filename: "DefinitelyNotFrak_E.uef",
      publisher: "Aardvark",
      uefBase64: existing.toString("base64")
    })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Duplicate UEF content already exists as Aardvark\/FrakV11_E\.uef/);
});

test("recognizes a gzip-compressed UEF before duplicate checking", async () => {
  const authorization = `Basic ${Buffer.from("admin:elknet").toString("base64")}`;
  const existing = await readFile(new URL("../storage/uefarchive/Aardvark/FrakV11_E.uef", import.meta.url));
  const response = await request("/api/admin/games", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({
      title: "Compressed duplicate test",
      filename: "CompressedDuplicate_E.uef",
      publisher: "Aardvark",
      uefBase64: gzipSync(existing).toString("base64")
    })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Duplicate UEF content already exists/);
});
