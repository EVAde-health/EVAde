import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            XAI_API_KEY: "test-xai-key",
            TWILIO_AUTH_TOKEN: "",
            EVADE_BROWSER_TOKEN: "test-browser-token",
            EVADE_ALERT_TOKEN: "",
          },
          // Every outbound fetch from the Worker (xAI, Twilio) goes to a local fake.
          outboundService: "fake-xai",
          workers: [{ name: "fake-xai", modules: true, scriptPath: path.join(import.meta.dirname, "test/fake-xai.js"), compatibilityDate: "2026-11-14" }],
        },
      };
    }),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
