import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("the manifest declares an installable standalone French app", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  assert.equal(manifest.lang, "fr");
  assert.equal(manifest.dir, "ltr");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#254496");
  assert.match(manifest.short_name, /UNIPLAST/);
  for (const purpose of ["any", "maskable"]) {
    for (const size of ["192x192", "512x512"]) {
      const icon = manifest.icons.find(
        (i: { purpose: string; sizes: string }) =>
          i.purpose === purpose && i.sizes === size,
      );
      assert.ok(icon, `missing ${purpose} ${size} icon`);
      assert.equal(icon.type, "image/png");
      assert.ok(existsSync(join(root, "public", icon.src.slice(1))));
    }
  }
});

test("the service worker never caches API traffic and keeps a network-first shell", () => {
  const worker = read("public/sw.js");
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /request\.mode === "navigate"/);
  assert.match(worker, /fetch\(request\)/);
  assert.match(worker, /caches\.match\("\/index\.html"\)/);
  assert.match(worker, /uniplast-shell-/);
  assert.match(worker, /self\.clients\.claim\(\)/);
  assert.doesNotMatch(worker, /caches\.match\(request\)[\s\S]*\/api\//);
});

test("registration is production-only and deployment headers keep the worker fresh", () => {
  const registration = read("src/pwa.ts");
  assert.match(registration, /import\.meta\.env\.PROD/);
  assert.match(registration, /register\("\/sw\.js", \{ scope: "\/" \}\)/);
  const entry = read("src/main.tsx");
  assert.match(entry, /import \{ registerServiceWorker \} from "\.\/pwa"/);
  assert.match(entry, /registerServiceWorker\(\)/);
  const html = read("index.html");
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
  assert.match(html, /name="apple-mobile-web-app-capable"/);
  const netlify = read("netlify.toml");
  assert.match(netlify, /for = "\/sw\.js"[\s\S]*Cache-Control = "no-cache"/);
  assert.match(
    netlify,
    /for = "\/manifest\.webmanifest"[\s\S]*Content-Type = "application\/manifest\+json"/,
  );
});
