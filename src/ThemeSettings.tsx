import type { Settings } from "./types";
import {
  storefrontMenuStyle,
  storefrontMenuStyles,
  storefrontTheme,
  storefrontThemes,
} from "./seasonalTheme";
import "./theme-settings.css";

export function ThemeSettings({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (next: Settings) => void;
}) {
  const selected = storefrontTheme(settings);
  const selectedMenuStyle = storefrontMenuStyle(settings);
  return (
    <section className="panel theme-settings">
      <h2>Ambiance du site</h2>
      <p className="theme-settings-help">
        Choisissez une ambiance, puis enregistrez les paramètres. Revenez à «
        Classique » pour retirer tous les décors saisonniers.
      </p>
      <fieldset className="theme-options">
        <legend className="theme-settings-legend">Choisir un thème</legend>
        {storefrontThemes.map((theme) => (
          <label
            className={
              "theme-option" + (selected === theme.id ? " is-selected" : "")
            }
            key={theme.id}
          >
            <input
              type="radio"
              name="storefront-theme"
              value={theme.id}
              checked={selected === theme.id}
              onChange={() =>
                onChange({ ...settings, storefront_theme: theme.id })
              }
            />
            <span
              className="theme-option-preview"
              data-theme={theme.id}
              aria-hidden="true"
            >
              <span className="theme-preview-decoration">
                {theme.id.startsWith("ramadan")
                  ? "☾"
                  : theme.id.startsWith("newyear")
                    ? "❄"
                    : ""}
              </span>
              <span className="theme-preview-card" />
              <span className="theme-preview-card" />
            </span>
            <span className="theme-option-title">{theme.label}</span>
            <span className="theme-option-description">
              {theme.description}
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="theme-options menu-style-options">
        <legend className="theme-settings-legend">Style de la liste déroulante</legend>
        {storefrontMenuStyles.map((style) => (
          <label
            className={
              "theme-option menu-style-option" +
              (selectedMenuStyle === style.id ? " is-selected" : "")
            }
            key={style.id}
          >
            <input
              type="radio"
              name="storefront-menu-style"
              value={style.id}
              checked={selectedMenuStyle === style.id}
              onChange={() =>
                onChange({ ...settings, menu_style: style.id })
              }
            />
            <span
              className="menu-style-preview"
              data-menu-style={style.id}
              aria-hidden="true"
            >
              <span className="menu-style-preview-bar" />
              <span className="menu-style-preview-panel">
                <i />
                <i />
                <i />
              </span>
            </span>
            <span className="theme-option-title">{style.label}</span>
            <span className="theme-option-description">
              {style.description}
            </span>
          </label>
        ))}
      </fieldset>
      <p className="theme-settings-help">
        Le choix reste actif jusqu’à votre prochaine modification. Le menu,
        l’en-tête et les décors changent ensemble. Les photos des produits
        conservent leurs couleurs et tous les boutons restent accessibles.
      </p>
    </section>
  );
}
