// Run only from the isolated USB verification page, after writing an original backup.
import { applyConfiguration, sameConfiguration } from '../src/domain/apply';
import { clone, type DeviceSnapshot, type Driver } from '../src/domain/types';
import { acceptsBinding, advancedKind, shortcutBinding } from '../src/domain/behaviors';
import { snapshotLayout } from '../src/domain/via-definition';

export async function verifyFeatures(driver: Driver, original: DeviceSnapshot) {
  const checks: string[] = [];
  const backups: DeviceSnapshot[] = [];
  const keepBackup = async (snapshot: DeviceSnapshot) => {
    backups.push(clone(snapshot));
  };
  const reserved = new Map<number, DeviceSnapshot['layers'][number]>();
  let failure: string | null = null;
  let restored = false;
  if (original.locked || original.firmwareUnsaved)
    throw new Error('Device must be unlocked and saved before testing.');
  if (
    original.protocol === 'zmk' &&
    (original.deviceInfo?.layerCapacity ?? 0) - original.layers.length < 2
  )
    throw new Error('Feature verification requires two unused layer slots.');
  try {
    let current = await driver.read();
    if (!sameConfiguration(original, current))
      throw new Error('Configuration changed since backup.');
    if (current.protocol === 'via') {
      const desired = clone(current);
      desired.layoutOptions ^= 15;
      desired.keys = snapshotLayout(desired, desired.layoutOptions);
      const index = Array.from({ length: desired.layers[0].bindings.length }, (_, i) => i).find(
        (i) =>
          !original.keys.some((k) => k.index === i) && !desired.keys.some((k) => k.index === i),
      );
      if (index === undefined) throw new Error('No unused matrix position available for testing');
      desired.layers.at(-1)!.bindings[index] = shortcutBinding(desired, 6, 3)!;
      current = await applyConfiguration(driver, current, desired, keepBackup);
      checks.push('layout-write-readback', 'shortcut-write-readback');
      if (!Array.isArray(await driver.readMatrix!())) throw new Error('No matrix response');
      checks.push('matrix-query');
    } else {
      await driver.addLayer!();
      const staged = await driver.read();
      if (!staged.firmwareUnsaved || staged.layers.length !== original.layers.length + 1)
        throw new Error('Layer staging failed');
      await driver.discardChanges!();
      current = await driver.read();
      if (!sameConfiguration(original, current) || current.firmwareUnsaved)
        throw new Error('Discard failed');
      checks.push('discard-staged-layer');
      for (let i = 0; i < 2; i++) {
        await driver.addLayer!();
        const added = await driver.read();
        for (const layer of added.layers)
          if (!current.layers.some((l) => l.id === layer.id)) reserved.set(layer.id, clone(layer));
        current = added;
      }
      await driver.commit();
      current = await driver.read();
      const desired = clone(current);
      const addedIds = [...reserved.keys()];
      const extra = desired.layers.find((l) => l.id === addedIds[0])!;
      desired.layers.splice(1, 0, desired.layers.splice(desired.layers.indexOf(extra), 1)[0]);
      const layer = desired.layers.find((l) => l.id === original.layers.at(-1)!.id)!;
      const indices = layer.bindings
        .map((b, i) => {
          const behavior = b.type === 'zmk' && desired.behaviors.find((x) => x.id === b.behaviorId);
          return b.type === 'zmk' &&
            behavior &&
            (!behavior.metadata?.length ||
              acceptsBinding(
                behavior,
                b,
                desired.layers.map((l) => l.id),
              ))
            ? i
            : -1;
        })
        .filter((i) => i >= 0)
        .slice(-4);
      if (indices.length < 4) throw new Error('Not enough restorable original bindings');
      layer.bindings[indices[0]] = shortcutBinding(desired, 6, 3)!;
      const lt = desired.behaviors.find((b) => advancedKind(b) === 'layer-tap')!;
      const mt = desired.behaviors.find((b) => advancedKind(b) === 'mod-tap')!;
      const mouse = desired.behaviors.find((b) => advancedKind(b) === 'mouse')!;
      layer.bindings[indices[1]] = { type: 'zmk', behaviorId: lt.id, param1: 0, param2: 0x7002c };
      layer.bindings[indices[2]] = {
        type: 'zmk',
        behaviorId: mt.id,
        param1: 0x700e0,
        param2: 0x70004,
      };
      layer.bindings[indices[3]] = { type: 'zmk', behaviorId: mouse.id, param1: 1, param2: 0 };
      current = await applyConfiguration(driver, current, desired, keepBackup);
      checks.push(
        'add-layer',
        'reorder-layer',
        'shortcut-write-readback',
        'layer-tap-write-readback',
        'mod-tap-write-readback',
        'mouse-button-write-readback',
      );
    }
  } catch (error) {
    failure = String(error);
  } finally {
    let current = await driver.read();
    if (current.firmwareUnsaved && driver.discardChanges) {
      await driver.discardChanges();
      current = await driver.read();
    }
    if (reserved.size) {
      // Deleted layers retain their contents. Restore their bindings before removing them.
      const desired = clone(current);
      for (const [id, layer] of reserved) {
        const index = desired.layers.findIndex((l) => l.id === id);
        if (index >= 0) desired.layers[index] = clone(layer);
      }
      current = await applyConfiguration(driver, current, desired, keepBackup);
    }
    current = await applyConfiguration(driver, current, original, keepBackup);
    restored = sameConfiguration(original, current) && !current.firmwareUnsaved;
    if (!restored) throw new Error('ORIGINAL CONFIGURATION RESTORE FAILED');
    if (reserved.size) checks.push('remove-layer', 'restore-original-and-reserved-layers');
  }
  return { checks, backups: backups.length, restored, failure };
}
