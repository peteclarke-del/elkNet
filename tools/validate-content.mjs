import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const root = resolve("storage", "uefarchive");
let errors = 0;
let warnings = 0;

for (const required of ["MENU", "TITLES"]) {
  try {
    await access(resolve(root, required), constants.R_OK);
  } catch {
    console.warn(`warning: ${required} has not been added yet`);
    warnings += 1;
  }
}

async function walk(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walk(resolve(directory, entry.name), relative));
    else files.push(relative);
  }
  return files;
}

const files = await walk(root);
for (const relative of files.filter((file) => file.toLowerCase().endsWith(".uef"))) {
  const header = await readFile(resolve(root, relative), { encoding: null });
  if (header.subarray(0, 10).toString("latin1") !== "UEF File!\0") {
    console.error(`error: ${relative} does not have an uncompressed UEF header`);
    errors += 1;
  }
}

console.log(`${files.filter((file) => file.toLowerCase().endsWith(".uef")).length} UEF files checked; ${warnings} warnings`);
if (errors) process.exitCode = 1;
