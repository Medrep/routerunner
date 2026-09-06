'use client';
import { useState } from 'react';
import { Crosshair, Minus, Plus } from 'lucide-react';
import { stops, stopStatus, type Trip } from './trip';
export default function RouteMap({
  trip,
  onStop,
  full = false,
}: {
  trip: Trip;
  onStop: (i: number) => void;
  full?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState([280, 270]);
  const size = 560 / zoom;
  const status = (i: number) => stopStatus(i, trip);
  const gps = stops[Math.min(trip.current, 6)];
  const roads = [
    'M0 105L330 340',
    'M0 165L303 390',
    'M0 220L260 431',
    'M0 310L220 470',
    'M45 0L360 242',
    'M130 0L340 163',
    'M0 450L289 58',
    'M62 520L329 150',
    'M0 320L245 0',
    'M30 160L150 0',
    'M85 520L290 240',
  ];
  return (
    <div className={`route-map ${full ? 'is-full' : ''}`}>
      <svg
        role="img"
        aria-label="Schematic Copenhagen map with seven stops, route segments and a simulated current position"
        viewBox={`${center[0] - size / 2} ${center[1] - size / 2} ${size} ${size}`}
      >
        <defs>
          <pattern
            id={full ? 'blocks-full' : 'blocks'}
            width="49"
            height="42"
            patternTransform="rotate(36)"
            patternUnits="userSpaceOnUse"
          >
            <rect
              x="5"
              y="5"
              width="36"
              height="29"
              rx="3"
              fill="#e0e4dc"
              stroke="#d7ddd4"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect x="-1000" y="-1000" width="3000" height="3000" fill="#edf0e8" />
        <path
          d="M-100 -100H445L355 73 354 159 323 229 346 297 301 358 274 450 270 600H-100Z"
          fill={`url(#${full ? 'blocks-full' : 'blocks'})`}
        />
        <g stroke="#fafbf7" strokeWidth="12" fill="none">
          {roads.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        <path
          d="M422 -100L365 20 349 90 349 164 320 230 343 292 300 351 270 448 263 600H330L335 480 377 407 393 337 432 285 415 228 474 165 524 72 650 -100Z"
          fill="#bdd5db"
        />
        <path
          d="M310 339L229 367 196 399 172 460"
          fill="none"
          stroke="#bdd5db"
          strokeWidth="13"
        />
        <path
          d="M429 290L495 309 520 404 419 475 348 480 382 408 398 349Z"
          fill={`url(#${full ? 'blocks-full' : 'blocks'})`}
        />
        <path
          d="M425 66L519 35 557 112 493 192 432 211 410 169Z"
          fill="#e0e5dc"
        />
        <path
          d="M198 105L247 90 298 119 318 174 277 211 225 212 193 164Z"
          fill="#cadcbd"
        />
        <path
          d="M217 142L236 124 252 141 278 129 283 158 300 178 271 186 253 205 237 180 211 179Z"
          fill="#a8c596"
          stroke="#91b6a5"
          strokeWidth="7"
        />
        <path d="M32 385L76 335 133 377 95 438Z" fill="#cadcbd" />
        <g fill="#64716a" fontSize="10" fontWeight="500" letterSpacing="2">
          <text x="44" y="276" transform="rotate(-53 44 276)">
            BREDGADE
          </text>
          <text x="49" y="183">
            FREDERIKSSTADEN
          </text>
          <text x="47" y="482">
            INDRE BY
          </text>
          <text x="424" y="388" transform="rotate(-52 424 388)">
            CHRISTIANSHAVN
          </text>
          <text x="462" y="98" transform="rotate(-42 462 98)">
            REFSHALEØEN
          </text>
          <text x="375" y="262" fill="#50717c" transform="rotate(-57 375 262)">
            KØBENHAVNS HAVN
          </text>
        </g>
        {stops.slice(1).map((s, j) => {
          const i = j + 1;
          if (
            (trip.skipped && i === 5) ||
            trip.saved.includes(i) ||
            trip.saved.includes(i - 1)
          )
            return null;
          const from = trip.skipped && i === 6 ? stops[4] : stops[i - 1];
          const transit = i >= 5;
          const ferry = i === 5;
          const done = i < trip.current;
          return (
            <g key={i}>
              <path
                d={`M${from.x} ${from.y} L${s.x} ${s.y}`}
                stroke="#fff"
                strokeWidth="7"
                fill="none"
              />
              <path
                d={`M${from.x} ${from.y} L${s.x} ${s.y}`}
                stroke={
                  done
                    ? '#829c8d'
                    : status(i) === 'next'
                      ? '#166b50'
                      : ferry
                        ? '#427e94'
                        : '#667e74'
                }
                strokeWidth={status(i) === 'next' ? 4 : 3}
                strokeDasharray={
                  transit ? (ferry ? '8 6' : '16 7') : done ? '0' : '3 6'
                }
                strokeLinecap="round"
                fill="none"
              />
            </g>
          );
        })}
        {stops.map((s, i) => {
          const st = status(i);
          const active = st === 'current';
          const labelLeft = i === 4 || i === 5;
          return (
            <g
              key={s.name}
              className={`map-pin ${st}`}
              role="button"
              tabIndex={0}
              aria-label={`${i + 1}. ${s.name}, ${st}${s.kind === 'optional' ? ', optional' : ''}`}
              onClick={() => onStop(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onStop(i);
                }
              }}
            >
              <circle cx={s.x} cy={s.y} r="25" fill="transparent" />
              {active && (
                <circle cx={s.x} cy={s.y} r="27" fill="#166b50" opacity=".15" />
              )}
              {s.kind === 'optional' || st === 'saved' ? (
                <rect
                  x={s.x - 15}
                  y={s.y - 15}
                  width="30"
                  height="30"
                  rx="5"
                  transform={`rotate(45 ${s.x} ${s.y})`}
                  fill={
                    st === 'skipped' || st === 'saved' ? '#edf0e8' : 'white'
                  }
                  stroke="#64756a"
                  strokeWidth="2"
                />
              ) : (
                <circle
                  cx={s.x}
                  cy={s.y}
                  r={active ? 19 : 15}
                  fill={
                    active ? '#176b50' : st === 'completed' ? '#dfe9df' : '#fff'
                  }
                  stroke={active || st === 'next' ? '#176b50' : '#718577'}
                  strokeWidth={st === 'next' ? 3 : 2}
                />
              )}
              <text
                x={s.x}
                y={s.y + 5}
                textAnchor="middle"
                fill={active ? 'white' : '#274c3b'}
                fontSize="14"
                fontWeight="700"
              >
                {st === 'completed'
                  ? '✓'
                  : st === 'skipped'
                    ? '−'
                    : st === 'saved'
                      ? '◇'
                      : i + 1}
              </text>
              <text
                x={labelLeft ? s.x - 24 : s.x + 25}
                y={s.y + (i === 1 ? 6 : -5)}
                textAnchor={labelLeft ? 'end' : 'start'}
                fill="#243c31"
                stroke="#eef1e9"
                strokeWidth="5"
                paintOrder="stroke"
                fontWeight={active ? 700 : 500}
                fontSize={active ? 15 : 12}
              >
                {s.name}
              </text>
            </g>
          );
        })}
        {trip.started && trip.current < 7 && !trip.ended && (
          <g>
            <circle
              cx={gps.x - 22}
              cy={gps.y + 25}
              r="15"
              fill="#2978b1"
              opacity=".14"
            />
            <circle
              cx={gps.x - 22}
              cy={gps.y + 25}
              r="7"
              fill="#2678b4"
              stroke="white"
              strokeWidth="3"
            />
          </g>
        )}
      </svg>
      <div className="map-topline">
        <span>
          <i /> Route overview
        </span>
        <span className="north">↑ N</span>
      </div>
      <div className="map-caption">Schematic map · demo location</div>
      {full && (
        <div className="zoom-controls">
          <button
            aria-label="Zoom in"
            disabled={zoom >= 2}
            onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
          >
            <Plus />
          </button>
          <button
            aria-label="Zoom out"
            disabled={zoom <= 1}
            onClick={() => {
              setZoom((z) => Math.max(1, z - 0.25));
              setCenter([280, 270]);
            }}
          >
            <Minus />
          </button>
          <button
            aria-label="Center on current stop"
            onClick={() => {
              setCenter([gps.x, gps.y]);
              setZoom(1.75);
            }}
          >
            <Crosshair />
          </button>
          <button
            onClick={() => {
              setZoom(1);
              setCenter([280, 270]);
            }}
          >
            All
          </button>
        </div>
      )}
    </div>
  );
}
