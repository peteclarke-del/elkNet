import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const catalogRoot = resolve(projectRoot, "storage", "catalog");
const archiveRoot = resolve(projectRoot, "storage", "uefarchive");
const publicCatalogPath = resolve(projectRoot, "src", "web", "catalog.json");
const indexPath = resolve(catalogRoot, "index.txt");
const publishersPath = resolve(catalogRoot, "publishers.json");
const metadataPath = resolve(catalogRoot, "games.json");
const disabledPath = resolve(catalogRoot, "disabled.json");
const menuTemplateLoadAddress = 0x0e00;
const menuTemplateDirectoryOffset = 1596;
const menuTemplateDirhiAddress = 0x14b5;

export const suffixes = [
  "_RUN_BE.uef",
  "_RUN_E.uef",
  "_E.hq.uef",
  "_BE.uef",
  "_E.uef",
  ".uef"
];

export function originalMenuTitle(filename) {
  let title = filename[0] ?? "";
  for (const character of filename.slice(1)) {
    if (character === "-") continue;
    if (character >= "A" && character <= "Z") title += " ";
    title += character;
  }
  return title;
}

function parseLine(line, metadata) {
  const match = /^\.\/([^/]+)\/([^/]+)$/.exec(line);
  if (!match) throw new Error(`Invalid index entry: ${line}`);
  const [, publisher, file] = match;
  const suffix = suffixes.find((candidate) => file.endsWith(candidate));
  if (!suffix) return null;
  return {
    publisher,
    file,
    filename: file,
    filenameStem: file.slice(0, -suffix.length),
    title: metadata[`${publisher}/${file}`] ?? originalMenuTitle(file.slice(0, -suffix.length)),
    suffix,
    path: `${publisher}/${file}`
  };
}

export async function readGames() {
  let metadata = {};
  let disabled = [];
  try {
    metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    disabled = JSON.parse(await readFile(disabledPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const disabledPaths = new Set(disabled);
  const lines = [...new Set((await readFile(indexPath, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean))].sort();
  return lines.map((line) => parseLine(line, metadata)).filter(Boolean).map((game) => ({
    ...game,
    enabled: !disabledPaths.has(game.path)
  }));
}

export async function readPublishers() {
  try {
    return JSON.parse(await readFile(publishersPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const publishers = [...new Set((await readGames()).map(({ publisher }) => publisher))].sort();
    await writeFile(publishersPath, `${JSON.stringify(publishers, null, 2)}\n`);
    return publishers;
  }
}

export async function buildMenu(publishers) {
  if (publishers.length > 254) throw new Error("The directory table exceeds one byte");
  const menu = Buffer.from((await readFile(resolve(catalogRoot, "MENU.base64"), "utf8")).replace(/\s/g, ""), "base64");
  const prefix = Buffer.from(menu.subarray(0, menuTemplateDirectoryOffset));
  const dirhiAddress = menuTemplateLoadAddress + menuTemplateDirectoryOffset + publishers.length;

  let patchedReferences = 0;
  for (let offset = 0; offset < prefix.length - 2; offset += 1) {
    if (prefix[offset] === 0xb9 && prefix.readUInt16LE(offset + 1) === menuTemplateDirhiAddress) {
      prefix.writeUInt16LE(dirhiAddress, offset + 1);
      patchedReferences += 1;
    }
  }
  if (patchedReferences !== 2) throw new Error("The MENU template directory references could not be patched safely");

  const strings = publishers.map((publisher) => Buffer.from(`${publisher}\0`, "ascii"));
  const stringStart = menuTemplateLoadAddress + menuTemplateDirectoryOffset + publishers.length * 2;
  let stringAddress = stringStart;
  const pointers = strings.map((value) => {
    const address = stringAddress;
    stringAddress += value.length;
    return address;
  });
  const dirlo = Buffer.from(pointers.map((address) => address & 0xff));
  const dirhi = Buffer.from(pointers.map((address) => address >> 8));
  return Buffer.concat([prefix, dirlo, dirhi, ...strings]);
}

export async function generateContent() {
  const games = await readGames();
  const activeGames = games.filter(({ enabled }) => enabled);
  const publishers = await readPublishers();
  const publisherIds = new Map(publishers.map((publisher, index) => [publisher, index]));
  if (publishers.length > 254) throw new Error("The directory table exceeds one byte");

  const titleBytes = [];
  let pageOffset = 0;
  for (const game of activeGames) {
    const publisherId = publisherIds.get(game.publisher);
    if (publisherId === undefined) {
      throw new Error(`Publisher is not compiled into MENU: ${game.publisher}`);
    }
    const filename = Buffer.from(game.filenameStem, "ascii");
    const entryLength = filename.length + 2;
    if (entryLength >= 255) throw new Error(`Title is too long: ${game.file}`);
    if (pageOffset + entryLength >= 255) {
      titleBytes.push(0xfe);
      while (titleBytes.length % 256 !== 0) titleBytes.push(0x00);
      pageOffset = 0;
    }
    titleBytes.push(publisherId, ...filename, 0x80 + suffixes.indexOf(game.suffix));
    pageOffset += entryLength;
  }
  titleBytes.push(0xff);

  await mkdir(archiveRoot, { recursive: true });
  await writeFile(resolve(archiveRoot, "TITLES"), Buffer.from(titleBytes));
  await writeFile(resolve(archiveRoot, "MENU"), await buildMenu(publishers));
  await writeFile(publicCatalogPath, `${JSON.stringify(games.map(({ title, filename, publisher, path, enabled }) => ({
    title,
    filename,
    publisher,
    path,
    enabled
  })), null, 2)}\n`);
  await writeFile(metadataPath, `${JSON.stringify(Object.fromEntries(games.map(({ path, title }) => [path, title])), null, 2)}\n`);
  return games;
}

function validateFields({ title, publisher, filename }) {
  if (typeof title !== "string" || !title.trim() || title.length > 160 || /[\x00-\x1f\x7f]/.test(title)) {
    throw new Error("Title must be 1–160 printable characters");
  }
  if (typeof publisher !== "string" || !publisher) throw new Error("Publisher is required");
  if (typeof filename !== "string" || !/^[A-Za-z0-9._'()+&!-]{1,180}$/.test(filename)) {
    throw new Error("Filename contains unsupported characters");
  }
  if (!suffixes.some((suffix) => filename.endsWith(suffix))) throw new Error("Filename must use a supported UEF suffix");
}

function decodeUef(base64) {
  if (typeof base64 !== "string" || !base64) throw new Error("A UEF file is required");
  let bytes = Buffer.from(base64, "base64");
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      bytes = gunzipSync(bytes);
    } catch {
      throw new Error("The uploaded gzip file is damaged or incomplete");
    }
  }
  if (bytes.length < 10 || bytes.subarray(0, 10).toString("latin1") !== "UEF File!\0") {
    throw new Error("The upload does not contain a valid UEF File! header");
  }
  if (bytes.length > 2 * 1024 * 1024) throw new Error("UEF exceeds the 2 MiB upload limit");
  return bytes;
}

function contentHash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function findDuplicateUef(bytes, games) {
  const uploadedHash = contentHash(bytes);
  for (const game of games) {
    const existing = await readFile(resolve(archiveRoot, game.path));
    if (existing.length === bytes.length && contentHash(existing) === uploadedHash) return game;
  }
  return null;
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function saveIndex(games) {
  const contents = games.map(({ path }) => `./${path}`).sort().join("\n");
  const temporary = `${indexPath}.tmp`;
  const metadataTemporary = `${metadataPath}.tmp`;
  const disabledTemporary = `${disabledPath}.tmp`;
  await writeFile(temporary, `${contents}\n`);
  await writeFile(metadataTemporary, `${JSON.stringify(Object.fromEntries(games.map(({ path, title }) => [path, title.trim()])), null, 2)}\n`);
  await writeFile(disabledTemporary, `${JSON.stringify(games.filter(({ enabled }) => !enabled).map(({ path }) => path).sort(), null, 2)}\n`);
  await rename(temporary, indexPath);
  await rename(metadataTemporary, metadataPath);
  await rename(disabledTemporary, disabledPath);
  await generateContent();
}

let mutationQueue = Promise.resolve();
function serializeMutation(operation) {
  const result = mutationQueue.then(operation);
  mutationQueue = result.catch(() => {});
  return result;
}

export function addGame(input) {
  return serializeMutation(async () => {
    validateFields(input);
    const publishers = await readPublishers();
    if (!publishers.includes(input.publisher)) throw new Error("Publisher is not available in the legacy MENU");
    const bytes = decodeUef(input.uefBase64);
    const file = input.filename;
    const path = `${input.publisher}/${file}`;
    const destination = resolve(archiveRoot, path);
    if (await exists(destination)) throw new Error("A game already exists at that path");
    const games = await readGames();
    const duplicate = await findDuplicateUef(bytes, games);
    if (duplicate) throw new Error(`Duplicate UEF content already exists as ${duplicate.path}`);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx" });
    const suffix = suffixes.find((candidate) => file.endsWith(candidate));
    games.push({ title: input.title.trim(), publisher: input.publisher, suffix, filename: file, filenameStem: file.slice(0, -suffix.length), file, path, enabled: true });
    try {
      await saveIndex(games);
    } catch (error) {
      await unlink(destination).catch(() => {});
      throw error;
    }
    return { path };
  });
}

export function editGame(input) {
  return serializeMutation(async () => {
    validateFields(input);
    const publishers = await readPublishers();
    if (!publishers.includes(input.publisher)) throw new Error("Publisher is not available in the legacy MENU");
    const games = await readGames();
    const index = games.findIndex(({ path }) => path === input.originalPath);
    if (index < 0) throw new Error("Game not found");
    const oldPath = resolve(archiveRoot, games[index].path);
    const file = input.filename;
    const relativePath = `${input.publisher}/${file}`;
    const newPath = resolve(archiveRoot, relativePath);
    if (newPath !== oldPath && await exists(newPath)) throw new Error("A game already exists at the new path");
    await mkdir(dirname(newPath), { recursive: true });
    if (newPath !== oldPath) await rename(oldPath, newPath);
    const suffix = suffixes.find((candidate) => file.endsWith(candidate));
    games[index] = { title: input.title.trim(), publisher: input.publisher, suffix, filename: file, filenameStem: file.slice(0, -suffix.length), file, path: relativePath, enabled: games[index].enabled };
    try {
      await saveIndex(games);
    } catch (error) {
      if (newPath !== oldPath) await rename(newPath, oldPath).catch(() => {});
      throw error;
    }
    return { path: relativePath };
  });
}

export function removeGame(path) {
  return serializeMutation(async () => {
    const games = await readGames();
    const index = games.findIndex((game) => game.path === path);
    if (index < 0) throw new Error("Game not found");
    const [removed] = games.splice(index, 1);
    const source = resolve(archiveRoot, removed.path);
    const staged = `${source}.deleted`;
    await rename(source, staged);
    try {
      await saveIndex(games);
      await unlink(staged);
    } catch (error) {
      await rename(staged, source).catch(() => {});
      throw error;
    }
  });
}

export function setGameEnabled(path, enabled) {
  return serializeMutation(async () => {
    if (typeof enabled !== "boolean") throw new Error("Enabled state must be true or false");
    const games = await readGames();
    const game = games.find((candidate) => candidate.path === path);
    if (!game) throw new Error("Game not found");
    game.enabled = enabled;
    await saveIndex(games);
    return { path, enabled };
  });
}

export function addPublisher(name) {
  return serializeMutation(async () => {
    const publisher = typeof name === "string" ? name.trim() : "";
    if (!/^[A-Za-z0-9._'()+&!-]{1,40}$/.test(publisher)) {
      throw new Error("Publisher must be 1–40 URL-safe characters with no spaces or slashes");
    }
    const publishers = await readPublishers();
    const existing = publishers.find((value) => value.toLowerCase() === publisher.toLowerCase());
    if (existing) return { publisher: existing, created: false };
    publishers.push(publisher);
    publishers.sort();
    const temporary = `${publishersPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(publishers, null, 2)}\n`);
    await rename(temporary, publishersPath);
    try {
      await generateContent();
    } catch (error) {
      await writeFile(publishersPath, `${JSON.stringify(publishers.filter((value) => value !== publisher), null, 2)}\n`);
      await generateContent().catch(() => {});
      throw error;
    }
    return { publisher, created: true };
  });
}
