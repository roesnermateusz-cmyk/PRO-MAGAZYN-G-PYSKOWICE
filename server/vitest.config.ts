import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Kazdy plik testowy dostaje wlasny proces i wlasna baze danych,
    // dzieki czemu testy nie wplywaja na siebie nawzajem.
    pool: 'forks',
    isolate: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
