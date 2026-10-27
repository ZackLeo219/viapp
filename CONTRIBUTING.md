# 参与开发

欢迎提交原装 PCB 适配、界面改进和问题修复。项目采用 MIT 许可证。

Contributions are welcome. Please include the original PCB revision, firmware information and hardware verification when adding a device.

## 申请设备适配

通过 [设备适配申请](https://github.com/ZackLeo219/viapp/issues/new?template=device-support.yml) 提供型号、PCB 版本、官方资料和配置方式。

当前已验证 Neo65 Cu、Neo75 Cu 原装三模 PCB和 TOFU PAD 原装双模 PCB 的 USB 配置。Neo80 Cu 尚未真机验证。蓝牙配置和第三方 PCB 不在当前验证范围内。

同品牌、同系列或标注支持 VIA，均不能替代协议和配列验证。一个型号的不同 PCB 可能需要不同适配器。

## 开发与验证

1. Fork 仓库，新建分支。
2. 安装 Node.js 22.12+ 和 pnpm 10.33.0，执行 `pnpm install --frozen-lockfile`。
3. 使用 `pnpm dev` 启动，执行 `pnpm check` 和 `pnpm format:check`。
4. 首次运行浏览器测试前执行 `pnpm exec playwright install chromium`，再执行 `pnpm test:e2e`。
5. 提交 PR，说明使用场景、改动和验证结果。界面改动附电脑及窄屏截图。

## 本地运行与打包

网页使用 React、TypeScript 和 Vite。`pnpm dev` 默认运行在 `http://localhost:5173/`；WSL 开发时，用 Windows 的 Chrome / Edge 连接硬件。

```sh
pnpm build
pnpm package:offline  # 需要 Go 1.23+，生成 Windows、Linux 和 macOS 启动器
pnpm test:package     # 检查当前系统的离线包
```

## 新增设备

- 收集原装 PCB 版本、固件版本、USB VID/PID、可用配置接口、官方配列或 JSON。不要上传序列号、个人键位备份或私人宏内容。
- 标准 VIA 设备无需逐一新增型号代码：通用适配器读取矩阵、配列选项和厂商按键定义。优先提交或修正定义；本地也可直接导入厂商 JSON。
- 内置定义库来自固定版本的 `the-via/keyboards`。更新时在它的 checkout 上运行 `node scripts/sync-via-catalog.mjs /path/to/keyboards`，检查数据变化并保留 GPL 数据许可。VIAPP 的应用代码使用 MIT。
- 特殊协议在 `src/protocols/discovery.ts` 登记识别。检查具体接口，避免误识别；共享 USB 编号的不同 PCB 不能随意选择一份定义。
- 复用经过验证的协议适配器，或在 `src/protocols/` 新增适配器。遵循 `Driver` 接口，处理超时、断开、锁定、提交和读回校验。
- 在工作台中接入连接逻辑，并更新帮助中的支持列表、README 和测试。
- 为协议边界、参数校验和配置恢复添加测试。UI 不展示固件无法实现的功能。

## 真机验收

先只读连接，核对配列、层数和当前绑定，并在本地备份完整配置。写入测试只修改少量键位，完成提交与读回后恢复原配置，再核对全部层。宏、重启持久化和各连接模式分别记录验证结果。

测试还应覆盖：首次授权、刷新后自动连接、断线与重连、跨设备草稿隔离、保存失败时保留备份。没有真机验证的适配可以先提交草稿 PR，并明确未验证项目；正式支持列表只列已验证的型号和模式。

没有 USB 序列号的 HID 设备（如 Neo65 Cu 原装三模 PCB）会在拔出后失去浏览器授权。测试需覆盖重新授权、断开卡片与草稿保留，不能只模拟授权始终有效的拔插。

在项目目录运行 `node scripts/hardware-server.mjs`，然后用 Windows Node.js 执行。默认检查 Neo75 Cu 和 TOFU PAD；单独测试 Neo65 Cu 时添加 `--model=neo65cu`：

```sh
node --experimental-websocket scripts/hardware-smoke.mjs                 # 只读
node --experimental-websocket scripts/hardware-smoke.mjs --write        # 临时改键、读回并恢复
node --experimental-websocket scripts/hardware-smoke.mjs --write --macros
node --experimental-websocket scripts/hardware-smoke.mjs --features     # 配列、图层与高级按键
```

生产页面的连接与草稿隔离测试：先运行 `pnpm preview`，再执行 `node --experimental-websocket scripts/hardware-ui-smoke.mjs`。该脚本关闭自动保存，不写入设备。测试备份与结果放在被 Git 忽略的 `.hardware-test-results/`。

## 协议与许可

实现需依据可合法使用的协议资料，并在 `THIRD_PARTY_NOTICES.md` 记录来源。不要将许可证不兼容的驱动代码复制进项目，也不要通过关闭设备识别或写入校验来扩大支持范围。
