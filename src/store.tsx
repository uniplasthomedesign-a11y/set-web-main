import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CartItem, Catalog, Product, Order } from "./types";
import { assertQuantity, canBuy } from "./domain";
import * as api from "./api";
import {
  activateAdminDraft,
  adminDraftActive,
  adminDraftCatalog,
  consumeDraftRemoteRefresh,
  completeDraftRemoteRefresh,
  deactivateAdminDraft,
  subscribeAdminDraft,
} from "./adminDraft";
import { FAVORITES_KEY, parseFavoriteIds, toggleFavoriteId } from "./favorites";
import {
  canReuseCatalogCache,
  loadCachedCatalog,
  saveCachedCatalog,
  type CachedCatalog,
} from "./catalogCache";

function readFavorites() {
  try {
    return parseFavoriteIds(localStorage.getItem(FAVORITES_KEY));
  } catch {
    return [];
  }
}

const CART_KEY = "uniplast.cart.v1";
function readCart(): { items: CartItem[]; key: string } {
  try {
    const v = JSON.parse(localStorage.getItem(CART_KEY) || "null");
    if (v && Array.isArray(v.items) && typeof v.key === "string")
      return {
        items: v.items
          .filter(
            (i: CartItem) =>
              typeof i.product_id === "string" &&
              Number.isInteger(i.cartons) &&
              i.cartons > 0 &&
              i.cartons <= 10000,
          )
          .slice(0, 100),
        key: v.key,
      };
  } catch {}
  return { items: [], key: crypto.randomUUID() };
}
type Toast = { message: string; error: boolean } | null;
interface Store {
  catalog: Catalog | null;
  error: string;
  loading: boolean;
  refresh: (strict?: boolean) => Promise<void>;
  clearAccessView: () => void;
  clientLoginRequired: boolean;
  dismissClientLogin: () => void;
  now: number;
  cart: CartItem[];
  checkoutKey: string;
  addCart: (p: Product, n: number) => void;
  setQuantity: (id: string, n: number) => void;
  removeCart: (id: string) => void;
  emptyCart: () => void;
  repeatOrder: (order: Order) => void;
  admin: boolean;
  clientApproved: boolean;
  favoriteIds: string[];
  toggleFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;
  quickProductId: string | null;
  openProduct: (id: string) => void;
  closeProduct: () => void;
  checkAdmin: () => Promise<void>;
  toast: Toast;
  notify: (s: string, error?: boolean) => void;
  quantityProduct: Product | null;
  openQuantity: (p: Product) => void;
  closeQuantity: () => void;
  added: Product | null;
  dismissAdded: () => void;
}
const Context = createContext<Store | null>(null);
export const StoreContext = Context;
export const navigate = (path: string) => {
  window.location.hash = path;
};
export function useRoute() {
  const [route, setRoute] = useState(window.location.hash.slice(1) || "/");
  useEffect(() => {
    const fn = () => {
      setRoute(window.location.hash.slice(1) || "/");
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  return route;
}
export function StoreProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [now, setNow] = useState(Date.now());
  const [basket, setBasket] = useState(readCart),
    [admin, setAdmin] = useState(false),
    [toast, setToast] = useState<Toast>(null);
  const [quantityProduct, setQuantityProduct] = useState<Product | null>(null),
    [added, setAdded] = useState<Product | null>(null),
    toastTimer = useRef<number | undefined>(undefined);
  const [clientApproved, setClientApproved] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<string[]>(readFavorites);
  const toggleFavorite = useCallback((id: string) => {
    setFavoriteIds((ids) => toggleFavoriteId(ids, id));
  }, []);
  const isFavorite = useCallback(
    (id: string) => favoriteIds.includes(id),
    [favoriteIds],
  );
  const [quickProductId, setQuickProductId] = useState<string | null>(null);
  const loadSequence = useRef(0);
  const catalogRevision = useRef<string | undefined>(undefined);
  const currentCatalog = useRef<Catalog | null>(null);
  const cachedCatalog = useRef<CachedCatalog | null | undefined>(undefined);
  const manualRefreshes = useRef(0);
  const checkingAccess = useRef(false);
  const verifiedAdmin = useRef(false);
  const [clientLoginRequired, setClientLoginRequired] = useState(false);
  const notify = useCallback((message: string, error = false) => {
    setToast({ message, error });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 6500);
  }, []);
  const applyCatalogUpdate = useCallback((update: api.CatalogUpdate) => {
    const next = update.catalog || currentCatalog.current;
    if (!next) throw new Error("Le catalogue doit être chargé à nouveau.");
    currentCatalog.current = next;
    setCatalog(next);
    catalogRevision.current = update.revision;
    setClientApproved(update.client_approved);
    if (update.admin !== undefined) {
      verifiedAdmin.current = update.admin;
      setAdmin(update.admin);
      if (update.admin) void activateAdminDraft(next);
      else deactivateAdminDraft(false);
    }
    if (next.products.some((p) => p.price_hidden)) {
      setQuantityProduct(null);
      setAdded(null);
    }
    if (!update.admin && update.revision && update.price_access !== undefined) {
      const snapshot: CachedCatalog = {
        schema: 1,
        revision: update.revision,
        catalog: next,
        client_approved: update.client_approved,
        price_access: update.price_access,
      };
      cachedCatalog.current = snapshot;
      saveCachedCatalog(snapshot);
    } else {
      cachedCatalog.current = null;
      saveCachedCatalog(null);
    }
    setClientLoginRequired(false);
    setError("");
  }, []);
  const clearAccessView = useCallback(() => {
    deactivateAdminDraft(false);
    verifiedAdmin.current = false;
    ++loadSequence.current;
    currentCatalog.current = null;
    catalogRevision.current = undefined;
    cachedCatalog.current = null;
    saveCachedCatalog(null);
    setCatalog(null);
    setClientApproved(false);
    setAdmin(false);
    setQuantityProduct(null);
    setAdded(null);
    setClientLoginRequired(false);
    setLoading(true);
  }, []);
  const refresh = useCallback(
    async (strict = false) => {
      const remote = consumeDraftRemoteRefresh();
      if (adminDraftActive() && !remote) {
        const view = adminDraftCatalog();
        if (view) {
          setCatalog(view);
          setError("");
        }
        return;
      }
      const sequence = ++loadSequence.current;
      manualRefreshes.current++;
      try {
        const update = await api.loadCatalogUpdate(
          remote ? undefined : catalogRevision.current,
        );
        if (sequence !== loadSequence.current) return;
        applyCatalogUpdate(update);
        if (remote) completeDraftRemoteRefresh();
      } catch (e) {
        if (sequence !== loadSequence.current) return;
        setError((e as Error).message);
        if (strict) throw e;
      } finally {
        manualRefreshes.current--;
        if (sequence === loadSequence.current) {
          setLoading(false);
        }
      }
    },
    [applyCatalogUpdate],
  );
  const checkForUpdates = useCallback(async () => {
    if (manualRefreshes.current || checkingAccess.current) return;
    checkingAccess.current = true;
    const sequence = ++loadSequence.current;
    try {
      if (adminDraftActive()) {
        // A focus/resume checks access only. Catalogue editing and its Save buttons
        // keep using this device until the explicit synchronization action.
        const access = await api.loadCatalogUpdate(undefined, true);
        if (sequence !== loadSequence.current) return;
        if (access.admin) return;
        deactivateAdminDraft(false);
        verifiedAdmin.current = false;
        currentCatalog.current = null;
        catalogRevision.current = undefined;
        setCatalog(null);
        setAdmin(false);
        const publicUpdate = await api.loadCatalogUpdate();
        if (sequence !== loadSequence.current) return;
        applyCatalogUpdate(publicUpdate);
        return;
      }
      if (cachedCatalog.current === undefined)
        cachedCatalog.current = api.localMode ? loadCachedCatalog() : null;
      const snapshot = cachedCatalog.current;
      if (snapshot) {
        const probe = await api.loadCatalogUpdate(snapshot.revision, true);
        if (sequence !== loadSequence.current) return;
        // Cached prices are never displayed before this fresh access check.
        if (canReuseCatalogCache(snapshot, probe)) {
          currentCatalog.current = snapshot.catalog;
          catalogRevision.current = snapshot.revision;
          setCatalog(snapshot.catalog);
          setClientApproved(probe.client_approved);
          setAdmin(false);
          // Keep the saved catalogue until the customer's next successful login.
          // The probe verifies access only; it does not download changed products.
          setError("");
          return;
        }
        // A revoked client, hidden prices or an administrator must get a fresh view.
        currentCatalog.current = null;
        catalogRevision.current = undefined;
        cachedCatalog.current = null;
        saveCachedCatalog(null);
        setCatalog(null);
        setLoading(true);
        const loginRequired =
          snapshot.client_approved && !probe.client_approved && !probe.admin;
        const update = probe.catalog ? probe : await api.loadCatalogUpdate();
        if (sequence !== loadSequence.current) return;
        applyCatalogUpdate(update);
        if (loginRequired) setClientLoginRequired(true);
      } else {
        const update = await api.loadCatalogUpdate(catalogRevision.current);
        if (sequence !== loadSequence.current) return;
        applyCatalogUpdate(update);
      }
    } catch (e) {
      if (sequence === loadSequence.current && !adminDraftActive())
        setError((e as Error).message);
    } finally {
      checkingAccess.current = false;
      if (sequence === loadSequence.current) {
        setLoading(false);
      }
    }
  }, [applyCatalogUpdate]);
  const checkAdmin = useCallback(async () => {
    const allowed = await api.isAdmin();
    if (!allowed) {
      deactivateAdminDraft(false);
      verifiedAdmin.current = false;
    }
    setAdmin(allowed);
  }, []);
  useEffect(
    () =>
      subscribeAdminDraft(() => {
        const view = adminDraftCatalog();
        if (view && verifiedAdmin.current) setCatalog(view);
        else if (!adminDraftActive() && verifiedAdmin.current)
          clearAccessView();
      }),
    [clearAccessView],
  );
  useEffect(() => {
    void checkForUpdates();
    if (!api.localMode) void checkAdmin();
    const stop = api.watchCatalog(checkForUpdates);
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    const { data: auth } = api.supabase?.auth.onAuthStateChange(
      (event, session) => {
        void window.setTimeout(() => {
          void checkAdmin();
          if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
            currentCatalog.current = null;
            catalogRevision.current = undefined;
            cachedCatalog.current = null;
            saveCachedCatalog(null);
            setCatalog(null);
            setLoading(true);
          }
          void refresh();
        }, 0);
        if (event === "PASSWORD_RECOVERY") navigate("/nouveau-mot-de-passe");
        if (
          (event === "SIGNED_IN" || event === "INITIAL_SESSION") &&
          session &&
          new URLSearchParams(window.location.search).get("setup") ===
            "password"
        ) {
          const location = new URL(window.location.href);
          location.searchParams.delete("setup");
          window.history.replaceState(
            null,
            "",
            location.pathname + location.search + location.hash,
          );
          navigate("/nouveau-mot-de-passe");
        }
      },
    ) || { data: { subscription: null } };
    return () => {
      stop();
      window.clearInterval(t);
      auth.subscription?.unsubscribe();
    };
  }, [refresh, checkAdmin, checkForUpdates]);
  useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(basket));
    } catch {
      notify(
        "Le navigateur empêche la sauvegarde du panier. Il reste disponible pour cette session.",
        true,
      );
    }
  }, [basket, notify]);
  useEffect(() => {
    try {
      // Only product identifiers are saved: prices and catalogue details stay live.
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteIds));
    } catch {
      notify(
        "Les favoris restent disponibles pour cette visite. Le navigateur empêche leur sauvegarde sur cet appareil.",
        true,
      );
    }
  }, [favoriteIds, notify]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === FAVORITES_KEY)
        setFavoriteIds(parseFavoriteIds(event.newValue));
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  useEffect(() => {
    if (catalog) {
      document.documentElement.style.setProperty(
        "--blue",
        catalog.settings.primary_color,
      );
      document.documentElement.style.setProperty(
        "--yellow",
        catalog.settings.accent_color,
      );
    }
  }, [catalog?.settings.primary_color, catalog?.settings.accent_color]);
  const update = (items: CartItem[]) =>
    setBasket({ items, key: crypto.randomUUID() });
  const addCart = (p: Product, n: number) => {
    if (!canBuy(p)) {
      notify(
        "La disponibilité et le tarif doivent être confirmés avant la commande.",
        true,
      );
      return;
    }
    try {
      const total =
        n + (basket.items.find((i) => i.product_id === p.id)?.cartons || 0);
      assertQuantity(total, p);
      const items = basket.items.filter((i) => i.product_id !== p.id);
      items.push({ product_id: p.id, cartons: total });
      update(items);
      setQuantityProduct(null);
      setAdded(p);
    } catch (e) {
      notify((e as Error).message, true);
    }
  };
  const setQuantity = (id: string, n: number) => {
    try {
      assertQuantity(n);
      update(
        basket.items.map((i) =>
          i.product_id === id ? { ...i, cartons: n } : i,
        ),
      );
    } catch (e) {
      notify((e as Error).message, true);
    }
  };
  return (
    <Context.Provider
      value={{
        catalog,
        error,
        loading,
        refresh,
        clearAccessView,
        clientLoginRequired,
        dismissClientLogin: () => setClientLoginRequired(false),
        now,
        cart: basket.items,
        checkoutKey: basket.key,
        addCart,
        setQuantity,
        removeCart: (id) =>
          update(basket.items.filter((i) => i.product_id !== id)),
        emptyCart: () => update([]),
        repeatOrder: (order) => {
          const items: CartItem[] = [];
          for (const line of order.items) {
            const p = catalog?.products.find((p) => p.id === line.product_id);
            if (
              p &&
              canBuy(p) &&
              catalog?.families.some((f) => f.id === p.family_id && f.visible)
            )
              items.push({
                product_id: p.id,
                cartons: Math.min(
                  line.cartons,
                  p.stock_cartons ?? line.cartons,
                ),
              });
          }
          if (!items.length) {
            notify(
              "Aucun produit de ce bon ne peut être commandé actuellement. Vérifiez l’accès aux tarifs et la disponibilité.",
              true,
            );
            return;
          }
          update(items);
          notify(
            "Sélection reprise dans le panier. Vérifiez les prix, le colisage et les quantités actuels. Les produits indisponibles sont exclus.",
          );
          navigate("/panier");
        },
        admin,
        clientApproved,
        favoriteIds,
        toggleFavorite,
        isFavorite,
        quickProductId,
        openProduct: setQuickProductId,
        closeProduct: () => setQuickProductId(null),
        checkAdmin,
        toast,
        notify,
        quantityProduct: quantityProduct
          ? (catalog?.products.find((p) => p.id === quantityProduct.id) ?? null)
          : null,
        openQuantity: setQuantityProduct,
        closeQuantity: () => setQuantityProduct(null),
        added: added
          ? (catalog?.products.find((p) => p.id === added.id) ?? null)
          : null,
        dismissAdded: () => setAdded(null),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useStore() {
  const s = useContext(Context);
  if (!s) throw new Error("Store context missing");
  return s;
}
