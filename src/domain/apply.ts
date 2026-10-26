import { assertCompatible, changesBetween, type DeviceSnapshot, type Driver } from './types';
export const sameConfiguration = (a: DeviceSnapshot, b: DeviceSnapshot) =>
  changesBetween(a, b).length === 0 && JSON.stringify(a.macros) === JSON.stringify(b.macros);
export async function applyConfiguration(
  driver: Driver,
  baseline: DeviceSnapshot,
  desired: DeviceSnapshot,
  backup: (s: DeviceSnapshot) => Promise<unknown>,
  progress: (message: string) => void = () => {},
): Promise<DeviceSnapshot> {
  assertCompatible(baseline, desired);
  progress('检查设备当前配置');
  const current = await driver.read();
  assertCompatible(baseline, current);
  if (current.locked) throw new Error('Studio 已锁定，请在键盘上解锁后再保存。');
  if (current.firmwareUnsaved)
    throw new Error('设备中已有未保存的修改，请先在原配置工具中保存或撤销，再重新读取。');
  if (!sameConfiguration(baseline, current))
    throw new Error('设备配置已被其他工具更改。请先备份草稿，再重新读取设备，避免覆盖新配置。');
  const changes = changesBetween(current, desired);
  const macrosChanged = JSON.stringify(current.macros) !== JSON.stringify(desired.macros);
  if (!changes.length && !macrosChanged) return current;
  progress('保存写入前备份');
  await backup(current);
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
  await driver.commit();
  progress('读回并核对配置');
  const result = await driver.read();
  assertCompatible(desired, result);
  if (!sameConfiguration(result, desired) || result.firmwareUnsaved)
    throw new Error('读回校验没有通过，不能确认保存成功。写入前备份已保留，请重新读取后检查。');
  return result;
}
