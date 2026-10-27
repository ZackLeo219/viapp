import {
  assertCompatible,
  changesBetween,
  layerName,
  type DeviceSnapshot,
  type Driver,
} from './types';
import { acceptsBinding, normalizeEmptyBindings, referencedLayers } from './behaviors';
export const layersChanged = (a: DeviceSnapshot, b: DeviceSnapshot) =>
  JSON.stringify(a.layers.map((l) => [l.id, layerName(l)])) !==
  JSON.stringify(b.layers.map((l) => [l.id, layerName(l)]));
export const sameConfiguration = (a: DeviceSnapshot, b: DeviceSnapshot) =>
  changesBetween(a, b).length === 0 &&
  JSON.stringify(a.macros) === JSON.stringify(b.macros) &&
  a.layoutOptions === b.layoutOptions &&
  !layersChanged(a, b);
export async function applyConfiguration(
  driver: Driver,
  baseline: DeviceSnapshot,
  desired: DeviceSnapshot,
  backup: (s: DeviceSnapshot) => Promise<unknown>,
  progress: (message: string) => void = () => {},
): Promise<DeviceSnapshot> {
  desired = normalizeEmptyBindings(desired);
  assertCompatible(baseline, desired, true);
  progress('检查设备当前配置');
  const current = await driver.read();
  assertCompatible(baseline, current);
  if (current.locked) throw new Error('Studio 已锁定，请在键盘上解锁后再保存。');
  if (current.firmwareUnsaved)
    throw new Error('设备中已有未保存的修改，请先在设备设置中保存或撤销。');
  if (!sameConfiguration(baseline, current))
    throw new Error('设备配置已被其他工具更改。请先备份草稿，再重新读取设备，避免覆盖新配置。');
  let changes = changesBetween(current, desired);
  const macrosChanged = JSON.stringify(current.macros) !== JSON.stringify(desired.macros);
  const layerChanges = layersChanged(current, desired);
  const layoutChanges = current.layoutOptions !== desired.layoutOptions;
  const validateChanges = (pending: typeof changes) => {
    if (current.protocol !== 'zmk') return;
    const ids = desired.layers.map((l) => l.id);
    for (const { after: binding } of pending) {
      if (binding.type !== 'zmk') throw new Error('配置包含不匹配的按键。');
      const behavior = current.behaviors.find((b) => b.id === binding.behaviorId);
      if (binding.behaviorId === 0) continue;
      if (!behavior || (behavior.metadata?.length && !acceptsBinding(behavior, binding, ids)))
        throw new Error('配置包含无效的行为参数或图层引用。');
    }
  };
  if (layerChanges && !driver.writeLayers) throw new Error('当前固件不支持修改图层。');
  if (layoutChanges && !driver.writeLayout) throw new Error('当前固件不支持切换配列。');
  if (current.protocol === 'zmk') {
    const ids = desired.layers.map((l) => l.id);
    if (desired.layers[0].id !== current.layers[0].id) throw new Error('请保留基础层的位置。');
    if (
      desired.layers.some((layer) => {
        const previous = current.layers.find((l) => l.id === layer.id);
        return previous && layerName(previous) !== layerName(layer);
      })
    )
      throw new Error('当前固件的图层重命名不稳定，暂未开放。');
    if (
      desired.layers.some((layer) =>
        layer.bindings.some((binding) =>
          referencedLayers(current, binding).some((id) => !ids.includes(id)),
        ),
      )
    )
      throw new Error('配置包含无效的图层引用。');
    // Original vendor bindings may carry opaque values omitted from their public
    // metadata. Keep untouched bindings intact; validate only values being written.
    // Archived layers are checked after restoration reveals their retained values.
    validateChanges(changes.filter((change) => change.before !== null));
  }
  if (!changes.length && !macrosChanged && !layoutChanges && !layerChanges) return current;
  progress('保存写入前备份');
  await backup(current);
  let commitStarted = false;
  try {
    if (layerChanges) {
      progress('更新图层');
      await driver.writeLayers!(desired.layers);
      // Restoring a layer exposes its retained bindings; it does not create an
      // empty layer. Diff against those values before writing any key bindings.
      const staged = await driver.read();
      assertCompatible(desired, staged);
      if (layersChanged(staged, desired)) throw new Error('图层更新校验失败。');
      changes = changesBetween(staged, desired);
    }
    validateChanges(changes);
    if (layoutChanges) {
      progress('更新配列');
      await driver.writeLayout!(desired.layoutOptions);
    }
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      progress(`写入按键 ${i + 1} / ${changes.length}`);
      await driver.writeBinding(change.layerId, change.index, change.after);
    }
    if (macrosChanged) {
      progress('写入并校验宏');
      await driver.writeMacros(desired.macros);
    }
    progress('保存到键盘');
    commitStarted = true;
    await driver.commit();
    progress('读回并核对配置');
    const result = await driver.read();
    assertCompatible(desired, result);
    if (!sameConfiguration(result, desired) || result.firmwareUnsaved)
      throw new Error('读回校验没有通过，不能确认保存成功。写入前备份已保留，请重新读取后检查。');
    return result;
  } catch (error) {
    // ZMK edits are staged in RAM. Roll back only this transaction before committing.
    if (!commitStarted && driver.discardChanges)
      await driver.discardChanges().catch(() => undefined);
    throw error;
  }
}
