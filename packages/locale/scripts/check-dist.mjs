import { readdir, readFile } from "node:fs/promises";

const dist = new URL("../dist/", import.meta.url);

const read = (name) => readFile(new URL(name, dist), "utf-8");

const rootLocale = await read("root-locale.mjs");

if (!rootLocale.includes('from "next/root-params"')) {
  console.error(
    "dist/root-locale.mjs no longer imports next/root-params, so the Next.js compiler cannot replace it."
  );
  process.exit(1);
}

const localeCookie = await read("locale-cookie.mjs");

if (!localeCookie.includes('from "next/headers"')) {
  console.error(
    "dist/locale-cookie.mjs no longer imports next/headers, so the app's cookies() mock cannot reach it."
  );
  process.exit(1);
}

const clientMessages = await read("client-messages.mjs");

if (
  !clientMessages.startsWith('"use client"') &&
  !clientMessages.startsWith("'use client'")
) {
  console.error('dist/client-messages.mjs dropped "use client".');
  process.exit(1);
}

const entries = await readdir(dist);
const declarations = entries.filter((name) => name.endsWith(".d.mts"));

const texts = await Promise.all(
  declarations.map((name) => read(name).then((text) => ({ name, text })))
);

for (const { name, text } of texts) {
  if (text.includes("declare module")) {
    console.error(
      `${name} redeclares a module. A published next/root-params declaration merges with the app's generated signature.`
    );
    process.exit(1);
  }
}
