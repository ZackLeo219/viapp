import Dexie, { type EntityTable } from 'dexie';
import type { Profile } from '../domain/profiles';
import { clone, type DeviceSnapshot } from '../domain/types';

const database = new Dexie('viapp-local') as Dexie & { profiles: EntityTable<Profile, 'id'> };
database.version(1).stores({ profiles: 'id, createdAt, kind, snapshot.model' });
export async function saveProfile(
  name: string,
  snapshot: DeviceSnapshot,
  kind: Profile['kind'] = 'manual',
): Promise<Profile> {
  if (!name.trim() || name.trim().length > 80) throw new Error('配置名称应为 1–80 个字符。');
  const profile: Profile = {
    id: crypto.randomUUID(),
    name: name.trim(),
    createdAt: new Date().toISOString(),
    kind,
    snapshot: clone(snapshot),
  };
  try {
    await database.profiles.add(profile);
  } catch {
    throw new Error('浏览器未能保存本地备份。请检查存储权限或空间后重试。');
  }
  return profile;
}
export const listProfiles = () => database.profiles.orderBy('createdAt').reverse().toArray();
export const removeProfile = (id: string) => database.profiles.delete(id);
