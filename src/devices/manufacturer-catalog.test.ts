import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  definitionLayout,
  parseViaDefinition,
  setOption,
  usbIdentity,
} from '../domain/via-definition';
import {
  DefinitionRequired,
  forgetDefinition,
  importDefinition,
  resolveDefinition,
  viaFilters,
} from './via-registry';
import manifest from './manufacturer-sources.json';
import index from './manufacturer-index.json';

interface Entry {
  key: string;
  label: string;
  format: number;
  productName: string;
  definition: unknown;
}
const catalog = JSON.parse(readFileSync('public/definitions/manufacturers.json', 'utf8')) as Record<
  string,
  Entry[]
>;
const device = (id: string, productName: string) => {
  const [vendorId, productId] = id.split(':').map((n) => parseInt(n, 16));
  return { vendorId, productId, productName };
};
const storage = new Map<string, string>();
beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => catalog }));
});
afterEach(() => {
  storage.clear();
  vi.unstubAllGlobals();
});

describe('published manufacturer definitions', () => {
  it('covers every pinned source and validates all selectable physical layouts', () => {
    const entries = Object.values(catalog).flat();
    expect(new Set(entries.map((e) => e.key))).toEqual(new Set(manifest.sources.map((s) => s.key)));
    expect(Object.keys(catalog)).toEqual(index.identities);
    let combinations = 0;
    for (const [id, entries] of Object.entries(catalog))
      for (const entry of entries) {
        const d = parseViaDefinition(entry.definition);
        expect(usbIdentity(d.vendorId, d.productId)).toBe(id);
        expect(viaFilters).toContainEqual({ vendorId: d.vendorId, productId: d.productId });
        let options = [0];
        d.options.forEach((option, i) => {
          options = options.flatMap((packed) =>
            option.choices.map((_, c) => setOption(d.options, packed, i, c)),
          );
        });
        for (const option of options) {
          const keys = definitionLayout(d, option);
          expect(keys.length, `${entry.label}, options=${option}`).toBeGreaterThan(0);
          expect(keys.every((k) => k.index >= 0 && k.index < d.matrix.rows * d.matrix.cols)).toBe(
            true,
          );
          combinations++;
        }
      }
    expect(combinations).toBeGreaterThan(entries.length);
  });
  it.each([
    ['36B0:30C2', 'Neo80 Cu', 'Neo80 Cu'],
    ['36B0:30D8', 'Neo80 Cu', 'Neo80 Cu'],
    ['9D5B:2504', 'TOFU60', 'TOFU60 3.0'],
    ['9D5B:2505', 'TOFU65', 'TOFU65 3.0'],
    ['9D5B:2506', 'TOFU TKL', 'TOFU TKL'],
    ['9D5B:2511', 'TOFU PAD', 'TOFU PAD'],
    ['36B0:300E', 'EVO80', 'EVO80'],
  ])('resolves %s from the shipped catalog', async (id, product, name) => {
    const definition = await resolveDefinition(device(id, product), 12);
    expect(definition.name).toBe(name);
    expect(definitionLayout(definition).length).toBeGreaterThan(10);
  });
  it('uses QK100 definition format matching the firmware protocol', async () => {
    const target = device('4F53:3030', 'QK100');
    for (const [version, format] of [
      [10, 2],
      [12, 3],
    ]) {
      expect(await resolveDefinition(target, version)).toEqual(
        parseViaDefinition(catalog['4F53:3030'].find((e) => e.format === format)!.definition),
      );
    }
  });
  it('requires a choice for shared identities and remembers it without guessing another product', async () => {
    const target = device('4E45:3830', 'NEO80 Cu');
    forgetDefinition(target);
    const error = (await resolveDefinition(target, 12).catch((e) => e)) as DefinitionRequired;
    expect(error).toBeInstanceOf(DefinitionRequired);
    expect(error.choices.map((c) => c.label)).toEqual(['Neo80 Cu · 焊接', 'Neo80 Cu · 有线 ANSI']);
    const picked = importDefinition(target, error.choices[1].definition);
    expect(await resolveDefinition(target, 12)).toEqual(picked);
    expect((await resolveDefinition(device('4E45:3830', 'NEO80 Wired PCB'), 12)).name).toBe(
      'Neo80',
    );
    forgetDefinition(target);
    await expect(resolveDefinition(target, 12)).rejects.toBeInstanceOf(DefinitionRequired);
  });
  it('does not silently reuse old USB-only imports on an ambiguous identity', async () => {
    storage.set(
      'viapp:via-definition:1:36B0:3116',
      JSON.stringify(catalog['36B0:3116'][0].definition),
    );
    const error = (await resolveDefinition(device('36B0:3116', 'Neo Code98'), 12).catch(
      (e) => e,
    )) as DefinitionRequired;
    expect(error.choices.map((c) => c.label)).toEqual(['Neo98 · 三模 ANSI', 'Neo98 · 三模 ISO']);
  });
});
