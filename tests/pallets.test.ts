import { test } from "node:test";
import assert from "node:assert/strict";
import { maxPallets, palletRows, validPalletCartons } from "../src/pallets.ts";

test("validPalletCartons: entier de 1 à 10000 seulement", () => {
  assert.equal(validPalletCartons(220), 220);
  assert.equal(validPalletCartons(1), 1);
  assert.equal(validPalletCartons(10000), 10000);
  for (const bad of [0, -5, 10001, 1.5, NaN, "220", null, undefined, true])
    assert.equal(validPalletCartons(bad), null, String(bad));
});

test("maxPallets: stock, panier et limite serveur (pas de plafond fixe)", () => {
  // stock illimité (null) : seule la limite serveur de 10000 cartons borne (45 × 220)
  assert.equal(maxPallets(220, null, 0), 45);
  // 6 palettes de 180 cartons (cas courant) sont acceptées avec assez de stock
  assert.equal(maxPallets(180, 2000, 0), 11);
  assert.ok(maxPallets(180, 2000, 0) >= 6);
  // stock insuffisant pour une palette : bouton désactivé
  assert.equal(maxPallets(220, 219, 0), 0);
  assert.equal(maxPallets(220, 220, 0), 1);
  // 500 cartons en stock, palette de 220 : 2 palettes
  assert.equal(maxPallets(220, 500, 0), 2);
  // cartons déjà au panier réduisent ce qui reste
  assert.equal(maxPallets(220, 500, 100), 1);
  assert.equal(maxPallets(220, 500, 300), 0);
  // limite serveur de 10000 cartons par ligne (palette de 2000 → 5 max)
  assert.equal(maxPallets(2000, null, 0), 5);
  assert.equal(maxPallets(2000, null, 1500), 4);
  // jamais négatif
  assert.equal(maxPallets(220, 0, 0), 0);
  assert.equal(maxPallets(220, 100, 400), 0);
});

test("palletRows: palettes entières + cartons en plus, null s'il n'y a aucune palette", () => {
  const per = (id: string) => ({ a: 180, b: 220, c: 160, d: 140 })[id] ?? null;
  // commande de palettes pures
  const pure = palletRows(
    [
      { product_id: "a", cartons: 1080 },
      { product_id: "b", cartons: 220 },
    ],
    per,
  );
  assert.equal(pure?.length, 2);
  assert.deepEqual(
    pure?.map((r) => [r.palettes, r.per, r.extra]),
    [
      [6, 180, 0],
      [1, 220, 0],
    ],
  );
  // cas réel d'essai : cartons déjà au panier + palettes (808 = 5×160 + 8 ; 562 = 4×140 + 2)
  const mixed = palletRows(
    [
      { product_id: "c", cartons: 808 },
      { product_id: "d", cartons: 562 },
    ],
    per,
  );
  assert.deepEqual(
    mixed?.map((r) => [r.palettes, r.extra]),
    [
      [5, 8],
      [4, 2],
    ],
  );
  // un produit sans palette définie reste lisible
  const withOther = palletRows(
    [
      { product_id: "a", cartons: 180 },
      { product_id: "zzz", cartons: 5 },
    ],
    per,
  );
  assert.deepEqual(
    withOther?.map((r) => [r.palettes, r.per, r.extra]),
    [
      [1, 180, 0],
      [0, null, 5],
    ],
  );
  // moins d'une palette, ou rien : pas de version palettes
  assert.equal(palletRows([{ product_id: "a", cartons: 179 }], per), null);
  assert.equal(palletRows([{ product_id: "zzz", cartons: 50 }], per), null);
  assert.equal(palletRows([], per), null);
});
