import type Dexie from 'dexie';
import type { EntityTable } from 'dexie';
import type { Profile } from '../domain/profiles';
import { clone, type DeviceSnapshot } from '../domain/types';

type Database = Dexie & { profiles: EntityTable<Profile, 'id'> };
let database: Promise<Database> | undefined;
function getDatabase(): Promise<Database> {
  return (database ??= import('dexie')
    .then(({ default: Dexie }) => {
      const db = new Dexie('viapp-local') as Database;
      db.version(1).stores({ profiles: 'id, createdAt, kind, snapshot.model' });
      return db;
    })
    .catch((error) => {
      database = undefined;
      throw error;
    }));
}
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
    await (await getDatabase()).profiles.add(profile);
  } catch {
    throw new Error('浏览器未能保存本地备份。请检查存储权限或空间后重试。');
  }
  return profile;
}
export const listProfiles = async () =>
  (await getDatabase()).profiles.orderBy('createdAt').reverse().toArray();
export const removeProfile = async (id: string) => (await getDatabase()).profiles.delete(id);
