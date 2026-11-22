import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { StoreContext } from "../../src/store";
import { ProductCard } from "../../src/Storefront";
import { defaultSettings } from "../../src/catalog";
import { money } from "../../src/domain";
import type { Catalog, Product } from "../../src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const NOW = Date.parse("2026-11-22T10:00:00Z");
const catalog = { settings: defaultSettings, products: [] } as unknown as Catalog;
const product: Product = {
  id: "promo-ui",
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
  discount_start: "2026-11-22T09:00:00Z",
  discount_end: "2026-11-22T12:00:00Z",
  offer_title: "Offre du jour",
  show_offer: true,
  price_on_request: false,
  pinned: false,
  sort_order: 0,
  images: [],
  created_at: "2026-01-01T00:00:00Z",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.scrollTo = () => {};
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it("shows the offer title, old price and countdown on a discounted card", async () => {
  await act(async () =>
    root.render(
      createElement(
        StoreContext.Provider,
        {
          value: {
            catalog,
            now: NOW,
            openQuantity: () => {},
            openProduct: () => {},
            isFavorite: () => false,
            toggleFavorite: () => {},
          } as never,
        },
        createElement(ProductCard, { product }),
      ),
    ),
  );

  expect(container.querySelector(".card-name-row .product-title")?.textContent).toBe(
    "Produit en promotion",
  );
  expect(container.querySelector(".product-code")).toBeNull();
  expect(container.querySelector(".offer-strip .offer-title")?.textContent).toBe(
    "Offre du jour",
  );
  expect(container.querySelector(".price-discount")?.textContent).toBe("−10 %");
  expect(
    container.querySelector(".card-actions .card-countdown")?.textContent,
  ).toContain("2 h 0 min");
  expect(container.querySelector(".card-actions > a")?.textContent).toContain(
    "Détails",
  );
  expect(container.querySelector(".card-actions > .add-btn")).not.toBeNull();
  expect(container.querySelector(".badges .badge.sale")).toBeNull();
  expect(container.querySelector(".product-pricing del")?.textContent).toBe(
    money(10000, defaultSettings.currency),
  );
  expect(container.querySelector(".product-pricing strong")?.textContent).toBe(
    money(9000, defaultSettings.currency),
  );
});
