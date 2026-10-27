# VIAPP

浏览器里的键盘配置工具，支持改键、快捷键、图层管理、宏编辑和按键测试。

[打开网页驱动](https://zackleo219.github.io/viapp/) · [Windows 离线版](https://github.com/ZackLeo219/viapp/releases/latest/download/viapp-windows-x64.exe) · [其他下载](https://github.com/ZackLeo219/viapp/releases)

![VIAPP 设备中心](artifacts/connected-devices.png)

## 支持的键盘

| 型号     | PCB          | 功能                                       |
| -------- | ------------ | ------------------------------------------ |
| Neo75 Cu | 原装三模 PCB | 改键、快捷键、宏、物理配列、按键测试       |
| TOFU PAD | 原装双模 PCB | 改键、快捷键、双功能键、图层管理、按键测试 |

使用电脑上的 **Chrome 或 Edge**，通过 USB 数据线或受支持的 2.4 GHz 接收器连接。目前已验证 USB 有线连接，接收器待验证；蓝牙不支持网页配置。TOFU PAD 暂不支持在线编辑宏。

## 使用

1. 接上 USB，Neo75 Cu 切换到有线模式。
2. 点击「添加设备」，选择 VIA 或 ZMK，再在浏览器授权窗口中选择设备。
3. 点击设备卡片，选中键位后按下目标键，也可以搜索功能。

同一浏览器保留授权后，刷新网页或再次插入设备，无需重复添加。

改键默认**自动保存**，宏编辑完成后点击「保存宏」。底部显示「已保存到键盘」即生效。关闭自动保存后，需要手动保存。载入整套配置或备份时，需要确认后写入。

「本地配置」和自动备份保存在当前浏览器，可导出 JSON 备份或迁移。无法连接时，先关闭正在连接同一键盘的其他驱动页面。

## 离线使用

下载后双击 `viapp-windows-x64.exe`，在 Chrome / Edge 中打开 `http://localhost:5178/`。关闭程序窗口即可退出。

在线版与离线版的本地配置分别保存，可通过 JSON 导入、导出迁移。

## 反馈与贡献

遇到问题或想支持更多键盘，请[提交 Issue](https://github.com/ZackLeo219/viapp/issues)。参与开发见[贡献指南](CONTRIBUTING.md)。

非官方开源项目 · [MIT 许可证](LICENSE) · [第三方声明](THIRD_PARTY_NOTICES.md)
