import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeDiscount,
  discountPercent,
  isPromotion,
  orderLine,
  priceOf,
  timeRemaining,
  validateProduct,
} from "../src/domain.ts";
import type { Product } from "../src/types.ts";

const START = Date.parse("2026-11-22T09:00:00Z");
const NOW = Date.parse("2026-11-22T10:00:00Z");
const END = Date.parse("2026-11-22T12:00:00Z");

function promo(overrides: Partial<Product> = {}): Product {
  return {
    id: "promo-test",
    name: "Produit en promotion",
    name_fr: "Produit en promotion",
    code: "PROMO",
    barcode: null,
    family_id: "family",
    description: "",
    dimensions: "",
    capacity: "",
    material: "",
    weight_grams: null,
    pack_size: 10,
    pack_label: "carton",
    unit_price_cents: 10000,
    available: true,
    availability_confirmed: true,
    stock_cartons: null,
    is_new: false,
    upcoming: false,
    preorder_enabled: false,
    discount_price_cents: 9000,
    discount_start: new Date(START).toISOString(),
    discount_end: new Date(END).toISOString(),
    offer_title: "Offre du jour",
    show_offer: true,
    price_on_request: false,
    pinned: false,
    sort_order: 0,
    images: [],
    created_at: "2026-01-01T00:00:00Z",
    price_hidden: false,
    public_discount_percent: undefined,
    ...overrides,
  };
}

test("activeDiscount: fenêtre [début, fin[ et remis", () => {
  const p = promo();
  assert.equal(activeDiscount(p, START - 1), false);
  assert.equal(activeDiscount(p, START), true);
  assert.equal(activeDiscount(p, END - 1), true);
  assert.equal(activeDiscount(p, END), false);
  assert.equal(priceOf(p, NOW), 9000);
  assert.equal(discountPercent(p, NOW), 10);
});

test("isPromotion: show_offer doit être actif comme la remise", () => {
  assert.equal(isPromotion(promo(), NOW), true);
  assert.equal(isPromotion(promo({ show_offer: false }), NOW), false);
  assert.equal(isPromotion(promo({ discount_price_cents: null }), NOW), false);
});

test("orderLine: l’économie est dérivée du prix initial enregistré", () => {
  const line = orderLine(promo(), 2, NOW);
  assert.equal(line.unit_price_cents, 9000);
  assert.equal(line.original_unit_price_cents, 10000);
  assert.equal(line.discount_cents, 20000);
  assert.equal(line.total_cents, 180000);
});

test("timeRemaining: textes FR et zéro négatif", () => {
  assert.equal(timeRemaining(promo().discount_end, NOW), "2 h 0 min");
  assert.equal(
    timeRemaining(new Date(START - 1).toISOString(), NOW),
    "Offre terminée",
  );
});

test("validateProduct: titre et case d’affichage de l’offre contrôlés", () => {
  assert.equal(validateProduct(promo()), null);
  assert.equal(
    validateProduct(promo({ show_offer: "oui" as never })),
    "Choisissez un état d’affichage valide pour l’offre.",
  );
  assert.equal(
    validateProduct(promo({ offer_title: "x".repeat(151) })),
    "Le titre de l’offre ne doit pas dépasser 150 caractères.",
  );
});
