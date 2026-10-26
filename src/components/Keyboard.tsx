import { useMemo } from 'react';
import type { DeviceSnapshot } from '../domain/types';
import { equalBinding } from '../domain/types';
import { labelFor } from '../domain/keycodes';

const shortLabel = (label: string) =>
  ({
    Backspace: 'Bksp',
    'Caps Lock': 'Caps',
    'Print Screen': 'PrtSc',
    'Scroll Lock': 'ScrLk',
    'Page Up': 'PgUp',
    'Page Down': 'PgDn',
    'Num Lock': 'Num',
    'L Ctrl': 'Ctrl',
    'L Shift': 'Shift',
    'L Alt': 'Alt',
    'L Win': 'Win',
    'R Ctrl': 'Ctrl',
    'R Shift': 'Shift',
    'R Alt': 'Alt',
    'R Win': 'Win',
    'Num Enter': 'Enter',
  })[label] ?? label.replace('Num ', '');
export function Keyboard({
  snapshot,
  baseline,
  layerId,
  selected,
  onSelect,
  miniature = false,
}: {
  snapshot: DeviceSnapshot;
  baseline?: DeviceSnapshot;
  layerId: number;
  selected?: number | null;
  onSelect?: (index: number, activate?: boolean) => void;
  miniature?: boolean;
}) {
  const layer = snapshot.layers.find((l) => l.id === layerId) ?? snapshot.layers[0];
  const original = baseline?.layers.find((l) => l.id === layer.id);
  const keys = snapshot.keys;
  const bounds = useMemo(() => {
    const minX = Math.min(...keys.map((k) => k.x)),
      minY = Math.min(...keys.map((k) => k.y));
    const maxX = Math.max(...keys.map((k) => k.x + k.w)),
      maxY = Math.max(...keys.map((k) => k.y + k.h));
    return { minX, minY, width: (maxX - minX) * 52 + 34, height: (maxY - minY) * 52 + 44 };
  }, [keys]);
  return (
    <svg
      className={`keyboard-svg ${snapshot.model === 'tofu-pad' ? 'numpad' : ''} ${miniature ? 'miniature' : ''}`}
      viewBox={`0 0 ${bounds.width} ${bounds.height}`}
      role={miniature ? 'img' : 'group'}
      aria-label={`${snapshot.name} ${miniature ? '外观示意' : `${layer.name}可视化键盘`}`}
    >
      <rect
        x="1"
        y="6"
        width={bounds.width - 2}
        height={bounds.height - 7}
        rx="13"
        fill={snapshot.model === 'neo75cu' ? '#b5937b' : '#a6ada7'}
      />
      <rect
        x="1"
        y="1"
        width={bounds.width - 2}
        height={bounds.height - 12}
        rx="13"
        fill={snapshot.model === 'neo75cu' ? '#ded4c5' : '#dfe3da'}
        stroke={snapshot.model === 'neo75cu' ? '#c4b49e' : '#bec7ba'}
      />
      <rect
        x="11"
        y="11"
        width={bounds.width - 22}
        height={bounds.height - 32}
        rx="7"
        fill="#a8aa9e"
        opacity=".45"
      />
      {keys.map((key, position) => {
        const binding = layer.bindings[key.index];
        if (!binding) return null;
        const label = labelFor(binding, snapshot),
          changed = !!original && !equalBinding(original.bindings[key.index], binding);
        const active = selected === key.index;
        const x = (key.x - bounds.minX) * 52 + 17,
          y = (key.y - bounds.minY) * 52 + 16;
        const accent = key.index === keys[0].index || label === 'Enter';
        return (
          <g
            key={key.id}
            className={`key ${active ? 'selected' : ''}`}
            transform={
              key.rotation
                ? `rotate(${key.rotation} ${((key.rx ?? key.x) - bounds.minX) * 52 + 17} ${((key.ry ?? key.y) - bounds.minY) * 52 + 16})`
                : undefined
            }
            role={miniature ? undefined : 'button'}
            tabIndex={
              miniature
                ? undefined
                : selected === key.index || (selected == null && position === 0)
                  ? 0
                  : -1
            }
            aria-label={`${label}，位置 ${key.id}${changed ? '，已修改' : ''}`}
            aria-pressed={miniature ? undefined : active}
            data-key-index={key.index}
            onClick={() => onSelect?.(key.index)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect?.(key.index);
              }
              if (e.key.startsWith('Arrow')) {
                e.preventDefault();
                const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
                const next = keys[(position + delta + keys.length) % keys.length];
                onSelect?.(next.index, false);
                (
                  e.currentTarget.parentElement?.querySelector(
                    `[data-key-index="${next.index}"]`,
                  ) as SVGGElement | null
                )?.focus();
              }
            }}
          >
            <title>
              {label} · {key.id}
            </title>
            <rect
              x={x}
              y={y + 3}
              width={key.w * 52 - 5}
              height={key.h * 52 - 5}
              rx="5"
              fill={active ? '#7f9c43' : accent ? '#819371' : '#b8b8ab'}
            />
            <rect
              className="key-face"
              x={x}
              y={y}
              width={key.w * 52 - 5}
              height={key.h * 52 - 7}
              rx="5"
              fill={active ? '#d7ee9c' : accent ? '#d3debf' : '#f4f3ec'}
              stroke={active ? '#728c3b' : '#e1e0d4'}
              strokeWidth={active ? 2 : 1}
            />
            {!miniature && (
              <text
                x={x + (key.w * 52 - 5) / 2}
                y={y + (key.h * 52 - 7) / 2 + 4}
                textAnchor="middle"
                fill="#41463b"
                fontSize={label.length > 7 ? 9 : 11}
                fontWeight="550"
                pointerEvents="none"
              >
                {shortLabel(label)}
              </text>
            )}
            {changed && <circle cx={x + key.w * 52 - 13} cy={y + 8} r="3" fill="#b17731" />}
          </g>
        );
      })}
      {!miniature && (
        <text
          x={bounds.width - 18}
          y={bounds.height - 13}
          textAnchor="end"
          fill="#686e5e"
          fontSize="7"
          letterSpacing="3"
        >
          {snapshot.model === 'neo75cu' ? 'NEO / CU' : 'TOFU / PAD'}
        </text>
      )}
    </svg>
  );
}
