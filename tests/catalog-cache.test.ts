import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import seed from "../src/data/catalog.json" with { type: "json" };
import type { Catalog } from "../src/types.ts";
import {
  CATALOG_CACHE_KEY,
  canReuseCatalogCache,
  loadCachedCatalog,
  saveCachedCatalog,
  type CachedCatalog,
} from "../src/catalogCache.ts";

const require = createRequire(import.meta.url);
const { defaultSettings } = require("../server/generated/defaults.cjs");
const catalog = {
  products: [seed.products[0]],
  families: seed.families,
  settings: defaultSettings,
  sales: {},
} as Catalog;
function snapshot(): CachedCatalog {
  return {
    schema: 1,
    revision: "a".repeat(64),
    catalog: structuredClone(catalog),
    client_approved: false,
    price_access: false,
  };
}
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

test("the new catalogue does not reuse a pre-Emballage snapshot or clear personal favourites", () => {
  const storage = memoryStorage();
  storage.setItem("uniplast.catalog-cache.v1", JSON.stringify(snapshot()));
  storage.setItem("uniplast.favorites.v1", '["existing-product"]');
  assert.equal(loadCachedCatalog(storage), null);
  assert.equal(saveCachedCatalog(snapshot(), storage), true);
  assert.equal(storage.getItem("uniplast.catalog-cache.v1"), null);
  assert.equal(
    storage.getItem("uniplast.favorites.v1"),
    '["existing-product"]',
  );
});

test("catalogue cache round-trip preserves data and enforces schema and shape", () => {
  const storage = memoryStorage();
  const value = snapshot();
  assert.equal(loadCachedCatalog(storage), null);
  assert.equal(saveCachedCatalog(value, storage), true);
  assert.deepEqual(loadCachedCatalog(storage), value);
  for (const invalid of [
    "{",
    "null",
    "[]",
    JSON.stringify({ ...value, schema: 2 }),
    JSON.stringify({ ...value, revision: "not-a-revision" }),
    JSON.stringify({ ...value, price_access: "false" }),
    JSON.stringify({
      ...value,
      catalog: { ...value.catalog, products: [{ id: "p" }] },
    }),
    JSON.stringify({ ...value, catalog: { ...value.catalog, families: {} } }),
    JSON.stringify({ ...value, catalog: { ...value.catalog, settings: null } }),
    JSON.stringify({
      ...value,
      catalog: { ...value.catalog, sales: { invalid: "1" } },
    }),
  ]) {
    storage.setItem(CATALOG_CACHE_KEY, invalid);
    assert.equal(loadCachedCatalog(storage), null);
  }
  const duplicate = snapshot();
  duplicate.catalog.products.push(duplicate.catalog.products[0]);
  assert.equal(saveCachedCatalog(duplicate, storage), false);
});

test("optional video and family collections preserve valid data and reject corrupt nested values", () => {
  const storage = memoryStorage();
  const value = snapshot();
  const slide = {
    id: "test-slide",
    title: "Collection",
    body: "Présentation",
    image: "/assets/test.webp",
    visible: true,
    eyebrow: "",
    cta: "Voir",
    family_id: value.catalog.families[0].id,
  };
  value.catalog.families[0].slides = [slide];
  value.catalog.families[0].promotions = [{ ...slide, id: "test-promotion" }];
  value.catalog.families[0].aliases = ["Ancienne collection"];
  value.catalog.settings.videos = [
    {
      id: "test-video",
      title: "Présentation",
      source: "youtube",
      url: "https://www.youtube.com/watch?v=test",
      poster_url: "",
      visible: true,
    },
  ];
  assert.equal(saveCachedCatalog(value, storage), true);
  assert.deepEqual(loadCachedCatalog(storage), value);
  const invalidValues = [
    {
      ...value,
      catalog: {
        ...value.catalog,
        settings: { ...value.catalog.settings, videos: "bad" },
      },
    },
    {
      ...value,
      catalog: {
        ...value.catalog,
        settings: { ...value.catalog.settings, videos: [null] },
      },
    },
    {
      ...value,
      catalog: {
        ...value.catalog,
        settings: {
          ...value.catalog.settings,
          videos: [
            {
              id: "v",
              title: "Video",
              source: "invalid",
              url: "",
              poster_url: "",
              visible: true,
            },
          ],
        },
      },
    },
    ...["slides", "promotions", "aliases"].map((field) => ({
      ...value,
      catalog: {
        ...value.catalog,
        families: [{ ...value.catalog.families[0], [field]: "bad" }],
      },
    })),
    ...["slides", "promotions"].map((field) => ({
      ...value,
      catalog: {
        ...value.catalog,
        families: [{ ...value.catalog.families[0], [field]: [null] }],
      },
    })),
    {
      ...value,
      catalog: {
        ...value.catalog,
        families: [{ ...value.catalog.families[0], aliases: [1] }],
      },
    },
  ];
  for (const invalid of invalidValues) {
    assert.equal(
      saveCachedCatalog(invalid as unknown as CachedCatalog, storage),
      false,
    );
    storage.setItem(CATALOG_CACHE_KEY, JSON.stringify(invalid));
    assert.equal(loadCachedCatalog(storage), null);
  }
});

test("inaccessible storage, quota errors and oversize snapshots fail safely", () => {
  const unavailable = {
    getItem() {
      throw new Error("Storage denied");
    },
    setItem() {
      throw new Error("Quota exceeded");
    },
    removeItem() {
      throw new Error("Storage denied");
    },
  };
  assert.equal(loadCachedCatalog(unavailable), null);
  assert.equal(saveCachedCatalog(snapshot(), unavailable), false);
  assert.equal(saveCachedCatalog(null, unavailable), false);
  const storage = memoryStorage();
  storage.setItem(CATALOG_CACHE_KEY, " ".repeat(8 * 1024 * 1024 + 1));
  assert.equal(loadCachedCatalog(storage), null);
  const large = snapshot();
  large.catalog.products[0].description = "é".repeat(4 * 1024 * 1024);
  assert.equal(saveCachedCatalog(large, storage), false);
});

test("administrator snapshots are rejected and remove an older public cache", () => {
  const storage = memoryStorage();
  assert.equal(saveCachedCatalog(snapshot(), storage), true);
  assert.equal(
    saveCachedCatalog({ ...snapshot(), admin: true }, storage),
    false,
  );
  assert.equal(storage.getItem(CATALOG_CACHE_KEY), null);
  storage.setItem(
    CATALOG_CACHE_KEY,
    JSON.stringify({ ...snapshot(), admin: true }),
  );
  assert.equal(loadCachedCatalog(storage), null);
  assert.equal(saveCachedCatalog(null, storage), true);
  assert.equal(storage.getItem(CATALOG_CACHE_KEY), null);
});

test("reuse requires fresh matching access evidence, independent of revision changes", () => {
  const cached = snapshot();
  const probe = {
    admin: false,
    client_approved: false,
    price_access: false,
    revision: cached.revision,
  };
  assert.equal(canReuseCatalogCache(cached, probe), true);
  assert.equal(
    canReuseCatalogCache(cached, { ...probe, revision: "b".repeat(64) }),
    true,
  );
  assert.equal(canReuseCatalogCache(cached, { client_approved: false }), false);
  assert.equal(
    canReuseCatalogCache(cached, { ...probe, revision: undefined }),
    false,
  );
  assert.equal(
    canReuseCatalogCache(cached, { ...probe, admin: undefined }),
    false,
  );
  assert.equal(canReuseCatalogCache(cached, { ...probe, admin: true }), false);
  assert.equal(
    canReuseCatalogCache(cached, {
      ...probe,
      revision: undefined,
      access_only: true,
    }),
    true,
  );
  assert.equal(canReuseCatalogCache({ ...cached, admin: true }, probe), false);
  assert.equal(
    canReuseCatalogCache(
      { ...cached, schema: 2 } as unknown as CachedCatalog,
      probe,
    ),
    false,
  );
  assert.equal(
    canReuseCatalogCache(cached, { ...probe, price_access: true }),
    false,
  );
  const approved = { ...cached, client_approved: true, price_access: true };
  assert.equal(
    canReuseCatalogCache(approved, {
      ...probe,
      client_approved: true,
      price_access: true,
    }),
    true,
  );
  assert.equal(
    canReuseCatalogCache(approved, {
      ...probe,
      client_approved: false,
      price_access: true,
    }),
    false,
  );
  assert.equal(
    canReuseCatalogCache(approved, {
      ...probe,
      client_approved: true,
      price_access: false,
    }),
    false,
  );
  assert.equal(canReuseCatalogCache(null, probe), false);
});
