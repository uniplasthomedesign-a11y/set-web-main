import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { ProductImage } from "./types";
import { normalizeSearch } from "./domain";
import { Modal, Spinner } from "./ui";
import "./product-photo-library.css";

const prefix = "/assets/products/photos-2026-11-08/";
interface LibraryImage {
  id: string;
  name: string;
  family: string;
  url: string;
  bytes: number;
  width: number;
  height: number;
  matched_codes: string[];
}
function safePhotoUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith(prefix)) return false;
  try {
    const url = new URL(value, window.location.origin);
    const decoded = decodeURIComponent(url.pathname);
    return (
      url.origin === window.location.origin &&
      !url.search &&
      !url.hash &&
      decoded.startsWith(prefix) &&
      !/[\\\u0000-\u001f]/.test(decoded) &&
      !decoded.split("/").some((part) => part === "." || part === "..") &&
      /\.(?:webp|png|jpe?g)$/i.test(decoded)
    );
  } catch {
    return false;
  }
}
function readLibrary(value: unknown): LibraryImage[] {
  if (!value || typeof value !== "object")
    throw Error("Bibliothèque invalide.");
  const manifest = value as { version?: unknown; images?: unknown };
  if (
    typeof manifest.version !== "string" ||
    !manifest.version ||
    !Array.isArray(manifest.images) ||
    manifest.images.length > 5000
  )
    throw Error("Bibliothèque invalide.");
  const seen = new Set<string>();
  return manifest.images.map((value: unknown) => {
    if (!value || typeof value !== "object") throw Error("Photo invalide.");
    const photo = value as LibraryImage;
    if (
      ![photo.id, photo.name, photo.family].every(
        (field) =>
          typeof field === "string" && field.trim() && field.length <= 500,
      ) ||
      !safePhotoUrl(photo.url) ||
      ![photo.bytes, photo.width, photo.height].every(
        (field) => Number.isSafeInteger(field) && field > 0,
      ) ||
      !Array.isArray(photo.matched_codes) ||
      photo.matched_codes.some(
        (code) => typeof code !== "string" || code.length > 100,
      ) ||
      seen.has(photo.url)
    )
      throw Error("Une photo de la bibliothèque est invalide.");
    seen.add(photo.url);
    return photo;
  });
}

export function ProductPhotoLibrary({
  onSelect,
  onClose,
  maxPhotos,
  existingUrls = [],
}: {
  onSelect: (images: ProductImage[]) => void;
  onClose: () => void;
  maxPhotos: number;
  existingUrls?: string[];
}) {
  const [images, setImages] = useState<LibraryImage[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0),
    [query, setQuery] = useState(""),
    [family, setFamily] = useState("");
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState<string[]>([]);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    grid.current?.scrollTo({ top: 0 });
  }, [page, query, family]);
  const limit = Number.isFinite(maxPhotos)
    ? Math.max(0, Math.min(10, Math.floor(maxPhotos)))
    : 0;
  const existingKey = JSON.stringify(existingUrls);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void fetch(prefix + "library.json", {
      cache: "force-cache",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw Error("Bibliothèque indisponible.");
        const list = readLibrary(await response.json());
        if (!controller.signal.aborted) setImages(list);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "Impossible de charger les photos intégrées. Réessayez dans un instant.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    const excluded = new Set<string>(JSON.parse(existingKey));
    setSelected((current) =>
      current.filter((url) => !excluded.has(url)).slice(0, limit),
    );
  }, [existingKey, limit]);
  const excluded = new Set(existingUrls);
  const available = images.filter((image) => !excluded.has(image.url));
  const families = [...new Set(images.map((image) => image.family))].sort(
    (a, b) => a.localeCompare(b, "fr", { numeric: true }),
  );
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const filtered = available.filter(
    (image) =>
      (!family || image.family === family) &&
      words.every((word) =>
        normalizeSearch(
          [image.name, image.family, ...image.matched_codes].join(" "),
        ).includes(word),
      ),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 24)),
    currentPage = Math.min(page, pages);
  const byUrl = new Map(available.map((image) => [image.url, image]));
  const selection = selected.filter((url) => byUrl.has(url)).slice(0, limit);
  const toggle = (url: string) =>
    setSelected((current) =>
      current.includes(url)
        ? current.filter((value) => value !== url)
        : current.length < limit
          ? [...current, url]
          : current,
    );
  return (
    <Modal
      title="Photos intégrées"
      onClose={onClose}
      wide
      className="product-photo-library"
    >
      <p className="photo-library-intro">
        Utilisez ces photos sans téléverser de nouveau fichier.
      </p>
      <div className="photo-library-filters">
        <label>
          <span>Nom, référence ou famille</span>
          <div className="photo-library-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Rechercher une photo…"
            />
          </div>
        </label>
        <label>
          <span>Famille</span>
          <select
            value={family}
            onChange={(event) => {
              setFamily(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Toutes les familles</option>
            {families.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="photo-library-summary">
        <span>
          {filtered.length} photo{filtered.length > 1 ? "s" : ""}
        </span>
        <span role="status" aria-live="polite">
          {selection.length} / {limit} sélectionnée
          {selection.length > 1 ? "s" : ""}
        </span>
      </div>
      {loading ? (
        <div className="photo-library-state" role="status">
          <Spinner /> Chargement des photos…
        </div>
      ) : error ? (
        <div className="photo-library-state" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Réessayer
          </button>
        </div>
      ) : !filtered.length ? (
        <div className="photo-library-state">
          <p>
            {!available.length && images.length
              ? "Toutes ces photos sont déjà associées au produit."
              : "Aucune photo pour ces filtres."}
          </p>
          {(query || family) && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setQuery("");
                setFamily("");
                setPage(1);
              }}
            >
              Effacer les filtres
            </button>
          )}
        </div>
      ) : (
        <div className="photo-library-grid" ref={grid}>
          {filtered
            .slice((currentPage - 1) * 24, currentPage * 24)
            .map((image) => {
              const checked = selection.includes(image.url);
              return (
                <button
                  type="button"
                  key={image.url}
                  className={
                    "photo-library-item " + (checked ? "is-selected" : "")
                  }
                  aria-pressed={checked}
                  aria-label={`${checked ? "Désélectionner" : "Sélectionner"} ${image.name}`}
                  disabled={!checked && selection.length >= limit}
                  onClick={() => toggle(image.url)}
                  title={image.name}
                >
                  <span className="photo-library-picture">
                    <img
                      src={image.url}
                      alt={image.name}
                      loading="lazy"
                      decoding="async"
                      onError={(event) => {
                        event.currentTarget.style.visibility = "hidden";
                        event.currentTarget.parentElement?.classList.add(
                          "unavailable",
                        );
                      }}
                    />
                    {checked && (
                      <span className="photo-library-check">
                        <Check size={15} />
                      </span>
                    )}
                  </span>
                  <strong>{image.name}</strong>
                  <small>
                    {image.matched_codes.join(" · ") || image.family}
                  </small>
                </button>
              );
            })}
        </div>
      )}
      {!loading && !error && filtered.length > 24 && (
        <div className="photo-library-pagination">
          <button
            type="button"
            className="btn btn-outline"
            aria-label="Photos précédentes"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <span>
            Page {currentPage} sur {pages}
          </span>
          <button
            type="button"
            className="btn btn-outline"
            aria-label="Photos suivantes"
            disabled={currentPage === pages}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      )}
      <div className="photo-library-actions">
        <p>
          {limit
            ? `Choisissez jusqu’à ${limit} photo${limit > 1 ? "s" : ""}. Les photos déjà ajoutées sont masquées.`
            : "Ce produit a atteint sa limite de photos."}
        </p>
        <div>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!selection.length || loading || !!error}
            onClick={() =>
              onSelect(selection.map((url) => ({ url, scale: 1, x: 0, y: 0 })))
            }
          >
            Ajouter {selection.length || "les"} photo
            {selection.length !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </Modal>
  );
}
