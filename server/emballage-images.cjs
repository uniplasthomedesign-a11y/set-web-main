"use strict";
const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const VERSION = "emballage-lids-2026-11-09-v1";
const KEY = "emballage-images:" + VERSION;
const staticUrl = (url) =>
  typeof url === "string" &&
  /^\/assets\/[a-zA-Z0-9_./-]+$/.test(url) &&
  !url.includes("..");

function createEmballageImages({
  assert,
  meta,
  setMeta,
  canonicalRows,
  sourceSha,
}) {
  let document, byCode, digest;
  function load() {
    if (document) return;
    const data = require("../data/emballage-images-2026-11-09.json");
    const rows = new Map((data.rows || []).map((row) => [row.code, row]));
    assert(
      data.schema === 1 &&
        data.version === VERSION &&
        data.source_sha256 === sourceSha &&
        rows.size === 88 &&
        data.rows.length === 88 &&
        canonicalRows.every((canonical) => {
          const row = rows.get(canonical.code);
          return (
            row &&
            row.legacy_base_id === canonical.legacy_base_id &&
            row.lid_variant === canonical.lid_variant &&
            ["authentic", "illustrative"].includes(row.kind) &&
            row.kind ===
              (row.lid_variant === row.real_lid_variant
                ? "authentic"
                : "illustrative") &&
            Array.isArray(row.images) &&
            row.images.length > 0 &&
            row.images.length <= 10 &&
            row.images.every(
              (image) =>
                image &&
                staticUrl(image.url) &&
                (!image.original_url || staticUrl(image.original_url)) &&
                Number.isFinite(image.scale) &&
                image.scale > 0 &&
                Number.isFinite(image.x) &&
                Number.isFinite(image.y),
            )
          );
        }),
      "Les photos préparées des emballages sont incomplètes.",
    );
    document = data;
    byCode = rows;
    digest = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  }
  function begin() {
    load();
    return {
      version: VERSION,
      manifest_hash: digest,
      marker_before: meta(KEY) || "",
    };
  }
  function verify(state) {
    load();
    assert(
      state &&
        state.version === VERSION &&
        state.manifest_hash === digest &&
        state.marker_before === (meta(KEY) || ""),
      "Les photos des emballages ont changé depuis la préparation. Rechargez le fichier.",
    );
  }
  function approved(base, state) {
    if (state.marker_before) return;
    const row = document.rows.find(
      (item) => item.legacy_base_id === base.id && item.kind === "authentic",
    );
    const allowed = new Set(
      [
        ...(row.approved_base_images || []),
        ...(row.real_source_images || []),
      ].flatMap((image) => [image.url, image.original_url].filter(Boolean)),
    );
    assert(
      Array.isArray(base.images) &&
        base.images.every(
          (image) =>
            allowed.has(image.url) &&
            (!image.original_url || allowed.has(image.original_url)),
        ),
      "Une photo de ce modèle a changé depuis la préparation des images : " +
        base.code +
        ". Les nouvelles photos sont conservées ; vérifiez ce modèle avant l’import.",
    );
  }
  function choose(row, base, existingVariant, state) {
    load();
    if (state.marker_before && existingVariant)
      return structuredClone(existingVariant.images || []);
    approved(base, state);
    const photo = byCode.get(row.code);
    if (
      !state.marker_before &&
      photo.kind === "authentic" &&
      base.images.length
    ) {
      const urls = {
        ...(document.url_mapping || {}),
        ...(photo.url_mapping || {}),
      };
      const result = base.images.map((image) => {
        const url = urls[image.url] || image.url;
        const original = image.original_url
          ? staticUrl(image.original_url)
            ? image.original_url
            : urls[image.original_url] || image.original_url
          : url !== image.url
            ? staticUrl(image.url)
              ? image.url
              : url
            : null;
        return {
          ...image,
          url,
          ...(original ? { original_url: original } : {}),
        };
      });
      assert(
        result.every(
          (image) =>
            staticUrl(image.url) &&
            (!image.original_url || staticUrl(image.original_url)),
        ),
        "Une photo originale n’a pas encore été intégrée au dossier du site.",
      );
      return result;
    }
    return structuredClone(photo.images);
  }
  function markApplied(state) {
    verify(state);
    setMeta(KEY, digest);
    return {
      version: VERSION,
      marker_before: state.marker_before,
      marker_after: digest,
    };
  }
  function verifyRestore(state) {
    if (!state) return; // Backups made before photo preparation remain usable.
    assert(
      state.version === VERSION && (meta(KEY) || "") === state.marker_after,
      "Une autre mise à jour des photos a été appliquée depuis cette sauvegarde.",
    );
  }
  function restore(state) {
    if (state) setMeta(KEY, state.marker_before || "");
  }
  return { begin, verify, choose, markApplied, verifyRestore, restore };
}
module.exports = { createEmballageImages, VERSION, KEY };
