import type { Settings, StorefrontMenuStyle, StorefrontTheme } from "./types";

export const storefrontThemeIds = [
  "classic",
  "ramadan-night",
  "ramadan-ivory",
  "newyear-snow",
  "newyear-midnight",
] as const satisfies readonly StorefrontTheme[];

export const storefrontThemes = [
  {
    id: "classic",
    label: "Classique",
    description:
      "Bleu profond, touches de vert d’eau et fond clair, sans décor saisonnier.",
  },
  {
    id: "ramadan-night",
    label: "Ramadan · Nuit dorée",
    description:
      "En-tête bleu nuit, menu doré, croissant et lanternes de Ramadan.",
  },
  {
    id: "ramadan-ivory",
    label: "Ramadan · Ivoire et or",
    description: "En-tête ivoire, menu or ancien et grand décor de Ramadan.",
  },
  {
    id: "newyear-snow",
    label: "Nouvel An · Neige",
    description:
      "En-tête givré, menu vert sapin et décor de neige de fin d’année.",
  },
  {
    id: "newyear-midnight",
    label: "Nouvel An · Minuit",
    description:
      "En-tête bleu nuit, menu argenté et décor de fête aux flocons lumineux.",
  },
] as const satisfies readonly {
  id: StorefrontTheme;
  label: string;
  description: string;
}[];

export const storefrontMenuStyleIds = [
  "floating",
  "classic",
  "sheet",
] as const satisfies readonly StorefrontMenuStyle[];

export const storefrontMenuStyles = [
  {
    id: "floating",
    label: "Flottant",
    description: "Panneau arrondi, ombre douce et fond légèrement voilé.",
  },
  {
    id: "classic",
    label: "Classique",
    description: "Menu carré collé au header, sans ombre ni voile.",
  },
  {
    id: "sheet",
    label: "Plein écran",
    description: "Grand panneau sur toute la largeur, arrondi en haut.",
  },
] as const satisfies readonly {
  id: StorefrontMenuStyle;
  label: string;
  description: string;
}[];

export function validateStorefrontTheme(value: unknown): string | null {
  return value === undefined ||
    storefrontThemeIds.some((theme) => theme === value)
    ? null
    : "Choisissez un thème proposé dans les paramètres.";
}

export function validateStorefrontMenuStyle(value: unknown): string | null {
  return value === undefined ||
    storefrontMenuStyleIds.some((style) => style === value)
    ? null
    : "Choisissez un style de menu proposé dans les paramètres.";
}

/** Missing or unrecognised saved themes use the classic storefront. */
export function storefrontTheme(
  settings: Pick<Settings, "storefront_theme">,
): StorefrontTheme {
  return typeof settings.storefront_theme === "string" &&
    storefrontThemeIds.some((theme) => theme === settings.storefront_theme)
    ? settings.storefront_theme
    : "classic";
}

export function storefrontMenuStyle(
  settings: Pick<Settings, "menu_style">,
): StorefrontMenuStyle {
  return typeof settings.menu_style === "string" &&
    storefrontMenuStyleIds.some((style) => style === settings.menu_style)
    ? settings.menu_style
    : "floating";
}
