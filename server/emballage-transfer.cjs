"use strict";
const source = require("../data/emballage-canonical-2026-11-09.json");
const { validateProduct } = require("./generated/domain.cjs");
const { createEmballageImages } = require("./emballage-images.cjs");
const FIELDS = ["code", "name", "name_fr", "barcode", "images"];
const GUARDS = ["code", "name", "name_fr", "barcode", "family_id"];
const normal = (value) => (value === undefined ? null : value);
const equal = (a, b) => JSON.stringify(normal(a)) === JSON.stringify(normal(b));
const key = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();
const plain = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
const SOURCE_SHA =
  "19cd1a4b951e12f88d7fb3cace20e1da644f061202f427384db1147f34eded8e";
const canonical = new Map(source.rows.map((row) => [row.code, row]));
const pairs = new Map();
for (const row of source.rows) {
  const pair = pairs.get(row.legacy_base_id) || [];
  pair.push(row);
  pairs.set(row.legacy_base_id, pair);
}
const ean = (value) =>
  /^\d{13}$/.test(value) &&
  Array.from(value.slice(0, 12)).reduce(
    (n, c, i) => n + Number(c) * (i % 2 ? 3 : 1),
    0,
  ) %
    10 ===
    (10 - Number(value[12])) % 10;
if (
  source.schema !== 1 ||
  source.source_sha256 !== SOURCE_SHA ||
  source.rows.length !== 88 ||
  canonical.size !== 88 ||
  new Set(source.rows.map((r) => r.barcode)).size !== 88 ||
  !source.rows.every((r) => ean(r.barcode)) ||
  pairs.size !== 44 ||
  [...pairs.values()].some(
    (p) =>
      p.length !== 2 ||
      new Set(p.map((r) => r.lid_variant)).size !== 2 ||
      p[0].legacy_base_code !== p[1].legacy_base_code,
  )
)
  throw new Error("Le référentiel PDF des emballages est invalide.");

function physicalSignature(product, row) {
  const text = plain(product.name),
    capacity = plain(product.capacity);
  const shape = /\b(CARREE?|RECTANGLE|RONDE)\b/
    .exec(text)?.[1]
    ?.replace("CARREE", "CARRE");
  const format = /\b(PROMAXI|MAXI|MINI)\b/.exec(text)?.[1] || null;
  const ref = /\bREF\.?\s*0*(\d+)\b/.exec(text)?.[1];
  const volume = (value) => {
    const size = /(\d+(?:[.,]\d+)?)\s*(ML|LT?|LITRES?)\b/.exec(value);
    return size
      ? Number(size[1].replace(",", ".")) * (size[2] === "ML" ? 1 : 1000)
      : null;
  };
  const namedMl = volume(text),
    fieldMl = volume(capacity);
  const ml = namedMl ?? fieldMl;
  const count = Number(/\bS\s*\/\s*(\d+)\b/.exec(text)?.[1] || 1);
  return (
    /\bBOITE\s+EMBALLAGE\b/.test(text) &&
    shape === row.shape &&
    format === row.format &&
    Number(ref) === Number(row.model_reference) &&
    ml === row.capacity_ml &&
    (fieldMl == null || fieldMl === row.capacity_ml) &&
    count === row.set_count
  );
}

function createEmballageTransfer({
  all,
  get,
  put,
  remove,
  assert,
  uid,
  nowISO,
  meta,
  setMeta,
}) {
  const photos = createEmballageImages({
    assert,
    meta,
    setMeta,
    canonicalRows: source.rows,
    sourceSha: SOURCE_SHA,
  });
  const target = (row) => ({
    code: row.code,
    name: row.name,
    name_fr: row.name,
    barcode: row.barcode,
  });
  const knownBase = (product, row) => {
    assert(
      product &&
        product.id === row.legacy_base_id &&
        [row.legacy_base_code, row.code].includes(product.code),
      "Modèle d’emballage absent ou référence modifiée : " +
        row.legacy_base_code,
    );
    assert(
      physicalSignature(product, row),
      "La forme, le format, la capacité ou le lot ne correspondent pas au PDF : " +
        product.code,
    );
    const barcode = String(product.barcode || "").trim();
    if (barcode)
      assert(
        barcode === row.barcode,
        "Un code-barres existant ne peut pas être attribué à une autre variante : " +
          product.code,
      );
    else
      assert(
        row.lid_variant === "TRANSPARENT",
        "Les modèles sans code-barres sont rapprochés uniquement de la variante transparente approuvée.",
      );
    const family = get("family", product.family_id);
    assert(
      family && family.kind !== "new",
      "La collection du modèle n’est plus disponible.",
    );
  };
  const buildNew = (base, row, id, date, imageState) => ({
    id,
    ...target(row),
    family_id: base.family_id,
    description: "",
    dimensions: base.dimensions || "",
    capacity: base.capacity || "",
    material: base.material || "",
    weight_grams: base.weight_grams ?? null,
    pack_size: base.pack_size,
    pack_label: base.pack_label || "carton",
    available: base.available === true,
    availability_confirmed: base.availability_confirmed === true,
    visible: true,
    stock_cartons: null,
    is_new: false,
    new_until: null,
    upcoming: false,
    preorder_enabled: false,
    unit_price_cents: base.unit_price_cents,
    price_on_request: base.price_on_request === true,
    discount_price_cents: null,
    discount_start: null,
    discount_end: null,
    offer_title: "",
    show_offer: false,
    pinned: false,
    sort_order: 999,
    manual_position: null,
    images: photos.choose(row, base, null, imageState),
    created_at: date,
  });
  const validateCatalog = (products) => {
    const ids = new Set(),
      codes = new Set(),
      bars = new Set();
    for (const product of products) {
      const code = key(product.code),
        barcode = key(product.barcode);
      assert(
        product.id &&
          code &&
          !ids.has(product.id) &&
          !codes.has(code) &&
          (!barcode || !bars.has(barcode)),
        "Une référence ou un code-barres est déjà utilisé : " + product.code,
      );
      ids.add(product.id);
      codes.add(code);
      if (barcode) bars.add(barcode);
    }
  };
  const verifyGuards = (plan) => {
    photos.verify(plan.emballage?.image_state);
    assert(
      plan.emballage?.source_sha256 === SOURCE_SHA,
      "Le référentiel PDF de cette préparation a changé.",
    );
    for (const guard of plan.emballage.base_guards) {
      const current = get("product", guard.id);
      assert(
        current &&
          GUARDS.every((field) => equal(current[field], guard.values[field])),
        "Un emballage a été modifié après la préparation : " +
          guard.values.code,
      );
      knownBase(current, canonical.get(guard.canonical_code));
    }
    for (const guard of plan.emballage.image_guards || [])
      assert(
        equal(get("product", guard.id)?.images, guard.images),
        "Une photo d’emballage a changé après la préparation. Les nouvelles photos sont conservées.",
      );
    for (const guard of plan.emballage.present_guards) {
      const current = get("product", guard.id),
        row = canonical.get(guard.canonical_code);
      assert(
        current &&
          current.code === row.code &&
          current.barcode === row.barcode &&
          physicalSignature(current, row),
        "Une variante déjà présente a changé après la préparation : " +
          row.code,
      );
    }
  };

  function preview(s, base, payload) {
    assert(
      payload.source_sha256 === SOURCE_SHA,
      "Ce fichier ne correspond pas au PDF d’emballages approuvé.",
    );
    assert(
      Array.isArray(payload.rows) && payload.rows.length === 88,
      "Le fichier doit contenir exactement les 88 variantes du PDF.",
    );
    const baseline = new Map(base.products.map((p) => [p.id, p]));
    const seen = new Set(),
      grouped = new Map();
    const allowed = new Set([
      "action",
      "id",
      "base_id",
      "previous_code",
      "legacy_base_code",
      "code",
      "name",
      "barcode",
    ]);
    for (const input of payload.rows) {
      assert(
        input &&
          typeof input === "object" &&
          Object.keys(input).every((field) => allowed.has(field)),
        "Ligne d’emballage invalide.",
      );
      const row = canonical.get(input.code);
      assert(
        row &&
          input.name === row.name &&
          input.barcode === row.barcode &&
          !seen.has(row.code),
        "Référence, nom ou code-barres différent du PDF, ou ligne dupliquée.",
      );
      assert(
        input.base_id === row.legacy_base_id &&
          (!input.legacy_base_code ||
            input.legacy_base_code === row.legacy_base_code),
        "Le modèle indiqué ne correspond pas à cette variante du PDF.",
      );
      assert(
        ["update", "create"].includes(input.action) &&
          typeof input.previous_code === "string",
        "Action d’emballage invalide.",
      );
      assert(
        [row.legacy_base_code, row.code].includes(input.previous_code),
        "La référence précédente ne correspond pas au modèle approuvé.",
      );
      assert(
        input.action === "update"
          ? input.id === input.base_id
          : input.id === "",
        "Identifiant de mise à jour ou de création invalide.",
      );
      seen.add(row.code);
      const group = grouped.get(input.base_id) || [];
      group.push({ input, row });
      grouped.set(input.base_id, group);
    }
    assert(
      seen.size === 88 && grouped.size === 44,
      "La liste des variantes du PDF est incomplète.",
    );
    const changes = [],
      conflicts = [],
      skipped = [],
      base_guards = [],
      present_guards = [],
      image_guards = [],
      create_specs = [],
      new_products = [];
    const allProducts = all("product"),
      candidates = new Map(allProducts.map((p) => [p.id, p]));
    let already_present = 0;
    const date = nowISO(),
      image_state = photos.begin();
    for (const [baseId, group] of grouped) {
      const updates = group.filter((item) => item.input.action === "update"),
        creates = group.filter((item) => item.input.action === "create");
      assert(
        group.length === 2 && updates.length === 1 && creates.length === 1,
        "Chaque modèle doit conserver une variante existante et ajouter sa variante complémentaire.",
      );
      const chosen = updates[0].row,
        other = creates[0].row;
      assert(
        chosen.lid_variant !== other.lid_variant,
        "La variante complémentaire doit avoir l’autre type de couvercle.",
      );
      const original = baseline.get(baseId),
        current = get("product", baseId);
      knownBase(original, chosen);
      assert(
        current,
        "Un modèle d’emballage n’existe plus : " + chosen.legacy_base_code,
      );
      for (const field of GUARDS)
        if (!equal(original[field], current[field]))
          conflicts.push({ code: original.code, field });
      base_guards.push({
        id: baseId,
        canonical_code: chosen.code,
        values: Object.fromEntries(
          GUARDS.map((field) => [field, normal(original[field])]),
        ),
      });
      if (!image_state.marker_before) {
        if (!equal(original.images, current.images))
          conflicts.push({ code: original.code, field: "images" });
        image_guards.push({
          id: baseId,
          images: structuredClone(original.images || []),
        });
      }
      const after = {
        ...target(chosen),
        images: photos.choose(chosen, current, current, image_state),
      };
      const fields = FIELDS.filter(
        (field) => !equal(original[field], after[field]),
      ).map((field) => ({
        field,
        before: normal(original[field]),
        after: after[field],
      }));
      if (fields.length) {
        changes.push({
          id: baseId,
          base_id: baseId,
          action: "update",
          code: chosen.code,
          name: chosen.name,
          fields,
        });
        candidates.set(baseId, { ...current, ...after });
      } else already_present++;
      const codeMatches = allProducts.filter(
        (p) => key(p.code) === key(other.code),
      );
      const barcodeMatches = allProducts.filter(
        (p) => key(p.barcode) === other.barcode,
      );
      if (codeMatches.length || barcodeMatches.length) {
        const existing = codeMatches[0];
        assert(
          codeMatches.length === 1 &&
            barcodeMatches.length === 1 &&
            existing.id === barcodeMatches[0].id &&
            existing.id !== baseId &&
            existing.code === other.code &&
            existing.barcode === other.barcode &&
            physicalSignature(existing, other),
          "La référence ou le code-barres de la nouvelle variante est déjà utilisé : " +
            other.code,
        );
        present_guards.push({ id: existing.id, canonical_code: other.code });
        already_present++;
      } else {
        const id = uid(),
          product = buildNew(current, other, id, date, image_state);
        const error = validateProduct(product);
        assert(!error, error);
        assert(!candidates.has(id), "Identifiant de création déjà utilisé.");
        create_specs.push({
          id,
          base_id: baseId,
          canonical_code: other.code,
          created_at: date,
        });
        new_products.push(product);
        candidates.set(id, product);
        changes.push({
          id,
          base_id: baseId,
          action: "create",
          code: other.code,
          name: other.name,
          fields: FIELDS.map((field) => ({
            field,
            before: null,
            after: product[field],
          })),
        });
      }
    }
    if (!conflicts.length) validateCatalog([...candidates.values()]);
    const summary = {
      updated: changes.filter((c) => c.action === "update").length,
      created: create_specs.length,
      deleted: 0,
      already_present,
    };
    return {
      id: uid(),
      owner: s.owner,
      created_at: date,
      source: "PDF emballages — Liste des articles - Maquette.pdf",
      mode: "all",
      kind: "emballage",
      changes,
      skipped,
      conflicts,
      count: changes.length,
      summary,
      emballage: {
        source_sha256: SOURCE_SHA,
        base_guards,
        present_guards,
        create_specs,
        image_state,
        image_guards,
      },
      new_products,
    };
  }

  function apply(plan) {
    verifyGuards(plan);
    const updates = plan.changes.filter((change) => change.action === "update");
    assert(
      plan.changes.every(
        (change) =>
          ["update", "create"].includes(change.action) &&
          change.fields.every((field) => FIELDS.includes(field.field)),
      ),
      "Préparation d’emballages invalide.",
    );
    const currentProducts = new Map(all("product").map((p) => [p.id, p]));
    for (const change of updates) {
      const current = currentProducts.get(change.id);
      assert(
        current &&
          change.fields.every((f) => equal(current[f.field], f.before)),
        "Un emballage a changé : " + change.code,
      );
      currentProducts.set(change.id, {
        ...current,
        ...Object.fromEntries(change.fields.map((f) => [f.field, f.after])),
      });
    }
    const created_products = [];
    for (const spec of plan.emballage.create_specs) {
      assert(
        !currentProducts.has(spec.id),
        "Une création a déjà été utilisée.",
      );
      const base = get("product", spec.base_id),
        row = canonical.get(spec.canonical_code);
      assert(
        base &&
          row &&
          row.legacy_base_id === spec.base_id &&
          get("family", base.family_id)?.kind !== "new" &&
          get("family", base.family_id),
        "Le modèle ou sa collection a changé.",
      );
      const product = buildNew(
        base,
        row,
        spec.id,
        spec.created_at,
        plan.emballage.image_state,
      );
      const error = validateProduct(product);
      assert(!error, error);
      created_products.push(product);
      currentProducts.set(product.id, product);
    }
    validateCatalog([...currentProducts.values()]);
    const backup = {
      id: uid(),
      owner: plan.owner,
      created_at: nowISO(),
      source: plan.source,
      kind: "emballage",
      source_sha256: SOURCE_SHA,
      changes: updates,
      created_products,
      image_state: photos.markApplied(plan.emballage.image_state),
    };
    put("product-update-backup", backup);
    for (const change of updates)
      put("product", currentProducts.get(change.id));
    for (const product of created_products) put("product", product);
    const result = {
      updated: updates.length,
      created: created_products.length,
      backup_id: backup.id,
    };
    put("transfer-plan", { ...plan, applied: result });
    return result;
  }

  function restore(backup) {
    photos.verifyRestore(backup.image_state);
    assert(
      backup.source_sha256 === SOURCE_SHA,
      "Le référentiel de cette sauvegarde n’est pas reconnu.",
    );
    const createdIds = new Set(
      backup.created_products.map((product) => product.id),
    );
    const referenced = (record) => {
      const pending = [record];
      while (pending.length) {
        const value = pending.pop();
        if (typeof value === "string" && createdIds.has(value)) return value;
        if (value && typeof value === "object")
          pending.push(...Object.values(value));
      }
      return null;
    };
    for (const [kind, label] of [
      ["order", "une commande"],
      ["request", "une demande"],
      ["reservation", "une réservation"],
      ["settings", "les réglages du magasin"],
      ["family", "une collection"],
    ]) {
      for (const record of all(kind)) {
        const id = referenced(record);
        assert(
          !id,
          "Restauration refusée : une variante créée est déjà utilisée dans " +
            label +
            ".",
        );
      }
    }
    const candidates = new Map(all("product").map((p) => [p.id, p]));
    for (const product of backup.created_products) {
      assert(
        equal(candidates.get(product.id), product),
        "Une variante créée a été modifiée depuis l’import : " + product.code,
      );
      candidates.delete(product.id);
    }
    for (const change of backup.changes) {
      const current = candidates.get(change.id);
      assert(
        current && change.fields.every((f) => equal(current[f.field], f.after)),
        "Un emballage a changé depuis l’import : " + change.code,
      );
      candidates.set(change.id, {
        ...current,
        ...Object.fromEntries(change.fields.map((f) => [f.field, f.before])),
      });
    }
    validateCatalog([...candidates.values()]);
    for (const product of backup.created_products)
      remove("product", product.id);
    for (const change of backup.changes)
      put("product", candidates.get(change.id));
    photos.restore(backup.image_state);
    put("product-update-backup", { ...backup, restored_at: nowISO() });
    return {
      restored: backup.changes.length,
      removed: backup.created_products.length,
    };
  }
  return { preview, apply, restore };
}

module.exports = { createEmballageTransfer, physicalSignature, SOURCE_SHA };
