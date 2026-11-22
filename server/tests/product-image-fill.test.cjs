const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  applyProductImageFill,
  productImageFillKey,
  productImageFillVersion,
} = require("../product-image-fill.cjs");
const PREFIX = "/assets/products/photos-2026-11-08/";
const image = (url, scale = 1) => ({ url, scale, x: 0, y: 0 });
function fixture(products) {
  const records = new Map(
    products.map((p) => ["product:" + p.id, structuredClone(p)]),
  );
  records.set("settings:true", {
    id: true,
    phone: "OWNER",
    heroes: [{ image: "/assets/owner.jpg" }],
  });
  const metadata = new Map();
  const access = {
    existingCatalog: true,
    meta: (k) => metadata.get(k),
    setMeta: (k, v) => metadata.set(k, v),
    all: (kind) =>
      [...records.entries()]
        .filter(([k]) => k.startsWith(kind + ":"))
        .map(([, v]) => structuredClone(v)),
    put: (kind, value) =>
      records.set(kind + ":" + value.id, structuredClone(value)),
    transaction: (fn) => fn(),
  };
  return { records, metadata, access };
}
const source = (rows) => ({
  version: productImageFillVersion,
  asset_prefix: PREFIX,
  products: rows,
});
const row = (id, legacy_images = []) => ({
  product_id: id,
  code: id.toUpperCase(),
  images: [image(PREFIX + id + "-abc.webp")],
  legacy_images,
});
const product = (id, images) => ({
  id,
  code: id.toUpperCase(),
  name: "OWNER " + id,
  images,
  unit_price_cents: 12345,
  weight_grams: 777.5,
  manual_position: 3,
  visible: false,
  family_id: "OWNER-FAMILY",
  owner_extra: { keep: "byte identical" },
});

test("existing image fill preserves owner photos, zoom and every non-image field, with backup and one-time marker", () => {
  const legacy = [image("/assets/legacy.webp")];
  const f = fixture([
    product("a", []),
    product("b", legacy),
    product("c", [image("/api/local/file?id=OWNER")]),
    product("d", [image("/assets/legacy.webp", 1.5)]),
    product("e", [image("https://example.com/owner.png")]),
    product("f", [image(PREFIX + "previous.webp")]),
    product("g", []),
    { ...product("g-other", []), code: "g" },
  ]);
  const manifest = source([
    row("a"),
    row("b", legacy),
    row("c"),
    row("d", legacy),
    row("e"),
    row("f", [image(PREFIX + "previous.webp")]),
    row("g"),
    row("unknown"),
    { ...row("mismatch"), product_id: "wrong-id" },
  ]);
  const before = structuredClone([...f.records.entries()]);
  applyProductImageFill({ ...f.access, source: manifest });
  for (const [key, value] of before) {
    const actual = f.records.get(key);
    if (["product:a", "product:b"].includes(key))
      assert.deepEqual(actual, {
        ...value,
        images: manifest.products.find((r) => "product:" + r.product_id === key)
          .images,
      });
    else assert.deepEqual(actual, value);
  }
  assert.equal(f.access.all("product").length, 8);
  const backup = f.records.get(
    "product-image-fill-backup:" + productImageFillVersion,
  );
  assert.equal(backup.changes.length, 2);
  assert.equal(backup.summary.replaced_legacy, 1);
  assert.equal(backup.summary.ambiguous, 1);
  assert(f.metadata.has(productImageFillKey));
  f.records.set("product:a", { ...f.records.get("product:a"), images: [] });
  const after = structuredClone([...f.records.entries()]);
  applyProductImageFill({ ...f.access, source: manifest });
  assert.deepEqual(
    [...f.records.entries()],
    after,
    "reopening never refills a manually cleared photo",
  );
});

test("fresh seeds receive all reviewed mapped photos, including replacement seed samples", () => {
  const f = fixture([product("a", [image("/assets/sample.webp", 1.5)])]);
  const manifest = source([row("a")]);
  const original = structuredClone(f.records.get("product:a"));
  applyProductImageFill({
    ...f.access,
    existingCatalog: false,
    source: manifest,
  });
  assert.deepEqual(f.records.get("product:a"), {
    ...original,
    images: manifest.products[0].images,
  });
});

test("duplicate mappings and unsafe manifest assets are rejected before any writes", () => {
  const valid = source([row("a")]);
  const invalid = [
    source([row("a"), row("a")]),
    source([row("a"), { ...row("b"), code: " a " }]),
    source([row("a"), { ...row("b"), product_id: "a" }]),
    ...[
      "/assets/other.webp",
      PREFIX + "../bad.webp",
      PREFIX + "%2e.webp",
      PREFIX + "bad.webp?x=1",
      "https://example.com/a.webp",
    ].map((url) => source([{ ...row("a"), images: [image(url)] }])),
    source([{ ...row("a"), images: [image(PREFIX + "a.webp", 2)] }]),
  ];
  for (const manifest of invalid) {
    const f = fixture([product("a", [])]);
    const before = structuredClone([...f.records.entries()]);
    assert.throws(() =>
      applyProductImageFill({ ...f.access, source: manifest }),
    );
    assert.deepEqual([...f.records.entries()], before);
    assert.equal(f.metadata.size, 0);
  }
  assert.doesNotThrow(() =>
    applyProductImageFill({
      ...fixture([product("a", [])]).access,
      source: valid,
    }),
  );
});
