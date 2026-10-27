import { neoLayout, tofuPreviewLayout } from './layouts';
import {
  clone,
  type Binding,
  type DeviceSnapshot,
  type Driver,
  type ModelId,
  type Layer,
} from './types';

export function previewSnapshot(model: ModelId): DeviceSnapshot {
  const neo = model === 'neo75cu';
  const keys = neo ? neoLayout() : tofuPreviewLayout();
  const none: Binding = neo
    ? { type: 'via', code: 0 }
    : { type: 'zmk', behaviorId: 2, param1: 0, param2: 0 };
  const basic = (code: number): Binding =>
    neo
      ? { type: 'via', code }
      : { type: 'zmk', behaviorId: 1, param1: (7 << 16) | code, param2: 0 };
  const bindings = Array.from({ length: neo ? 96 : keys.length }, () => clone(none));
  if (neo) {
    const rows = [
      [41, ...Array.from({ length: 12 }, (_, i) => 58 + i)],
      [53, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 45, 46, 42, 0, 76],
      [43, 20, 26, 8, 21, 23, 28, 24, 12, 18, 19, 47, 48, 49, 73, 78],
      [57, 4, 22, 7, 9, 10, 11, 13, 14, 15, 51, 52, 0, 40, 74, 75],
      [225, 0, 29, 27, 6, 25, 5, 17, 16, 54, 55, 56, 0, 229, 82],
      [224, 227, 226, 0, 0, 44, 0, 0, 0, 230, 0x5221, 0, 0, 80, 81, 79],
    ];
    rows.forEach((row, r) =>
      row.forEach((code, c) => {
        bindings[r * 16 + c] = basic(code);
      }),
    );
  } else {
    [41, 83, 84, 85, 86, 95, 96, 97, 92, 93, 94, 87, 89, 90, 91, 98, 99, 88].forEach((code, i) => {
      bindings[i] = basic(code);
    });
    bindings[0] = { type: 'zmk', behaviorId: 4, param1: 1, param2: 0 };
  }
  const layers = [
    { id: 0, name: '基础层', bindings },
    ...Array.from({ length: neo ? 3 : 1 }, (_, index) => ({
      id: index + 1,
      name: `功能层 ${index + 1}`,
      bindings: bindings.map(
        (): Binding =>
          neo ? { type: 'via', code: 1 } : { type: 'zmk', behaviorId: 3, param1: 0, param2: 0 },
      ),
    })),
  ];
  return {
    model,
    name: neo ? 'Neo75 Cu' : 'TOFU PAD',
    protocol: neo ? 'via' : 'zmk',
    protocolVersion: neo ? 12 : 1,
    identity: `DEMO:${model}`,
    layers,
    keys,
    behaviors: neo
      ? []
      : [
          {
            id: 1,
            name: 'Key Press',
            kind: 'key',
            parameterCount: 1,
            metadata: [
              {
                param1: [{ name: 'Key', hidUsage: { keyboardMax: 255, consumerMax: 4095 } }],
                param2: [],
              },
            ],
          },
          { id: 2, name: 'None', kind: 'none', parameterCount: 0 },
          { id: 3, name: 'Transparent', kind: 'transparent', parameterCount: 0 },
          {
            id: 4,
            name: 'Momentary Layer',
            kind: 'momentary',
            parameterCount: 1,
            metadata: [{ param1: [{ name: 'Layer', layerId: {} }], param2: [] }],
          },
          ...['Layer-Tap(TP)', 'Layer-Tap(HP)', 'Mod-Tap(HP)', 'Mod-Tap(TP)'].map((name, i) => ({
            id: 10 + i,
            name,
            kind: 'other' as const,
            parameterCount: 2,
            metadata: [
              {
                param1:
                  i < 2
                    ? [{ name: 'Layer', layerId: {} }]
                    : [{ name: 'Key', hidUsage: { keyboardMax: 255, consumerMax: 4095 } }],
                param2: [{ name: 'Key', hidUsage: { keyboardMax: 255, consumerMax: 4095 } }],
              },
            ],
          })),
          {
            id: 20,
            name: 'Mouse Key Press',
            kind: 'other',
            parameterCount: 1,
            metadata: [
              {
                param1: ['LBTN', 'RBTN', 'MBTN', 'MFWD', 'MBWD'].map((name, i) => ({
                  name,
                  constant: 1 << i,
                })),
                param2: [],
              },
            ],
          },
          {
            id: 21,
            name: 'Layer To',
            kind: 'other',
            parameterCount: 1,
            metadata: [{ param1: [{ name: 'Layer', layerId: {} }], param2: [] }],
          },
        ],
    layoutOptions: 0,
    macros: neo ? Array.from({ length: 16 }, () => []) : [],
    macroBufferSize: neo ? 1024 : 0,
    locked: false,
    capturedAt: new Date().toISOString(),
    firmwareUnsaved: false,
    deviceInfo: neo ? {} : { firmware: '演示', layerCapacity: 4 },
  };
}
export class DemoDriver implements Driver {
  private snapshot: DeviceSnapshot;
  constructor(readonly model: ModelId) {
    this.snapshot = previewSnapshot(model);
  }
  async read() {
    return clone(this.snapshot);
  }
  async writeBinding(layerId: number, index: number, binding: Binding) {
    this.snapshot.layers.find((l) => l.id === layerId)!.bindings[index] = clone(binding);
  }
  async writeMacros(macros: number[][]) {
    this.snapshot.macros = clone(macros);
  }
  async writeLayout(options: number) {
    if (this.model !== 'neo75cu') throw new Error('不支持此配列。');
    this.snapshot.layoutOptions = options;
    this.snapshot.keys = neoLayout(options);
  }
  async writeLayers(layers: Layer[]) {
    this.snapshot.layers = clone(layers);
  }
  async addLayer() {
    const capacity = this.snapshot.deviceInfo?.layerCapacity ?? 0;
    const id = Array.from({ length: capacity }, (_, i) => i).find(
      (i) => !this.snapshot.layers.some((l) => l.id === i),
    );
    if (id === undefined) throw new Error('没有可用图层。');
    this.snapshot.layers.push({
      id,
      name: `功能层 ${id}`,
      bindings: this.snapshot.layers[0].bindings.map(() => ({
        type: 'zmk',
        behaviorId: 3,
        param1: 0,
        param2: 0,
      })),
    });
  }
  async commit() {
    this.snapshot.capturedAt = new Date().toISOString();
  }
  async close() {}
}
