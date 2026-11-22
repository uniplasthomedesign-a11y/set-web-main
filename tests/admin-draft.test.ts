import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DraftWorkspace,
  draftConflicts,
  indexedDraftStorage,
  mediaToken,
  mapDraftStrings,
  type DraftStorage,
  type DraftState,
  type DraftMedia,
} from "../src/adminDraftCore.ts";
import type { Catalog } from "../src/types.ts";

function fixture(): Catalog {
  return {
    products: [
      {
        id: "p1",
        name: "Boîte",
        code: "B1",
        unit_price_cents: 100,
        images: [{ url: "/assets/a.webp", scale: 1, x: 0, y: 0 }],
        family_id: "f1",
        manual_position: 2,
      },
      {
        id: "p2",
        name: "Table",
        code: "T1",
        unit_price_cents: 200,
        images: [],
        family_id: "f1",
      },
    ],
    families: [
      { id: "f1", name: "Boîtes", sort_order: 0 },
      { id: "f2", name: "Cuisine", sort_order: 1 },
    ],
    settings: { id: true, company_name: "UNIPLAST", phone: "0555000000" },
    sales: {},
  } as unknown as Catalog;
}
function memory() {
  let saved: DraftState | null = null,
    fail = false;
  const files = new Map<string, DraftMedia>();
  const storage: DraftStorage = {
    read: async () => structuredClone(saved),
    write: async (value, expected = 0) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (fail) {
        fail = false;
        throw new Error("quota");
      }
      if ((saved?.revision || 0) !== expected) throw new Error("stale tab");
      saved = structuredClone(value);
    },
    media: async () => structuredClone([...files.values()]),
    putMedia: async (value) => {
      files.set(value.id, structuredClone(value));
    },
    removeMedia: async (id) => {
      files.delete(id);
    },
  };
  return {
    storage,
    saved: () => saved,
    failNext: () => {
      fail = true;
    },
  };
}
test("concurrent local saves both survive durable reload; only changed fields are queued", async () => {
  const db = memory(),
    workspace = new DraftWorkspace(db.storage),
    catalog = fixture();
  await workspace.load();
  await Promise.all([
    workspace.stage(catalog, "product", "p1", {
      ...catalog.products[0],
      name: "Boîte nouvelle",
    }),
    workspace.stage(catalog, "product", "p2", {
      ...catalog.products[1],
      unit_price_cents: 350,
    }),
  ]);
  assert.equal(workspace.state.entries.length, 2);
  const restored = new DraftWorkspace(db.storage);
  await restored.load();
  assert.equal(restored.overlay(catalog).products[0].name, "Boîte nouvelle");
  assert.equal(restored.overlay(catalog).products[1].unit_price_cents, 350);
  assert.deepEqual(Object.keys(restored.state.entries[0].patch), ["name"]);
});
test("concurrent edits of different fields on one product do not undo each other", async () => {
  const db = memory(),
    workspace = new DraftWorkspace(db.storage),
    catalog = fixture();
  await Promise.all([
    workspace.stage(catalog, "product", "p1", {
      ...catalog.products[0],
      name: "Nom",
    }),
    workspace.stage(catalog, "product", "p1", {
      ...catalog.products[0],
      unit_price_cents: 125,
    }),
  ]);
  assert.deepEqual(workspace.state.entries[0].patch, {
    name: "Nom",
    unit_price_cents: 125,
  });
});
test("failed durable write is rejected without changing the old draft; queue recovers", async () => {
  const db = memory(),
    workspace = new DraftWorkspace(db.storage),
    catalog = fixture();
  db.failNext();
  await assert.rejects(
    workspace.stage(catalog, "product", "p1", { name: "Not saved" }),
    /quota/,
  );
  assert.equal(workspace.state.entries.length, 0);
  assert.equal(db.saved(), null);
  await workspace.stage(catalog, "product", "p2", { name: "Saved" });
  assert.equal(workspace.state.entries[0].id, "p2");
});
test("two tabs cannot acknowledge overwriting another tab's durable changes", async () => {
  const db = memory(),
    first = new DraftWorkspace(db.storage),
    second = new DraftWorkspace(db.storage),
    catalog = fixture();
  await Promise.all([first.load(), second.load()]);
  await first.stage(catalog, "product", "p1", { name: "First tab" });
  await assert.rejects(
    second.stage(catalog, "product", "p2", { name: "Stale tab" }),
    /stale tab/,
  );
  assert.equal(db.saved()!.entries.length, 1);
  assert.equal(db.saved()!.entries[0].id, "p1");
  assert.equal(second.state.entries.length, 0);
});
test("a family transfer batch commits together or leaves every old local value intact", async () => {
  const db = memory(),
    workspace = new DraftWorkspace(db.storage),
    catalog = fixture();
  db.failNext();
  const saves = catalog.products.map((p) => ({
    kind: "product" as const,
    id: p.id,
    value: { ...p, family_id: "f2" },
    fields: ["family_id"],
  }));
  await assert.rejects(
    workspace.batch(catalog, saves, [{ kind: "family", id: "f1" }]),
    /quota/,
  );
  assert.equal(workspace.state.entries.length, 0);
  await workspace.batch(catalog, saves, [{ kind: "family", id: "f1" }]);
  assert.equal(workspace.state.entries.length, 3);
  assert.ok(
    workspace.overlay(catalog).products.every((p) => p.family_id === "f2"),
  );
  assert.equal(workspace.overlay(catalog).families.length, 1);
});
test("photo-only draft preserves concurrent website prices; touched conflicts stay explicit", async () => {
  const db = memory(),
    workspace = new DraftWorkspace(db.storage),
    catalog = fixture();
  await workspace.stage(catalog, "product", "p1", { images: [] }, ["images"]);
  const entry = workspace.state.entries[0],
    current = { ...catalog.products[0], unit_price_cents: 999 };
  assert.deepEqual(draftConflicts(entry, current), []);
  assert.equal(
    workspace.overlay({ ...catalog, products: [current, catalog.products[1]] })
      .products[0].unit_price_cents,
    999,
  );
  assert.deepEqual(
    draftConflicts(entry, {
      ...current,
      images: [{ url: "/assets/owner.webp" }],
    }),
    ["images"],
  );
});
test("conflict resolution keeps chosen local fields or website fields without dropping other drafts", async () => {
  const db = memory(),
    workspace = new DraftWorkspace(db.storage),
    catalog = fixture();
  await workspace.stage(catalog, "product", "p1", {
    name: "Local",
    unit_price_cents: 150,
  });
  await workspace.stage(catalog, "product", "p2", { name: "Other local" });
  await workspace.resolve(
    "product:p1",
    { ...catalog.products[0], name: "Website" },
    ["name"],
    false,
  );
  assert.deepEqual(workspace.state.entries[0].patch, { unit_price_cents: 150 });
  assert.equal(workspace.state.entries[1].patch.name, "Other local");
  await workspace.resolve(
    "product:p1",
    { ...catalog.products[0], unit_price_cents: 170 },
    ["unit_price_cents"],
    true,
  );
  assert.equal(workspace.state.entries[0].base!.unit_price_cents, 170);
  assert.equal(workspace.state.entries[0].patch.unit_price_cents, 150);
});
test("deletion guards the complete original product, including images and ordering", async () => {
  const db = memory(),
    workspace = new DraftWorkspace(db.storage),
    catalog = fixture();
  await workspace.remove(catalog, "product", "p1");
  const entry = workspace.state.entries[0];
  assert.deepEqual(entry.base, catalog.products[0]);
  assert.ok(
    draftConflicts(entry, { ...catalog.products[0], manual_position: 3 })
      .length,
  );
  assert.deepEqual(draftConflicts(entry, null), []);
});
test("acknowledging an old version never clears newer local changes", async () => {
  const db = memory(),
    workspace = new DraftWorkspace(db.storage),
    catalog = fixture();
  await workspace.stage(catalog, "product", "p1", { name: "One" });
  const old = structuredClone(workspace.state.entries);
  await workspace.stage(catalog, "product", "p1", { name: "Two" });
  await workspace.acknowledgeAll(old);
  assert.equal(workspace.state.entries[0].patch.name, "Two");
});
test("only catalogue fields persist; browser storage failure never falls back to a server write", async () => {
  const db = memory(),
    workspace = new DraftWorkspace(db.storage),
    catalog = fixture();
  await workspace.stage(catalog, "settings", "settings", {
    company_name: "Local",
    password: "never-store",
    pin: "123456",
    customers: ["private"],
  });
  assert.deepEqual(workspace.state.entries[0].patch, { company_name: "Local" });
  assert.ok(!JSON.stringify(db.saved()).includes("never-store"));
  await assert.rejects(indexedDraftStorage().read(), /sauvegarde locale/);
});
test("Blob storage and stable media tokens survive a workspace reload", async () => {
  const db = memory(),
    workspace = new DraftWorkspace(db.storage),
    catalog = fixture();
  await db.storage.putMedia({
    id: "media",
    blob: new Blob(["image-bytes"], { type: "image/webp" }),
  });
  await workspace.stage(
    catalog,
    "product",
    "p1",
    { images: [{ url: mediaToken("media"), scale: 1, x: 0, y: 0 }] },
    ["images"],
  );
  const reopened = new DraftWorkspace(db.storage);
  await reopened.load();
  assert.equal(await (await db.storage.media())[0].blob.text(), "image-bytes");
  const resolved = mapDraftStrings(reopened.overlay(catalog), (value) =>
    value === mediaToken("media") ? "/api/local/file?id=published" : value,
  );
  assert.equal(
    resolved.products[0].images[0].url,
    "/api/local/file?id=published",
  );
});
