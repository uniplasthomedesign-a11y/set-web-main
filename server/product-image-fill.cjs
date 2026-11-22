"use strict";
const { isDeepStrictEqual } = require("node:util");
const productImageFillVersion = "photos-familles-2026-11-08-v1";
const productImageFillKey = "product-image-fill:" + productImageFillVersion;
const PREFIX = "/assets/products/photos-2026-11-08/";
const codeOf = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();
const asset = (value, prefix) =>
  typeof value === "string" &&
  value.length <= 2000 &&
  value.startsWith(prefix) &&
  /^\/assets\/[a-zA-Z0-9_./-]+$/.test(value) &&
  !value.includes("..");

function validateSource(source) {
  if (
    !source ||
    source.version !== productImageFillVersion ||
    source.asset_prefix !== PREFIX ||
    !Array.isArray(source.products)
  )
    throw new Error("Invalid product image manifest");
  const ids = new Set(),
    codes = new Set();
  for (const row of source.products) {
    const code = codeOf(row?.code);
    if (
      !code ||
      typeof row?.code !== "string" ||
      typeof row.product_id !== "string" ||
      !row.product_id ||
      ids.has(row.product_id) ||
      codes.has(code)
    )
      throw new Error("Duplicate or invalid product image reference");
    ids.add(row.product_id);
    codes.add(code);
    if (
      !Array.isArray(row.images) ||
      !row.images.length ||
      row.images.length > 10 ||
      !Array.isArray(row.legacy_images)
    )
      throw new Error("Invalid product image list");
    for (const image of row.images)
      if (
        !image ||
        !asset(image.url, PREFIX) ||
        image.scale !== 1 ||
        image.x !== 0 ||
        image.y !== 0 ||
        (image.original_url !== undefined && !asset(image.original_url, PREFIX))
      )
        throw new Error("Unsafe product image asset or framing");
  }
}

function applyProductImageFill({
  existingCatalog,
  source,
  meta,
  setMeta,
  all,
  put,
  transaction,
}) {
  source ??= require("../data/product-images-2026-11-08.json");
  validateSource(source);
  if (meta(productImageFillKey)) return;
  transaction(() => {
    const products = all("product"),
      counts = new Map(),
      idCounts = new Map();
    for (const product of products) {
      counts.set(
        codeOf(product.code),
        (counts.get(codeOf(product.code)) || 0) + 1,
      );
      idCounts.set(product.id, (idCounts.get(product.id) || 0) + 1);
    }
    const summary = {
      version: productImageFillVersion,
      applied_at: new Date().toISOString(),
      mode: existingCatalog ? "existing-store-images" : "fresh-seed-images",
      total: products.length,
      filled: 0,
      replaced_legacy: 0,
      preserved: 0,
      unchanged: 0,
      unmatched: 0,
      ambiguous: 0,
    };
    const changes = [];
    for (const row of source.products) {
      const code = codeOf(row.code);
      if (counts.get(code) > 1 || idCounts.get(row.product_id) > 1) {
        summary.ambiguous++;
        continue;
      }
      const product = products.find(
        (p) => p.id === row.product_id && codeOf(p.code) === code,
      );
      if (!product) {
        summary.unmatched++;
        continue;
      }
      const empty =
        product.images == null ||
        (Array.isArray(product.images) && product.images.length === 0);
      const legacy =
        row.legacy_images.length > 0 &&
        row.legacy_images.every(
          (image) =>
            image &&
            asset(image.url, "/assets/") &&
            !image.url.startsWith(PREFIX) &&
            (image.original_url === undefined ||
              (asset(image.original_url, "/assets/") &&
                !image.original_url.startsWith(PREFIX))),
        ) &&
        isDeepStrictEqual(product.images, row.legacy_images);
      if (existingCatalog && !empty && !legacy) {
        summary.preserved++;
        continue;
      }
      if (isDeepStrictEqual(product.images, row.images)) {
        summary.unchanged++;
        continue;
      }
      const images = row.images.map((image) => ({ ...image }));
      changes.push({
        product_id: product.id,
        code: product.code,
        before: {
          present: Object.prototype.hasOwnProperty.call(product, "images"),
          value: product.images ?? null,
        },
        after: { images },
        reason: !existingCatalog
          ? "fresh-seed"
          : empty
            ? "missing"
            : "bundled-default",
      });
      put("product", { ...product, images });
      summary.filled++;
      if (existingCatalog && legacy) summary.replaced_legacy++;
    }
    put("product-image-fill-backup", {
      id: productImageFillVersion,
      created_at: summary.applied_at,
      asset_prefix: PREFIX,
      changes,
      summary,
    });
    setMeta(productImageFillKey, JSON.stringify(summary));
  });
}
module.exports = {
  applyProductImageFill,
  productImageFillKey,
  productImageFillVersion,
};
