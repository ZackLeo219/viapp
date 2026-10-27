import { hasViaInterface, viaFilters } from '../devices/via-registry';
import { viaModel } from '../domain/via-definition';
import type { ModelId } from '../domain/types';
import { TOFU_USB } from './zmk';

export type DeviceAccess =
  | { model: ModelId; transport: 'hid'; device: HIDDevice }
  | { model: 'tofu-pad'; transport: 'serial'; port: SerialPort };
export function identifyHid(device: HIDDevice): DeviceAccess | null {
  return hasViaInterface(device) && !(device.vendorId === 0x36b0 && device.productId === 0x3002)
    ? { model: viaModel(device.vendorId, device.productId), transport: 'hid', device }
    : null;
}
export function identifySerial(port: SerialPort): DeviceAccess | null {
  const info = port.getInfo();
  return info.usbVendorId === TOFU_USB.usbVendorId && info.usbProductId === TOFU_USB.usbProductId
    ? { model: 'tofu-pad', transport: 'serial', port }
    : null;
}
export async function authorizedDevices(): Promise<DeviceAccess[]> {
  if (!window.isSecureContext) return [];
  const results = await Promise.allSettled([
    navigator.hid?.getDevices() ?? Promise.resolve([]),
    navigator.serial?.getPorts() ?? Promise.resolve([]),
  ]);
  const hid = results[0].status === 'fulfilled' ? results[0].value : [];
  const ports = results[1].status === 'fulfilled' ? results[1].value : [];
  return [
    ...hid.map(identifyHid),
    ...ports.filter((p) => !('connected' in p) || p.connected !== false).map(identifySerial),
  ].filter((d): d is DeviceAccess => d !== null);
}
export async function requestDeviceAccess(transport: 'hid' | 'serial'): Promise<DeviceAccess> {
  if (!window.isSecureContext || !(transport in navigator))
    throw new Error('请使用桌面 Chrome / Edge，通过 HTTPS 或 localhost 打开网页。');
  const access =
    transport === 'hid'
      ? (
          await navigator.hid.requestDevice({
            filters: viaFilters,
            exclusionFilters: [{ vendorId: 0x36b0, productId: 0x3002 }],
          })
        )
          .map(identifyHid)
          .find(Boolean)
      : identifySerial(await navigator.serial.requestPort({ filters: [TOFU_USB] }));
  if (!access) throw new DOMException('未选择受支持的设备。', 'NotFoundError');
  return access;
}
