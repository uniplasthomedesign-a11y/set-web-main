import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { createNetlifyHandler } from "../netlify-store.mjs";
import { memoryStores } from "./blob-fixture.mjs";
const require = createRequire(import.meta.url);
const { createLocalStore } = require("../local-store.cjs");
const canonical = require("../../data/emballage-canonical-2026-11-09.json");
const imageManifest = require("../../data/emballage-images-2026-11-09.json");
const { KEY: imageMarkerKey } = require("../emballage-images.cjs");
const SITE = "https://emballage-test.example",
  INSTALL = "TEST-ONLY-emballage-installation-key-2026";
const PASSWORD = "TEST-ONLY-emballage-admin-2026!",
  CODE = "TEST-ONLY-emballage-update-2026!";
const identityFields = ["code", "name", "name_fr", "barcode", "images"];
const withoutIdentity = (product) =>
  Object.fromEntries(
    Object.entries(product).filter(
      ([field]) => !identityFields.includes(field),
    ),
  );

async function fixture(unlock = true) {
  const stores = memoryStores(),
    cookies = {};
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "uniplast-emballage-test-"),
  );
  try {
    const initial = createLocalStore({ dataDir: dir });
    initial.close();
    const db = new DatabaseSync(path.join(dir, "store.sqlite"));
    const pairs = new Map();
    for (const row of canonical.rows) {
      const values = pairs.get(row.legacy_base_id) || [];
      values.push(row);
      pairs.set(row.legacy_base_id, values);
    }
    for (const [id, pair] of pairs) {
      const p = JSON.parse(
        db
          .prepare("SELECT body FROM documents WHERE kind='product' AND id=?")
          .get(id).body,
      );
      const chosen =
        pair.find((r) => r.barcode === p.barcode) ||
        pair.find((r) => r.lid_variant === "TRANSPARENT");
      p.name = chosen.name.replace(/ COUVERCLE (TRANSPARENT|COULEUR)$/, "");
      p.name_fr = p.name;
      p.barcode = pair.some((r) => r.barcode === p.barcode) ? p.barcode : null;
      p.dimensions = "10 × 20 cm";
      p.weight_grams = 123.5;
      p.pack_size = 24;
      p.material = "PP";
      p.images = structuredClone(
        imageManifest.rows.find(
          (row) => row.legacy_base_id === id && row.kind === "authentic",
        ).approved_base_images,
      );
      db.prepare(
        "UPDATE documents SET body=? WHERE kind='product' AND id=?",
      ).run(JSON.stringify(p), id);
    }
    db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE");
    db.close();
    await stores.state.set(
      "store.sqlite",
      new Blob([fs.readFileSync(path.join(dir, "store.sqlite"))]),
    );
  } finally {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith("uniplast-emballage-test-"));
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const config = {
    getStores: () => stores,
    origins: [SITE],
    setupKey: INSTALL,
  };
  const call = async (name, body, who = "admin") => {
    const response = await createNetlifyHandler(config)(
      new Request(SITE + "/api/local/" + name, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(cookies[who] ? { cookie: cookies[who] } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { ip: "192.0.2.42" },
    );
    const cookie = response.headers.get("set-cookie");
    if (cookie) cookies[who] = cookie.split(";")[0];
    return { status: response.status, data: await response.json() };
  };
  assert.equal(
    (await call("setup", { setup_key: INSTALL, password: PASSWORD })).status,
    200,
  );
  if (unlock)
    assert.equal((await call("transfer-code", { next: CODE })).status, 200);
  const catalog = (await call("catalog")).data;
  const rowsFor = (catalog) => {
    const products = new Map(catalog.products.map((p) => [p.id, p]));
    return canonical.rows.map((row) => {
      const p = products.get(row.legacy_base_id);
      const pair = canonical.rows.filter(
        (r) => r.legacy_base_id === row.legacy_base_id,
      );
      const chosen =
        pair.find((r) => r.barcode === p.barcode) ||
        pair.find((r) => r.lid_variant === "TRANSPARENT");
      return {
        action: row.code === chosen.code ? "update" : "create",
        id: row.code === chosen.code ? p.id : "",
        base_id: p.id,
        previous_code: row.legacy_base_code,
        legacy_base_code: row.legacy_base_code,
        code: row.code,
        name: row.name,
        barcode: row.barcode,
      };
    });
  };
  const rows = rowsFor(catalog);
  const preview = async (overrideRows = rows, extra = {}) => {
    const exported = await call("transfer-export", {});
    if (exported.status !== 200) return exported;
    return call("transfer-emballage-preview", {
      export_id: exported.data.export_id,
      source_sha256: canonical.source_sha256,
      rows: overrideRows,
      ...extra,
    });
  };
  return { stores, call, catalog, rows, rowsFor, preview };
}

async function imageMarker(stores) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "uniplast-emballage-marker-"),
  );
  try {
    const file = path.join(directory, "store.sqlite");
    fs.writeFileSync(file, Buffer.from(await stores.state.get("store.sqlite")));
    const database = new DatabaseSync(file, { readOnly: true });
    try {
      return (
        database
          .prepare("SELECT value FROM meta WHERE key=?")
          .get(imageMarkerKey)?.value || ""
      );
    } finally {
      database.close();
    }
  } finally {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(
      path.basename(directory).startsWith("uniplast-emballage-marker-"),
    );
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function staticOwnerImages(images) {
  return images.map((image) => ({
    ...image,
    url: imageManifest.url_mapping[image.url] || image.url,
    ...(image.original_url
      ? {
          original_url:
            imageManifest.url_mapping[image.original_url] || image.original_url,
        }
      : {}),
  }));
}

test("emballage import requires administrator and update grant; exact canonical scope is enforced", async () => {
  const f = await fixture(false);
  assert.equal(
    (await f.call("transfer-emballage-preview", {}, "visitor")).status,
    403,
  );
  assert.equal((await f.call("transfer-emballage-preview", {})).status, 403);
  assert.equal((await f.call("transfer-code", { next: CODE })).status, 200);
  assert.equal(
    (await f.preview(f.rows, { source_sha256: "wrong" })).status,
    400,
  );
  assert.equal((await f.preview(f.rows.slice(1))).status, 400);
  const wrongName = structuredClone(f.rows);
  wrongName[0].name += " MODIFIE";
  assert.equal((await f.preview(wrongName)).status, 400);
  const duplicate = structuredClone(f.rows);
  duplicate[1] = duplicate[0];
  assert.equal((await f.preview(duplicate)).status, 400);
  const outside = f.catalog.products.find((p) => !/EMBALLAGE/.test(p.name));
  const wrongBase = structuredClone(f.rows);
  wrongBase[0].base_id = outside.id;
  assert.equal((await f.preview(wrongBase)).status, 400);
  const extra = structuredClone(f.rows);
  extra[0].unit_price_cents = 1;
  assert.equal((await f.preview(extra)).status, 400);
  const known = f.catalog.products.find(
    (p) => /EMBALLAGE/.test(p.name) && p.barcode,
  );
  const swapped = structuredClone(f.rows),
    pair = swapped.filter((r) => r.base_id === known.id);
  for (const row of pair) {
    row.action = row.action === "update" ? "create" : "update";
    row.id = row.action === "update" ? row.base_id : "";
  }
  assert.equal(
    (await f.preview(swapped)).status,
    400,
    "known EAN must not change to the other lid",
  );
  assert.deepEqual((await f.call("catalog")).data.products, f.catalog.products);
  const create = f.rows.find((row) => row.action === "create");
  const hiddenCollision = {
    ...outside,
    visible: false,
    barcode: create.barcode,
  };
  assert.equal((await f.call("product-save", hiddenCollision)).status, 200);
  assert.equal(
    (await f.preview()).status,
    400,
    "hidden products participate in canonical barcode collision checks",
  );
});

test("canonical 44 updates +44 creations preserve existing data and remain idempotent", async () => {
  const f = await fixture();
  const preview = await f.preview();
  assert.equal(preview.status, 200);
  assert.equal(preview.data.kind, "emballage");
  assert.deepEqual(preview.data.summary, {
    updated: 44,
    created: 44,
    deleted: 0,
    already_present: 0,
  });
  assert.equal(preview.data.conflicts.length, 0);
  const base = f.catalog.products.find((p) => p.id === f.rows[0].base_id);
  const liveEdit = {
    ...base,
    unit_price_cents: 22222,
    price_on_request: false,
    weight_grams: 456.5,
    dimensions: "Nouvelles dimensions",
    pack_size: 30,
  };
  assert.equal((await f.call("product-save", liveEdit)).status, 200);
  const requestBaseId = f.rows.find((row) => row.base_id !== base.id).base_id;
  const requestBase = f.catalog.products.find(
    (product) => product.id === requestBaseId,
  );
  assert.equal(
    (
      await f.call("product-save", {
        ...requestBase,
        unit_price_cents: 0,
        price_on_request: true,
        discount_price_cents: null,
      })
    ).status,
    200,
  );
  const before = (await f.call("catalog")).data;
  const applied = await f.call("transfer-apply", {
    plan_id: preview.data.plan_id,
  });
  assert.equal(applied.status, 200);
  assert.equal(applied.data.updated, 44);
  assert.equal(applied.data.created, 44);
  const after = (await f.call("catalog")).data;
  assert.equal(after.products.length, before.products.length + 44);
  assert.deepEqual(after.families, before.families);
  assert.deepEqual(after.settings, before.settings);
  const old = new Map(before.products.map((p) => [p.id, p]));
  const baseIds = new Set(f.rows.map((r) => r.base_id));
  for (const p of after.products) {
    const previous = old.get(p.id);
    if (!previous) continue;
    if (baseIds.has(p.id))
      assert.deepEqual(withoutIdentity(p), withoutIdentity(previous));
    else assert.deepEqual(p, previous);
  }
  for (const row of canonical.rows) {
    const p = after.products.find((p) => p.barcode === row.barcode);
    assert.ok(p);
    assert.equal(p.code, row.code);
    assert.equal(p.name, row.name);
    assert.equal(p.name_fr, row.name);
    const photo = imageManifest.rows.find((image) => image.code === row.code);
    assert.deepEqual(p.images, photo.images);
    assert.ok(
      p.images.every(
        (image) =>
          image.url.startsWith("/assets/") &&
          (!image.original_url || image.original_url.startsWith("/assets/")),
      ),
    );
  }
  for (const spec of preview.data.emballage.create_specs) {
    const p = after.products.find((p) => p.id === spec.id),
      currentBase = before.products.find((p) => p.id === spec.base_id);
    for (const field of [
      "family_id",
      "dimensions",
      "capacity",
      "material",
      "weight_grams",
      "pack_size",
      "pack_label",
      "available",
      "availability_confirmed",
    ])
      assert.deepEqual(p[field], currentBase[field]);
    assert.ok(p.images.length > 0);
    assert.equal(
      p.unit_price_cents,
      currentBase.unit_price_cents,
      "the complementary variant copies the current base price at apply, including edits made after preview",
    );
    assert.equal(p.price_on_request, currentBase.price_on_request === true);
    assert.equal(p.discount_price_cents, null);
    assert.equal(p.discount_start, null);
    assert.equal(p.discount_end, null);
    assert.equal(p.show_offer, false);
    assert.equal(p.stock_cartons, null);
    assert.equal(p.is_new, false);
    assert.equal(p.pinned, false);
    assert.equal(p.manual_position, null);
    assert.equal(p.source_metadata, undefined);
  }
  const repeated = await f.call("transfer-apply", {
    plan_id: preview.data.plan_id,
  });
  assert.deepEqual(repeated.data, applied.data);
  const second = await f.preview();
  assert.equal(second.status, 200);
  assert.deepEqual(second.data.summary, {
    updated: 0,
    created: 0,
    deleted: 0,
    already_present: 88,
  });
  assert.equal(second.data.changes.length, 0);
  const updated = after.products.find((product) => product.id === base.id);
  const created = after.products.find(
    (product) => product.id === preview.data.emballage.create_specs[0].id,
  );
  for (const product of [updated, created]) {
    assert.equal(
      (
        await f.call("product-save", {
          ...product,
          images: [
            {
              url: "/assets/owner-after-migration-" + product.id + ".webp",
              scale: 1.7,
              x: 9,
              y: -11,
            },
          ],
        })
      ).status,
      200,
    );
  }
  const ownerEdited = (await f.call("catalog")).data;
  const afterOwnerPreview = await f.preview();
  assert.equal(afterOwnerPreview.status, 200);
  assert.equal(afterOwnerPreview.data.changes.length, 0);
  const ownerAgain = ownerEdited.products.find(
    (product) => product.id === base.id,
  );
  assert.equal(
    (
      await f.call("product-save", {
        ...ownerAgain,
        images: [
          {
            url: "/assets/owner-edited-after-repeat-preview.webp",
            scale: 2,
            x: 2,
            y: 3,
          },
        ],
      })
    ).status,
    200,
  );
  const beforeRepeatApply = (await f.call("catalog")).data;
  const noOp = await f.call("transfer-apply", {
    plan_id: afterOwnerPreview.data.plan_id,
  });
  assert.equal(noOp.status, 200);
  assert.equal(noOp.data.updated, 0);
  assert.equal(noOp.data.created, 0);
  assert.deepEqual(
    (await f.call("catalog")).data,
    beforeRepeatApply,
    "once migrated, reimports never replace later owner photos or framing",
  );
});

test("identity changes and new barcode collisions after preview abort the complete batch", async () => {
  const f = await fixture();
  let preview = await f.preview();
  const original = f.catalog.products.find((p) => p.id === f.rows[0].base_id);
  const changed = {
    ...original,
    name: original.name + " EDITE",
    name_fr: original.name + " EDITE",
  };
  assert.equal((await f.call("product-save", changed)).status, 200);
  let before = (await f.call("catalog")).data;
  assert.equal(
    (await f.call("transfer-apply", { plan_id: preview.data.plan_id })).status,
    400,
  );
  assert.deepEqual((await f.call("catalog")).data.products, before.products);
  assert.equal((await f.call("product-save", original)).status, 200);
  preview = await f.preview();
  const newRow = f.rows.find((r) => r.action === "create");
  const outsider = f.catalog.products.find((p) => !/EMBALLAGE/.test(p.name));
  assert.equal(
    (await f.call("product-save", { ...outsider, barcode: newRow.barcode }))
      .status,
    200,
  );
  before = (await f.call("catalog")).data;
  assert.equal(
    (await f.call("transfer-apply", { plan_id: preview.data.plan_id })).status,
    400,
  );
  assert.deepEqual((await f.call("catalog")).data.products, before.products);
});

test("the first photo migration rejects unapproved source photos and concurrent image or framing edits atomically", async () => {
  const f = await fixture();
  const original = f.catalog.products.find(
    (product) => product.id === f.rows[0].base_id,
  );
  const unknown = {
    ...original,
    images: [
      { url: "/assets/unapproved-owner-photo.webp", scale: 1, x: 0, y: 0 },
    ],
  };
  assert.equal((await f.call("product-save", unknown)).status, 200);
  let before = (await f.call("catalog")).data;
  const rejected = await f.preview();
  assert.equal(rejected.status, 400);
  assert.match(rejected.data.error, /photo.*chang|photo.*modèle/i);
  assert.deepEqual((await f.call("catalog")).data, before);
  assert.equal(await imageMarker(f.stores), "");
  assert.equal((await f.call("product-save", original)).status, 200);
  for (const images of [
    unknown.images,
    original.images.map((image, index) =>
      index ? image : { ...image, scale: 2.1, x: 7, y: -9 },
    ),
  ]) {
    const plan = await f.preview();
    assert.equal(plan.status, 200);
    assert.equal(
      (await f.call("product-save", { ...original, images })).status,
      200,
    );
    before = (await f.call("catalog")).data;
    const applied = await f.call("transfer-apply", {
      plan_id: plan.data.plan_id,
    });
    assert.equal(applied.status, 400);
    assert.match(applied.data.error, /photo/i);
    assert.deepEqual(
      (await f.call("catalog")).data,
      before,
      "a first-migration image conflict must not partially standardize or create products",
    );
    assert.equal(await imageMarker(f.stores), "");
    assert.equal((await f.call("product-save", original)).status, 200);
  }
});

test("known owner framing follows the authentic lid while the other lid gets an illustration; rollback restores photos and marker", async () => {
  const f = await fixture();
  const base = f.catalog.products.find(
    (product) => product.code === "BER500ML",
  );
  const transparent = canonical.rows.find((row) => row.code === "BER500MLT");
  const colour = canonical.rows.find((row) => row.code === "BER500MLC");
  assert.equal(
    base.barcode,
    transparent.barcode,
    "the existing ID belongs to Transparent by its actual EAN",
  );
  const real = imageManifest.rows.find((row) => row.code === colour.code);
  assert.equal(
    real.kind,
    "authentic",
    "the audited owner photo shows the colour lid despite the old generic product identity",
  );
  const framed = {
    ...base,
    images: base.images.map((image) => ({
      ...image,
      scale: 1.9,
      x: 13,
      y: -14,
    })),
  };
  assert.equal((await f.call("product-save", framed)).status, 200);
  const before = (await f.call("catalog")).data,
    markerBefore = await imageMarker(f.stores);
  const plan = await f.preview();
  assert.equal(plan.status, 200);
  const applied = await f.call("transfer-apply", {
    plan_id: plan.data.plan_id,
  });
  assert.equal(applied.status, 200);
  const after = (await f.call("catalog")).data;
  const savedTransparent = after.products.find(
    (product) => product.code === transparent.code,
  );
  const savedColour = after.products.find(
    (product) => product.code === colour.code,
  );
  assert.equal(
    savedTransparent.id,
    base.id,
    "a photo cannot move an existing EAN to the wrong lid",
  );
  assert.notEqual(savedColour.id, base.id);
  assert.deepEqual(
    savedColour.images,
    staticOwnerImages(framed.images),
    "owner original/processed sources and exact framing move together to the authentic colour variant",
  );
  assert.deepEqual(
    savedTransparent.images,
    imageManifest.rows.find((row) => row.code === transparent.code).images,
  );
  assert.ok(savedTransparent.images[0].url.includes("-illustration-v1.webp"));
  const markerAfter = await imageMarker(f.stores);
  assert.match(markerAfter, /^[a-f0-9]{64}$/);
  const backup = await f.call("transfer-backup?id=" + applied.data.backup_id);
  assert.equal(backup.status, 200);
  assert.equal(backup.data.image_state.marker_before, markerBefore);
  assert.equal(backup.data.image_state.marker_after, markerAfter);
  assert.equal(backup.data.created_products.length, 44);
  assert.ok(
    backup.data.changes.every((change) =>
      change.fields.every((field) => identityFields.includes(field.field)),
    ),
  );
  const ownerEdit = {
    ...savedTransparent,
    images: [
      { url: "/assets/owner-new-post-migration.webp", scale: 1.5, x: 2, y: -3 },
    ],
  };
  assert.equal((await f.call("product-save", ownerEdit)).status, 200);
  const beforeBlockedRestore = (await f.call("catalog")).data;
  assert.equal(
    (await f.call("transfer-restore", { backup_id: applied.data.backup_id }))
      .status,
    400,
    "rollback cannot replace a later owner photo edit",
  );
  assert.deepEqual((await f.call("catalog")).data, beforeBlockedRestore);
  assert.equal(await imageMarker(f.stores), markerAfter);
  assert.equal((await f.call("product-save", savedTransparent)).status, 200);
  const restored = await f.call("transfer-restore", {
    backup_id: applied.data.backup_id,
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.restored, 44);
  assert.equal(restored.data.removed, 44);
  assert.deepEqual((await f.call("catalog")).data, before);
  assert.equal(await imageMarker(f.stores), markerBefore);
  assert.equal(
    (await f.call("transfer-restore", { backup_id: applied.data.backup_id }))
      .data.restored,
    0,
  );
  const again = await f.preview();
  assert.equal(again.status, 200);
  assert.equal(again.data.emballage.image_state.marker_before, "");
  assert.deepEqual(again.data.summary, {
    updated: 44,
    created: 44,
    deleted: 0,
    already_present: 0,
  });
});

test("stale export is reported and rollback preserves unrelated later edits atomically", async () => {
  const f = await fixture();
  const exported = (await f.call("transfer-export", {})).data;
  const first = f.catalog.products.find((p) => p.id === f.rows[0].base_id);
  assert.equal(
    (
      await f.call("product-save", {
        ...first,
        name: first.name + " EDITE",
        name_fr: first.name + " EDITE",
      })
    ).status,
    200,
  );
  const stale = await f.call("transfer-emballage-preview", {
    export_id: exported.export_id,
    source_sha256: canonical.source_sha256,
    rows: f.rows,
  });
  assert.equal(stale.status, 200);
  assert.ok(stale.data.conflicts.length > 0);
  assert.equal(
    (await f.call("transfer-apply", { plan_id: stale.data.plan_id })).status,
    400,
  );
  assert.equal((await f.call("product-save", first)).status, 200);
  const preview = await f.preview(),
    applied = await f.call("transfer-apply", { plan_id: preview.data.plan_id });
  assert.equal(applied.status, 200);
  let live = (await f.call("catalog")).data;
  const updated = live.products.find((p) => p.id === first.id);
  const ownerEdit = {
    ...updated,
    unit_price_cents: 33333,
    price_on_request: false,
  };
  assert.equal((await f.call("product-save", ownerEdit)).status, 200);
  const created = live.products.find(
    (p) => p.id === preview.data.emballage.create_specs[0].id,
  );
  assert.equal(
    (
      await f.call("product-save", {
        ...created,
        description: "Propriétaire : conserver cette modification",
      })
    ).status,
    200,
  );
  const beforeFailedUndo = (await f.call("catalog")).data;
  assert.equal(
    (await f.call("transfer-restore", { backup_id: applied.data.backup_id }))
      .status,
    400,
  );
  assert.deepEqual(
    (await f.call("catalog")).data.products,
    beforeFailedUndo.products,
  );
  assert.equal((await f.call("product-save", created)).status, 200);
  const restored = await f.call("transfer-restore", {
    backup_id: applied.data.backup_id,
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.restored, 44);
  assert.equal(restored.data.removed, 44);
  live = (await f.call("catalog")).data;
  assert.equal(live.products.length, f.catalog.products.length);
  const kept = live.products.find((p) => p.id === first.id);
  assert.equal(kept.code, first.code);
  assert.equal(kept.name, first.name);
  assert.equal(kept.barcode, first.barcode);
  assert.equal(kept.unit_price_cents, 33333);
  assert.deepEqual(
    kept.images,
    first.images,
    "rollback restores the exact previous owner photo objects",
  );
  assert.equal(
    await imageMarker(f.stores),
    "",
    "rollback resets the one-time photo migration marker",
  );
  assert.equal(
    (await f.call("transfer-restore", { backup_id: applied.data.backup_id }))
      .data.restored,
    0,
  );
});

test("rollback rejects a created variant referenced by an order even after its product record is restored unchanged", async () => {
  const f = await fixture(),
    preview = await f.preview();
  const applied = await f.call("transfer-apply", {
    plan_id: preview.data.plan_id,
  });
  assert.equal(applied.status, 200);
  const catalog = (await f.call("catalog")).data;
  const created = catalog.products.find(
    (p) => p.id === preview.data.emballage.create_specs[0].id,
  );
  const priced = {
    ...created,
    unit_price_cents: 1000,
    price_on_request: false,
  };
  assert.equal((await f.call("product-save", priced)).status, 200);
  const order = await f.call("order-create", {
    key: randomUUID(),
    cart: [{ product_id: created.id, cartons: 1 }],
    expected: [
      {
        product_id: created.id,
        unit_price_cents: 1000,
        pack_size: created.pack_size,
      },
    ],
    currency: catalog.settings.currency,
    shipping: catalog.settings.shipping_cents,
    customer: {
      name: "Client de contrôle",
      phone: "0550000000",
      wilaya: "Oran",
      address: "Adresse de contrôle complète",
      notes: "",
    },
  });
  assert.equal(order.status, 200);
  assert.equal((await f.call("product-save", created)).status, 200);
  const before = (await f.call("catalog")).data;
  assert.deepEqual(
    before.products.find((p) => p.id === created.id),
    created,
  );
  const rollback = await f.call("transfer-restore", {
    backup_id: applied.data.backup_id,
  });
  assert.equal(rollback.status, 400);
  assert.match(rollback.data.error, /commande/);
  assert.deepEqual((await f.call("catalog")).data.products, before.products);
});

test("rollback rejects unchanged created variants referenced by homepage or collection slides", async () => {
  const f = await fixture(),
    preview = await f.preview();
  const applied = await f.call("transfer-apply", {
    plan_id: preview.data.plan_id,
  });
  assert.equal(applied.status, 200);
  const catalog = (await f.call("catalog")).data;
  const created = catalog.products.find(
    (p) => p.id === preview.data.emballage.create_specs[0].id,
  );
  const settings = structuredClone(catalog.settings);
  settings.heroes[0].product_id = created.id;
  assert.equal((await f.call("settings-save", settings)).status, 200);
  let rollback = await f.call("transfer-restore", {
    backup_id: applied.data.backup_id,
  });
  assert.equal(rollback.status, 400);
  assert.match(rollback.data.error, /réglages/);
  assert.equal((await f.call("settings-save", catalog.settings)).status, 200);
  const family = catalog.families.find((p) => p.id === created.family_id);
  const linkedFamily = {
    ...family,
    slides: [
      {
        ...settings.heroes[0],
        id: "qa-family-reference",
        product_id: created.id,
      },
    ],
    slider_height: 380,
  };
  assert.equal((await f.call("family-save", linkedFamily)).status, 200);
  rollback = await f.call("transfer-restore", {
    backup_id: applied.data.backup_id,
  });
  assert.equal(rollback.status, 400);
  assert.match(rollback.data.error, /collection/);
  assert.equal(
    (await f.call("catalog")).data.products.length,
    catalog.products.length,
  );
  assert.equal((await f.call("family-save", family)).status, 200);
  assert.equal(
    (await f.call("transfer-restore", { backup_id: applied.data.backup_id }))
      .status,
    200,
  );
});
