// Isolated development endpoint: no app state, HMR or live reload during hardware tests.
import { createServer } from 'vite';
const server = await createServer({
  configFile: false,
  cacheDir: 'node_modules/.vite-hardware',
  optimizeDeps: { entries: ['src/protocols/via.ts', 'src/protocols/zmk.ts'] },
  server: { host: '0.0.0.0', port: 5179, strictPort: true, hmr: false, watch: null },
  plugins: [
    {
      name: 'hardware-test-page',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url !== '/') return next();
          res.setHeader('Content-Type', 'text/html;charset=utf-8');
          res.end(
            '<!doctype html><html><head><title>VIAPP USB verification</title></head><body><main id="root">VIAPP USB verification. Configuration is backed up before a write test.</main></body></html>',
          );
        });
      },
    },
  ],
});
await server.listen();
server.printUrls();
