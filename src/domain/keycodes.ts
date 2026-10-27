import type { Binding, DeviceSnapshot } from './types';
import { hex } from './types';
import { advancedKind, acceptsBinding } from './behaviors';

export interface KeyAction {
  id: string;
  label: string;
  description: string;
  category:
    | '常用'
    | '字母数字'
    | '符号'
    | '功能'
    | '导航'
    | '修饰键'
    | '数字键盘'
    | '媒体'
    | '层'
    | '设备'
    | '宏'
    | '鼠标';
  binding?: Binding;
  hid?: number;
  page?: number;
  special?: string;
}
const basic = (
  hid: number,
  label: string,
  category: KeyAction['category'] = '功能',
  description = label,
): KeyAction => ({ id: `key-${hid}`, hid, label, description, category });
export const KEY_ACTIONS: KeyAction[] = [
  basic(41, 'Esc', '常用', 'Escape / 退出'),
  basic(40, 'Enter', '常用', '回车'),
  basic(42, 'Backspace', '常用', '退格'),
  basic(43, 'Tab', '常用', '制表'),
  basic(44, 'Space', '常用', '空格'),
  basic(57, 'Caps Lock', '常用', '大写锁定'),
  ...Array.from({ length: 26 }, (_, i) => basic(i + 4, String.fromCharCode(65 + i), '字母数字')),
  ...Array.from({ length: 10 }, (_, i) => basic(i + 30, String((i + 1) % 10), '字母数字')),
  ...['−', '=', '[', ']', '\\', '#', ';', "'", '`', ',', '.', '/'].map((label, i) =>
    basic(i + 45, label, '符号'),
  ),
  ...Array.from({ length: 12 }, (_, i) => basic(58 + i, `F${i + 1}`)),
  ...Array.from({ length: 12 }, (_, i) => basic(104 + i, `F${i + 13}`)),
  ...[
    'Print Screen',
    'Scroll Lock',
    'Pause',
    'Insert',
    'Home',
    'Page Up',
    'Delete',
    'End',
    'Page Down',
    '→',
    '←',
    '↓',
    '↑',
  ].map((label, i) => basic(70 + i, label, '导航')),
  ...[
    'Num Lock',
    'Num /',
    'Num *',
    'Num −',
    'Num +',
    'Num Enter',
    'Num 1',
    'Num 2',
    'Num 3',
    'Num 4',
    'Num 5',
    'Num 6',
    'Num 7',
    'Num 8',
    'Num 9',
    'Num 0',
    'Num .',
  ].map((label, i) => basic(83 + i, label, '数字键盘')),
  ...['L Ctrl', 'L Shift', 'L Alt', 'L Win', 'R Ctrl', 'R Shift', 'R Alt', 'R Win'].map(
    (label, i) => basic(224 + i, label, '修饰键'),
  ),
  ...[
    { hid: 0xe2, label: '静音', special: 'mute' },
    { hid: 0xe9, label: '音量 +', special: 'volumeUp' },
    { hid: 0xea, label: '音量 −', special: 'volumeDown' },
    { hid: 0xcd, label: '播放 / 暂停', special: 'playPause' },
    { hid: 0xb5, label: '下一首', special: 'nextTrack' },
    { hid: 0xb6, label: '上一首', special: 'previousTrack' },
  ].map((k) => ({
    ...k,
    id: k.special,
    description: k.label,
    page: 0x0c,
    category: '媒体' as const,
  })),
  {
    id: 'transparent',
    label: '▽',
    description: '透明：沿用下一有效层的按键',
    category: '层',
    special: 'transparent',
  },
  { id: 'none', label: '禁用', description: '此位置不发送按键', category: '功能', special: 'none' },
];
export function viaRanges(version: number) {
  if (version >= 12) return { macro: 0x7700, custom: 0x7e00, momentary: 0x5220, toggle: 0x5260 };
  if (version === 11) return { macro: 0x7702, custom: 0x7f00, momentary: 0x5220, toggle: 0x5260 };
  return { macro: 0x5f12, custom: 0x5f80, momentary: 0x5100, toggle: 0x5300 };
}
const mediaVia: Record<string, number> = {
  mute: 0xa8,
  volumeUp: 0xa9,
  volumeDown: 0xaa,
  nextTrack: 0xab,
  previousTrack: 0xac,
  playPause: 0xae,
};
const customNames = [
  '2.4G',
  '蓝牙 1',
  '蓝牙 2',
  '蓝牙 3',
  'USB',
  '查看电量',
  'Win 锁定',
  '6KRO / NKRO',
  '指示灯开关',
];
const customKeys = (snapshot: DeviceSnapshot) =>
  snapshot.viaDefinition?.customKeycodes ??
  (snapshot.model === 'neo75cu' ? customNames.map((name) => ({ name, title: name })) : []);
const behaviorLabel = (name: string) =>
  ({ Device_USB: '切换 USB', Device_BT1: '蓝牙 1', Device_BT2: '蓝牙 2', Device_BT3: '蓝牙 3' })[
    name
  ] ?? name;
export function actionsFor(snapshot: DeviceSnapshot): KeyAction[] {
  const keys = KEY_ACTIONS.filter((a) => bindingFor(a, snapshot) !== null);
  for (const layer of snapshot.layers) {
    for (const mode of ['momentary', 'toggle'] as const) {
      const a: KeyAction = {
        id: `${mode}-${layer.id}`,
        label: `${mode === 'momentary' ? 'MO' : 'TG'}(${layer.id})`,
        description: `${mode === 'momentary' ? '按住切换' : '开关切换'}到 ${layer.name}`,
        category: '层',
        special: `${mode}:${layer.id}`,
      };
      if (bindingFor(a, snapshot)) keys.push(a);
    }
  }
  if (snapshot.protocol === 'via') {
    if (snapshot.protocolVersion >= 12)
      keys.push({
        id: 'grave-escape',
        label: 'Esc / `',
        description: 'Esc 与反引号复用',
        category: '功能',
        binding: { type: 'via', code: 0x7c16 },
      });
    customKeys(snapshot).forEach(({ name: label, title }, index) => {
      if (!label || /reset|clear|bootloader|erase|ee_clr/i.test(`${label} ${title}`)) return;
      keys.push({
        id: `custom-${index}`,
        label,
        description: title,
        category: '设备',
        special: `custom:${index}`,
      });
    });
    snapshot.macros.forEach((_, index) =>
      keys.push({
        id: `macro-${index}`,
        label: `M${index}`,
        description: `执行宏 ${index + 1}`,
        category: '宏',
        special: `macro:${index}`,
      }),
    );
  } else {
    for (const behavior of snapshot.behaviors) {
      const kind = advancedKind(behavior);
      const values =
        kind === 'mouse'
          ? [
              { value: 1, label: '鼠标左键' },
              { value: 2, label: '鼠标右键' },
              { value: 4, label: '鼠标中键' },
              { value: 8, label: '鼠标前进' },
              { value: 16, label: '鼠标后退' },
            ]
          : kind === 'to-layer'
            ? snapshot.layers.map((l) => ({ value: l.id, label: `切换到 ${l.name}` }))
            : [];
      for (const item of values) {
        const binding: Binding = {
          type: 'zmk',
          behaviorId: behavior.id,
          param1: item.value,
          param2: 0,
        };
        if (
          acceptsBinding(
            behavior,
            binding,
            snapshot.layers.map((l) => l.id),
          )
        )
          keys.push({
            id: `parameter-${behavior.id}-${item.value}`,
            label: item.label,
            description: item.label,
            category: kind === 'mouse' ? '鼠标' : '层',
            binding,
          });
      }
    }
    snapshot.behaviors
      .filter(
        (b) =>
          b.kind === 'other' &&
          b.parameterCount === 0 &&
          !/bootloader|reset|clear|flash|erase|zmk_reserved|firmware_version/i.test(b.name),
      )
      .forEach((b) =>
        keys.push({
          id: `behavior-${b.id}`,
          label: behaviorLabel(b.name),
          description: `原厂功能：${behaviorLabel(b.name)}`,
          category: '设备',
          special: `behavior:${b.id}`,
        }),
      );
  }
  return keys;
}
export function bindingFor(action: KeyAction, snapshot: DeviceSnapshot): Binding | null {
  if (action.binding) return structuredClone(action.binding);
  const special = action.special || '';
  if (snapshot.protocol === 'via') {
    let code = action.hid;
    const ranges = viaRanges(snapshot.protocolVersion);
    if (action.page === 0x0c) code = mediaVia[special];
    if (special === 'transparent') code = 1;
    if (special === 'none') code = 0;
    for (const prefix of ['momentary', 'toggle', 'macro', 'custom'] as const)
      if (special.startsWith(`${prefix}:`)) code = ranges[prefix] + Number(special.split(':')[1]);
    return code === undefined ? null : { type: 'via', code };
  }
  let kind = 'key';
  let param1 = action.hid === undefined ? 0 : (((action.page ?? 7) << 16) | action.hid) >>> 0;
  if (['transparent', 'none'].includes(special)) kind = special;
  if (special.startsWith('momentary:') || special.startsWith('toggle:')) {
    kind = special.split(':')[0];
    param1 = Number(special.split(':')[1]);
  }
  const behavior = special.startsWith('behavior:')
    ? snapshot.behaviors.find((b) => b.id === Number(special.split(':')[1]))
    : snapshot.behaviors.find((b) => b.kind === kind);
  return behavior ? { type: 'zmk', behaviorId: behavior.id, param1, param2: 0 } : null;
}
export function labelFor(binding: Binding, snapshot: DeviceSnapshot): string {
  if (binding.type === 'via') {
    if (snapshot.protocolVersion >= 12 && binding.code === 0x7c16) return 'Esc / `';
    if (binding.code === 0) return '禁用';
    if (binding.code === 1) return '▽';
    const range = viaRanges(snapshot.protocolVersion);
    const custom = customKeys(snapshot);
    if (binding.code >= range.custom && binding.code < range.custom + custom.length)
      return custom[binding.code - range.custom].name || hex(binding.code);
    if (binding.code >= range.macro && binding.code < range.macro + snapshot.macros.length)
      return `M${binding.code - range.macro}`;
    if (binding.code >= range.momentary && binding.code < range.momentary + 32)
      return `MO(${binding.code - range.momentary})`;
    if (binding.code >= range.toggle && binding.code < range.toggle + 32)
      return `TG(${binding.code - range.toggle})`;
    if (binding.code >= 0x100 && binding.code <= 0x1fff) {
      const flags = binding.code >>> 8;
      const labels =
        flags & 16 ? ['R Ctrl', 'R Shift', 'R Alt', 'R Win'] : ['Ctrl', 'Shift', 'Alt', 'Win'];
      const key =
        KEY_ACTIONS.find((a) => a.hid === (binding.code & 255) && !a.page)?.label ??
        hex(binding.code & 255);
      return `${labels.filter((_, i) => flags & (1 << i)).join('+')}+${key}`;
    }
    const media = Object.entries(mediaVia).find(([, v]) => v === binding.code);
    return (
      (media
        ? KEY_ACTIONS.find((a) => a.special === media[0])?.label
        : KEY_ACTIONS.find((a) => !a.page && a.hid === binding.code)?.label) ?? hex(binding.code)
    );
  }
  const behavior = snapshot.behaviors.find((b) => b.id === binding.behaviorId);
  if (behavior?.kind === 'transparent') return '▽';
  if (behavior?.kind === 'none' || binding.behaviorId === 0) return '禁用';
  if (behavior?.kind === 'momentary') return `MO(${binding.param1})`;
  if (behavior?.kind === 'toggle') return `TG(${binding.param1})`;
  if (behavior && ['layer-tap', 'mod-tap'].includes(advancedKind(behavior) ?? '')) {
    const label = (value: number) =>
      KEY_ACTIONS.find((a) => a.hid === (value & 65535) && (a.page ?? 7) === ((value >>> 16) & 255))
        ?.label ?? hex(value);
    return `${label(binding.param2)} / ${advancedKind(behavior) === 'layer-tap' ? `层 ${binding.param1}` : label(binding.param1).replace('L ', '')}`;
  }
  if (behavior && advancedKind(behavior) === 'to-layer') return `TO(${binding.param1})`;
  if (behavior && advancedKind(behavior) === 'mouse')
    return (
      { 1: '鼠标左键', 2: '鼠标右键', 4: '鼠标中键', 8: '鼠标前进', 16: '鼠标后退' }[
        binding.param1
      ] ?? '鼠标按键'
    );
  if (behavior?.kind === 'key') {
    const action = KEY_ACTIONS.find(
      (a) =>
        a.hid === (binding.param1 & 0xffff) && (a.page ?? 7) === ((binding.param1 >>> 16) & 0xff),
    );
    const mods = binding.param1 >>> 24;
    return `${mods ? `${['Ctrl', 'Shift', 'Alt', 'Win', 'R Ctrl', 'R Shift', 'R Alt', 'R Win'].filter((_, i) => mods & (1 << i)).join('+')}+` : ''}${action?.label ?? hex(binding.param1, 8)}`;
  }
  return behavior ? behaviorLabel(behavior.name) : `行为 ${binding.behaviorId}`;
}
