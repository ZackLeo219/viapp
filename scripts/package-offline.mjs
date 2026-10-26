import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const launcher = resolve(root, 'scripts/launcher');
const html = await readFile(resolve(root, 'dist/index.html'), 'utf8');
if (!html.includes('./assets/'))
  throw new Error('离线包需要相对路径构建，请先运行 pnpm build（不要设置 VITE_BASE_PATH）。');
execFileSync('go', ['version'], { stdio: 'inherit' });
await mkdir(resolve(root, 'release'), { recursive: true });
await rm(resolve(launcher, 'site'), { recursive: true, force: true });
await cp(resolve(root, 'dist'), resolve(launcher, 'site'), { recursive: true });
const targets = [
  ['windows', 'amd64', 'viapp-windows-x64.exe'],
  ['linux', 'amd64', 'viapp-linux-x64'],
  ['darwin', 'arm64', 'viapp-macos-arm64'],
];
for (const [os, arch, name] of targets) {
  execFileSync(
    'go',
    ['build', '-trimpath', '-ldflags=-s -w', '-o', resolve(root, 'release', name), '.'],
    {
      cwd: launcher,
      env: { ...process.env, CGO_ENABLED: '0', GOOS: os, GOARCH: arch },
      stdio: 'inherit',
    },
  );
  console.log(`Created release/${name}`);
}
const checksums = await Promise.all(
  targets.map(async ([, , name]) => {
    const digest = createHash('sha256')
      .update(await readFile(resolve(root, 'release', name)))
      .digest('hex');
    return `${digest}  ${name}`;
  }),
);
await writeFile(resolve(root, 'release', 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
await writeFile(
  resolve(root, 'release', 'USAGE.txt'),
  'VIAPP 离线版\n\nWindows：双击 viapp-windows-x64.exe。\nLinux / macOS：赋予可执行权限后运行对应文件。\n启动器自动打开 http://localhost:5178/，请使用 Chrome / Edge。\n无需安装 Node.js、Docker 或数据库；全部网页资源已内置。\n关闭启动器窗口即停止本地服务。\n浏览器方案以访问地址区分，在线版与离线版之间请导出/导入配置文件。\n首次运行的未签名程序可能需要操作系统确认。\n',
);
