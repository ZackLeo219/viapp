import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(
  process.env.VIAPP_DIST_DIR || fileURLToPath(new URL('../dist/', import.meta.url)),
);
const port = Number(process.env.PORT || 5178);
const base = (process.env.VITE_BASE_PATH || '/').replace(/\/+$/, '') + '/';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
await stat(resolve(root, 'index.html')).catch(() => {
  console.error('未找到 dist/index.html，请先运行 pnpm build。');
  process.exit(1);
});
const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-VIAPP-Server', '1');
  response.setHeader('Cache-Control', 'no-cache');
  if (!['GET', 'HEAD'].includes(request.method || '')) {
    response.writeHead(405);
    response.end();
    return;
  }
  try {
    const path = decodeURIComponent(
      new URL(request.url || '/', `http://localhost:${port}`).pathname,
    );
    if (!path.startsWith(base)) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    const relative = path.slice(base.length) || 'index.html';
    const target = resolve(root, relative);
    if (!target.startsWith(root + sep)) {
      response.writeHead(403);
      response.end();
      return;
    }
    const content = await readFile(target);
    response.setHeader('Content-Type', types[extname(target)] || 'application/octet-stream');
    response.writeHead(200);
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
server.on('error', (error) => {
  console.error(`本地启动失败：${error.message}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  const url = `http://localhost:${port}${base}`;
  console.log(`VIAPP 已启动：${url}\n使用 Chrome / Edge 打开，按 Ctrl+C 关闭本地服务。`);
  if (process.argv.includes('--open')) {
    const command =
      process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin'
          ? ['open', [url]]
          : ['xdg-open', [url]];
    const child = spawn(command[0], command[1], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  }
});
