import type { ModelId } from '../domain/types';

export interface ZmkDeviceDefinition {
  model: ModelId;
  name: string;
  usbVendorId: number;
  usbProductId: number;
  deviceName: RegExp;
  minKeys: number;
  maxKeys: number;
}

// USB identities and Studio support come from the manufacturer's openkbd configs.
// Layouts and bindings are read from the connected firmware, never guessed here.
export const ZMK_DEVICES: ZmkDeviceDefinition[] = [
  {
    model: 'tofu-pad',
    name: 'TOFU PAD',
    usbVendorId: 0x9d5b,
    usbProductId: 0x2566,
    deviceName: /^tofu\s*pad\b/i,
    minKeys: 10,
    maxKeys: 32,
  },
  {
    model: 'zmk-9d5b-2562',
    name: 'TOFU60 3.0',
    usbVendorId: 0x9d5b,
    usbProductId: 0x2562,
    deviceName: /^tofu\s*60\b/i,
    minKeys: 40,
    maxKeys: 80,
  },
  {
    model: 'zmk-9d5b-2563',
    name: 'TOFU65 3.0',
    usbVendorId: 0x9d5b,
    usbProductId: 0x2563,
    deviceName: /^tofu\s*65\b/i,
    minKeys: 40,
    maxKeys: 80,
  },
  {
    model: 'zmk-9d5b-2564',
    name: 'TOFU TKL',
    usbVendorId: 0x9d5b,
    usbProductId: 0x2564,
    deviceName: /^tofu\s*tkl\b/i,
    minKeys: 70,
    maxKeys: 110,
  },
];

export const serialFilters = ZMK_DEVICES.map(({ usbVendorId, usbProductId }) => ({
  usbVendorId,
  usbProductId,
}));
export const TOFU_USB = serialFilters[0];
export function identifyZmkDevice(info: SerialPortInfo): ZmkDeviceDefinition | undefined {
  return ZMK_DEVICES.find(
    (d) => d.usbVendorId === info.usbVendorId && d.usbProductId === info.usbProductId,
  );
}
