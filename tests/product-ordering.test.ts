import { test } from "node:test";
import assert from "node:assert/strict";
import type { Family, Product } from "../src/types.ts";
import seed from "../src/data/catalog.json" with { type: "json" };
import canonical from "../data/emballage-canonical-2026-11-09.json" with { type: "json" };
import { catalogueFamilyOrder, productGroup } from "../src/productGroups.ts";
import {
  orderedCatalogueProducts,
  catalogueOrder,
  planProductPosition,
} from "../src/productOrdering.ts";
import { validateProduct } from "../src/domain.ts";

const families = [
  { ...seed.families[0], id: "boxes", kind: "standard", sort_order: 1 },
  { ...seed.families[0], id: "children", kind: "standard", sort_order: 5 },
] as Family[];
const p = (
  id: string,
  name: string,
  manual_position?: number | null,
  family_id = "boxes",
) =>
  ({
    ...seed.products[0],
    id,
    code: id,
    name,
    name_fr: name,
    family_id,
    manual_position,
  }) as Product;
const base = [
  p("r1", "BOITE EMBALLAGE RONDE 300ML REF 1"),
  p("r2", "BOITE EMBALLAGE RONDE 400ML REF 2"),
  p("r3", "BOITE EMBALLAGE RONDE 500ML REF 3"),
  p("s1", "BOITE EMBALLAGE RONDE S/4 300ML REF 1"),
  p("child", "BOITE SANDWICH REF 1", null, "children"),
];
const apply = (products: Product[], id: string, position: number | null) => {
  const patches = planProductPosition(products, families, id, position);
  return products.map((product) => {
    const patch = patches.find((x) => x.id === product.id);
    return patch
      ? { ...product, manual_position: patch.manual_position }
      : product;
  });
};
const ids = (products: Product[]) =>
  orderedCatalogueProducts(products, families).map((x) => x.id);

test("legacy products retain automatic family, reference and set ordering", () => {
  assert.deepEqual(
    orderedCatalogueProducts([...base].reverse(), families).map((x) => x.id),
    [...base].sort(catalogueFamilyOrder(families)).map((x) => x.id),
  );
});
test("a fixed set bypasses automatic reference/set rules inside its own family", () => {
  const before = JSON.stringify(base),
    next = apply(base, "s1", 1);
  assert.deepEqual(ids(next), ["s1", "r1", "r2", "r3", "child"]);
  assert.equal(next.find((x) => x.id === "s1")!.manual_position, 1);
  assert.equal(next.find((x) => x.id === "child")!.family_id, "children");
  assert.equal(JSON.stringify(base), before);
});
test("moving across another fixed product shifts only existing anchors", () => {
  let products = apply(base, "s1", 2);
  products = apply(products, "r3", 1);
  assert.deepEqual(ids(products), ["r3", "r1", "s1", "r2", "child"]);
  assert.equal(products.find((x) => x.id === "s1")!.manual_position, 3);
  assert.equal(products.find((x) => x.id === "r1")!.manual_position, undefined);
  assert.deepEqual(ids(apply(products, "r3", null)), [
    "r1",
    "r2",
    "s1",
    "r3",
    "child",
  ]);
});
test("an explicit return to automatic restores the reference and set rules", () => {
  const moved = apply(base, "s1", 1);
  assert.deepEqual(ids(apply(moved, "s1", null)), ids(base));
  const renamed = moved.map((x) =>
    x.id === "s1" ? { ...x, name: "BOITE EMBALLAGE RONDE S/4 REF 99" } : x,
  );
  assert.equal(ids(renamed)[0], "s1");
});
test("search subsets keep the order of the full collection rather than reinterpreting positions", () => {
  const products = apply(base, "s1", 2);
  const subset = products.filter((x) => x.id === "r2" || x.id === "s1");
  assert.deepEqual(
    subset.sort(catalogueOrder(products, families)).map((x) => x.id),
    ["s1", "r2"],
  );
});
test("position bounds, collisions and deleted neighbours are handled deterministically", () => {
  assert.equal(
    apply(base, "s1", 1000000).find((x) => x.id === "s1")!.manual_position,
    4,
  );
  for (const value of [0, -1, 1.5, NaN, Infinity, 1000001])
    assert.throws(
      () => planProductPosition(base, families, "s1", value),
      /position/,
    );
  assert.throws(
    () => planProductPosition(base, families, "missing", 1),
    /introuvable/,
  );
  const collision = base.map((x) =>
    ["r2", "s1"].includes(x.id) ? { ...x, manual_position: 1 } : x,
  );
  assert.deepEqual(ids(collision), ids([...collision].reverse()));
  const removed = apply(base, "s1", 3).filter((x) => x.id !== "r2");
  assert.equal(new Set(ids(removed)).size, removed.length);
});
test("manual position remains optional and validates without changing other product fields", () => {
  for (const manual_position of [undefined, null, 1, 1000000])
    assert.equal(validateProduct({ ...base[0], manual_position }), null);
  for (const manual_position of [0, -1, 0.5, NaN, Infinity, 1000001])
    assert.match(validateProduct({ ...base[0], manual_position })!, /position/);
});

test("44 legacy Emballage models expand into 88 C/T products in twelve complete automatic blocks", () => {
  const blocks = [
    ["CARRE", "MINI", false],
    ["CARRE", "MINI", true],
    ["CARRE", "MAXI", false],
    ["CARRE", "MAXI", true],
    ["CARRE", "PROMAXI", false],
    ["CARRE", "PROMAXI", true],
    ["RECTANGLE", "MINI", false],
    ["RECTANGLE", "MINI", true],
    ["RECTANGLE", "MAXI", false],
    ["RECTANGLE", "MAXI", true],
    ["RONDE", null, false],
    ["RONDE", null, true],
  ] as const;
  const selected = new Map<string, (typeof canonical.rows)[number]>();
  for (const row of canonical.rows) {
    const original = seed.products.find(
      (product) => product.id === row.legacy_base_id,
    )!;
    if (
      row.barcode === original.barcode ||
      (!canonical.rows.some(
        (r) =>
          r.legacy_base_id === row.legacy_base_id &&
          r.barcode === original.barcode,
      ) &&
        row.lid_variant === "TRANSPARENT")
    )
      selected.set(row.legacy_base_id, row);
  }
  assert.equal(selected.size, 44);
  const products = canonical.rows.map((row) => ({
    ...p(row.code, row.name),
    id:
      selected.get(row.legacy_base_id)!.code === row.code
        ? row.legacy_base_id
        : "new:" + row.code,
    barcode: row.barcode,
  }));
  const legacy = [...selected.values()].map((row) => ({
    ...p(
      row.legacy_base_id,
      row.name.replace(/ COUVERCLE (COULEUR|TRANSPARENT)$/, ""),
    ),
    code: row.legacy_base_code,
  }));
  const before = JSON.stringify({ products, legacy });
  const sorted = orderedCatalogueProducts([...products].reverse(), families);
  const sortedLegacy = orderedCatalogueProducts(
    [...legacy].reverse(),
    families,
  );
  assert.equal(sorted.length, 88);
  assert.equal(sortedLegacy.length, 44);
  const expected = blocks.flatMap(([shape, format, set]) =>
    canonical.rows
      .filter(
        (row) =>
          row.shape === shape &&
          row.format === format &&
          row.set_count > 1 === set,
      )
      .sort(
        (a, b) =>
          Number(a.model_reference) - Number(b.model_reference) ||
          a.lid_variant.localeCompare(b.lid_variant),
      )
      .map((row) => row.code),
  );
  assert.deepEqual(
    sorted.map((product) => product.code),
    expected,
  );
  const headings = sorted
    .filter(
      (product, index) =>
        !index ||
        productGroup(product).key !== productGroup(sorted[index - 1]).key,
    )
    .map((product) => productGroup(product));
  assert.equal(headings.length, 12);
  assert.equal(new Set(headings.map((heading) => heading.key)).size, 12);
  assert.deepEqual(
    sortedLegacy
      .filter(
        (product, index) =>
          !index ||
          productGroup(product).key !==
            productGroup(sortedLegacy[index - 1]).key,
      )
      .map((product) => productGroup(product).key),
    headings.map((heading) => heading.key),
  );
  for (let index = 0; index < sorted.length; index += 2) {
    const pair = sorted
      .slice(index, index + 2)
      .map(
        (product) => canonical.rows.find((row) => row.code === product.code)!,
      );
    assert.equal(
      pair[0].legacy_base_id,
      pair[1].legacy_base_id,
      "same REF C/T variants must remain adjacent",
    );
    assert.deepEqual(
      pair.map((row) => row.lid_variant),
      ["COULEUR", "TRANSPARENT"],
    );
    assert.equal(
      productGroup(sorted[index]).key,
      productGroup(sorted[index + 1]).key,
    );
  }
  assert.equal(
    JSON.stringify({ products, legacy }),
    before,
    "sorting must not rewrite names, PDF set counts or any saved data",
  );
});
