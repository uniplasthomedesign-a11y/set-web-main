import type { Catalog } from "./types";
import {
  DraftWorkspace,
  draftConflicts,
  draftEntity,
  draftEqual,
  indexedDraftStorage,
  mapDraftStrings,
  mediaToken,
  type DraftEntry,
  type DraftMedia,
} from "./adminDraftCore";
import {
  configureDraftTransport,
  localMode,
  remoteLocalCall,
  remoteLocalUpload,
} from "./localApi";

const workspace = new DraftWorkspace(indexedDraftStorage());
let baseCatalog: Catalog | null = null,
  active = false,
  ready = false,
  syncing = false,
  forceRemote = false;
let load: Promise<void> | undefined;
let lastError = "";
interface DraftConflict {
  key: string;
  label: string;
  fields: string[];
  can_keep: boolean;
  removing: boolean;
}
let conflicts: DraftConflict[] = [];
const conflictRecords = new Map<string, Record<string, unknown> | null>();
const media = new Map<string, DraftMedia>(),
  previews = new Map<string, string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
export const adminDraftStatus = () => ({
  active,
  ready,
  syncing,
  pending: workspace.state.entries.length,
  pending_media: referencedMedia().length,
  saved_at: workspace.state.saved_at,
  error: lastError,
  conflicts: [...conflicts],
  refresh_pending: forceRemote,
});
export function subscribeAdminDraft(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const adminDraftActive = () => localMode && active;
export const adminDraftPending = () => workspace.state.entries.length > 0;
export function consumeDraftRemoteRefresh() {
  return forceRemote;
}
export function completeDraftRemoteRefresh() {
  forceRemote = false;
  emit();
}
export function deactivateAdminDraft(notify = true) {
  active = false;
  ready = false;
  baseCatalog = null;
  conflicts = [];
  conflictRecords.clear();
  for (const url of previews.values()) URL.revokeObjectURL(url);
  previews.clear();
  if (notify) emit();
}
export async function activateAdminDraft(catalog: Catalog) {
  if (!localMode) return;
  const openingSession = !active;
  active = true;
  baseCatalog = structuredClone(catalog);
  try {
    if (!load)
      load = (async () => {
        await workspace.load();
        for (const item of await workspace.storage.media())
          media.set(item.id, item);
      })().catch((error) => {
        load = undefined;
        throw error;
      });
    await load;
    if (!active) return;
    if (openingSession) {
      // Same-page logout/login is a new editing session too: recover the latest
      // durable state, not a previous tab's in-memory revision.
      await workspace.load();
      const savedMedia = await workspace.storage.media();
      media.clear();
      for (const item of savedMedia) media.set(item.id, item);
      const referenced = new Set(referencedMedia().map((item) => item.id));
      for (const [id, item] of media)
        if (item.uploaded_url && !referenced.has(id)) {
          try {
            await workspace.storage.removeMedia(id);
            media.delete(id);
          } catch {
            /* Cleanup failure never discards or blocks saved editing work. */
          }
        }
    }
    ready = true;
    lastError = "";
    emit();
  } catch (error) {
    ready = false;
    lastError = (error as Error).message;
    emit();
  }
}
function requireReady() {
  if (!active || !ready || !baseCatalog)
    throw new Error(
      lastError ||
        "Reconnectez-vous à la gestion pour ouvrir la sauvegarde de cet appareil.",
    );
  if (syncing)
    throw new Error(
      "La synchronisation est en cours. Attendez sa fin pour enregistrer une autre modification.",
    );
}
function preview(item: DraftMedia) {
  let url = previews.get(item.id);
  if (!url) {
    url = URL.createObjectURL(item.blob);
    previews.set(item.id, url);
  }
  return url;
}
export function isAdminDraftMediaUrl(value: string) {
  return active && [...previews.values()].includes(value);
}
export function normalizeAdminDraftMedia<T>(value: T): T {
  const replacements = new Map(
    [...previews].map(([id, url]) => [url, mediaToken(id)]),
  );
  return mapDraftStrings(value, (text) => replacements.get(text) || text) as T;
}
export function adminDraftCatalog(): Catalog | null {
  if (!active || !ready || !baseCatalog) return null;
  const tokens = new Map(
    [...media].map(([id, item]) => [mediaToken(id), item]),
  );
  return mapDraftStrings(workspace.overlay(baseCatalog), (text) =>
    tokens.has(text) ? preview(tokens.get(text)!) : text,
  ) as Catalog;
}
function referencedMedia(): DraftMedia[] {
  const referenced = new Set<string>();
  mapDraftStrings(
    workspace.state.entries.map((entry) => entry.patch),
    (text) => {
      referenced.add(text);
      return text;
    },
  );
  return [...media.values()].filter((item) =>
    referenced.has(mediaToken(item.id)),
  );
}
async function stage(
  kind: "product" | "family" | "settings",
  value: any,
  fields?: readonly string[],
) {
  requireReady();
  const canonical = normalizeAdminDraftMedia(value);
  try {
    await workspace.stage(
      baseCatalog!,
      kind,
      kind === "settings" ? "settings" : canonical.id,
      canonical,
      fields,
    );
  } catch (error) {
    lastError = (error as Error).message;
    emit();
    throw error;
  }
  conflicts = conflicts.filter(
    (item) =>
      item.key !==
      kind + ":" + (kind === "settings" ? "settings" : canonical.id),
  );
  lastError = "";
  emit();
}
async function queueMedia(blob: Blob) {
  requireReady();
  const max = ["application/pdf", "video/mp4", "video/webm"].includes(blob.type)
    ? 20
    : 5;
  if (!blob.size || blob.size > max * 1024 * 1024)
    throw new Error(`Le fichier doit faire au maximum ${max} Mo.`);
  const item: DraftMedia = { id: crypto.randomUUID(), blob };
  try {
    await workspace.storage.putMedia(item);
  } catch (error) {
    lastError = (error as Error).message;
    emit();
    throw error;
  }
  media.set(item.id, item);
  emit();
  return preview(item);
}
const stagedCalls = new Set([
  "product-save",
  "product-images",
  "product-delete",
  "family-save",
  "family-delete",
  "family-reorder",
  "settings-save",
]);
const guardedOnline = new Set([
  "transfer-preview",
  "transfer-weights-preview",
  "transfer-emballage-preview",
  "transfer-apply",
  "transfer-restore",
  "product-position",
]);
configureDraftTransport({
  async call(name, payload) {
    const endpoint = name.split("?")[0];
    if (endpoint === "logout") {
      deactivateAdminDraft();
      return { handled: false };
    }
    if (guardedOnline.has(endpoint) && adminDraftPending())
      throw new Error(
        "Synchronisez d’abord vos modifications locales avant cette opération en ligne.",
      );
    if (!stagedCalls.has(endpoint)) return { handled: false };
    requireReady();
    const p = payload as any;
    if (endpoint === "product-save") await stage("product", p);
    if (endpoint === "product-images") {
      const current = draftEntity(
        workspace.overlay(baseCatalog!),
        "product",
        p.id,
      );
      if (!current) throw new Error("Ce produit n’existe plus.");
      await stage("product", { ...current, images: p.images }, ["images"]);
    }
    if (endpoint === "settings-save") await stage("settings", p);
    if (endpoint === "family-save") await stage("family", p);
    if (endpoint === "product-delete") {
      await workspace.remove(baseCatalog!, "product", p.id);
      emit();
    }
    if (endpoint === "family-reorder") {
      const ids = p.ids;
      const view = workspace.overlay(baseCatalog!);
      if (
        !Array.isArray(ids) ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !view.families.some((f) => f.id === id))
      )
        throw new Error("Ordre des collections invalide.");
      const saves = [];
      for (let index = 0; index < ids.length; index++) {
        const family = view.families.find((f) => f.id === ids[index])!;
        saves.push({
          kind: "family" as const,
          id: family.id,
          value: { ...family },
          fields: ["sort_order"],
          index,
        });
      }
      await workspace.batch(
        baseCatalog!,
        saves.map((save) => ({
          ...save,
          value: { ...save.value, sort_order: save.index },
        })),
      );
      emit();
    }
    if (endpoint === "family-delete") {
      const view = workspace.overlay(baseCatalog!),
        products = view.products.filter(
          (product) => product.family_id === p.id,
        );
      const target = view.families.find(
        (family) =>
          family.id === p.target && family.id !== p.id && family.kind !== "new",
      );
      if (products.length && !target)
        throw new Error("Choisissez la collection qui recevra les produits.");
      await workspace.batch(
        baseCatalog!,
        products.map((product) => ({
          kind: "product",
          id: product.id,
          value: { ...product, family_id: target!.id },
          fields: ["family_id"],
        })),
        [{ kind: "family", id: p.id, target: target?.id }],
      );
      emit();
    }
    return { handled: true };
  },
  upload: queueMedia,
  afterCall(name) {
    const endpoint = name.split("?")[0];
    if (
      ["transfer-apply", "transfer-restore", "product-position"].includes(
        endpoint,
      )
    ) {
      forceRemote = true;
      emit();
    }
  },
});

function resolvedEntry(saved: DraftEntry): DraftEntry {
  const urls = new Map(
    [...media]
      .filter(([, item]) => item.uploaded_url)
      .map(([id, item]) => [mediaToken(id), item.uploaded_url!]),
  );
  return {
    ...saved,
    patch: mapDraftStrings(saved.patch, (value) => urls.get(value) || value),
  };
}
function findConflicts(catalog: Catalog) {
  conflicts = [];
  conflictRecords.clear();
  for (const saved of workspace.state.entries) {
    const entry = resolvedEntry(saved),
      current = draftEntity(catalog, entry.kind, entry.id);
    const fields = draftConflicts(entry, current);
    if (entry.kind === "product" && !entry.remove) {
      for (const field of ["code", "barcode"]) {
        const value = entry.patch[field];
        if (
          value &&
          catalog.products.some(
            (p) =>
              p.id !== entry.id &&
              String(p[field as "code" | "barcode"] || "").toUpperCase() ===
                String(value).toUpperCase(),
          )
        )
          fields.push(field);
      }
    }
    if (fields.length) {
      conflicts.push({
        key: entry.key,
        label: String(
          current?.code ||
            current?.name ||
            entry.patch.name ||
            (entry.kind === "settings" ? "Réglages du magasin" : entry.id),
        ),
        fields: [...new Set(fields)],
        can_keep:
          !!entry.base &&
          !!current &&
          !fields.includes("code") &&
          !fields.includes("barcode"),
        removing: !!entry.remove,
      });
      conflictRecords.set(entry.key, current);
    }
  }
}
export async function resolveAdminDraftConflict(
  key: string,
  keepLocal: boolean,
) {
  requireReady();
  const conflict = conflicts.find((item) => item.key === key);
  if (!conflict || (keepLocal && !conflict.can_keep))
    throw new Error(
      "Cette modification doit être corrigée dans son formulaire ou remplacée par la version du site.",
    );
  await workspace.resolve(
    key,
    conflictRecords.get(key) || null,
    conflict.fields,
    keepLocal,
  );
  conflicts = conflicts.filter((item) => item.key !== key);
  conflictRecords.delete(key);
  lastError = "";
  emit();
}

export async function synchronizeAdminDraft() {
  requireReady();
  if (!workspace.state.entries.length) return;
  syncing = true;
  lastError = "";
  conflicts = [];
  conflictRecords.clear();
  emit();
  try {
    const access = await remoteLocalCall<{ admin: boolean }>(
      "catalog?sync=1&access=1",
    );
    if (!access.admin) {
      deactivateAdminDraft();
      throw new Error(
        "Reconnectez-vous comme administrateur pour synchroniser. Vos modifications locales sont conservées.",
      );
    }
    // Only files referenced by saved local changes are uploaded. Persist every URL
    // before proceeding, so retries never repeat an acknowledged media upload.
    for (const item of referencedMedia()) {
      if (!item.uploaded_url) {
        const uploaded = {
          ...item,
          uploaded_url: await remoteLocalUpload(item.blob, true, item.id),
        };
        await workspace.storage.putMedia(uploaded);
        media.set(item.id, uploaded);
      }
    }
    const snapshot = await remoteLocalCall<{
      admin: boolean;
      catalog: Catalog;
    }>("catalog?sync=1");
    if (!snapshot.admin || !snapshot.catalog) {
      deactivateAdminDraft();
      throw new Error(
        "La session de gestion a expiré. Reconnectez-vous pour synchroniser.",
      );
    }
    baseCatalog = structuredClone(snapshot.catalog);
    findConflicts(snapshot.catalog);
    if (conflicts.length)
      throw new Error(
        "Des informations ont changé en ligne. Choisissez ci-dessous la version à conserver ; les autres modifications locales restent sauvegardées.",
      );
    const entries = structuredClone(workspace.state.entries);
    const operations: any[] = [];
    for (const saved of entries) {
      const entry = resolvedEntry(saved);
      const current = draftEntity(snapshot.catalog, entry.kind, entry.id);
      const conflicts = draftConflicts(entry, current);
      if (conflicts.length)
        throw new Error(
          `Une modification en ligne concerne ${current?.code || current?.name || (entry.kind === "settings" ? "les réglages" : entry.id)} : ${conflicts.join(", ")}. La sauvegarde locale est conservée.`,
        );
      if (entry.remove) {
        if (current)
          operations.push({
            entity: entry.kind,
            id: entry.id,
            changes: {},
            expected: entry.base,
            remove: true,
          });
      } else if (!entry.base) {
        if (!current)
          operations.push({
            entity: entry.kind,
            id: entry.id,
            changes: entry.patch,
            expected: null,
            create: true,
          });
      } else {
        const changes = Object.fromEntries(
          Object.entries(entry.patch).filter(
            ([field, value]) => !draftEqual(current?.[field], value),
          ),
        );
        if (Object.keys(changes).length)
          operations.push({
            entity: entry.kind,
            id: entry.id,
            changes,
            expected: Object.fromEntries(
              Object.keys(changes).map((field) => [field, entry.base![field]]),
            ),
          });
      }
    }
    operations.sort(
      (a, b) =>
        (a.remove
          ? 3
          : a.entity === "family"
            ? 0
            : a.entity === "product"
              ? 1
              : 2) -
        (b.remove
          ? 3
          : b.entity === "family"
            ? 0
            : b.entity === "product"
              ? 1
              : 2),
    );
    if (operations.length)
      await remoteLocalCall("admin-draft-sync", { operations });
    await workspace.acknowledgeAll(entries);
    forceRemote = true;
    emit();
  } catch (error) {
    if ((error as Error & { status?: number }).status === 409 && active) {
      try {
        const fresh = await remoteLocalCall<{
          admin: boolean;
          catalog: Catalog;
        }>("catalog?sync=1");
        if (fresh.admin && fresh.catalog) {
          baseCatalog = fresh.catalog;
          findConflicts(fresh.catalog);
        } else deactivateAdminDraft();
      } catch {
        /* A network error never discards the durable local workspace. */
      }
    }
    lastError = (error as Error).message;
    throw error;
  } finally {
    syncing = false;
    emit();
  }
}
