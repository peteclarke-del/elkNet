import { generateContent } from "../src/server/catalog.mjs";

const games = await generateContent();
console.log(`Generated MENU, TITLES and web catalogue for ${games.length} titles`);
