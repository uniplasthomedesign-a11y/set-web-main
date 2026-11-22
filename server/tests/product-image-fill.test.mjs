import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module from "node:module";
import { DatabaseSync } from "node:sqlite";
import { createNetlifyHandler } from "../netlify-store.mjs";
import { memoryStores } from "./blob-fixture.mjs";
import imageFill from "../product-image-fill.cjs";

test("Netlify image fill is durable after a cold CAS retry and preserves owner records and uploaded bytes", async () => {
  const prefix = "/assets/products/photos-2026-11-08/";
  let manifest = {
    version: imageFill.productImageFillVersion,
    asset_prefix: prefix,
    products: [],
  };
  // Only this isolated test worker replaces the manifest input; no source asset
  // or real catalogue is read, edited or uploaded by the fixture.
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return request.endsWith("data/product-images-2026-11-08.json")
      ? manifest
      : Reflect.apply(originalLoad, this, [request, ...rest]);
  };
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "uniplast-image-fill-test-"),
  );
  const site = "https://image-fill-test.example",
    key = "TEST-ONLY-image-fill-installation-key",
    stores = memoryStores();
  let cookie = "";
  const call = async (name, data, binary = false) => {
    const response = await createNetlifyHandler({
      getStores: () => stores,
      origins: [site],
      setupKey: key,
    })(
      new Request(site + (name.startsWith("/") ? name : "/api/local/" + name), {
        method: data === undefined ? "GET" : "POST",
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(data === undefined
            ? {}
            : { "content-type": binary ? "image/png" : "application/json" }),
        },
        body:
          data === undefined ? undefined : binary ? data : JSON.stringify(data),
      }),
      { ip: "192.0.2.84" },
    );
    if (response.headers.has("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    return {
      status: response.status,
      data: response.headers.get("content-type")?.startsWith("application/json")
        ? await response.json()
        : Buffer.from(await response.arrayBuffer()),
    };
  };
  const dbPath = path.join(directory, "store.sqlite");
  const openState = () => {
    fs.writeFileSync(
      dbPath,
      Buffer.from(stores.state.records.get("store.sqlite").bytes),
    );
    return new DatabaseSync(dbPath);
  };
  const commitState = (db) => {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
    const bytes = fs.readFileSync(dbPath);
    stores.state.records.get("store.sqlite").bytes = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
  };
  try {
    assert.equal(
      (
        await call("setup", {
          setup_key: key,
          password: "TEST-ONLY-image-fill-password!",
        })
      ).status,
      200,
    );
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
    const uploaded = await call("upload?public=1", png, true);
    assert.equal(uploaded.status, 200);
    const initial = (await call("catalog")).data;
    const blank = initial.products.find((p) => p.images.length === 0);
    const legacy = initial.products.find((p) => p.images.length > 0);
    const owner = initial.products.find(
      (p) => p.id !== blank.id && p.id !== legacy.id,
    );
    const ownerImages = [{ url: uploaded.data, scale: 1.6, x: 17, y: -14 }];
    let db = openState();
    db.prepare("UPDATE documents SET body=? WHERE kind='product' AND id=?").run(
      JSON.stringify({
        ...owner,
        images: ownerImages,
        unit_price_cents: 98765,
        weight_grams: 808,
        manual_position: 9,
      }),
      owner.id,
    );
    db.prepare("DELETE FROM meta WHERE key=?").run(
      imageFill.productImageFillKey,
    );
    db.prepare(
      "DELETE FROM documents WHERE kind='product-image-fill-backup'",
    ).run();
    const before = db
      .prepare("SELECT kind,id,body FROM documents ORDER BY kind,id")
      .all();
    const adminHash = db
      .prepare("SELECT value FROM meta WHERE key='admin'")
      .get().value;
    commitState(db);
    manifest = {
      ...manifest,
      products: [blank, legacy, owner].map((p, i) => ({
        product_id: p.id,
        code: p.code,
        legacy_images: p.images,
        images: [{ url: prefix + "test-" + i + ".webp", scale: 1, x: 0, y: 0 }],
      })),
    };
    stores.state.rejectWrites = 1;
    assert.equal((await call("catalog")).status, 200);
    assert(stores.state.conflicts >= 1);
    const writes = stores.state.writes;
    assert.equal((await call("catalog")).status, 200);
    assert.equal(
      stores.state.writes,
      writes,
      "a second cold call must not reapply migration",
    );
    db = openState();
    for (const old of before) {
      const actual = db
        .prepare("SELECT body FROM documents WHERE kind=? AND id=?")
        .get(old.kind, old.id).body;
      if (old.kind === "product" && [blank.id, legacy.id].includes(old.id)) {
        const mapping = manifest.products.find((p) => p.product_id === old.id);
        assert.deepEqual(JSON.parse(actual), {
          ...JSON.parse(old.body),
          images: mapping.images,
        });
      } else
        assert.equal(
          actual,
          old.body,
          "non-image data, owner photos and settings remain byte-identical",
        );
    }
    assert.equal(
      db.prepare("SELECT value FROM meta WHERE key='admin'").get().value,
      adminHash,
    );
    const backup = JSON.parse(
      db
        .prepare(
          "SELECT body FROM documents WHERE kind='product-image-fill-backup'",
        )
        .get().body,
    );
    assert.equal(backup.changes.length, 2);
    assert.equal(backup.summary.replaced_legacy, 1);
    assert.equal(
      db
        .prepare("SELECT count(*) AS n FROM documents WHERE kind='product'")
        .get().n,
      initial.products.length,
    );
    db.close();
    assert.equal(
      (await call("product-images", { id: blank.id, images: [] })).status,
      200,
    );
    assert.deepEqual(
      (await call("catalog")).data.products.find((p) => p.id === blank.id)
        .images,
      [],
    );
    assert.deepEqual((await call(uploaded.data)).data, png);
    assert.equal(
      stores.files.records.size,
      1,
      "static migration does not upload any files to Blobs",
    );
  } finally {
    Module._load = originalLoad;
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert(path.basename(directory).startsWith("uniplast-image-fill-test-"));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
