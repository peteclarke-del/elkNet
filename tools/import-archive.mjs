import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const baseUrl = process.env.ELKNET_SOURCE_URL ?? "http://acornelectron.nl/uefarchive/";
const concurrency = Number.parseInt(process.env.ELKNET_IMPORT_CONCURRENCY ?? "6", 10);
const lines = (await readFile(resolve("storage", "catalog", "index.txt"), "utf8"))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => line.replace(/^\.\//, ""))
  .filter((line) => line.toLowerCase().endsWith(".uef"));

let cursor = 0;
let downloaded = 0;
let skipped = 0;

async function isValidUef(path) {
  try {
    const bytes = await readFile(path);
    return bytes.length >= 10 && bytes.subarray(0, 10).toString("latin1") === "UEF File!\0";
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function worker() {
  while (cursor < lines.length) {
    const index = cursor++;
    const relative = lines[index];
    const destination = resolve("storage", "uefarchive", relative);
    if (await isValidUef(destination)) {
      skipped += 1;
      continue;
    }

    const encodedPath = relative.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(new URL(encodedPath, baseUrl), {
      headers: { "User-Agent": "elkNet archive migration" },
      signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok) throw new Error(`${relative}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.subarray(0, 10).toString("latin1") !== "UEF File!\0") {
      throw new Error(`${relative}: response is not an uncompressed UEF`);
    }

    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.part`;
    await writeFile(temporary, bytes);
    await rename(temporary, destination);
    downloaded += 1;
    if ((downloaded + skipped) % 25 === 0) {
      console.log(`${downloaded + skipped}/${lines.length} processed`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
console.log(`${downloaded} downloaded, ${skipped} already present, ${lines.length} total`);
