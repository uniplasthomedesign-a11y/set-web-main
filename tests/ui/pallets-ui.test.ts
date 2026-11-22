import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { CartDialogs } from "../../src/Dialogs";
import { InvoicePaper } from "../../src/Commerce";
import { StoreContext } from "../../src/store";
import { defaultSettings } from "../../src/catalog";
import { money } from "../../src/domain";
import { setInvoiceVariant } from "../../src/invoiceVariant";
import { palletCartonsFor } from "../../src/palletData";
import type { Catalog, Order, Product } from "../../src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BCR10_ID = "0754cd8d-2c96-51f1-ab1b-ddda070874bb";
const UNIT_PRICE_CENTS = 6783;
const PACK_SIZE = 20;
const NOW = Date.parse("2026-11-22T10:00:00Z");

const catalog = {
  settings: defaultSettings,
  products: [],
  families: [],
  customers: [],
  orders: [],
  requests: [],
} as unknown as Catalog;

const product: Product = {
  id: BCR10_ID,
  name: "BOITE CRYSTAL RC10 MAXI REF 02",
  name_fr: "BOITE CRYSTAL RC10 MAXI REF 02",
  code: "BCR10",
  barcode: null,
  family_id: "crystal",
  description: "",
  dimensions: "",
  capacity: "",
  material: "",
  weight_grams: null,
  pack_size: PACK_SIZE,
  pack_label: "carton",
  unit_price_cents: UNIT_PRICE_CENTS,
  available: true,
  availability_confirmed: true,
  stock_cartons: null,
  is_new: false,
  upcoming: false,
  preorder_enabled: false,
  discount_price_cents: null,
  discount_start: null,
  discount_end: null,
  offer_title: "",
  show_offer: false,
  pinned: false,
  sort_order: 0,
  images: [],
  created_at: "2026-01-01T00:00:00Z",
  price_on_request: false,
};

function orderWithPallet(): Order {
  return {
    id: "order-test",
    reference: "CMD-TEST",
    user_id: "test",
    created_at: "2026-11-22T10:00:00Z",
    status: "new",
    customer: {
      name: "Client test",
      phone: "0555000000",
      wilaya: "Alger",
      address: "",
      notes: "",
    },
    items: [
      {
        product_id: BCR10_ID,
        name: product.name,
        code: product.code,
        barcode: null,
        pack_label: product.pack_label,
        unit_price_cents: UNIT_PRICE_CENTS,
        original_unit_price_cents: UNIT_PRICE_CENTS,
        pack_size: PACK_SIZE,
        cartons: 200,
        total_units: 200 * PACK_SIZE,
        carton_price_cents: UNIT_PRICE_CENTS * PACK_SIZE,
        discount_cents: 0,
        total_cents: UNIT_PRICE_CENTS * PACK_SIZE * 200,
      },
    ],
    subtotal_cents: UNIT_PRICE_CENTS * PACK_SIZE * 200,
    discount_cents: 0,
    shipping_cents: 0,
    total_cents: UNIT_PRICE_CENTS * PACK_SIZE * 200,
    currency: defaultSettings.currency,
    company_snapshot: {
      company_name: defaultSettings.company_name,
      logo_url: defaultSettings.logo_url,
      phone: defaultSettings.phone,
      email: defaultSettings.email,
      address: defaultSettings.address,
      tax_note: defaultSettings.tax_note,
      timezone: defaultSettings.timezone,
    },
    idempotency_key: "test",
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  window.scrollTo = () => {};
  setInvoiceVariant(null);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setInvoiceVariant(null);
});

async function render(node: ReturnType<typeof createElement>) {
  await act(async () => root.render(node));
}

async function click(element: Element) {
  await act(async () => {
    (element as HTMLElement).click();
  });
}

function buttonByText(text: string) {
  return Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text),
  );
}

function text() {
  return container.textContent ?? "";
}

it("pallet mapping uses the imported Product settings file", () => {
  expect(palletCartonsFor(BCR10_ID)).toBe(96);
  expect(palletCartonsFor("BCR10")).toBe(96);
});

it("product settings override the static pallet mapping", () => {
  expect(palletCartonsFor({ ...product, pallet_enabled: false })).toBeNull();
  expect(
    palletCartonsFor({ ...product, pallet_enabled: true, pallet_cartons: 60 }),
  ).toBe(60);
});

it("shows PALETTE and adds two full pallets of BCR10", async () => {
  const added: { id: string; cartons: number }[] = [];
  await render(
    createElement(
      StoreContext.Provider,
      {
        value: {
          catalog,
          now: NOW,
          cart: [],
          quantityProduct: product,
          closeQuantity: () => {},
          addCart: (p: Product, n: number) => added.push({ id: p.id, cartons: n }),
          added: null,
          dismissAdded: () => {},
        } as never,
      },
      createElement(CartDialogs),
    ),
  );

  expect(text()).toContain("Choisir la quantité");
  const paletteButton = container.querySelector<HTMLButtonElement>(
    ".pallet-button",
  );
  expect(paletteButton).not.toBeNull();
  expect(paletteButton?.disabled).toBe(false);
  await click(paletteButton!);

  expect(text()).toContain("Une palette = 96 cartons");
  expect(text()).toContain("Attention achat par palette");
  expect(text()).not.toContain("sans fractionnement");
  const notice = container.querySelector(".pallet-confirm .pallet-notice.notice.danger");
  expect(notice).not.toBeNull();
  expect(notice?.previousElementSibling?.classList.contains("field")).toBe(true);
  expect(notice?.nextElementSibling?.classList.contains("quantity-breakdown")).toBe(true);
  const plus = container.querySelector(
    '.pallet-confirm button[aria-label="Augmenter la quantité"]',
  );
  expect(plus).not.toBeNull();
  await click(plus!);

  const input = container.querySelector<HTMLInputElement>(
    '.pallet-confirm input[aria-label="Nombre de palettes"]',
  );
  expect(input?.value).toBe("2");
  const totals = Array.from(
    container.querySelectorAll(".pallet-confirm .quantity-breakdown dd"),
  ).map((node) => node.textContent);
  expect(totals[0]).toBe("192");
  expect(totals[1]).toBe("3840");
  expect(totals[2]).toBe(money(UNIT_PRICE_CENTS * PACK_SIZE * 192, defaultSettings.currency));

  await click(buttonByText("Oui, ajouter")!);
  expect(added).toEqual([{ id: BCR10_ID, cartons: 192 }]);
});

it("defaults to Version palettes and can switch back to standard", async () => {
  await render(
    createElement(
      StoreContext.Provider,
      {
        value: {
          catalog: { ...catalog, products: [product] },
        } as never,
      },
      createElement(InvoicePaper, { order: orderWithPallet() }),
    ),
  );

  const palettesButton = buttonByText("Version palettes") as HTMLButtonElement;
  const standardButton = buttonByText("Version standard") as HTMLButtonElement;
  expect(palettesButton.getAttribute("aria-pressed")).toBe("true");
  expect(standardButton.getAttribute("aria-pressed")).toBe("false");
  expect(container.querySelector(".invoice-paper")?.getAttribute("data-variant")).toBe(
    "palettes",
  );

  await click(standardButton);
  expect(standardButton.getAttribute("aria-pressed")).toBe("true");
  expect(palettesButton.getAttribute("aria-pressed")).toBe("false");
  expect(container.querySelector(".invoice-paper")?.getAttribute("data-variant")).toBe(
    "standard",
  );
});
