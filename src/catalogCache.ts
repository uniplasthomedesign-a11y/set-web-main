import type { Catalog } from "./types.ts";

// Reload once for the canonical Emballage catalogue; subsequent visits keep
// using the same access-checked cache without a periodic refresh.
export const CATALOG_CACHE_KEY = "uniplast.catalog-cache.v2";
const LEGACY_CACHE_KEY = "uniplast.catalog-cache.v1";
const MAX_BYTES = 8 * 1024 * 1024;
const revisionPattern = /^[a-f0-9]{64}$/i;

export type CachedCatalog = {
  schema: 1;
  revision: string;
  catalog: Catalog;
  client_approved: boolean;
  price_access: boolean;
  admin?: boolean;
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const id = (value: unknown): value is string =>
  text(value) && value.trim().length > 0 && value.length <= 128;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const optionalBoolean = (value: unknown) =>
  value === undefined || typeof value === "boolean";
const uniqueRecords = (
  values: unknown,
  valid: (value: Record<string, unknown>) => boolean,
) =>
  Array.isArray(values) &&
  values.every((value) => record(value) && id(value.id) && valid(value)) &&
  new Set(values.map((value) => value.id)).size === values.length;
const heroShape = (hero: Record<string, unknown>) =>
  text(hero.title) &&
  text(hero.body) &&
  text(hero.image) &&
  typeof hero.visible === "boolean";
const optionalRecords = (
  values: unknown,
  valid: (value: Record<string, unknown>) => boolean,
) => values === undefined || uniqueRecords(values, valid);

function validCatalog(value: unknown): value is Catalog {
  if (!record(value) || !record(value.settings) || !record(value.sales))
    return false;
  const settings = value.settings;
  return (
    uniqueRecords(
      value.products,
      (product) =>
        text(product.name) &&
        text(product.code) &&
        id(product.family_id) &&
        finite(product.unit_price_cents) &&
        product.unit_price_cents >= 0 &&
        finite(product.pack_size) &&
        product.pack_size > 0 &&
        optionalBoolean(product.visible) &&
        Array.isArray(product.images) &&
        product.images.length <= 10 &&
        product.images.every(
          (image) =>
            record(image) &&
            text(image.url) &&
            image.url.trim().length > 0 &&
            image.url.length <= 2000 &&
            finite(image.scale) &&
            finite(image.x) &&
            finite(image.y),
        ),
    ) &&
    uniqueRecords(
      value.families,
      (family) =>
        text(family.name) &&
        text(family.image) &&
        finite(family.sort_order) &&
        typeof family.visible === "boolean" &&
        optionalRecords(family.slides, heroShape) &&
        optionalRecords(family.promotions, heroShape) &&
        (family.aliases === undefined ||
          (Array.isArray(family.aliases) && family.aliases.every(text))),
    ) &&
    (settings.price_visibility === "public" ||
      settings.price_visibility === "approved") &&
    text(settings.currency) &&
    /^[A-Z]{3}$/.test(settings.currency) &&
    text(settings.company_name) &&
    uniqueRecords(settings.heroes, heroShape) &&
    optionalRecords(
      settings.videos,
      (video) =>
        text(video.title) &&
        text(video.url) &&
        text(video.poster_url) &&
        (video.source === "youtube" || video.source === "upload") &&
        typeof video.visible === "boolean",
    ) &&
    uniqueRecords(
      settings.seasons,
      (season) =>
        text(season.title) &&
        text(season.starts_on) &&
        text(season.ends_on) &&
        typeof season.visible === "boolean" &&
        Array.isArray(season.product_ids) &&
        season.product_ids.every(id) &&
        Array.isArray(season.family_ids) &&
        season.family_ids.every(id),
    ) &&
    Object.entries(value.sales).every(
      ([key, count]) => id(key) && finite(count) && count >= 0,
    )
  );
}

function validSnapshot(value: unknown): value is CachedCatalog {
  return (
    record(value) &&
    value.schema === 1 &&
    text(value.revision) &&
    revisionPattern.test(value.revision) &&
    typeof value.client_approved === "boolean" &&
    typeof value.price_access === "boolean" &&
    optionalBoolean(value.admin) &&
    value.admin !== true &&
    validCatalog(value.catalog)
  );
}

function tooLarge(value: string) {
  return (
    value.length > MAX_BYTES ||
    new TextEncoder().encode(value).length > MAX_BYTES
  );
}

export function loadCachedCatalog(
  storage?: Pick<Storage, "getItem">,
): CachedCatalog | null {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(
      CATALOG_CACHE_KEY,
    );
    if (!raw || tooLarge(raw)) return null;
    const parsed: unknown = JSON.parse(raw);
    return validSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCachedCatalog(
  snapshot: CachedCatalog | null,
  storage?: Pick<Storage, "setItem" | "removeItem">,
): boolean {
  try {
    const target = storage ?? globalThis.localStorage;
    if (!target) return false;
    target.removeItem(LEGACY_CACHE_KEY);
    if (snapshot === null) {
      target.removeItem(CATALOG_CACHE_KEY);
      return true;
    }
    if (snapshot.admin === true) {
      target.removeItem(CATALOG_CACHE_KEY);
      return false;
    }
    if (!validSnapshot(snapshot)) return false;
    const raw = JSON.stringify(snapshot);
    if (tooLarge(raw)) return false;
    target.setItem(CATALOG_CACHE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

/** Call only after the current server access probe has completed successfully.
 * A changed revision alone does not revoke access; login loads the latest data.
 * Missing access evidence must never authorize displaying a cached catalogue.
 */
export function canReuseCatalogCache(
  cached: CachedCatalog | null,
  probe: {
    revision?: string;
    admin?: boolean;
    client_approved: boolean;
    price_access?: boolean;
    access_only?: boolean;
  },
): boolean {
  return (
    validSnapshot(cached) &&
    record(probe) &&
    probe.admin === false &&
    typeof probe.client_approved === "boolean" &&
    typeof probe.price_access === "boolean" &&
    (probe.access_only === true ||
      (text(probe.revision) && revisionPattern.test(probe.revision))) &&
    cached.client_approved === probe.client_approved &&
    cached.price_access === probe.price_access
  );
}
