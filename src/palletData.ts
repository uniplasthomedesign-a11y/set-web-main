import raw from "./data/pallets.json";
import { validPalletCartons } from "./pallets";
import type { Product } from "./types";

export type PalletRow = {
  id: string | null;
  code: string;
  name: string;
  colisage: number;
  cartons: number;
  pieces: number;
  barcode: string | null;
};

const rows = raw as PalletRow[];
const byId = new Map(
  rows.filter((row) => row.id).map((row) => [row.id as string, row]),
);
const byCode = new Map<string, PalletRow[]>();
const byBarcode = new Map<string, PalletRow>();
for (const row of rows) {
  const code = row.code.toUpperCase();
  byCode.set(code, [...(byCode.get(code) ?? []), row]);
  if (row.barcode) byBarcode.set(row.barcode, row);
}

function uniqueCode(code: string): PalletRow | null {
  const matches = byCode.get(code.toUpperCase());
  return matches?.length === 1 ? matches[0] : null;
}

function cartonsOf(row: PalletRow | null | undefined): number | null {
  return row ? validPalletCartons(row.cartons) : null;
}

/**
 * Nombre de cartons par palette pour un produit.
 * Les champs du produit (activation + quantité) priment sur le fichier statique ;
 * une désactivation explicite supprime le bouton même si le fichier contient une valeur.
 */
export function palletCartonsFor(product: Product | string): number | null {
  if (typeof product === "string")
    return cartonsOf(byId.get(product) ?? uniqueCode(product));
  if (product.pallet_enabled === false) return null;
  return (
    validPalletCartons(product.pallet_cartons) ??
    cartonsOf(byId.get(product.id)) ??
    cartonsOf(product.barcode ? byBarcode.get(product.barcode) : null) ??
    cartonsOf(uniqueCode(product.code))
  );
}

export function palletRowFor(product: Product): PalletRow | null {
  if (product.pallet_enabled === false) return null;
  return (
    byId.get(product.id) ??
    (product.barcode ? byBarcode.get(product.barcode) : null) ??
    uniqueCode(product.code) ??
    null
  );
}
