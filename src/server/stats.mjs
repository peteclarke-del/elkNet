import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const statsPath = resolve(fileURLToPath(new URL("../../storage/stats/stats.json", import.meta.url)));
let state;
let writeQueue = Promise.resolve();

async function load() {
  if (state) return state;
  try {
    state = JSON.parse(await readFile(statsPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    state = { devices: {}, files: {}, totalDownloads: 0 };
  }
  return state;
}

function normalizedMac(value) {
  if (!value) return null;
  const compact = value.replace(/[^0-9a-f]/gi, "").toUpperCase();
  return /^[0-9A-F]{12}$/.test(compact) ? compact.match(/../g).join(":") : null;
}

async function persist() {
  await mkdir(dirname(statsPath), { recursive: true });
  const temporary = `${statsPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
  await rename(temporary, statsPath);
}

export async function recordDownload({ mac, ip, forwardedFor, remoteAddress, userAgent, acceptLanguage, path, bytes }) {
  const stats = await load();
  const actualMac = normalizedMac(mac);
  const id = actualMac ?? ip ?? "unknown";
  const now = new Date().toISOString();
  const device = stats.devices[id] ?? {
    id,
    identifierType: actualMac ? "mac" : "ip",
    firstSeen: now,
    downloads: 0,
    bytes: 0,
    files: [],
    fileDownloads: {}
  };
  device.identifierType = actualMac ? "mac" : "ip";
  device.ip = ip ?? device.ip ?? null;
  device.mac = actualMac ?? device.mac ?? null;
  device.forwardedFor = forwardedFor ?? device.forwardedFor ?? null;
  device.remoteAddress = remoteAddress ?? device.remoteAddress ?? null;
  device.userAgent = userAgent ?? device.userAgent ?? null;
  device.acceptLanguage = acceptLanguage ?? device.acceptLanguage ?? null;
  device.lastSeen = now;
  device.downloads += 1;
  device.bytes = (device.bytes ?? 0) + bytes;
  device.files = Array.isArray(device.files) ? device.files : [];
  if (!device.files.includes(path)) device.files.push(path);
  device.fileDownloads = device.fileDownloads && typeof device.fileDownloads === "object" ? device.fileDownloads : {};
  const deviceFile = device.fileDownloads[path] ?? {
    path,
    downloads: 0,
    bytes: 0,
    firstDownloaded: now
  };
  deviceFile.downloads += 1;
  deviceFile.bytes += bytes;
  deviceFile.lastDownloaded = now;
  device.fileDownloads[path] = deviceFile;
  device.lastFile = path;
  stats.devices[id] = device;
  const file = stats.files[path] ?? { path, downloads: 0, bytes: 0 };
  file.downloads += 1;
  file.bytes += bytes;
  file.lastDownloaded = now;
  stats.files[path] = file;
  stats.totalDownloads += 1;
  writeQueue = writeQueue.then(persist, persist);
  await writeQueue;
}

export async function readStats() {
  const stats = await load();
  return {
    totalDownloads: stats.totalDownloads,
    devices: Object.values(stats.devices).map((device) => {
      const knownFiles = Array.isArray(device.files) ? device.files : [];
      const recorded = device.fileDownloads && typeof device.fileDownloads === "object" ? device.fileDownloads : {};
      const fileDownloads = knownFiles.map((path) => recorded[path] ?? {
        path,
        downloads: null,
        bytes: null,
        firstDownloaded: null,
        lastDownloaded: null,
        historical: true
      }).sort((a, b) => (b.downloads ?? -1) - (a.downloads ?? -1) || a.path.localeCompare(b.path));
      return {
        ...device,
        bytes: device.bytes ?? 0,
        files: knownFiles,
        fileDownloads,
        uniqueFiles: knownFiles.length
      };
    }).sort((a, b) => b.downloads - a.downloads || b.lastSeen.localeCompare(a.lastSeen)),
    files: Object.values(stats.files).sort((a, b) => b.downloads - a.downloads)
  };
}
