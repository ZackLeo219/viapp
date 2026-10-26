import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    server: { deps: { inline: ['@zmkfirmware/zmk-studio-ts-client'] } },
  },
});
