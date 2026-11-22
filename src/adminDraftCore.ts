import type { Catalog } from "./types";

export type DraftKind = "product" | "family" | "settings";
export interface DraftEntry {
  key: string;
  kind: DraftKind;
  id: string;
  base: Record<string, unknown> | null;
  patch: Record<string, unknown>;
  remove?: boolean;
  target?: string | null;
  version: number;
}
export interface DraftState {
  schema: 1;
  revision?: number;
  entries: DraftEntry[];
  saved_at: string;
}
export interface DraftMedia {
  id: string;
  blob: Blob;
  uploaded_url?: string;
}
export interface DraftStorage {
  read(): Promise<DraftState | null>;
  write(value: DraftState, expectedRevision?: number): Promise<void>;
  media(): Promise<DraftMedia[]>;
  putMedia(value: DraftMedia): Promise<void>;
  removeMedia(id: string): Promise<void>;
}
export const productDraftFields = [
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
  "pallet_enabled",
  "pallet_cartons",
  "pack_size",
  "pack_label",
  "unit_price_cents",
  "price_on_request",
  "available",
  "availability_confirmed",
  "visible",
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
] as const;
export const familyDraftFields = [
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
] as const;
export const settingsDraftFields = [
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
] as const;
export const draftFields = (kind: DraftKind): readonly string[] =>
  kind === "product"
    ? productDraftFields
    : kind === "family"
      ? familyDraftFields
      : settingsDraftFields;
export const normalized = (v: unknown): unknown => (v === undefined ? null : v);
const comparable = (value: any): any =>
  Array.isArray(value)
    ? value.map(comparable)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, comparable(value[key])]),
        )
      : normalized(value);
export const draftEqual = (a: unknown, b: unknown) =>
  JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
export const mediaToken = (id: string) => "/api/local/file?id=" + id;
export function mapDraftStrings(
  value: unknown,
  mapper: (value: string) => string,
): any {
  if (typeof value === "string") return mapper(value);
  if (Array.isArray(value))
    return value.map((item) => mapDraftStrings(item, mapper));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        mapDraftStrings(item, mapper),
      ]),
    );
  return value;
}
export function draftEntity(
  catalog: Catalog,
  kind: DraftKind,
  id: string,
): Record<string, unknown> | null {
  const entity =
    kind === "settings"
      ? catalog.settings
      : (kind === "product" ? catalog.products : catalog.families).find(
          (p) => p.id === id,
        );
  return entity ? (entity as unknown as Record<string, unknown>) : null;
}
export function draftConflicts(
  entry: DraftEntry,
  current: Record<string, unknown> | null,
): string[] {
  if (!entry.base)
    return current &&
      !Object.entries(entry.patch).every(([key, value]) =>
        draftEqual(current[key], value),
      )
      ? ["identifiant déjà utilisé"]
      : [];
  if (!current) return entry.remove ? [] : ["produit ou collection supprimé"];
  if (entry.remove)
    return draftEqual(entry.base, current)
      ? []
      : ["version à supprimer modifiée en ligne"];
  return Object.entries(entry.base)
    .filter(
      ([key, value]) =>
        !draftEqual(current[key], value) &&
        (entry.remove || !draftEqual(current[key], entry.patch[key])),
    )
    .map(([key]) => key);
}

/** No credentials, customers or orders can enter this allowlisted workspace. */
export class DraftWorkspace {
  state: DraftState = { schema: 1, entries: [], saved_at: "" };
  readonly storage: DraftStorage;
  private mutations: Promise<void> = Promise.resolve();
  constructor(storage: DraftStorage) {
    this.storage = storage;
  }
  private schedule(task: () => Promise<void>) {
    const result = this.mutations.then(task);
    this.mutations = result.catch(() => {});
    return result;
  }
  load() {
    return this.schedule(() => this.loadNow());
  }
  private async loadNow() {
    const stored = await this.storage.read();
    if (stored && stored.schema === 1 && Array.isArray(stored.entries)) {
      this.state = structuredClone(stored);
      // Validate saved records too; unknown persisted payloads are never synchronized.
      for (const entry of this.state.entries) {
        if (
          !["product", "family", "settings"].includes(entry.kind) ||
          !entry.id ||
          Object.keys(entry.patch).some(
            (field) => !draftFields(entry.kind).includes(field),
          )
        )
          throw new Error("La sauvegarde locale est invalide.");
      }
    }
  }
  private async persist(next: DraftState) {
    next.saved_at = new Date().toISOString();
    const revision = this.state.revision || 0;
    next.revision = revision + 1;
    await this.storage.write(next, revision);
    this.state = next;
  }
  stage(
    catalog: Catalog,
    kind: DraftKind,
    id: string,
    desired: Record<string, unknown>,
    fields?: readonly string[],
  ) {
    const snapshot = structuredClone(desired),
      visible = draftEntity(this.overlay(catalog), kind, id);
    const selected =
      fields ||
      draftFields(kind).filter(
        (field) =>
          Object.hasOwn(snapshot, field) &&
          (!visible || !draftEqual(snapshot[field], visible[field])),
      );
    return this.schedule(() =>
      this.stageNow(catalog, kind, id, snapshot, selected),
    );
  }
  private async stageNow(
    catalog: Catalog,
    kind: DraftKind,
    id: string,
    desired: Record<string, unknown>,
    fields?: readonly string[],
  ) {
    if (!id) throw new Error("Identifiant de brouillon absent.");
    const next = structuredClone(this.state),
      key = kind + ":" + id;
    const current = draftEntity(catalog, kind, id);
    let entry = next.entries.find((item) => item.key === key);
    if (!entry) {
      entry = {
        key,
        kind,
        id,
        base: current ? {} : null,
        patch: {},
        version: 0,
      };
      next.entries.push(entry);
    }
    const allowed = draftFields(kind);
    const selected = fields || allowed;
    if (selected.some((field) => !allowed.includes(field)))
      throw new Error("Champ non autorisé dans la sauvegarde locale.");
    for (const field of selected) {
      if (!Object.hasOwn(desired, field)) continue;
      const value = normalized(desired[field]);
      if (entry.base && !Object.hasOwn(entry.base, field))
        entry.base[field] = normalized(current?.[field]);
      if (entry.base && draftEqual(value, entry.base[field])) {
        delete entry.patch[field];
        delete entry.base[field];
      } else entry.patch[field] = structuredClone(value);
    }
    entry.remove = false;
    entry.version++;
    if (!Object.keys(entry.patch).length)
      next.entries = next.entries.filter((item) => item.key !== key);
    await this.persist(next);
  }
  remove(
    catalog: Catalog,
    kind: "product" | "family",
    id: string,
    target?: string | null,
  ) {
    return this.schedule(() => this.removeNow(catalog, kind, id, target));
  }
  private async removeNow(
    catalog: Catalog,
    kind: "product" | "family",
    id: string,
    target?: string | null,
  ) {
    const next = structuredClone(this.state),
      key = kind + ":" + id;
    const current = draftEntity(catalog, kind, id);
    const previous = next.entries.find((item) => item.key === key);
    next.entries = next.entries.filter((item) => item.key !== key);
    if (current) {
      const base = structuredClone(current);
      next.entries.push({
        key,
        kind,
        id,
        base,
        patch: {},
        remove: true,
        target,
        version: (previous?.version || 0) + 1,
      });
    }
    await this.persist(next);
  }
  batch(
    catalog: Catalog,
    saves: {
      kind: DraftKind;
      id: string;
      value: Record<string, unknown>;
      fields?: readonly string[];
    }[],
    removals: {
      kind: "product" | "family";
      id: string;
      target?: string | null;
    }[] = [],
  ) {
    return this.schedule(async () => {
      // Build the complete family move/reorder in memory, then commit it once.
      const shadow = new DraftWorkspace({
        ...this.storage,
        write: async () => {},
      });
      shadow.state = structuredClone(this.state);
      for (const save of saves)
        await shadow.stageNow(
          catalog,
          save.kind,
          save.id,
          save.value,
          save.fields,
        );
      for (const removal of removals)
        await shadow.removeNow(
          catalog,
          removal.kind,
          removal.id,
          removal.target,
        );
      await this.persist(shadow.state);
    });
  }
  overlay(catalog: Catalog): Catalog {
    const next = structuredClone(catalog);
    for (const entry of this.state.entries) {
      if (entry.kind === "settings") {
        next.settings = {
          ...next.settings,
          ...structuredClone(entry.patch),
        } as Catalog["settings"];
        continue;
      }
      const list = entry.kind === "product" ? next.products : next.families;
      const index = list.findIndex((p) => p.id === entry.id);
      if (entry.remove) {
        if (index >= 0) list.splice(index, 1);
      } else if (index >= 0)
        list[index] = {
          ...list[index],
          ...structuredClone(entry.patch),
        } as any;
      else list.push({ id: entry.id, ...structuredClone(entry.patch) } as any);
    }
    return next;
  }
  acknowledge(key: string, version: number) {
    return this.schedule(() => this.acknowledgeNow(key, version));
  }
  private async acknowledgeNow(key: string, version: number) {
    const next = structuredClone(this.state);
    next.entries = next.entries.filter(
      (entry) => entry.key !== key || entry.version !== version,
    );
    await this.persist(next);
  }
  acknowledgeAll(entries: Pick<DraftEntry, "key" | "version">[]) {
    return this.schedule(() => this.acknowledgeAllNow(entries));
  }
  private async acknowledgeAllNow(
    entries: Pick<DraftEntry, "key" | "version">[],
  ) {
    const acknowledged = new Map(
      entries.map((entry) => [entry.key, entry.version]),
    );
    const next = structuredClone(this.state);
    next.entries = next.entries.filter(
      (entry) => acknowledged.get(entry.key) !== entry.version,
    );
    await this.persist(next);
  }
  resolve(
    key: string,
    current: Record<string, unknown> | null,
    fields: string[],
    keepLocal: boolean,
  ) {
    return this.schedule(() =>
      this.resolveNow(key, current, fields, keepLocal),
    );
  }
  private async resolveNow(
    key: string,
    current: Record<string, unknown> | null,
    fields: string[],
    keepLocal: boolean,
  ) {
    const next = structuredClone(this.state),
      entry = next.entries.find((item) => item.key === key);
    if (!entry) return;
    if (entry.remove) {
      if (keepLocal && current) entry.base = structuredClone(current);
      else next.entries = next.entries.filter((item) => item.key !== key);
    } else if (!entry.base || !current) {
      if (keepLocal)
        throw new Error(
          "Cet ajout ou ce produit ne peut pas remplacer un autre identifiant. Utilisez la version du site.",
        );
      next.entries = next.entries.filter((item) => item.key !== key);
    } else {
      for (const field of fields) {
        if (keepLocal && !draftEqual(current[field], entry.patch[field]))
          entry.base[field] = normalized(current[field]);
        else {
          delete entry.base[field];
          delete entry.patch[field];
        }
      }
      if (!Object.keys(entry.patch).length)
        next.entries = next.entries.filter((item) => item.key !== key);
    }
    entry.version++;
    await this.persist(next);
  }
}

/** IndexedDB transaction completion, not request success, confirms durability. */
export function indexedDraftStorage(): DraftStorage {
  let pending: Promise<IDBDatabase> | undefined;
  const database = () =>
    (pending ||= new Promise((resolve, reject) => {
      if (!globalThis.indexedDB)
        return reject(
          new Error(
            "Le navigateur ne permet pas la sauvegarde locale. Aucun changement n’a été envoyé.",
          ),
        );
      const request = indexedDB.open("uniplast-admin-drafts-v1", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("workspace"))
          db.createObjectStore("workspace");
        if (!db.objectStoreNames.contains("media"))
          db.createObjectStore("media", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          new Error(
            "Impossible d’ouvrir la sauvegarde locale. Aucun changement n’a été envoyé.",
          ),
        );
    }));
  const run = async <T>(
    name: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(name, mode),
        request = operation(transaction.objectStore(name));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () =>
        reject(
          new Error(
            "La sauvegarde locale a échoué. Vérifiez l’espace disponible sur cet appareil.",
          ),
        );
    });
  };
  return {
    read: () => run("workspace", "readonly", (s) => s.get("state")),
    write: async (value, expectedRevision = 0) => {
      const db = await database();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("workspace", "readwrite"),
          store = transaction.objectStore("workspace");
        let failure: Error | undefined;
        const previous = store.get("state");
        previous.onsuccess = () => {
          if ((previous.result?.revision || 0) !== expectedRevision) {
            failure = Object.assign(
              new Error(
                "Un autre onglet a enregistré des modifications. Rechargez cette page avant de continuer. Ce formulaire n’a pas été enregistré.",
              ),
              { code: "DRAFT_STALE_TAB" },
            );
            transaction.abort();
          } else store.put(value, "state");
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () =>
          reject(
            failure ||
              new Error(
                "La sauvegarde locale a échoué. Vérifiez l’espace disponible sur cet appareil.",
              ),
          );
      });
    },
    media: () => run("media", "readonly", (s) => s.getAll()),
    putMedia: async (v) => {
      await run("media", "readwrite", (s) => s.put(v));
    },
    removeMedia: async (id) => {
      await run("media", "readwrite", (s) => s.delete(id));
    },
  };
}
