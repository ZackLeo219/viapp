import { TESTER_LAYOUTS } from '../domain/tester';
import './IdleKeyboard.css';

const keys = TESTER_LAYOUTS.find((layout) => layout.id === 'compact')!.keys;
export function IdleKeyboard() {
  return (
    <div className="idle-keyboard" aria-hidden="true">
      <svg viewBox="0 0 920 500" fill="none">
        <defs>
          <linearGradient
            id="idle-case"
            x1="150"
            y1="80"
            x2="700"
            y2="480"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#fcfcf7" />
            <stop offset="1" stopColor="#e7e9dd" />
          </linearGradient>
          <linearGradient id="idle-cap" x1="0" y1="0" x2="0" y2="46" gradientUnits="userSpaceOnUse">
            <stop stopColor="#fffef9" />
            <stop offset="1" stopColor="#f2f3e9" />
          </linearGradient>
          <radialGradient id="idle-shadow">
            <stop stopColor="#55613c" stopOpacity=".12" />
            <stop offset="1" stopColor="#55613c" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="475" cy="401" rx="370" ry="52" fill="url(#idle-shadow)" />
        <g className="idle-float">
          <g transform="translate(72 102) rotate(-6 400 160) skewX(-5) scale(.94 .87)">
            <path
              className="idle-cable"
              d="M180 4 V-40 C180 -100 250 -62 250 -125"
              stroke="#d6dcc8"
              strokeWidth="5"
              strokeLinecap="round"
            />
            <path
              className="idle-signal"
              d="M180 4 V-40 C180 -100 250 -62 250 -125"
              stroke="#a8b68b"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <rect x="-18" y="-8" width="853" height="368" rx="23" fill="#d6ddc8" stroke="#c8d1b8" />
            <rect
              x="-18"
              y="-17"
              width="853"
              height="368"
              rx="23"
              fill="url(#idle-case)"
              stroke="#d8dfcb"
            />
            <rect
              x="-7"
              y="-6"
              width="831"
              height="342"
              rx="15"
              fill="#dce2d1"
              fillOpacity=".5"
              stroke="#e4e8d9"
            />
            {keys.map((k, i) => (
              <g key={i} transform={`translate(${k.x * 50 + 2} ${k.y * 50 + 2})`}>
                <rect
                  width={k.w * 50 - 6}
                  height="45"
                  y="3"
                  rx="6"
                  fill="#d1d9c2"
                  stroke="#ccd5bd"
                />
                <rect
                  className={`idle-cap ${['Escape', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp'].includes(k.code ?? '') ? 'idle-lit' : ''}`}
                  style={{ animationDelay: `${k.x * 0.12}s` }}
                  width={k.w * 50 - 6}
                  height="43"
                  rx="6"
                  fill="url(#idle-cap)"
                  stroke="#dce2d1"
                />
                {k.code === 'Escape' && <circle cx="22" cy="21" r="3" fill="#a2b881" />}
              </g>
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}
