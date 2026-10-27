import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DefinitionRequired,
  importDefinition,
  resolveDefinition,
  viaFilters,
} from './via-registry';
const storage = new Map<string, string>();
afterEach(() => {
  storage.clear();
  vi.unstubAllGlobals();
});
const raw = {
  name: 'Custom Pad',
  vendorId: '0xCAFE',
  productId: '0xBEEF',
  matrix: { rows: 1, cols: 2 },
  layouts: { keymap: [['0,0', '0,1']] },
};
describe('VIA definition registry', () => {
  it('loads original Neo65 without network and includes catalog identities in the picker', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const d = await resolveDefinition(
      { vendorId: 0x36b0, productId: 0x3060, productName: 'Neo 65Cu' },
      12,
    );
    expect(d.name).toBe('Neo65 Cu');
    expect(fetch).not.toHaveBeenCalled();
    expect(viaFilters).toContainEqual({ vendorId: 0x36b0, productId: 0x3060 });
    expect(viaFilters.length).toBeGreaterThan(2000);
  });
  it('rejects mismatched USB identities before persisting an import', () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem });
    expect(() => importDefinition({ vendorId: 0x1111, productId: 0x2222 }, raw)).toThrow('不匹配');
    expect(setItem).not.toHaveBeenCalled();
  });
  it('remembers a validated imported definition and reuses it without network', async () => {
    vi.stubGlobal('localStorage', {
      setItem: (k: string, v: string) => storage.set(k, v),
      getItem: (k: string) => storage.get(k) ?? null,
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const device = { vendorId: 0xcafe, productId: 0xbeef, productName: 'Custom Pad' };
    expect(importDefinition(device, raw).matrix.cols).toBe(2);
    expect((await resolveDefinition(device, 12)).name).toBe('Custom Pad');
    expect(storage.size).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('matches a catalog definition by USB identity and rejects ambiguity', async () => {
    const device = { vendorId: 0x5946, productId: 1, productName: 'Claw44' };
    const definition = { ...raw, name: 'Claw44', vendorId: '0x5946', productId: '0x0001' };
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        '5946:0001': { v2: [], v3: [{ path: 'v3/claw44/claw44.json', definition }] },
      }),
    });
    vi.stubGlobal('fetch', fetch);
    expect((await resolveDefinition(device, 12)).name).toBe('Claw44');
    expect(fetch).toHaveBeenCalledOnce();
    await expect(
      resolveDefinition({ vendorId: 0xeeee, productId: 0xabcd, productName: 'Unknown' }, 12),
    ).rejects.toBeInstanceOf(DefinitionRequired);
  });
});
