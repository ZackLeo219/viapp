import { describe, expect, it, vi } from 'vitest';
import { ZmkDriver, describeBehavior, validParameter } from './zmk';
import type { ZmkRpc } from './zmk-rpc';
import type { Request } from '@zmkfirmware/zmk-studio-ts-client/studio';
import type { Layer as RpcLayer } from '@zmkfirmware/zmk-studio-ts-client/keymap';
import { applyConfiguration, sameConfiguration } from '../domain/apply';
import { clone } from '../domain/types';
import { validateSnapshot } from '../domain/profiles';
import { ZMK_DEVICES, type ZmkDeviceDefinition } from '../devices/zmk-registry';

describe('original TOFU PAD firmware metadata', () => {
  it('accepts zero for omitted parameters and rejects nonzero data', () => {
    expect(validParameter(0, [], [0, 1])).toBe(true);
    expect(validParameter(1, [], [0, 1])).toBe(false);
    const hid = [{ name: 'Key', hidUsage: { keyboardMax: 255, consumerMax: 4095 } }];
    expect(validParameter(0x70004, hid, [0, 1])).toBe(true);
    expect(validParameter(0x70100, hid, [0, 1])).toBe(false);
    expect(validParameter(0x80004, hid, [0, 1])).toBe(false);
  });
  it('recognizes manufacturer behavior names instead of assuming upstream names', () => {
    for (const [displayName, kind] of [
      ['Layer Momentary', 'momentary'],
      ['Layer Toggle', 'toggle'],
      ['_Trans', 'transparent'],
      ['Key(None)', 'none'],
    ]) {
      expect(describeBehavior({ id: 7, displayName, metadata: [] }).kind).toBe(kind);
    }
    expect(validParameter(2, [{ name: 'Layer', layerId: {} }], [0, 1])).toBe(false);
    expect(validParameter(1, [{ name: 'Layer', layerId: {} }], [0, 1])).toBe(true);
  });
});

function firmware(
  definition: ZmkDeviceDefinition = ZMK_DEVICES[0],
  keyCount = 18,
  name = 'TOFU PAD',
) {
  const empty = { behaviorId: 0, param1: 0, param2: 0 };
  let order = [0, 1];
  let layers: RpcLayer[] = Array.from({ length: 4 }, (_, id) => ({
    id,
    name: '',
    bindings: Array.from({ length: keyCount }, () => ({ ...empty })),
  }));
  layers[0].bindings[0] = { behaviorId: 7, param1: 0x70004, param2: 0 };
  layers[2].bindings[17] = { behaviorId: 99, param1: 2, param2: 0 };
  let saved = clone({ order, layers }),
    unsaved = false;
  let failMove = false;
  const keymap = () => ({
    layers: order.map((id) => clone(layers[id])),
    availableLayers: 4 - order.length,
    maxLayerNameLength: 20,
  });
  const call = vi.fn(async (request: Omit<Request, 'requestId'>) => {
    if (request.core?.getDeviceInfo)
      return { core: { getDeviceInfo: { name, serialNumber: new Uint8Array([1]) } } };
    if (request.core?.getLockState) return { core: { getLockState: 1 } };
    if (request.behaviors?.listAllBehaviors)
      return { behaviors: { listAllBehaviors: { behaviors: [7, 40, 99] } } };
    if (request.behaviors?.getBehaviorDetails) {
      const id = request.behaviors.getBehaviorDetails.behaviorId;
      return {
        behaviors: {
          getBehaviorDetails: {
            id,
            displayName: id === 7 ? 'Key Press' : id === 40 ? '_Trans' : 'Device_BT3',
            metadata:
              id === 7
                ? [
                    {
                      param1: [{ name: 'Key', hidUsage: { keyboardMax: 255, consumerMax: 4095 } }],
                      param2: [],
                    },
                  ]
                : id === 99
                  ? [{ param1: [], param2: [] }]
                  : [],
          },
        },
      };
    }
    const r = request.keymap!;
    if (r.getKeymap) return { keymap: { getKeymap: keymap() } };
    if (r.getPhysicalLayouts)
      return {
        keymap: {
          getPhysicalLayouts: {
            activeLayoutIndex: 0,
            layouts: [
              {
                name: 'ALL_KEYS',
                keys: Array.from({ length: keyCount }, (_, i) => ({
                  x: (i % 16) * 100,
                  y: Math.floor(i / 16) * 100,
                  width: 100,
                  height: 100,
                  r: 0,
                  rx: 0,
                  ry: 0,
                })),
              },
            ],
          },
        },
      };
    if (r.checkUnsavedChanges) return { keymap: { checkUnsavedChanges: unsaved } };
    if (r.saveChanges) {
      saved = clone({ order, layers });
      unsaved = false;
      return { keymap: { saveChanges: { ok: true } } };
    }
    if (r.discardChanges) {
      ({ order, layers } = clone(saved));
      unsaved = false;
      return { keymap: { discardChanges: true } };
    }
    unsaved = true;
    if (r.addLayer) {
      const id = layers.find((l) => !order.includes(l.id))!.id;
      order.push(id);
      return { keymap: { addLayer: { ok: { layer: clone(layers[id]) } } } };
    }
    if (r.removeLayer) {
      order.splice(r.removeLayer.layerIndex, 1);
      return { keymap: { removeLayer: { ok: keymap() } } };
    }
    if (r.restoreLayer) {
      order.splice(r.restoreLayer.atIndex, 0, r.restoreLayer.layerId);
      return { keymap: { restoreLayer: { ok: clone(layers[r.restoreLayer.layerId]) } } };
    }
    if (r.moveLayer) {
      if (failMove) return { keymap: { moveLayer: { err: 1 } } };
      order.splice(r.moveLayer.destIndex, 0, order.splice(r.moveLayer.startIndex, 1)[0]);
      return { keymap: { moveLayer: { ok: keymap() } } };
    }
    if (r.setLayerProps) {
      throw new Error('Layer renaming must not be sent to the original firmware');
    }
    if (r.setLayerBinding) {
      if (![7, 40].includes(r.setLayerBinding.binding!.behaviorId))
        return { keymap: { setLayerBinding: 1 } };
      layers[r.setLayerBinding.layerId].bindings[r.setLayerBinding.keyPosition] = clone(
        r.setLayerBinding.binding!,
      );
      return { keymap: { setLayerBinding: 0 } };
    }
    throw new Error('Unexpected firmware request');
  });
  return {
    driver: new ZmkDriver({ call } as unknown as ZmkRpc, definition),
    call,
    rejectMove() {
      failMove = true;
    },
    raw: () => clone({ order, layers }),
  };
}
describe('TOFU family self-described Studio layouts', () => {
  it.each([
    [1, 61, 'Tofu60 BLE 3.0(USB)'],
    [2, 68, 'Tofu65 BLE 3.0(USB)'],
    [3, 88, 'Tofu TKL BLE v3.0'],
  ] as const)(
    'reads and saves model %i using firmware-provided positions',
    async (index, count, name) => {
      const { driver, call } = firmware(ZMK_DEVICES[index], count, name);
      const before = await driver.read();
      expect(before.name).toBe(ZMK_DEVICES[index].name);
      expect(before.model).toBe(ZMK_DEVICES[index].model);
      expect(before.identity).toMatch(/^9D5B:256[234]:01$/);
      expect(before.keys).toHaveLength(count);
      expect(validateSnapshot(before)).toEqual(before);
      const desired = clone(before);
      desired.layers[0].bindings[count - 1] = {
        type: 'zmk',
        behaviorId: 7,
        param1: 0x70005,
        param2: 0,
      };
      const applied = await applyConfiguration(driver, before, desired, async () => {});
      expect(sameConfiguration(applied, desired)).toBe(true);
      expect(
        call.mock.calls.some(([r]) => r.keymap?.setLayerBinding?.keyPosition === count - 1),
      ).toBe(true);
      const restored = await applyConfiguration(driver, applied, before, async () => {});
      expect(sameConfiguration(restored, before)).toBe(true);
    },
  );
  it('rejects a name mismatch before reading or modifying a keymap', async () => {
    const { driver, call } = firmware(ZMK_DEVICES[1], 61, 'Unrelated board');
    await expect(driver.read()).rejects.toThrow('不匹配');
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('rejects a layout outside the registered model range', async () => {
    const { driver } = firmware(ZMK_DEVICES[1], 90, 'Tofu60 BLE 3.0(USB)');
    await expect(driver.read()).rejects.toThrow('布局');
  });
});
describe('ZMK layer RPC transactions', () => {
  it('reads layer capacity and treats unassigned bindings as transparent', async () => {
    const { driver } = firmware(),
      before = await driver.read();
    expect(before.deviceInfo?.layerCapacity).toBe(4);
    expect(before.layers[0].storedName).toBe('');
    expect(before.layers[1].bindings[0]).toEqual({
      type: 'zmk',
      behaviorId: 40,
      param1: 0,
      param2: 0,
    });
  });
  it('adds, reorders, removes and restores layers without losing retained bindings', async () => {
    const { driver, call, raw } = firmware(),
      original = await driver.read();
    await driver.addLayer();
    await driver.commit();
    const added = await driver.read(),
      desired = clone(added);
    desired.layers = [desired.layers[0], desired.layers[2], desired.layers[1]];
    desired.layers[1].bindings[1] = { type: 'zmk', behaviorId: 7, param1: 0x1070006, param2: 0 };
    const backup = vi.fn(async () => {});
    const changed = await applyConfiguration(driver, added, desired, backup);
    expect(changed.layers.map((l) => l.id)).toEqual([0, 2, 1]);
    expect(changed.layers[1].storedName).toBe('');
    expect(backup).toHaveBeenCalledOnce();
    const removed = await applyConfiguration(driver, changed, original, async () => {});
    const writes = call.mock.calls.filter(([r]) => r.keymap?.setLayerBinding).length;
    const restored = await applyConfiguration(driver, removed, changed, async () => {});
    expect(sameConfiguration(changed, restored)).toBe(true);
    expect(call.mock.calls.filter(([r]) => r.keymap?.setLayerBinding)).toHaveLength(writes);
    expect(raw().layers[2].bindings[0].behaviorId).toBe(0);
    // Undo a key on a previously unassigned position using explicit transparency.
    const undo = clone(restored);
    undo.layers[1].bindings[1] = { type: 'zmk', behaviorId: 40, param1: 0, param2: 0 };
    expect(
      (await applyConfiguration(driver, restored, undo, async () => {})).layers[1].bindings[1],
    ).toEqual(undo.layers[1].bindings[1]);
  });
  it('rejects renamed layers before making changes to the firmware', async () => {
    const { driver, call } = firmware(),
      before = await driver.read(),
      desired = clone(before);
    desired.layers[1].name = desired.layers[1].storedName = 'Work';
    const count = call.mock.calls.length;
    await expect(driver.writeLayers(desired.layers)).rejects.toThrow('名称');
    expect(call.mock.calls).toHaveLength(count);
  });
  it('restores a removed layer when a subsequent reorder fails', async () => {
    const { driver, call, rejectMove } = firmware();
    await driver.read();
    await driver.addLayer();
    await driver.read();
    await driver.addLayer();
    await driver.commit();
    const before = await driver.read(),
      desired = clone(before);
    desired.layers = [desired.layers[0], desired.layers[2], desired.layers[1]];
    rejectMove();
    const backup = vi.fn(async () => {});
    await expect(applyConfiguration(driver, before, desired, backup)).rejects.toThrow('顺序');
    expect(backup).toHaveBeenCalledOnce();
    expect(call.mock.calls.some(([r]) => r.keymap?.removeLayer)).toBe(true);
    expect(call.mock.calls.some(([r]) => r.keymap?.discardChanges)).toBe(true);
    expect(sameConfiguration(before, await driver.read())).toBe(true);
  });
  it('rejects duplicate or out-of-capacity layer IDs without device writes', async () => {
    const { driver, call } = firmware(),
      before = await driver.read();
    for (const id of [0, 4]) {
      const desired = clone(before);
      desired.layers[1].id = id;
      const count = call.mock.calls.length;
      await expect(applyConfiguration(driver, before, desired, async () => {})).rejects.toThrow(
        '匹配',
      );
      expect(call.mock.calls).toHaveLength(count);
    }
  });
});
