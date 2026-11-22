import { Slider, AboutSection, SuggestionBanner, publicLabel } from "./Experience";
import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Barcode,
  Box,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Factory,
  Grid2X2,
  Headphones,
  House,
  Layers,
  Mail,
  Menu,
  Package,
  Phone,
  ScanLine,
  Search,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Star,
  UserRound,
  X,
} from "lucide-react";
import type { Family, Product } from "./types";
import {
  activeDiscount,
  canBuy,
  discountPercent,
  isPromotion,
  money,
  normalizeSearch,
  priceOf,
  rankProducts,
  timeRemaining,
  activeSeasons,
  safeWebUrl,
  belowPrice,
} from "./domain";
import { navigate, useStore } from "./store";
import { Badges, Empty, Modal, ProductPhoto, Quantity, buyLabel } from "./ui";
import { previewMode } from "./api";
import { FamilyLanding } from "./FeatureControls";
import { VideoSection } from "./VideoFeatures";
import { SeasonalNavigation } from "./SeasonalNavigation";
import { productGroup } from "./productGroups";
import { catalogueOrder } from "./productOrdering";
import { DEFAULT_TAGLINE, youtubeChannelUrl } from "./media";
import "./favorites-ui.css";
import {
  isNewProduct,
  matchesFamily,
  productDisplay,
  productSpecifications,
  customOrderOptions,
} from "./domain";

function storefrontProducts(catalog: { products: Product[] }) {
  return catalog.products.filter((product) => product.visible !== false);
}

function contactEmails(value: string) {
  return value
    .split(/[;,]/)
    .map((email) => email.trim())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}
function productLabel(value: string) {
  return publicLabel(value);
}

export function Header({
  openLogin,
  openScanner,
  openClientLogin,
}: {
  openLogin: () => void;
  openScanner: () => void;
  openClientLogin: () => void;
}) {
  const { catalog, cart, clientApproved, isFavorite } = useStore();
  const [search, setSearch] = useState(""),
    [menu, setMenu] = useState(false),
    [families, setFamilies] = useState(false),
    [contactOpen, setContactOpen] = useState(false);
  const clicks = useRef<number[]>([]);
  const menuToggle = useRef<HTMLButtonElement>(null);
  const familyToggle = useRef<HTMLButtonElement>(null);
  const closeMenus = () => {
    setMenu(false);
    setFamilies(false);
    setContactOpen(false);
  };
  const selectSection = (path: string) => {
    closeMenus();
    navigate(path);
    window.requestAnimationFrame(() => {
      document.getElementById("main-content")?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  };
  useEffect(() => {
    const closeOnRoute = () => {
      setMenu(false);
      setFamilies(false);
    };
    window.addEventListener("hashchange", closeOnRoute);
    return () => window.removeEventListener("hashchange", closeOnRoute);
  }, []);
  useEffect(() => {
    if (!menu && !families) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenu(false);
      setFamilies(false);
      (menu ? menuToggle : familyToggle).current?.focus();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [menu, families]);
  useEffect(() => {
    if (!menu) return;
    const onOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const nav = document.getElementById("primary-navigation");
      if (nav?.contains(target) || menuToggle.current?.contains(target)) return;
      setMenu(false);
      setFamilies(false);
    };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [menu]);
  const brandClick = () => {
    const now = Date.now();
    clicks.current = clicks.current.filter((t) => now - t < 2200);
    clicks.current.push(now);
    if (clicks.current.length >= 5) {
      clicks.current = [];
      closeMenus();
      openLogin();
    } else selectSection("/");
  };
  if (!catalog) return null;
  const favoriteCount = storefrontProducts(catalog).filter(
    (product) =>
      isFavorite(product.id) &&
      catalog.families.some(
        (family) => family.visible && family.id === product.family_id,
      ),
  ).length;
  const emails = contactEmails(catalog.settings.email);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    selectSection("/catalogue?q=" + encodeURIComponent(search));
  };
  return (
    <>
      <div className="topbar brand-tagline-bar">
        <div className="container topbar-inner">
          <span>
            UNIPLAST <i /> HOME DESIGN
          </span>
          <span className="topbar-tagline">
            {catalog.settings.topbar_tagline ?? DEFAULT_TAGLINE}
          </span>
          <span className="topbar-lang">
            Français ·{" "}
            {catalog.settings.currency === "DZD"
              ? "DA"
              : catalog.settings.currency}
          </span>
        </div>
      </div>
      <header className="main-header">
        <SeasonalNavigation placement="header" />
        <div className="container header-inner">
          <button
            ref={menuToggle}
            type="button"
            className="mobile-menu icon-btn"
            aria-label={menu ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={menu}
            aria-controls="primary-navigation"
            onClick={() => {
              setMenu(!menu);
              setFamilies(false);
            }}
          >
            {menu ? <X /> : <Menu />}
          </button>
          <button
            className="brand brand-compact"
            aria-label="Accueil UNIPLAST"
            onClick={brandClick}
          >
            <img
              className="brand-corner-logo"
              src={catalog.settings.logo_url}
              alt="UNIPLAST"
            />
            <span className="brand-wordmark" aria-hidden="true">
              <strong>UNIPLAST SARL</strong>
              <small>HOME DESIGN</small>
            </span>
          </button>
          <form className="search-box" onSubmit={submit}>
            <Search size={20} />
            <input
              aria-label="Rechercher un produit"
              placeholder="Un produit, une référence, un code-barres…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              type="button"
              className="scan-btn"
              aria-label="Scanner un code-barres"
              onClick={() => {
                closeMenus();
                openScanner();
              }}
            >
              <ScanLine size={21} />
            </button>
            <button className="search-submit" aria-label="Lancer la recherche">
              <ArrowRight size={20} />
            </button>
          </form>
          {customOrderOptions(catalog.settings).enabled && (
            <button
              className="header-contact"
              onClick={() => selectSection("/sur-mesure")}
            >
              <Headphones size={23} />
              <span>
                Un produit absent ?<b>Demandez sa fabrication</b>
              </span>
            </button>
          )}
          <button
            type="button"
            className="header-home-button"
            aria-label="Retour à l’accueil"
            title="Accueil"
            onClick={() => selectSection("/")}
          >
            <House size={18} aria-hidden="true" />
            <span aria-hidden="true">Accueil</span>
          </button>
          <button
            type="button"
            className={
              "header-client-button " + (clientApproved ? "is-connected" : "")
            }
            aria-label={clientApproved ? "Mon espace client" : "Accès client"}
            title={
              clientApproved ? "Mon espace client · connecté" : "Accès client"
            }
            onClick={() => {
              if (clientApproved) selectSection("/client-agree");
              else {
                closeMenus();
                openClientLogin();
              }
            }}
          >
            <UserRound size={22} aria-hidden="true" />
            <span className="header-client-caption" aria-hidden="true">
              {clientApproved ? "Espace" : "Client"}
            </span>
          </button>
          <button
            className="cart-button"
            aria-label="Mon panier"
            onClick={() => selectSection("/panier")}
          >
            <span className="cart-icon">
              <ShoppingBag size={24} />
              <b>{cart.length}</b>
            </span>
            <span>Mon panier</span>
          </button>
          <button
            type="button"
            className="header-favorites-button"
            aria-label={`Mes favoris (${favoriteCount})`}
            title="Mes favoris"
            onClick={() => {
              selectSection("/catalogue?favoris=1");
              window.dispatchEvent(new Event("uniplast:open-favorites"));
            }}
          >
            <Star size={20} aria-hidden="true" />
            <span aria-hidden="true">Favoris</span>
            {favoriteCount > 0 && <b aria-hidden="true">{favoriteCount}</b>}
          </button>
        </div>
        <div
          id="primary-navigation"
          role="navigation"
          aria-label="Navigation principale"
          className={`navigation ${menu ? "mobile-open" : ""}`}
          onClick={(event) => {
            if (
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            const link =
              event.target instanceof Element
                ? event.target.closest<HTMLAnchorElement>('a[href^="#/"]')
                : null;
            if (!link || !event.currentTarget.contains(link)) return;
            event.preventDefault();
            selectSection(link.hash.slice(1));
          }}
        >
          <SeasonalNavigation placement="menu" />
          <div className="container nav-inner">
            <div className="family-menu-wrap">
              <button
                ref={familyToggle}
                type="button"
                className={`family-nav ${families ? "is-open" : ""}`}
                aria-expanded={families}
                aria-controls="collections-navigation"
                onClick={() => setFamilies(!families)}
              >
                <Grid2X2 size={17} /> Familles <ChevronDown size={15} />
              </button>
              {families && (
                <>
                  <button
                    className="dropdown-dismiss"
                    aria-label="Fermer les familles"
                    onClick={() => setFamilies(false)}
                  />
                  <div className="family-dropdown" id="collections-navigation">
                    {catalog.families
                      .filter((f) => f.visible)
                      .map((f) => (
                        <button
                          key={f.id}
                          onClick={() => {
                            selectSection("/catalogue?famille=" + f.id);
                          }}
                        >
                          {f.name}
                          <span>
                            {
                              storefrontProducts(catalog).filter((p) =>
                                matchesFamily(p, f),
                              ).length
                            }
                          </span>
                        </button>
                      ))}
                  </div>
                </>
              )}
            </div>
            <a href="#/">
              <House size={16} aria-hidden="true" /> Accueil
            </a>
            <a href="#/catalogue">Tous les produits</a>
            <a href="#/catalogue?filtre=promotions">
              Promotions <span className="tiny-dot" />
            </a>
            <a href="#/a-propos">Qui sommes-nous ?</a>
            {customOrderOptions(catalog.settings).enabled && (
              <a href="#/sur-mesure">
                Produit personnalisé <ArrowUpRight size={14} />
              </a>
            )}
            <a href="#/client-agree" className="client-nav">
              <ShieldCheck size={16} /> Client agréé
            </a>
            <a href="#/mes-commandes" className="orders-nav">
              Mes commandes <Package size={16} />
            </a>
            <div className="mobile-nav-list">
              <a href="#/">
                <House size={14} aria-hidden="true" /> Accueil
              </a>
              <a href="#/catalogue">
                <Grid2X2 size={14} aria-hidden="true" /> Tous les produits
              </a>
              <div className="mobile-family-wrap">
                <button
                  type="button"
                  className={`mobile-family-toggle ${families ? "is-open" : ""}`}
                  aria-expanded={families}
                  aria-controls="mobile-family-list"
                  onClick={() => setFamilies(!families)}
                >
                  <Layers size={14} aria-hidden="true" /> Familles{" "}
                  <ChevronDown size={13} aria-hidden="true" />
                </button>
                {families && (
                  <div className="mobile-family-list" id="mobile-family-list">
                    {catalog.families
                      .filter((f) => f.visible && f.kind !== "new")
                      .map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => selectSection("/catalogue?famille=" + f.id)}
                        >
                          {f.name}
                        </button>
                      ))}
                    <a href="#/collections">Voir toutes les familles →</a>
                  </div>
                )}
              </div>
              <a href="#/catalogue?filtre=promotions">
                Promotions <span className="tiny-dot" />
              </a>
              <button
                type="button"
                onClick={() => {
                  selectSection("/catalogue?favoris=1");
                  window.dispatchEvent(new Event("uniplast:open-favorites"));
                }}
              >
                <Star size={17} aria-hidden="true" /> Mes favoris
                {favoriteCount > 0 && <b>{favoriteCount}</b>}
              </button>
              <a href="#/a-propos">Qui sommes-nous ?</a>
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  setFamilies(false);
                  setContactOpen(true);
                }}
              >
                <Phone size={17} aria-hidden="true" /> Contact
              </button>
              <a href="#/catalogue-pdf">
                <ArrowUpRight size={17} aria-hidden="true" /> PDF des produits
              </a>
              <button
                type="button"
                className="mobile-nav-close"
                onClick={() => {
                  closeMenus();
                  menuToggle.current?.focus();
                }}
              >
                <X size={17} aria-hidden="true" /> Fermer
              </button>
            </div>
          </div>
        </div>
      </header>
      {contactOpen && (
        <Modal title="Contact UNIPLAST" onClose={() => setContactOpen(false)}>
          <div className="contact-dialog-list">
            {catalog.settings.phone && (
              <a href={"tel:" + catalog.settings.phone}>
                <Phone size={18} aria-hidden="true" />
                <span>
                  <small>Téléphone principal</small>
                  {catalog.settings.phone}
                </span>
              </a>
            )}
            {catalog.settings.secondary_phone && (
              <a href={"tel:" + catalog.settings.secondary_phone}>
                <Phone size={18} aria-hidden="true" />
                <span>
                  <small>Téléphone secondaire</small>
                  {catalog.settings.secondary_phone}
                </span>
              </a>
            )}
            {catalog.settings.whatsapp_phone && (
              <a
                href={
                  "https://wa.me/" +
                  catalog.settings.whatsapp_phone.replace(/\D/g, "")
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                <Phone size={18} aria-hidden="true" />
                <span>
                  <small>WhatsApp</small>
                  {catalog.settings.whatsapp_phone}
                </span>
              </a>
            )}
            {catalog.settings.viber_phone && (
              <a
                href={
                  "viber://chat?number=" +
                  encodeURIComponent(
                    "+213" +
                      catalog.settings.viber_phone
                        .replace(/\D/g, "")
                        .replace(/^0/, ""),
                  )
                }
              >
                <Phone size={18} aria-hidden="true" />
                <span>
                  <small>Viber</small>
                  {catalog.settings.viber_phone}
                </span>
              </a>
            )}
            {emails.map((email) => (
              <a href={"mailto:" + email} key={email}>
                <Mail size={18} aria-hidden="true" />
                <span>
                  <small>E-mail</small>
                  {email}
                </span>
              </a>
            ))}
            {!emails.length && (
              <p className="contact-dialog-empty">
                Aucune adresse e-mail renseignée.
              </p>
            )}
          </div>
        </Modal>
      )}
      {previewMode && (
        <div className="preview-bar">
          <div className="container">
            <span>
              <span className="status-dot" />
              Mode aperçu · produits importés
            </span>
            <span>Commandes non transmises. Disponibilités à valider.</span>
            <button onClick={openLogin}>
              Espace de gestion <ArrowUpRight size={13} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
export function CatalogPdfPage() {
  const { catalog } = useStore();
  if (!catalog) return null;
  const s = catalog.settings;
  const url =
    safeWebUrl(s.catalog_pdf_url) ||
    (previewMode && s.catalog_pdf_url.startsWith("blob:")
      ? s.catalog_pdf_url
      : "");
  return (
    <main className="container page pdf-download-page">
      <div className="page-heading">
        <span className="eyebrow">DOCUMENTS UNIPLAST</span>
        <h1>Télécharger les produits</h1>
        <p>Le PDF des produits préparé par UNIPLAST, prêt à être consulté.</p>
      </div>
      <section className="panel pdf-download-card">
        <ArrowDown size={42} strokeWidth={1.4} aria-hidden="true" />
        <h2>{productLabel(s.catalog_pdf_title || "Produits UNIPLAST")}</h2>
        {url ? (
          <>
            <p>Le fichier est disponible au téléchargement.</p>
            <a
              className="btn btn-primary"
              href={url}
              download
              target="_blank"
              rel="noopener noreferrer"
            >
              Télécharger le PDF <ArrowDown size={17} aria-hidden="true" />
            </a>
          </>
        ) : (
          <Empty
            title="PDF des produits non disponible."
            body="Le document n’a pas encore été déposé dans l’espace de gestion."
          />
        )}
      </section>
    </main>
  );
}
export function Footer({
  openPolicy,
}: {
  openPolicy: (type: "privacy" | "terms") => void;
}) {
  const { catalog } = useStore();
  if (!catalog) return null;
  const s = catalog.settings;
  return (
    <footer>
      <div className="container footer-top">
        <div className="footer-brand">
          <img src={s.logo_url} alt="UNIPLAST" />
          <p>
            Des objets utiles, des idées simples.
            <br />
            La maison et les professionnels ont leurs solutions.
          </p>
          <span>Transformation des matières plastiques</span>
        </div>
        <div>
          <h4>Explorez UNIPLAST</h4>
          <a href="#/catalogue">Nos produits</a>
          <a href="#/collections">Familles</a>
          <a href="#/catalogue?filtre=promotions">Promotions</a>
          {customOrderOptions(s).enabled && (
            <a href="#/sur-mesure">Demander un autre produit</a>
          )}
        </div>
        <div>
          <h4>Votre commande</h4>
          <a href="#/panier">Mon panier</a>
          <a href="#/mes-commandes">Mes commandes</a>
          <a href="#/a-propos">Qui sommes-nous ?</a>
          <a href="#/suggestions">Vos suggestions</a>
          <a href="#/admin">Espace de gestion</a>
          <button onClick={() => openPolicy("terms")}>
            Conditions de commande
          </button>
          <button onClick={() => openPolicy("privacy")}>Confidentialité</button>
        </div>
        <div id="footer-contact">
          <h4>Restons en contact</h4>
          {s.phone ? (
            <a href={"tel:" + s.phone}>{s.phone}</a>
          ) : (
            <p>
              Pour toute information, utilisez
              <br />
              notre formulaire de demande.
            </p>
          )}
          {s.viber_phone && (
            <a
              href={
                "viber://chat?number=" +
                encodeURIComponent(
                  "+213" + s.viber_phone.replace(/\D/g, "").replace(/^0/, ""),
                )
              }
            >
              Viber : {s.viber_phone}
            </a>
          )}
          {s.email && <a href={"mailto:" + s.email}>{s.email}</a>}
          {s.secondary_phone && (
            <a href={"tel:" + s.secondary_phone}>{s.secondary_phone}</a>
          )}
          {s.whatsapp_phone && (
            <a
              href={"https://wa.me/" + s.whatsapp_phone.replace(/\D/g, "")}
              target="_blank"
              rel="noopener noreferrer"
            >
              WhatsApp
            </a>
          )}
          {safeWebUrl(s.facebook_url) && (
            <a
              href={safeWebUrl(s.facebook_url)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Facebook ↗
            </a>
          )}
          {safeWebUrl(s.website_url) && (
            <a
              href={safeWebUrl(s.website_url)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Site internet ↗
            </a>
          )}
          {youtubeChannelUrl(s.youtube_url || "") && (
            <a
              href={youtubeChannelUrl(s.youtube_url || "")}
              target="_blank"
              rel="noopener noreferrer"
            >
              YouTube ↗
            </a>
          )}
          {(safeWebUrl(s.catalog_pdf_url) ||
            (previewMode && s.catalog_pdf_url.startsWith("blob:"))) && (
            <a href="#/catalogue-pdf">{productLabel(s.catalog_pdf_title)} · PDF ↗</a>
          )}
          {s.address && <p>{s.address}</p>}
          {customOrderOptions(s).enabled && (
            <a className="footer-project" href="#/sur-mesure">
              Demander un produit absent <ArrowUpRight size={16} />
            </a>
          )}
        </div>
      </div>
      <p className="container footer-refresh-note">
        Les informations sur les produits sont actualisées lors de votre connexion
        client.
      </p>
      <div className="container footer-bottom">
        <span>
          © {new Date().getFullYear()} UNIPLAST. Tous droits réservés.
        </span>
        <span>Conserver. Organiser. Simplifier.</span>
      </div>
    </footer>
  );
}
export function ProductCard({ product: p }: { product: Product }) {
  const {
    catalog,
    now,
    openQuantity,
    openProduct,
    isFavorite,
    toggleFavorite,
  } = useStore();
  const discounted = activeDiscount(p, now),
    s = catalog!.settings,
    favorite = isFavorite(p.id);
  return (
    <article
      className={`product-card ${discounted ? "discounted" : ""} ${p.availability_confirmed && !p.available ? "sold-out" : ""}`}
    >
      {discounted && p.offer_title && (
        <div className="offer-strip">
          <span className="offer-title">{p.offer_title}</span>
        </div>
      )}
      <a
        href={"#/produit/" + p.id}
        className="card-image-link"
        onClick={(e) => {
          if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            openProduct(p.id);
          }
        }}
      >
        <ProductPhoto image={p.images[0]} name={p.name} />
        <Badges product={p} now={now} showDiscount={false} />
        <span className="card-detail-arrow" aria-hidden="true">
          <ArrowUpRight size={19} />
        </span>
      </a>
      <div className="card-info">
        <div className="card-name-row">
          <a
            href={"#/produit/" + p.id}
            className="product-title"
            onClick={(e) => {
              if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                openProduct(p.id);
              }
            }}
          >
            {p.name}
          </a>
          <button
            type="button"
            className="favorite-toggle"
            aria-label={
              favorite ? "Retirer des favoris" : "Ajouter aux favoris"
            }
            aria-pressed={favorite}
            title={`${favorite ? "Retirer des favoris" : "Ajouter aux favoris"} : ${p.name}`}
            onClick={() => toggleFavorite(p.id)}
          >
            <Star size={18} fill={favorite ? "currentColor" : "none"} />
          </button>
        </div>
        {p.availability_confirmed &&
          (!p.available || p.stock_cartons === 0) && (
            <span className="card-unavailable">
              Indisponible pour le moment
            </span>
          )}
        {productDisplay(s).pack && (
          <div className="product-specs">
            <span>
              <Package size={13} />
              {p.pack_size} unités / {p.pack_label}
            </span>
            {productDisplay(s).capacity && p.capacity && (
              <span>{p.capacity}</span>
            )}
          </div>
        )}
        {productDisplay(s).dimensions && (
          <p className="card-dimensions">
            {p.dimensions || "Dimensions à renseigner"}
          </p>
        )}
        <div className="card-price-row">
          <div className="product-pricing">
            {p.price_hidden ? (
              <a className="price-locked" href="#/client-agree">
                <ShieldCheck size={15} /> Voir les prix
              </a>
            ) : p.price_on_request ? (
              <strong className="on-request">Prix sur demande</strong>
            ) : (
              <>
                <div className="price-main">
                  <strong>{money(priceOf(p, now), s.currency)}</strong>
                  <span> / unité</span>
                </div>
                {discounted && (
                  <del>{money(p.unit_price_cents, s.currency)}</del>
                )}
                {discounted && (
                  <span className="price-discount">
                    −{discountPercent(p, now)} %
                  </span>
                )}
                <small>
                  {money(priceOf(p, now) * p.pack_size, s.currency)} /{" "}
                  {p.pack_label}
                </small>
              </>
            )}
          </div>
          {!p.price_hidden && canBuy(p) && (
            <button
              type="button"
              className="card-add-quick"
              aria-label={`Ajouter ${p.name} au panier`}
              title="Ajouter au panier"
              onClick={() => openQuantity(p)}
            >
              <ShoppingBag size={17} />
              <span className="card-add-label">Ajouter</span>
            </button>
          )}
        </div>
        <div className="card-actions">
          <a
            href={"#/produit/" + p.id}
            onClick={(e) => {
              e.preventDefault();
              openProduct(p.id);
            }}
          >
            Détails <ArrowUpRight size={14} />
          </a>
          {discounted && (
            <span className="offer-countdown card-countdown">
              <Clock3 size={12} />
              {timeRemaining(p.discount_end, now)}
              {Date.parse(p.discount_end!) - now < 3 * 86400000 &&
                " · Profitez-en vite !"}
            </span>
          )}
          {p.price_hidden ? (
            <a className="add-btn" href="#/client-agree">
              Voir les prix
            </a>
          ) : canBuy(p) ? (
            <button
              className="add-btn"
              aria-label={`Ajouter ${p.name} au panier`}
              onClick={() => openQuantity(p)}
            >
              <ShoppingBag size={16} />
              <span>Ajouter</span>
            </button>
          ) : p.upcoming && p.preorder_enabled ? (
            <a className="add-btn" href={"#/reservation/" + p.id}>
              Réserver
            </a>
          ) : (
            <button className="add-btn muted" disabled>
              <Box size={16} />
              <span>
                {p.price_on_request
                  ? "Sur demande"
                  : p.availability_confirmed
                    ? "Indisponible"
                    : "À confirmer"}
              </span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
function ProductRail({
  title,
  eyebrow,
  products,
  href,
}: {
  title: string;
  eyebrow?: string;
  products: Product[];
  href: string;
}) {
  const rail = useRef<HTMLDivElement>(null);
  return (
    <section className="product-section">
      <div className="section-heading">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2>{title}</h2>
        </div>
        <div className="section-actions">
          <a className="text-link" href={href}>
            Tout voir <ArrowRight size={16} />
          </a>
          <div className="rail-arrows">
            <button
              className="icon-btn"
              aria-label={`Précédents produits : ${title}`}
              onClick={() =>
                rail.current?.scrollBy({ left: -640, behavior: "smooth" })
              }
            >
              <ChevronLeft size={18} />
            </button>
            <button
              className="icon-btn"
              aria-label={`Produits suivants : ${title}`}
              onClick={() =>
                rail.current?.scrollBy({ left: 640, behavior: "smooth" })
              }
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>
      <div ref={rail} className="product-rail">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
export function Home() {
  const { catalog, now } = useStore(),
    [showAll, setShowAll] = useState(false);
  if (!catalog) return null;
  const { settings: s, families, sales } = catalog;
  const products = storefrontProducts(catalog);
  const visibleFamilies = families
      .filter((f) => f.visible && f.kind !== "new")
      .sort((a, b) => a.sort_order - b.sort_order),
    allRanked = rankProducts(products, sales, now),
    ranked = allRanked.filter((p) =>
      visibleFamilies.some((f) => f.id === p.family_id),
    );
  if (s.recommendation_mode === "sales")
    ranked.sort((a, b) => (sales[b.id] || 0) - (sales[a.id] || 0));
  const offers = ranked.filter((p) => isPromotion(p, now)),
    news = allRanked.filter((p) => isNewProduct(p, now)),
    upcoming = ranked.filter((p) => p.upcoming),
    popular = ranked.filter((p) => (sales[p.id] || 0) > 0);
  const populatedFamilies = visibleFamilies.filter((f) =>
    ranked.some((p) => matchesFamily(p, f, now)),
  );
  return (
    <>
      <main className="home-page">
        <div className="container">
          <Slider
            slides={s.heroes}
            height={s.home_slider_height}
            interval={s.slider_interval}
          />
          <section className="collections-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">TROUVEZ VOTRE UNIVERS</span>
                <h2>De la place pour toutes vos idées.</h2>
              </div>
              <a className="text-link" href="#/collections">
                Les {visibleFamilies.length} familles{" "}
                <ArrowRight size={16} />
              </a>
            </div>
            <div className="collection-grid">
              {populatedFamilies.slice(0, 6).map((f, i) => (
                <a
                  className={"collection-tile tile-" + i}
                  key={f.id}
                  href={"#/catalogue?famille=" + f.id}
                >
                  <span className="collection-count">
                    {products.filter((p) => matchesFamily(p, f)).length}{" "}
                    produits
                  </span>
                  {f.image ? (
                    <img
                      src={f.image}
                      alt={`Famille ${f.name}`}
                      loading="lazy"
                    />
                  ) : (
                    <Layers size={60} strokeWidth={0.8} />
                  )}
                  <div>
                    <h3>{f.name}</h3>
                    <span className="circle-arrow">
                      <ArrowUpRight size={17} />
                    </span>
                  </div>
                </a>
              ))}
            </div>
          </section>
          <section className="benefits">
            <div>
              <Package />
              <span>
                <b>Commandez par carton</b>
                {s.price_visibility === "approved"
                  ? "Colisage clair · tarifs sur agrément"
                  : "Colisage et prix toujours visibles"}
              </span>
            </div>
            <div>
              <ShieldCheck />
              <span>
                <b>Une commande transparente</b>Chaque quantité, chaque total
              </span>
            </div>
            <div>
              <Factory />
              <span>
                <b>À chaque besoin, sa solution</b>Maison, commerce et
                professionnels
              </span>
            </div>
            <div>
              <Headphones />
              <span>
                <b>Un produit absent ?</b>Demandez sa fabrication
              </span>
            </div>
          </section>
          {activeSeasons(s.seasons, s.timezone, now).map((season) => {
            const selection = ranked.filter(
              (p) =>
                season.product_ids.includes(p.id) ||
                catalog.families.some(
                  (f) =>
                    season.family_ids.includes(f.id) &&
                    matchesFamily(p, f, now),
                ),
            );
            return selection.length > 0 ? (
              <div className="season-home" key={season.id}>
                <p className="season-description">{season.description}</p>
                <ProductRail
                  eyebrow="NOTRE SÉLECTION DE SAISON"
                  title={season.title}
                  products={selection.slice(0, 12)}
                  href={"#/catalogue?saison=" + encodeURIComponent(season.id)}
                />
              </div>
            ) : null;
          })}
          <div className="section-tabs">
            <a href="#/catalogue?filtre=promotions">
              <span className="mini-badge">%</span>Promotions{" "}
              <b>{offers.length}</b>
            </a>
            <a href="#/catalogue?filtre=nouveautes">
              <Layers size={18} />
              Nouveautés <b>{news.length}</b>
            </a>
            <a href="#/catalogue?tri=populaires">
              <Package size={18} />
              Les plus demandés <b>{popular.length}</b>
            </a>
            <a href="#/catalogue?filtre=bientot">
              <Clock3 size={18} />
              Bientôt disponibles <b>{upcoming.length}</b>
            </a>
          </div>
          {offers.length > 0 && (
            <ProductRail
              eyebrow="LES OFFRES DU MOMENT"
              title="À saisir, tout simplement."
              products={offers.slice(0, 8)}
              href="#/catalogue?filtre=promotions"
            />
          )}
          {news.length > 0 && (
            <ProductRail
              eyebrow="NOUVEAUTÉS PRODUITS"
              title="Les nouveautés"
              products={news.slice(0, 8)}
              href="#/catalogue?filtre=nouveautes"
            />
          )}
          {popular.length > 0 && (
            <ProductRail
              title="Les produits les plus demandés"
              products={popular.slice(0, 8)}
              href="#/catalogue?tri=populaires"
            />
          )}
          <AboutSection />
          <VideoSection />
          <SuggestionBanner />
          {customOrderOptions(catalog.settings).enabled && (
            <section className="custom-banner">
              <div className="custom-banner-icon">
                <Factory size={48} strokeWidth={1} />
              </div>
              <div>
                <span className="eyebrow">PRODUITS SUR MESURE</span>
                <h2>Vous recherchez un produit que nous ne proposons pas ?</h2>
                <p>
                  Envoyez son nom, une photo et la quantité souhaitée. Nous
                  étudierons sa fabrication ou sa fourniture.
                </p>
              </div>
              <a className="btn btn-yellow" href="#/sur-mesure">
                Demander ce produit <ArrowUpRight size={18} />
              </a>
            </section>
          )}
          <div className="universes-heading">
            <span className="eyebrow">LES PRODUITS, PAR FAMILLE</span>
            <h2>Explorez à votre façon.</h2>
          </div>
          {populatedFamilies
            .slice(0, showAll ? populatedFamilies.length : 3)
            .map((f) => (
              <ProductRail
                key={f.id}
                title={f.name}
                products={ranked.filter((p) => matchesFamily(p, f)).slice(0, 8)}
                href={"#/catalogue?famille=" + f.id}
              />
            ))}
          {!showAll && populatedFamilies.length > 3 && (
            <div className="show-more">
              <button
                className="btn btn-outline"
                onClick={() => setShowAll(true)}
              >
                Explorer les {populatedFamilies.length - 3} autres familles{" "}
                <ArrowDown size={17} />
              </button>
            </div>
          )}
          {upcoming.length > 0 && (
            <ProductRail
              title="Bientôt dans votre quotidien"
              products={upcoming.slice(0, 8)}
              href="#/catalogue?filtre=bientot"
            />
          )}
        </div>
      </main>
    </>
  );
}
export function Collections() {
  const { catalog } = useStore();
  if (!catalog) return null;
  return (
    <main className="container page">
      <div className="page-heading">
        <span className="eyebrow">LES PRODUITS UNIPLAST</span>
        <h1>Familles</h1>
        <p>Choisissez votre univers, nous avons de quoi vous inspirer.</p>
      </div>
      <div className="collection-page-grid">
        {catalog.families
          .filter((f) => f.visible)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((f) => (
            <a
              className="collection-page-tile"
              key={f.id}
              href={"#/catalogue?famille=" + f.id}
            >
              {f.image ? (
                <img src={f.image} alt={f.name} />
              ) : (
                <Layers size={70} strokeWidth={0.7} />
              )}
              <div>
                <h2>{f.name}</h2>
                <span>
                  {
                    storefrontProducts(catalog).filter((p) =>
                      matchesFamily(p, f),
                    ).length
                  }{" "}
                  références
                </span>
              </div>
              <ArrowUpRight size={20} />
            </a>
          ))}
      </div>
    </main>
  );
}
function customerCatalogueFilter(value: string | null) {
  return value &&
    ["disponibles", "promotions", "nouveautes", "bientot"].includes(value)
    ? value
    : "";
}
export function Catalogue({ params }: { params: URLSearchParams }) {
  const { catalog, now, clientApproved, isFavorite } = useStore();
  const [maximum, setMaximum] = useState(""),
    [maximumDraft, setMaximumDraft] = useState("");
  const [q, setQ] = useState(params.get("q") || ""),
    [family, setFamily] = useState(params.get("famille") || ""),
    [filter, setFilter] = useState(
      customerCatalogueFilter(params.get("filtre")),
    ),
    [favoritesOnly, setFavoritesOnly] = useState(params.get("favoris") === "1"),
    [sort, setSort] = useState(params.get("tri") || "nom"),
    [page, setPage] = useState(1),
    [mobileFilters, setMobileFilters] = useState(false);
  const productsTop = useRef<HTMLDivElement>(null);
  const scrollToProducts = () =>
    window.requestAnimationFrame(() =>
      productsTop.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      }),
    );
  const queryString = params.toString();
  useEffect(() => {
    const openFavorites = () => {
      setQ("");
      setFamily("");
      setFilter("");
      setSort("nom");
      setMaximum("");
      setMaximumDraft("");
      setFavoritesOnly(true);
      setPage(1);
      setMobileFilters(false);
    };
    window.addEventListener("uniplast:open-favorites", openFavorites);
    return () =>
      window.removeEventListener("uniplast:open-favorites", openFavorites);
  }, []);
  useEffect(() => {
    if (!clientApproved) {
      setMaximum("");
      setMaximumDraft("");
    }
  }, [clientApproved]);
  useEffect(() => {
    setQ(params.get("q") || "");
    setFamily(params.get("famille") || "");
    setFilter(customerCatalogueFilter(params.get("filtre")));
    setFavoritesOnly(params.get("favoris") === "1");
    setSort(params.get("tri") || "nom");
    setPage(1);
  }, [queryString]);
  if (!catalog) return null;
  const allVisibleFamilies = catalog.families.filter((f) => f.visible),
    families = allVisibleFamilies.filter((f) => f.kind !== "new"),
    selectedFamily = families.find(
      (f) => f.id === family || f.aliases?.includes(family),
    ),
    familyName = selectedFamily?.name,
    favoriteCount = storefrontProducts(catalog).filter(
      (p) =>
        isFavorite(p.id) &&
        allVisibleFamilies.some((f) => f.id === p.family_id),
    ).length;
  const newOnly = filter === "nouveautes";
  let products = rankProducts(storefrontProducts(catalog), catalog.sales, now);
  const seasonId = params.get("saison"),
    season = activeSeasons(
      catalog.settings.seasons,
      catalog.settings.timezone,
      now,
    ).find((s) => s.id === seasonId);
  if (newOnly) {
    products = products.filter((p) => isNewProduct(p, now));
  } else {
    products = products.filter(
      (p) =>
        allVisibleFamilies.some((f) => f.id === p.family_id) &&
        (!family || (!!selectedFamily && matchesFamily(p, selectedFamily, now))),
    );
    if (favoritesOnly) products = products.filter((p) => isFavorite(p.id));
    if (seasonId)
      products = season
        ? products.filter(
            (p) =>
              season.product_ids.includes(p.id) ||
              catalog.families.some(
                (f) =>
                  season.family_ids.includes(f.id) && matchesFamily(p, f, now),
              ),
          )
        : [];
  }
  if (sort === "recommande" && catalog.settings.recommendation_mode === "sales")
    products.sort(
      (a, b) => (catalog.sales[b.id] || 0) - (catalog.sales[a.id] || 0),
    );
  const words = normalizeSearch(q).split(/\s+/).filter(Boolean);
  if (!newOnly && words.length)
    products = products.filter((p) =>
      words.every((w) =>
        normalizeSearch(
          `${p.name} ${p.name_fr} ${p.code} ${p.barcode || ""}`,
        ).includes(w),
      ),
    );
  if (filter === "disponibles")
    products = products.filter(
      (p) =>
        p.available &&
        p.availability_confirmed &&
        !p.upcoming &&
        (p.stock_cartons === null || p.stock_cartons > 0),
    );
  if (filter === "promotions")
    products = products.filter((p) => isPromotion(p, now));
  if (filter === "bientot") products = products.filter((p) => p.upcoming);
  if (!newOnly && clientApproved && maximum)
    products = products.filter((p) =>
      belowPrice(p, Math.round(Number(maximum) * 100), clientApproved, now),
    );
  if (sort === "nom")
    products.sort(catalogueOrder(catalog.products, catalog.families));
  if (sort === "prix-croissant")
    products.sort(
      (a, b) =>
        (a.price_on_request ? Infinity : priceOf(a, now)) -
        (b.price_on_request ? Infinity : priceOf(b, now)),
    );
  if (sort === "prix-decroissant")
    products.sort(
      (a, b) =>
        (b.price_on_request ? -1 : priceOf(b, now)) -
        (a.price_on_request ? -1 : priceOf(a, now)),
    );
  if (sort === "recent")
    products.sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    );
  if (sort === "populaires")
    products.sort(
      (a, b) => (catalog.sales[b.id] || 0) - (catalog.sales[a.id] || 0),
    );
  const pageCount = Math.max(1, Math.ceil(products.length / 24)),
    displayPage = Math.min(page, pageCount);
  const selectFavorites = (value: boolean) => {
    const next = new URLSearchParams(params);
    for (const [key, current] of [
      ["q", q],
      ["famille", family],
      ["filtre", filter],
      ["tri", sort],
    ]) {
      if (current) next.set(key, current);
      else next.delete(key);
    }
    if (value) next.set("favoris", "1");
    else next.delete("favoris");
    setFavoritesOnly(value);
    setPage(1);
    navigate("/catalogue" + (next.size ? "?" + next.toString() : ""));
  };
  const reset = () => {
    setQ("");
    setFamily("");
    setFilter("");
    setSort("nom");
    setMaximum("");
    setMaximumDraft("");
    setFavoritesOnly(false);
    setPage(1);
    navigate("/catalogue");
  };
  return (
    <main className="container page catalogue-page">
      <div className="breadcrumb">
        <a href="#/">Accueil</a>
        <ChevronRight size={12} />
        <span>{favoritesOnly ? "Mes favoris" : "Produits"}</span>
        {familyName && !newOnly && (
          <>
            <ChevronRight size={12} />
            <span>{familyName}</span>
          </>
        )}
      </div>
      {selectedFamily && <FamilyLanding family={selectedFamily} />}
      <div className="catalog-heading" id="collection-products">
        <div>
          <span className="eyebrow">L’UNIVERS UNIPLAST</span>
          <h1>
            {favoritesOnly
              ? "Mes favoris"
              : newOnly
                ? "Nouveautés"
                : season?.title || familyName || "Les produits"}
          </h1>
          {seasonId && !newOnly && (
            <a className="text-link" href="#/catalogue">
              Voir tous les produits →
            </a>
          )}
          <p>
            {favoritesOnly
              ? "Vos produits enregistrés, réunis au même endroit."
              : newOnly
                ? "Les derniers produits ajoutés, réunis au même endroit."
                : `${selectedFamily ? storefrontProducts(catalog).filter((p) => matchesFamily(p, selectedFamily, now)).length : storefrontProducts(catalog).length} références pour trouver votre solution.`}
          </p>
        </div>
        <div className="catalog-count">
          <b>{String(products.length).padStart(2, "0")}</b>
          <span>
            produits
            <br />
            correspondants
          </span>
        </div>
      </div>
      <div className="catalog-layout">
        <aside
          className={`catalog-sidebar ${mobileFilters ? "filters-open" : ""}`}
        >
          <div className="sidebar-heading">
            <h3>Affiner la sélection</h3>
            <button
              className="icon-btn mobile-only"
              onClick={() => setMobileFilters(false)}
              aria-label="Fermer les filtres"
            >
              <X size={18} />
            </button>
          </div>
          {!newOnly && (
            <>
              <h4>Familles</h4>
              <button
                className={`family-filter ${!family ? "selected" : ""}`}
                onClick={() => {
                  setFamily("");
                  setPage(1);
                }}
              >
                <span>Toutes les familles</span>
                <b>{storefrontProducts(catalog).length}</b>
              </button>
              {families.map((f) => (
                <button
                  className={`family-filter ${selectedFamily?.id === f.id ? "selected" : ""}`}
                  key={f.id}
                  onClick={() => {
                    setFamily(f.id);
                    setPage(1);
                  }}
                >
                  <span>{f.name}</span>
                  <b>
                    {
                      storefrontProducts(catalog).filter((p) =>
                        matchesFamily(p, f),
                      ).length
                    }
                  </b>
                </button>
              ))}
            </>
          )}
          <h4>À la une</h4>
          {[
            ["", "Tous les produits"],
            ["disponibles", "Disponibles"],
            ["promotions", "En promotion"],
            ["nouveautes", "Nouveautés"],
            ["bientot", "Bientôt disponibles"],
          ].map(([v, label]) => (
            <label className="radio-filter" key={v}>
              <input
                type="radio"
                name="state-filter"
                value={v}
                checked={filter === v}
                onChange={() => {
                  const next = new URLSearchParams(params);
                  if (v === "nouveautes") {
                    next.delete("q");
                    next.delete("famille");
                    next.delete("saison");
                    next.delete("favoris");
                    next.delete("maximum");
                    setQ("");
                    setFamily("");
                    setFavoritesOnly(false);
                    setMaximum("");
                    setMaximumDraft("");
                  }
                  if (v) next.set("filtre", v);
                  else next.delete("filtre");
                  setFilter(v);
                  setPage(1);
                  navigate("/catalogue" + (next.size ? "?" + next.toString() : ""));
                }}
              />
              {label}
            </label>
          ))}
          <button className="reset-filters" onClick={reset}>
            Réinitialiser les filtres
          </button>
        </aside>
        <section className="catalog-results">
          {clientApproved && !newOnly && (
            <form
              className="budget-search"
              aria-label="Rechercher par prix maximum"
              onSubmit={(event) => {
                event.preventDefault();
                setMaximum(maximumDraft.trim());
                setPage(1);
                setMobileFilters(false);
              }}
            >
              <div className="budget-search-copy">
                <strong>Un prix maximum ?</strong>
                <p>Les produits à ce prix ou moins.</p>
              </div>
              <div className="budget-search-controls">
                <label>
                  Prix maximum par unité (
                  {catalog.settings.currency === "DZD"
                    ? "DA"
                    : catalog.settings.currency}
                  )
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    max="1000000000"
                    step="0.01"
                    placeholder="Ex. 50 ou 100"
                    value={maximumDraft}
                    onChange={(event) => setMaximumDraft(event.target.value)}
                  />
                </label>
                <button type="submit" className="btn btn-primary">
                  Rechercher
                </button>
              </div>
              {maximum && (
                <div className="budget-search-active" aria-live="polite">
                  <span>
                    Jusqu’à{" "}
                    {money(
                      Math.round(Number(maximum) * 100),
                      catalog.settings.currency,
                    )}{" "}
                    par unité
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setMaximum("");
                      setMaximumDraft("");
                      setPage(1);
                    }}
                  >
                    Effacer
                  </button>
                </div>
              )}
            </form>
          )}
          <div className="catalog-toolbar">
            {!newOnly && (
              <div className="catalog-search">
                <Search size={18} />
                <input
                  aria-label="Rechercher dans les résultats"
                  value={q}
                  placeholder="Rechercher dans les produits…"
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                />
                {q && (
                  <button
                    aria-label="Effacer la recherche"
                    className="icon-btn"
                    onClick={() => setQ("")}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            )}
            <button
              className="btn btn-outline filter-toggle"
              onClick={() => setMobileFilters(!mobileFilters)}
            >
              <SlidersHorizontal size={17} />
              Filtres
            </button>
            <select
              aria-label="Trier les produits"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
            >
              <option value="nom">Nom : A à Z</option>
              <option value="recommande">Pertinence</option>
              <option value="prix-croissant">Prix croissant</option>
              <option value="prix-decroissant">Prix décroissant</option>
              <option value="populaires">Les plus demandés</option>
              <option value="recent">Les plus récents</option>
            </select>
          </div>
          <div className="result-summary">
            <span>
              {products.length} résultat{products.length > 1 ? "s" : ""}
            </span>
            {!newOnly && (
              <button
                type="button"
                className="favorites-filter"
                aria-pressed={favoritesOnly}
                onClick={() => selectFavorites(!favoritesOnly)}
              >
                <Star
                  size={14}
                  fill={favoritesOnly ? "currentColor" : "none"}
                />
                Mes favoris <b>{favoriteCount}</b>
              </button>
            )}
            {(q ||
              family ||
              filter ||
              favoritesOnly ||
              (clientApproved && maximum)) && (
              <button onClick={reset} aria-label="Effacer la sélection">
                Effacer <X size={12} />
              </button>
            )}
          </div>
          {products.length ? (
            <>
              <div className="product-grid" ref={productsTop}>
                {products
                  .slice((displayPage - 1) * 24, displayPage * 24)
                  .map((p, index, visibleProducts) => {
                    const group = productGroup(p);
                    const startsGroup =
                      !favoritesOnly &&
                      (index === 0 ||
                        visibleProducts[index - 1].family_id !== p.family_id ||
                        productGroup(visibleProducts[index - 1]).key !==
                          group.key);
                    return (
                      <Fragment key={p.id}>
                        {startsGroup && (
                          <div className="product-group-heading">
                            <Layers size={19} aria-hidden="true" />
                            <h2>{group.label}</h2>
                          </div>
                        )}
                        <ProductCard product={p} />
                      </Fragment>
                    );
                  })}
              </div>
              {products.length > 24 && (
                <div className="pagination">
                  <button
                    className="btn btn-outline"
                    onClick={() => {
                      setPage(Math.max(1, displayPage - 1));
                      scrollToProducts();
                    }}
                    disabled={displayPage === 1}
                  >
                    <ArrowLeft size={16} />
                    Précédent
                  </button>
                  <span>
                    Page {displayPage} sur {pageCount}
                  </span>
                  <button
                    className="btn btn-outline"
                    onClick={() => {
                      setPage(Math.min(pageCount, displayPage + 1));
                      scrollToProducts();
                    }}
                    disabled={displayPage >= pageCount}
                  >
                    Suivant
                    <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </>
          ) : (
            <Empty
              title={
                favoritesOnly
                  ? favoriteCount
                    ? "Aucun favori dans cette sélection"
                    : "Aucun favori pour le moment"
                  : "Aucun produit pour cette sélection"
              }
              body={
                favoritesOnly && !favoriteCount
                  ? "Touchez l’étoile à côté d’un produit pour le retrouver ici. Vos favoris restent mémorisés sur cet appareil."
                  : filter === "promotions"
                    ? "Aucune promotion active pour le moment. Retrouvez les tarifs des produits."
                    : "Essayez une autre référence ou élargissez vos filtres."
              }
            >
              <button
                className="btn btn-primary"
                onClick={favoritesOnly ? () => selectFavorites(false) : reset}
              >
                {favoritesOnly
                  ? "Quitter les favoris"
                  : "Voir tous les produits"}
              </button>
            </Empty>
          )}
        </section>
      </div>
    </main>
  );
}
export function ProductQuickView() {
  const { catalog, quickProductId, closeProduct } = useStore();
  useEffect(() => {
    const close = () => closeProduct();
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, [closeProduct]);
  if (!quickProductId || !catalog) return null;
  const product = storefrontProducts(catalog).find(
    (p) => p.id === quickProductId,
  );
  return (
    <Modal
      title={product?.name || "Détails du produit"}
      onClose={closeProduct}
      wide
      className="product-quick-view"
    >
      <ProductDetails id={quickProductId} onClose={closeProduct} />
    </Modal>
  );
}
export function ProductDetails({
  id,
  onClose,
}: {
  id: string;
  onClose?: () => void;
}) {
  const { catalog, now, addCart, isFavorite, toggleFavorite } = useStore();
  const Wrapper = onClose ? "div" : "main";
  const [zoom, setZoom] = useState(false);
  const [image, setImage] = useState(0),
    [n, setN] = useState(1);
  useEffect(() => {
    setImage(0);
    setZoom(false);
    setN(1);
  }, [id]);
  if (!catalog) return null;
  const p = storefrontProducts(catalog).find(
    (p) =>
      p.id === id &&
      catalog.families.some((f) => f.id === p.family_id && f.visible),
  );
  if (!p)
    return (
      <Wrapper className={onClose ? "quick-view-body" : "container page"}>
        <Empty
          title="Produit introuvable"
          body="Cette référence a été retirée ou n’est plus visible."
        >
          <a className="btn btn-primary" href="#/catalogue">
            Retour aux produits
          </a>
        </Empty>
      </Wrapper>
    );
  const family = catalog.families.find((f) => f.id === p.family_id),
    discount = activeDiscount(p, now),
    currency = catalog.settings.currency;
  return (
    <Wrapper className={onClose ? "quick-view-body" : "container page"}>
      <div className={onClose ? "quick-view-collection" : "breadcrumb"}>
        <a href="#/">Accueil</a>
        <ChevronRight size={12} />
        <a href={"#/catalogue?famille=" + p.family_id}>
          {family?.name || "Produits"}
        </a>
        <ChevronRight size={12} />
        <span>{p.code}</span>
      </div>
      <div className="product-detail-layout">
        <div className="detail-gallery">
          <div className={`detail-image ${zoom ? "photo-enlarged" : ""}`}>
            {p.images.length > 0 && (
              <button
                className="photo-zoom"
                aria-label={zoom ? "Réduire la photo" : "Agrandir la photo"}
                onClick={() => setZoom(!zoom)}
              >
                <span>{zoom ? "Réduire" : "Agrandir"}</span>
              </button>
            )}
            <ProductPhoto image={p.images[image]} name={p.name} eager />
            <Badges product={p} now={now} />
          </div>
          {p.images.length > 1 && (
            <div className="gallery-thumbs">
              {p.images.map((im, i) => (
                <button
                  key={im.url}
                  className={image === i ? "selected" : ""}
                  onClick={() => {
                    setImage(i);
                    setZoom(false);
                  }}
                  aria-pressed={image === i}
                  aria-label={`Afficher la photo ${i + 1}`}
                >
                  <ProductPhoto
                    image={im}
                    name={`Vue ${i + 1}`}
                    className="framed-thumbnail"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="detail-content">
          <span className="eyebrow">{family?.name}</span>
          <div className="detail-title-with-favorite">
            <h1>{p.name}</h1>
            <button
              type="button"
              className="favorite-toggle"
              aria-label={
                isFavorite(p.id) ? "Retirer des favoris" : "Ajouter aux favoris"
              }
              aria-pressed={isFavorite(p.id)}
              onClick={() => toggleFavorite(p.id)}
            >
              <Star
                size={21}
                fill={isFavorite(p.id) ? "currentColor" : "none"}
              />
            </button>
          </div>
          <span className="detail-ref">Référence {p.code}</span>
          {p.availability_confirmed &&
            (!p.available || p.stock_cartons === 0) && (
              <p className="card-unavailable">Indisponible pour le moment</p>
            )}
          <div className="detail-prices">
            {p.price_hidden ? (
              <a className="price-locked" href="#/client-agree">
                <ShieldCheck size={18} /> Connectez-vous pour consulter les
                tarifs
              </a>
            ) : p.price_on_request ? (
              <strong>Prix sur demande</strong>
            ) : (
              <>
                <strong>{money(priceOf(p, now), currency)}</strong>
                <span>l’unité</span>
                {discount && <del>{money(p.unit_price_cents, currency)}</del>}
                <p>
                  {money(priceOf(p, now) * p.pack_size, currency)}{" "}
                  <span>
                    le {p.pack_label} de {p.pack_size} unités
                  </span>
                </p>
              </>
            )}
            {discount && (
              <div className="offer-countdown">
                <Clock3 size={14} />
                {p.offer_title || "Offre en cours"} ·{" "}
                {timeRemaining(p.discount_end, now)}
              </div>
            )}
          </div>
          {canBuy(p) ? (
            <div className="detail-purchase">
              <label>Nombre de {p.pack_label}s</label>
              <div className="detail-buy-row">
                <Quantity
                  value={n}
                  onChange={setN}
                  max={p.stock_cartons ?? 10000}
                />
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    onClose?.();
                    addCart(p, n);
                  }}
                >
                  <ShoppingBag size={18} />
                  Ajouter au panier
                </button>
              </div>
              <p>
                <b>{n * p.pack_size} unités</b> · Total{" "}
                {money(n * p.pack_size * priceOf(p, now), currency)}
              </p>
            </div>
          ) : p.price_hidden ? (
            <a className="btn btn-primary" href="#/client-agree">
              <ShieldCheck size={17} /> Accéder aux tarifs
            </a>
          ) : p.upcoming && p.preorder_enabled ? (
            <a className="btn btn-primary" href={"#/reservation/" + p.id}>
              Réserver ce produit <ArrowRight size={17} />
            </a>
          ) : (
            <div className="availability-notice">
              <Box size={20} />
              <div>
                <b>
                  {p.availability_confirmed
                    ? "Indisponible pour le moment"
                    : "Disponibilité à confirmer"}
                </b>
                <p>
                  {p.price_on_request
                    ? "Le prix doit être renseigné avant la commande."
                    : "Contactez-nous pour connaître les conditions de disponibilité."}
                </p>
              </div>
            </div>
          )}
          {productDisplay(catalog.settings).description && p.description && (
            <p className="detail-description">{p.description}</p>
          )}
          <dl className="detail-spec-table">
            {productSpecifications(p, catalog.settings).map(
              ([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd className={label === "Code-barres" ? "mono" : ""}>
                    {value}
                  </dd>
                </div>
              ),
            )}
          </dl>
          {onClose && (
            <button
              className="btn btn-outline quick-view-back"
              onClick={onClose}
            >
              <ArrowLeft size={16} /> Retour aux produits
            </button>
          )}
          <div className="detail-reassurance">
            <ShieldCheck size={16} />
            Prix et disponibilité vérifiés lors de l’envoi de la commande.
          </div>
        </div>
      </div>
      {!onClose && productDisplay(catalog.settings).related_products && (
        <ProductRail
          title="Dans la même famille"
          products={storefrontProducts(catalog)
            .filter(
              (item) => item.family_id === p.family_id && item.id !== p.id,
            )
            .slice(0, 8)}
          href={"#/catalogue?famille=" + p.family_id}
        />
      )}
    </Wrapper>
  );
}
