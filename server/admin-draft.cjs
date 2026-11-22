"use strict";
const { isDeepStrictEqual } = require("node:util");

// This endpoint accepts catalogue content only. Credentials, customers, orders,
// transfer plans and ordering anchors always use their dedicated online routes.
const fields = {
  product: new Set([
    "name",
    "name_fr",
    "code",
    "barcode",
    "family_id",
    "description",
    "dimensions",
    "capacity",
    "material",
    "weight_grams",
    "pack_size",
    "pack_label",
    "unit_price_cents",
    "price_on_request",
    "available",
    "availability_confirmed",
    "visible",
    "pallet_enabled",
    "pallet_cartons",
    "stock_cartons",
    "is_new",
    "new_until",
    "upcoming",
    "preorder_enabled",
    "discount_price_cents",
    "discount_start",
    "discount_end",
    "offer_title",
    "show_offer",
    "pinned",
    "sort_order",
    "images",
    "created_at",
  ]),
  family: new Set([
    "name",
    "name_fr",
    "image",
    "sort_order",
    "visible",
    "aliases",
    "kind",
    "introduction",
    "slider_enabled",
    "slider_autoplay",
    "slider_interval",
    "promotions",
    "slides",
    "slider_height",
  ]),
  settings: new Set([
    "storefront_theme",
    "topbar_tagline",
    "youtube_url",
    "videos_enabled",
    "videos_title",
    "videos",
    "product_display",
    "custom_order",
    "family_options",
    "home_slider_height",
    "slider_interval",
    "about_title",
    "about_body",
    "about_image",
    "price_visibility",
    "secondary_phone",
    "viber_phone",
    "whatsapp_phone",
    "website_url",
    "facebook_url",
    "catalog_pdf_url",
    "catalog_pdf_title",
    "seasons",
    "recommendation_mode",
    "company_name",
    "company_name_fr",
    "logo_url",
    "phone",
    "email",
    "address",
    "currency",
    "timezone",
    "shipping_cents",
    "tax_note",
    "pack_label",
    "accent_color",
    "primary_color",
    "heroes",
    "privacy",
    "terms",
  ]),
};
const record = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const equal = (a, b) =>
  isDeepStrictEqual(a === undefined ? null : a, b === undefined ? null : b);
const operationFields = new Set([
  "entity",
  "id",
  "changes",
  "expected",
  "create",
  "remove",
]);

function createAdminDraft({
  get,
  all,
  put,
  remove,
  transaction,
  admin,
  assert,
  settings,
  saveProduct,
  saveFamily,
  saveSettings,
  newsFamilyId,
}) {
  return function sync(payload, session) {
    admin(session);
    assert(
      record(payload) &&
        Object.keys(payload).every((key) => key === "operations") &&
        Array.isArray(payload.operations) &&
        payload.operations.length > 0 &&
        payload.operations.length <= 500,
      "La synchronisation accepte de 1 à 500 modifications du catalogue.",
    );
    assert(
      Buffer.byteLength(JSON.stringify(payload), "utf8") <= 3 * 1024 * 1024,
      "La synchronisation ne doit pas dépasser 3 Mo.",
      413,
    );
    return transaction(() => {
      const seen = new Set(),
        planned = [];
      let unchanged = 0;
      for (const operation of payload.operations) {
        assert(
          record(operation) &&
            Object.keys(operation).every((key) => operationFields.has(key)) &&
            Object.hasOwn(fields, operation.entity),
          "Modification de catalogue invalide.",
        );
        const kind = operation.entity;
        const id = kind === "settings" ? "true" : operation.id;
        assert(
          kind === "settings"
            ? [true, "true", "settings"].includes(operation.id)
            : typeof id === "string" && id.length > 0 && id.length <= 128,
          "Identifiant de catalogue invalide.",
        );
        assert(
          !seen.has(kind + ":" + id),
          "Un élément ne peut figurer qu’une fois dans la synchronisation.",
        );
        seen.add(kind + ":" + id);
        assert(
          (operation.create === undefined || operation.create === true) &&
            (operation.remove === undefined || operation.remove === true) &&
            !(operation.create && operation.remove),
          "Action de synchronisation invalide.",
        );
        assert(
          record(operation.changes) &&
            Object.keys(operation.changes).every((field) =>
              fields[kind].has(field),
            ),
          "Un champ ne peut pas être modifié depuis la sauvegarde locale.",
        );
        const current = kind === "settings" ? settings() : get(kind, id);
        if (operation.remove) {
          assert(
            kind !== "settings" &&
              !Object.keys(operation.changes).length &&
              record(operation.expected) &&
              operation.expected.id === id,
            "Suppression de catalogue invalide.",
          );
          if (!current) {
            unchanged++;
            continue;
          }
          assert(
            equal(current, operation.expected),
            "Cet élément a changé depuis la sauvegarde locale : la suppression est annulée.",
            409,
          );
          assert(
            kind !== "family" || id !== newsFamilyId,
            "Masquez la collection automatique depuis son bouton de visibilité.",
          );
          planned.push({ kind, id, remove: true });
          continue;
        }
        const changes = operation.changes,
          keys = Object.keys(changes);
        assert(keys.length > 0, "La modification ne contient aucun champ.");
        if (operation.create) {
          assert(
            kind !== "settings" &&
              operation.expected === null &&
              /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
                id,
              ),
            "Création de catalogue invalide.",
          );
          if (current) {
            assert(
              keys.every((field) => equal(current[field], changes[field])),
              "L’identifiant de cette création est déjà utilisé.",
              409,
            );
            unchanged++;
            continue;
          }
          planned.push({ kind, id, create: true, value: { ...changes, id } });
          continue;
        }
        assert(
          record(operation.expected) &&
            Object.keys(operation.expected).length === keys.length &&
            keys.every((field) => Object.hasOwn(operation.expected, field)),
          "Les valeurs d’origine doivent correspondre exactement aux champs modifiés.",
        );
        assert(
          current,
          "Cet élément a été supprimé depuis la sauvegarde locale.",
          409,
        );
        // An already-desired field is a safe retry after a lost successful reply.
        assert(
          keys.every(
            (field) =>
              equal(current[field], operation.expected[field]) ||
              equal(current[field], changes[field]),
          ),
          "Un champ a changé depuis la sauvegarde locale : aucune modification n’a été publiée.",
          409,
        );
        if (keys.every((field) => equal(current[field], changes[field]))) {
          unchanged++;
          continue;
        }
        planned.push({
          kind,
          id,
          value: {
            ...current,
            ...changes,
            id: kind === "settings" ? true : id,
          },
        });
      }
      // Stage the complete final graph inside this transaction. Existing route
      // validators then see new families, moved products and final unique codes,
      // including safe reference swaps, instead of a transient half-batch state.
      for (const item of planned) {
        if (item.remove) remove(item.kind, item.id);
        else put(item.kind, item.value);
      }
      for (const item of planned) {
        if (item.remove) {
          if (item.kind === "family")
            assert(
              !all("product").some((product) => product.family_id === item.id),
              "Déplacez les produits vers une autre collection avant de supprimer celle-ci.",
            );
        } else {
          const save =
            item.kind === "product"
              ? saveProduct
              : item.kind === "family"
                ? saveFamily
                : saveSettings;
          save(item.value);
        }
      }
      return {
        applied: planned.length,
        updated: planned.filter((item) => !item.create && !item.remove).length,
        created: planned.filter((item) => item.create).length,
        removed: planned.filter((item) => item.remove).length,
        unchanged,
      };
    });
  };
}

module.exports = { createAdminDraft };
