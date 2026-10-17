// Unit tests run in jsdom with React 16 (the version the platform provides) and the real RESX
// files, through a mocked ComponentFramework context (tests/mockContext.ts).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
    restoreMocks: true,
  },
});
