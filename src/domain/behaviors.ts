import type { BehaviorParameterValueDescription } from '@zmkfirmware/zmk-studio-ts-client/behaviors';
import type { Behavior, Binding, DeviceSnapshot } from './types';

// ZMK's unassigned behavior falls through to lower layers, like &trans. The RPC
// cannot write behavior ID 0, so use the firmware's explicit transparent behavior.
export function normalizeEmptyBindings(snapshot: DeviceSnapshot): DeviceSnapshot {
  const transparent = snapshot.behaviors.find((b) => b.kind === 'transparent');
  if (snapshot.protocol !== 'zmk' || !transparent) return snapshot;
  return {
    ...snapshot,
    layers: snapshot.layers.map((layer) => ({
      ...layer,
      bindings: layer.bindings.map((binding) =>
        binding.type === 'zmk' && binding.behaviorId === 0
          ? { ...binding, behaviorId: transparent.id, param1: 0, param2: 0 }
          : binding,
      ),
    })),
  };
}

export function validParameter(
  value: number,
  specs: BehaviorParameterValueDescription[],
  layerIds: number[],
): boolean {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return false;
  if (!specs.length) return value === 0;
  return specs.some((spec) => {
    if (spec.nil !== undefined) return value === 0;
    if (spec.constant !== undefined) return value === spec.constant;
    if (spec.range) return value >= spec.range.min && value <= spec.range.max;
    if (spec.layerId) return layerIds.includes(value);
    if (spec.hidUsage) {
      const page = (value >>> 16) & 255,
        usage = value & 65535;
      return (
        (page === 7 && usage <= spec.hidUsage.keyboardMax) ||
        (page === 12 && usage <= spec.hidUsage.consumerMax)
      );
    }
    return false;
  });
}
export function acceptsBinding(
  behavior: Behavior,
  binding: Extract<Binding, { type: 'zmk' }>,
  layers: number[],
) {
  return (
    behavior.id === binding.behaviorId &&
    !!behavior.metadata?.some(
      (set) =>
        validParameter(binding.param1, set.param1, layers) &&
        validParameter(binding.param2, set.param2, layers),
    )
  );
}
export function advancedKind(
  behavior: Behavior | undefined,
): 'layer-tap' | 'mod-tap' | 'mouse' | 'to-layer' | null {
  if (!behavior?.metadata?.length) return null;
  if (/^layer-tap\b/i.test(behavior.name)) return 'layer-tap';
  if (/^mod-tap\b/i.test(behavior.name)) return 'mod-tap';
  if (/^mouse key press$/i.test(behavior.name)) return 'mouse';
  if (/^layer to$/i.test(behavior.name)) return 'to-layer';
  return null;
}
export function behaviorTitle(behavior: Behavior): string {
  const kind = advancedKind(behavior);
  const preference = /\(TP\)/i.test(behavior.name)
    ? '轻点优先'
    : /\(HP\)/i.test(behavior.name)
      ? '长按优先'
      : '';
  const title =
    kind === 'layer-tap'
      ? '长按切层'
      : kind === 'mod-tap'
        ? '长按修饰键'
        : kind === 'mouse'
          ? '鼠标按键'
          : kind === 'to-layer'
            ? '切换图层'
            : behavior.name;
  return preference ? `${title} · ${preference}` : title;
}
export function shortcutBinding(
  snapshot: DeviceSnapshot,
  hid: number,
  modifiers: number,
): Binding | null {
  if (
    !Number.isInteger(hid) ||
    hid < 4 ||
    hid > 223 ||
    !Number.isInteger(modifiers) ||
    modifiers < 0 ||
    modifiers > 15
  )
    return null;
  if (snapshot.protocol === 'via') return { type: 'via', code: (modifiers << 8) | hid };
  const behavior = snapshot.behaviors.find((b) => b.kind === 'key');
  if (!behavior) return null;
  const binding: Binding = {
    type: 'zmk',
    behaviorId: behavior.id,
    param1: ((modifiers << 24) | 0x70000 | hid) >>> 0,
    param2: 0,
  };
  return acceptsBinding(
    behavior,
    binding,
    snapshot.layers.map((l) => l.id),
  )
    ? binding
    : null;
}
export function referencedLayers(snapshot: DeviceSnapshot, binding: Binding): number[] {
  if (binding.type !== 'zmk') return [];
  const behavior = snapshot.behaviors.find((b) => b.id === binding.behaviorId);
  const matching =
    behavior?.metadata?.filter(
      (set) =>
        validParameter(
          binding.param1,
          set.param1,
          snapshot.layers.map((l) => l.id),
        ) &&
        validParameter(
          binding.param2,
          set.param2,
          snapshot.layers.map((l) => l.id),
        ),
    ) ?? [];
  if (behavior?.kind === 'momentary' || behavior?.kind === 'toggle') return [binding.param1];
  return [
    ...new Set(
      matching
        .flatMap((set) => [
          set.param1.some((s) => s.layerId) ? binding.param1 : -1,
          set.param2.some((s) => s.layerId) ? binding.param2 : -1,
        ])
        .filter((id) => id >= 0),
    ),
  ];
}
