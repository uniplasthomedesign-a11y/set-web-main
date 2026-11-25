import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  storefrontMenuStyle,
  storefrontMenuStyleIds,
  storefrontMenuStyles,
  validateStorefrontMenuStyle,
} from "../src/seasonalTheme.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("three selectable dropdown styles are validated and have a safe default", () => {
  assert.deepEqual([...storefrontMenuStyleIds], [
    "floating",
    "classic",
    "sheet",
  ]);
  assert.equal(storefrontMenuStyles.length, 3);
  assert.equal(validateStorefrontMenuStyle(undefined), null);
  for (const id of storefrontMenuStyleIds)
    assert.equal(validateStorefrontMenuStyle(id), null);
  assert.match(
    validateStorefrontMenuStyle("rounded") || "",
    /style de menu proposé/,
  );
  assert.equal(storefrontMenuStyle({}), "floating");
  assert.equal(storefrontMenuStyle({ menu_style: "sheet" }), "sheet");
});

test("the setting is editable, saved on the server and applied to the storefront", () => {
  assert.match(read("src/types.ts"), /menu_style\?: StorefrontMenuStyle/);
  assert.match(read("src/adminDraftCore.ts"), /"menu_style"/);
  assert.match(
    read("src/SettingsManager.tsx"),
    /edit\("storefront_theme", "menu_style"\)/,
  );
  assert.match(
    read("src/ThemeSettings.tsx"),
    /name="storefront-menu-style"/,
  );
  assert.match(read("src/api.ts"), /validateStorefrontMenuStyle/);
  assert.match(read("server/local-store.cjs"), /validateStorefrontMenuStyle/);
  assert.match(
    read("src/SeasonalDecor.tsx"),
    /dataset\.menuStyle = menuStyle/,
  );
  assert.match(
    read("index.html"),
    /localStorage\.getItem\("uniplast\.menu-style\.v1"\)/,
  );
});

test("each dropdown style has a distinct, theme-aware panel shape", () => {
  const css = read("src/menu-style.css");
  for (const id of storefrontMenuStyleIds)
    assert.match(css, new RegExp(`html\\[data-menu-style="${id}"\\]`));
  assert.match(css, /--menu-panel-bg: var\(--seasonal-nav-background/);
  assert.match(css, /--menu-panel-accent: var\(--seasonal-button/);
  assert.match(css, /width: 4\.5cm/);
  assert.match(css, /width: 100vw/);
  assert.match(css, /border-radius: var\(--menu-panel-radius\)/);
});
