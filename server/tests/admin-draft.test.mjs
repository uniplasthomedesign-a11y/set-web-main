import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createNetlifyHandler } from "../netlify-store.mjs";
import { memoryStores } from "./blob-fixture.mjs";

const SITE = "https://admin-draft-test.example";
const PASSWORD = "TEST-ONLY-draft-admin-password-2026!";
const INSTALL = "TEST-ONLY-draft-installation-key-2026";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
async function fixture() {
  const stores = memoryStores(), cookies = {};
  const config = { getStores: () => stores, origins: [SITE], setupKey: INSTALL };
  async function call(route, body, who = "admin", binary = false, mime = "image/png") {
    const response = await createNetlifyHandler(config)(new Request(SITE + "/api/local/" + route, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(body === undefined ? {} : { "content-type": binary ? mime : "application/json" }),
        ...(cookies[who] ? { cookie: cookies[who] } : {}),
      },
      body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
    }), { ip: "192.0.2.89" });
    const cookie = response.headers.get("set-cookie");
    if (cookie) cookies[who] = cookie.split(";")[0];
    return { status: response.status, data: await response.json() };
  }
  assert.equal((await call("setup", { setup_key: INSTALL, password: PASSWORD })).status, 200);
  const catalog = async () => (await call("catalog")).data;
  const sync = (operations, who) => call("admin-draft-sync", { operations }, who);
  return { call, sync, catalog, stores };
}
const edit = (entity, value, changes) => ({ entity, id: entity === "settings" ? "settings" : value.id, changes,
  expected: Object.fromEntries(Object.keys(changes).map((key) => [key, value[key] === undefined ? null : value[key]])) });
const create = (entity, value) => {
  const changes = { ...value };
  for (const key of ["id", "source_metadata", "manual_position", "demo", "price_hidden", "public_discount_percent"]) delete changes[key];
  return { entity, id: value.id, changes, expected: null, create: true };
};
const remove = (entity, value) => ({ entity, id: value.id, changes: {}, expected: value, remove: true });

test("draft batches merge touched fields, retain fresh photos/prices/anchors and retry atomically across cold invocations", async () => {
  const f = await fixture(), original = await f.catalog();
  const product = original.products[0], family = original.families.find((family) => family.id === product.family_id);
  const images = [{ url: "/assets/concurrent-owner.webp", scale: 1.2, x: 8, y: -9 }];
  assert.equal((await f.call("product-save", { ...product, images, unit_price_cents: 12345, discount_price_cents: null })).status, 200);
  assert.equal((await f.call("product-position", { id: product.id, position: 1 })).status, 200);
  assert.equal((await f.call("family-save", { ...family, image: "/assets/concurrent-family.webp" })).status, 200);
  const operations = [
    edit("product", product, { description: "Description enregistrée localement" }),
    edit("family", family, { introduction: "Présentation enregistrée localement" }),
    edit("settings", original.settings, { about_title: "Présentation synchronisée" }),
  ];
  const result = await f.sync(operations);
  assert.equal(result.status, 200); assert.deepEqual(result.data, { applied: 3, updated: 3, created: 0, removed: 0, unchanged: 0 });
  let current = await f.catalog(), saved = current.products.find((p) => p.id === product.id);
  assert.equal(saved.description, operations[0].changes.description);
  assert.deepEqual(saved.images, images); assert.equal(saved.unit_price_cents, 12345); assert.equal(saved.manual_position, 1);
  assert.equal(current.families.find((p) => p.id === family.id).image, "/assets/concurrent-family.webp");
  assert.deepEqual(current.products.filter((p) => p.id !== product.id), original.products.filter((p) => p.id !== product.id));
  assert.equal((await f.sync(operations)).data.unchanged, 3, "lost successful replies can be retried");
  const parallel = await Promise.all([
    f.sync([edit("product", saved, { dimensions: "Dimensions concurrentes" })]),
    f.sync([edit("product", saved, { material: "PP synchronisé" })]),
  ]);
  assert.deepEqual(parallel.map((reply) => reply.status), [200, 200]);
  current = await f.catalog(); saved = current.products.find((p) => p.id === product.id);
  assert.equal(saved.dimensions, "Dimensions concurrentes"); assert.equal(saved.material, "PP synchronisé");
  assert.deepEqual(saved.images, images); assert.ok(f.stores.state.conflicts > 0, "durable CAS retries were exercised");
});

test("same-field conflicts and existing route validation reject the complete batch", async () => {
  const f = await fixture(), original = await f.catalog(), product = original.products[0];
  assert.equal((await f.call("product-save", { ...product, description: "Autre modification" })).status, 200);
  let before = await f.catalog();
  assert.equal((await f.sync([
    edit("settings", original.settings, { about_title: "Ne doit pas être publié" }),
    edit("product", product, { description: "Valeur périmée" }),
  ])).status, 409);
  assert.deepEqual(await f.catalog(), before);
  const family = before.families.find((p) => p.kind !== "new");
  for (const invalid of [
    edit("family", family, { slider_interval: 2 }),
    edit("family", family, { kind: "new" }),
    edit("settings", before.settings, { price_visibility: "invalid" }),
    edit("settings", before.settings, { storefront_theme: "invalid-theme" }),
    edit("product", product, { unit_price_cents: -1 }),
  ]) {
    const valid = invalid.entity === "settings"
      ? edit("product", before.products.find((p) => p.id === product.id), { dimensions: "Doit rester inchangé" })
      : edit("settings", before.settings, { about_title: "Doit rester inchangé" });
    assert.equal((await f.sync([valid, invalid])).status, 400);
    assert.deepEqual(await f.catalog(), before, "validator errors roll back every entity");
  }
});

test("new families/products, final reference swaps and full-record deletions are guarded and idempotent", async () => {
  const f = await fixture(), original = await f.catalog();
  const base = original.products[0], family = { ...original.families.find((p) => p.kind !== "new"), id: randomUUID(), name: "Famille locale" };
  const product = { ...base, id: randomUUID(), family_id: family.id, code: "LOCAL-CREATE-TEST", barcode: null,
    images: [], name: "Produit local", name_fr: "Produit local", discount_price_cents: null };
  const operations = [create("product", product), create("family", family)];
  const result = await f.sync(operations); assert.equal(result.status, 200); assert.equal(result.data.created, 2);
  assert.equal((await f.sync(operations)).data.unchanged, 2);
  let current = await f.catalog(), created = current.products.find((p) => p.id === product.id), savedFamily = current.families.find((p) => p.id === family.id);
  assert.equal((await f.sync([remove("family", savedFamily)])).status, 400, "cannot leave a dangling primary family");
  assert.equal((await f.call("product-save", { ...created, description: "Nouvelle information à conserver" })).status, 200);
  const beforeConflict = await f.catalog();
  assert.equal((await f.sync([remove("family", savedFamily), remove("product", created)])).status, 409);
  assert.deepEqual(await f.catalog(), beforeConflict);
  created = beforeConflict.products.find((p) => p.id === product.id);
  const deletion = [remove("family", savedFamily), remove("product", created)];
  assert.equal((await f.sync(deletion)).data.removed, 2);
  assert.equal((await f.sync(deletion)).data.unchanged, 2);
  assert.deepEqual(await f.catalog(), original);
  const [a, b] = original.products;
  assert.equal((await f.sync([edit("product", a, { code: b.code, barcode: b.barcode }), edit("product", b, { code: a.code, barcode: a.barcode })])).status, 200);
  current = await f.catalog();
  assert.equal(current.products.find((p) => p.id === a.id).code, b.code);
  assert.equal(current.products.find((p) => p.id === b.id).code, a.code);
  const collision = { ...product, id: randomUUID(), family_id: base.family_id, code: a.code };
  const beforeCollision = await f.catalog();
  assert.equal((await f.sync([create("family", { ...family, id: randomUUID() }), create("product", collision)])).status, 400);
  assert.deepEqual(await f.catalog(), beforeCollision);
});

test("only administrators can sync allowlisted catalogue fields within bounded batches", async () => {
  const f = await fixture(), original = await f.catalog(), product = original.products[0];
  const op = edit("product", product, { description: "Brouillon" });
  assert.equal((await f.sync([op], "visitor")).status, 403);
  for (const operations of [
    [{ ...op, entity: "order" }], [{ ...op, changes: { manual_position: 1 }, expected: { manual_position: null } }],
    [{ ...op, changes: { source_metadata: {} }, expected: { source_metadata: product.source_metadata } }],
    [{ ...op, expected: {} }], [op, op], Array.from({ length: 501 }, () => op),
    [{ ...remove("product", product), expected: { id: product.id, name: product.name } }],
  ]) assert.ok([400, 409].includes((await f.sync(operations)).status));
  assert.equal((await f.sync([edit("settings", original.settings, { about_body: "x".repeat(3 * 1024 * 1024) })])).status, 413);
  assert.deepEqual(await f.catalog(), original);
});

test("public upload keys deduplicate exact bytes across cold and concurrent retries without exposing private media", async () => {
  const f = await fixture(), key = randomUUID(), route = "upload?public=1&key=" + key;
  assert.equal((await f.call(route, PNG, "visitor", true)).status, 403);
  const first = await f.call(route, PNG, "admin", true);
  assert.equal(first.status, 200);
  const writes = f.stores.files.writes, count = f.stores.files.records.size;
  const repeat = await f.call(route, PNG, "admin", true, "image/x-png");
  assert.equal(repeat.data, first.data); assert.equal(f.stores.files.writes, writes); assert.equal(f.stores.files.records.size, count);
  assert.equal((await f.call(route, Buffer.concat([PNG, Buffer.from([1])]), "admin", true)).status, 409);
  const concurrentKey = randomUUID();
  const both = await Promise.all([0, 1].map(() => f.call("upload?public=1&key=" + concurrentKey, PNG, "admin", true)));
  assert.deepEqual(both.map((r) => r.status), [200, 200]); assert.equal(both[0].data, both[1].data);
  assert.equal(f.stores.files.records.size, count + 1);
  assert.equal((await f.call("upload?public=0&key=" + randomUUID(), PNG, "admin", true)).status, 400);
  const oldA = await f.call("upload?public=1", PNG, "admin", true), oldB = await f.call("upload?public=1", PNG, "admin", true);
  assert.notEqual(oldA.data, oldB.data, "legacy uploads without a key keep their behavior");
});
