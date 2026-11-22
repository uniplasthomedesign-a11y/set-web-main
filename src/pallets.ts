// Achat par palette : règles pures (sans accès au catalogue ni à l'interface).
// Une palette = un nombre entier de cartons défini dans src/data/pallets.json.
// L'achat passe ensuite par addCart(), donc par les mêmes contrôles que l'ajout normal.

/** Limite serveur : cartons par ligne de commande. */
export const MAX_LINE_CARTONS = 10000;

/** Cartons par palette valides : entier de 1 à 10000, sinon null (pas de bouton). */
export function validPalletCartons(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_LINE_CARTONS
    ? value
    : null;
}

/**
 * Nombre maximal de palettes achetables maintenant (0 = bouton désactivé).
 * Tient compte des cartons déjà au panier, du stock (null = illimité) et de la limite serveur.
 * Aucun plafond fixe de palettes : ce sont le stock et la limite serveur qui bornent.
 */
export function maxPallets(
  perPallet: number,
  stockCartons: number | null,
  inCart: number,
): number {
  const byServer = Math.floor((MAX_LINE_CARTONS - inCart) / perPallet);
  const byStock =
    stockCartons === null
      ? Number.POSITIVE_INFINITY
      : Math.floor((stockCartons - inCart) / perPallet);
  return Math.max(0, Math.min(byServer, byStock));
}

export interface PalletRow<L> {
  line: L;
  /** Cartons par palette du produit, null si le produit n'a pas de palette définie. */
  per: number | null;
  /** Palettes entières contenues dans la ligne (0 s'il n'y en a pas). */
  palettes: number;
  /** Cartons en plus des palettes entières (ou tous les cartons si aucune palette). */
  extra: number;
}

/**
 * Version « palettes » d'un bon de commande : proposée si au moins une ligne contient
 * une palette entière. Le panier additionne les quantités : 5 palettes de 160 + 8 cartons
 * déjà au panier donnent 808 cartons ; la ligne se lit alors « 5 palettes + 8 cartons ».
 * Les lignes sans palette définie restent lisibles (palettes = 0). Sinon null.
 */
export function palletRows<L extends { product_id: string; cartons: number }>(
  lines: L[],
  perPalletOf: (productId: string) => number | null,
): PalletRow<L>[] | null {
  let anyPallet = false;
  const rows = lines.map((line): PalletRow<L> => {
    const per = perPalletOf(line.product_id);
    const palettes = per ? Math.floor(line.cartons / per) : 0;
    if (palettes > 0) anyPallet = true;
    return {
      line,
      per,
      palettes,
      extra: per ? line.cartons - palettes * per : line.cartons,
    };
  });
  return anyPallet ? rows : null;
}
