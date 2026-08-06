import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // Node's experimental global `localStorage` (on by default since Node 22+)
    // shadows jsdom's simulated one and resolves to undefined without
    // --localstorage-file, breaking any test that touches localStorage directly.
    // Disabling it lets jsdom's own implementation take over as intended.
    execArgv: ['--no-experimental-webstorage'],
  },
})
