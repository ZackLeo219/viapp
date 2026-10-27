import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizedDevices, identifyHid, identifySerial, requestDeviceAccess } from './discovery';
import { NEO_USB } from './via';
import { TOFU_USB } from './zmk';

const hid = {
  ...NEO_USB,
  collections: [{ usagePage: NEO_USB.usagePage, usage: NEO_USB.usage }],
} as unknown as HIDDevice;
const serial = { getInfo: () => TOFU_USB, connected: true } as unknown as SerialPort;
afterEach(() => vi.unstubAllGlobals());
describe('permission-based device discovery', () => {
  it('recognizes supported original USB interfaces and rejects unrelated devices', () => {
    expect(identifyHid(hid)?.model).toBe('neo75cu');
    expect(identifySerial(serial)?.model).toBe('tofu-pad');
    expect(
      identifyHid({ ...hid, collections: [{ usagePage: 1, usage: 6 }] } as HIDDevice),
    ).toBeNull();
    expect(identifyHid({ ...hid, productId: 1 } as unknown as HIDDevice)?.model).toBe(
      'via-36b0-0001',
    );
    expect(identifyHid({ ...hid, productId: 0x3060 } as unknown as HIDDevice)?.model).toBe(
      'neo65cu',
    );
    expect(identifyHid({ ...hid, productId: 0x3002 } as unknown as HIDDevice)).toBeNull();
    expect(
      identifySerial({ getInfo: () => ({ usbVendorId: 1, usbProductId: 2 }) } as SerialPort),
    ).toBeNull();
  });
  it('enumerates both existing grants without prompting, ignores disconnected ports', async () => {
    const request = vi.fn();
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', {
      hid: { getDevices: vi.fn().mockResolvedValue([hid]), requestDevice: request },
      serial: {
        getPorts: vi
          .fn()
          .mockResolvedValue([serial, { getInfo: () => TOFU_USB, connected: false }]),
        requestPort: request,
      },
    });
    expect((await authorizedDevices()).map((d) => d.model)).toEqual(['neo75cu', 'tofu-pad']);
    expect(request).not.toHaveBeenCalled();
  });
  it('still discovers HID devices if serial permission enumeration fails', async () => {
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', {
      hid: { getDevices: () => Promise.resolve([hid]) },
      serial: { getPorts: () => Promise.reject(new Error('denied')) },
    });
    expect((await authorizedDevices()).map((d) => d.model)).toEqual(['neo75cu']);
  });
  it('requests only the chosen native interface and identifies the result', async () => {
    const requestHid = vi.fn().mockResolvedValue([hid]);
    const requestSerial = vi.fn().mockResolvedValue(serial);
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', {
      hid: { requestDevice: requestHid },
      serial: { requestPort: requestSerial },
    });
    expect((await requestDeviceAccess('hid')).model).toBe('neo75cu');
    expect(requestSerial).not.toHaveBeenCalled();
    expect((await requestDeviceAccess('serial')).model).toBe('tofu-pad');
    expect(requestHid).toHaveBeenCalledTimes(1);
  });
  it('limits reauthorization to the disconnected keyboard identity', async () => {
    const requestDevice = vi.fn().mockResolvedValue([{ ...hid, productId: 0x3060 }]);
    vi.stubGlobal('window', { isSecureContext: true });
    vi.stubGlobal('navigator', { hid: { requestDevice } });
    expect((await requestDeviceAccess('hid', 'neo65cu')).model).toBe('neo65cu');
    expect(requestDevice).toHaveBeenLastCalledWith({
      filters: [{ vendorId: 0x36b0, productId: 0x3060 }],
      exclusionFilters: [{ vendorId: 0x36b0, productId: 0x3002 }],
    });
    requestDevice.mockResolvedValue([{ ...hid, vendorId: 0x1234, productId: 0x5678 }]);
    expect((await requestDeviceAccess('hid', 'via-1234-5678')).model).toBe('via-1234-5678');
    expect(requestDevice.mock.lastCall?.[0].filters).toEqual([
      { vendorId: 0x1234, productId: 0x5678 },
    ]);
  });
});
