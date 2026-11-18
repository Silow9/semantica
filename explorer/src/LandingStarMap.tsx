import type { CSSProperties } from 'react';
import { useI18n } from './i18n';
import type { MessageKey } from './i18n/messages';

const WIDTH = 1000;
const HEIGHT = 560;
const CX = 500;
const CY = 290;
const SCALE_X = 1.65;
const SCALE_Y = 0.56;
const TILT_DEG = -9;
const TILT_COS = Math.cos((TILT_DEG * Math.PI) / 180);
const TILT_SIN = Math.sin((TILT_DEG * Math.PI) / 180);

type Point = { x: number; y: number; depth: number };
type StarNode = Point & { key: MessageKey; color: string; r: number };

function project(angleDeg: number, radius: number, lift = 0): Point {
  const rad = (angleDeg * Math.PI) / 180;
  const flatX = Math.cos(rad) * radius * SCALE_X;
  const flatY = Math.sin(rad) * radius * SCALE_Y - lift;
  return {
    x: CX + flatX * TILT_COS - flatY * TILT_SIN,
    y: CY + flatX * TILT_SIN + flatY * TILT_COS,
    depth: (Math.sin(rad) + 1) / 2,
  };
}

function depthScale(point: Point): number {
  return 0.72 + point.depth * 0.48;
}

function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function floatStyle(index: number, amplitude: number): CSSProperties {
  return {
    '--float-amp': `${amplitude}px`,
    animationDelay: `${-((index * 0.73) % 6)}s`,
    animationDuration: `${5 + (index % 5) * 0.6}s`,
  } as CSSProperties;
}

const HUB: StarNode = { ...project(0, 0), key: 'landing.star.workshop', color: '#7fd0ff', r: 16 };

const STAGES = [
  { key: 'landing.star.preprocess', angle: -150, color: '#56d3a0', steps: 4 },
  { key: 'landing.star.molding', angle: -90, color: '#7fd0ff', steps: 6 },
  { key: 'landing.star.postprocess', angle: -30, color: '#f2b66d', steps: 3 },
] as const;

const INNER_RADIUS = 150;
const OUTER_RADIUS = 258;

const STAGE_NODES: StarNode[] = STAGES.map((stage) => ({
  ...project(stage.angle, INNER_RADIUS),
  key: stage.key,
  color: stage.color,
  r: 9,
}));

const STEP_SPREAD = 13;
const STEP_NODES: (StarNode & { stage: number })[] = STAGES.flatMap((stage, stageIndex) =>
  Array.from({ length: stage.steps }, (_, i) => ({
    ...project(stage.angle + (i - (stage.steps - 1) / 2) * STEP_SPREAD, OUTER_RADIUS),
    color: stage.color,
    r: 4.2,
    stage: stageIndex,
  })),
).map((step, index) => ({ ...step, key: `landing.star.step${index + 1}` as MessageKey }));

const RUNNING_GROUP: StarNode = { ...project(125, INNER_RADIUS), key: 'landing.star.runningGroup', color: '#4cc38a', r: 9 };
const IDLE_GROUP: StarNode = { ...project(55, INNER_RADIUS), key: 'landing.star.idleGroup', color: '#8a96a8', r: 7 };
const CURRENT_CAPACITY: StarNode = { ...project(165, INNER_RADIUS), key: 'landing.star.currentCapacity', color: '#c084fc', r: 7 };
const FULL_CAPACITY: StarNode = { ...project(15, INNER_RADIUS), key: 'landing.star.fullCapacity', color: '#c084fc', r: 7 };
const ORDER_RULE: StarNode = { ...project(90, INNER_RADIUS), key: 'landing.star.orderRule', color: '#ff9daf', r: 8 };

const INNER_NODES = [...STAGE_NODES, RUNNING_GROUP, IDLE_GROUP, CURRENT_CAPACITY, FULL_CAPACITY, ORDER_RULE];

const RUNNING_MACHINES: Point[] = Array.from({ length: 36 }, (_, i) => {
  const row = i % 2;
  const column = Math.floor(i / 2);
  return project(101 + column * 2.9, row === 0 ? 236 : 266);
});

const IDLE_MACHINES: Point[] = Array.from({ length: 7 }, (_, i) => project(42 + i * 4.6, 250));

const BACKGROUND_STARS = (() => {
  const random = seeded(20261117);
  return Array.from({ length: 170 }, () => ({
    x: random() * WIDTH,
    y: random() * HEIGHT,
    r: 0.4 + random() * 1.3,
    delay: -random() * 6,
    duration: 3 + random() * 4,
  }));
})();

const LINKS: { from: Point; to: Point; color: string }[] = [
  ...INNER_NODES.map((node) => ({ from: HUB, to: node, color: node.color })),
  ...STEP_NODES.map((step) => ({ from: STAGE_NODES[step.stage], to: step, color: step.color })),
  { from: RUNNING_GROUP, to: CURRENT_CAPACITY, color: '#c084fc' },
  { from: IDLE_GROUP, to: FULL_CAPACITY, color: '#c084fc' },
  { from: ORDER_RULE, to: CURRENT_CAPACITY, color: '#ff9daf' },
  { from: ORDER_RULE, to: FULL_CAPACITY, color: '#ff9daf' },
];

const PROCESS_FLOW = STEP_NODES.map((step, i) => `${i === 0 ? 'M' : 'L'}${step.x.toFixed(1)} ${step.y.toFixed(1)}`).join(' ');

function ringPath(radius: number, lift = 0): string {
  const points = Array.from({ length: 73 }, (_, i) => project(i * 5, radius, lift));
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + ' Z';
}

const DECK_RINGS = [
  { d: ringPath(OUTER_RADIUS + 46), className: 'star-map-deck star-map-deck--outer' },
  { d: ringPath(OUTER_RADIUS), className: 'star-map-deck' },
  { d: ringPath(INNER_RADIUS), className: 'star-map-deck' },
  { d: ringPath(62), className: 'star-map-deck star-map-deck--core' },
  { d: ringPath(INNER_RADIUS, 26), className: 'star-map-deck star-map-deck--upper' },
];

const SPOKES = Array.from({ length: 12 }, (_, i) => {
  const inner = project(i * 30, 62);
  const outer = project(i * 30, OUTER_RADIUS + 46);
  return { x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y };
});

const SPINE_TOP = project(0, 0, 120);
const SPINE_BOTTOM = project(0, 0, -70);

function labelAnchor(point: Point): 'start' | 'end' | 'middle' {
  const dx = point.x - CX;
  if (Math.abs(dx) < 40) return 'middle';
  return dx > 0 ? 'start' : 'end';
}

function labelOffset(point: Point, distance: number): { x: number; y: number } {
  const dx = point.x - CX;
  const dy = point.y - CY;
  const length = Math.hypot(dx, dy) || 1;
  return { x: point.x + (dx / length) * distance, y: point.y + (dy / length) * distance + 4 };
}

function curve(from: Point, to: Point): string {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const bend = 0.1;
  const cx = mx - (to.y - from.y) * bend;
  const cy = my + (to.x - from.x) * bend * 0.5;
  return `M${from.x.toFixed(1)} ${from.y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

export function LandingStarMap() {
  const { t } = useI18n();
  return (
    <svg className="star-map" viewBox={`0 52 ${WIDTH} ${HEIGHT - 96}`} role="img" aria-label={t('landing.previewLabel')}>
      <defs>
        <radialGradient id="star-map-hub" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="35%" stopColor="#bfe9ff" />
          <stop offset="100%" stopColor="#4aa3ff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="star-map-nebula" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(74,163,255,0.22)" />
          <stop offset="45%" stopColor="rgba(192,132,252,0.08)" />
          <stop offset="100%" stopColor="rgba(8,8,8,0)" />
        </radialGradient>
        <linearGradient id="star-map-spine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(127,208,255,0)" />
          <stop offset="50%" stopColor="rgba(127,208,255,0.55)" />
          <stop offset="100%" stopColor="rgba(127,208,255,0)" />
        </linearGradient>
        <filter id="star-map-glow" x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <ellipse
        cx={CX}
        cy={CY}
        rx={470}
        ry={230}
        fill="url(#star-map-nebula)"
        transform={`rotate(${TILT_DEG} ${CX} ${CY})`}
      />

      <g>
        {BACKGROUND_STARS.map((star, i) => (
          <circle
            key={i}
            className="star-map-twinkle"
            cx={star.x}
            cy={star.y}
            r={star.r}
            style={{ animationDelay: `${star.delay}s`, animationDuration: `${star.duration}s` }}
          />
        ))}
      </g>

      <g className="star-map-station">
        {SPOKES.map((spoke, i) => (
          <line key={`spoke-${i}`} {...spoke} className="star-map-spoke" />
        ))}
        {DECK_RINGS.map((ring, i) => (
          <path key={`deck-${i}`} d={ring.d} className={ring.className} />
        ))}
        <line
          x1={SPINE_TOP.x}
          y1={SPINE_TOP.y}
          x2={SPINE_BOTTOM.x}
          y2={SPINE_BOTTOM.y}
          stroke="url(#star-map-spine)"
          strokeWidth={2}
        />
      </g>

      <g>
        {LINKS.map((link, i) => (
          <path key={i} d={curve(link.from, link.to)} stroke={link.color} className="star-map-link" />
        ))}
        {RUNNING_MACHINES.map((machine, i) => (
          <line key={`rl-${i}`} x1={RUNNING_GROUP.x} y1={RUNNING_GROUP.y} x2={machine.x} y2={machine.y} className="star-map-machine-link" />
        ))}
        {IDLE_MACHINES.map((machine, i) => (
          <line key={`il-${i}`} x1={IDLE_GROUP.x} y1={IDLE_GROUP.y} x2={machine.x} y2={machine.y} className="star-map-machine-link star-map-machine-link--idle" />
        ))}
      </g>

      <path d={PROCESS_FLOW} className="star-map-flow" />

      <g>
        {RUNNING_MACHINES.map((machine, i) => (
          <g key={`rm-${i}`} className="star-map-float" style={floatStyle(i, 3)}>
            <circle
              cx={machine.x}
              cy={machine.y}
              r={2.6 * depthScale(machine)}
              className="star-map-machine"
              style={{ animationDelay: `${-(i % 9) * 0.45}s` }}
            />
          </g>
        ))}
        {IDLE_MACHINES.map((machine, i) => (
          <g key={`im-${i}`} className="star-map-float" style={floatStyle(i + 40, 2)}>
            <circle cx={machine.x} cy={machine.y} r={2.4 * depthScale(machine)} className="star-map-machine star-map-machine--idle" />
          </g>
        ))}
      </g>

      {STEP_NODES.map((step, i) => {
        const at = labelOffset(step, 14);
        return (
          <g key={step.key} className="star-map-float" style={floatStyle(i + 3, 5)}>
            <circle cx={step.x} cy={step.y} r={step.r * depthScale(step)} fill={step.color} filter="url(#star-map-glow)" />
            <text x={at.x} y={at.y} textAnchor={labelAnchor(step)} className="star-map-label star-map-label--step">
              {t(step.key)}
            </text>
          </g>
        );
      })}

      {INNER_NODES.map((node, i) => {
        const at = labelOffset(node, node.r + 14);
        const r = node.r * depthScale(node);
        return (
          <g key={node.key} className="star-map-float" style={floatStyle(i + 20, 6)}>
            <circle cx={node.x} cy={node.y} r={r * 2.4} fill={node.color} opacity={0.12} />
            <circle cx={node.x} cy={node.y} r={r} fill={node.color} filter="url(#star-map-glow)" />
            <text x={at.x} y={at.y} textAnchor={labelAnchor(node)} className="star-map-label" fill={node.color}>
              {t(node.key)}
            </text>
          </g>
        );
      })}

      <g className="star-map-float" style={floatStyle(0, 4)}>
        <g className="star-map-hub">
          <circle cx={HUB.x} cy={HUB.y} r={64} fill="url(#star-map-hub)" opacity={0.35} />
          <ellipse
            cx={HUB.x}
            cy={HUB.y}
            rx={40}
            ry={14}
            className="star-map-hub-ring"
            transform={`rotate(${TILT_DEG} ${HUB.x} ${HUB.y})`}
          />
          <circle cx={HUB.x} cy={HUB.y} r={HUB.r} fill="url(#star-map-hub)" filter="url(#star-map-glow)" />
        </g>
        <text x={HUB.x} y={HUB.y - 34} textAnchor="middle" className="star-map-label star-map-label--hub">
          {t(HUB.key)}
        </text>
      </g>
    </svg>
  );
}
