import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.mjs";

const base = viteConfig({ mode: "test", command: "serve" });

export default mergeConfig(
  base,
  defineConfig({
    test: {
      environment: "jsdom",
      include: ["tests/ui/*.test.ts"],
      restoreMocks: true,
    },
  }),
);
