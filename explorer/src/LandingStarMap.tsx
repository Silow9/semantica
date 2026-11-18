import type { CSSProperties } from 'react';
import { useI18n } from './i18n';
import type { MessageKey } from './i18n/messages';

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
  return 0.78 + point.depth * 0.34;
}

function depthFade(point: Point): number {
  return 0.46 + point.depth * 0.54;
}

function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const HUB: StarNode = { ...project(0, 0), key: 'landing.star.workshop', color: '#d5e6f4', r: 16 };

const FLOWS = [
  {
    id: 'production',
    color: '#8fb8a4',
    start: -158,
    end: -14,
    stages: [
      { key: 'landing.star.preprocess', angle: -148 },
      { key: 'landing.star.molding', angle: -90 },
      { key: 'landing.star.postprocess', angle: -32 },
    ],
  },
  {
    id: 'customer',
    color: '#d4a8b0',
    start: 134,
    end: 194,
    stages: [
      { key: 'landing.star.customerDemand', angle: 144 },
      { key: 'landing.star.leadTime', angle: 162 },
      { key: 'landing.star.fulfillment', angle: 188 },
    ],
  },
  {
    id: 'cost',
    color: '#c9aa7e',
    start: 2,
    end: 56,
    stages: [
      { key: 'landing.star.costCollect', angle: 12 },
      { key: 'landing.star.costing', angle: 30 },
      { key: 'landing.star.quote', angle: 46 },
    ],
  },
] as const;

const INNER_RADIUS = 150;
const OUTER_RADIUS = 258;
const STAGE_RADIUS = 210;

const STAGE_NODES: StarNode[] = FLOWS.flatMap((flow) =>
  flow.stages.map((stage) => ({
    ...project(stage.angle, STAGE_RADIUS),
    key: stage.key,
    color: flow.color,
    r: 8,
  })),
);

const stageNode = (key: MessageKey) => {
  const node = STAGE_NODES.find((item) => item.key === key);
  if (!node) throw new Error(`Missing star node ${key}`);
  return node;
};

const RUNNING_GROUP: StarNode = { ...project(112, 114), key: 'landing.star.runningGroup', color: '#7eae96', r: 7 };
const IDLE_GROUP: StarNode = { ...project(68, 114), key: 'landing.star.idleGroup', color: '#9aa4b2', r: 6 };
const CURRENT_CAPACITY: StarNode = { ...project(132, 162), key: 'landing.star.currentCapacity', color: '#b4a6cc', r: 6.2 };
const ORDER_RULE: StarNode = { ...project(90, 140), key: 'landing.star.orderRule', color: '#c9a8b0', r: 6.5 };
const DECISION: StarNode = { ...project(90, 234), key: 'landing.star.acceptOrder', color: '#e4d2c4', r: 8.5 };

const FIELD_NODES = [RUNNING_GROUP, IDLE_GROUP, CURRENT_CAPACITY, ORDER_RULE];

const RUNNING_ROWS = 3;
const RUNNING_COLUMNS = 12;
const RUNNING_MACHINES: Point[] = Array.from({ length: RUNNING_ROWS * RUNNING_COLUMNS }, (_, index) => {
  const row = Math.floor(index / RUNNING_COLUMNS);
  const column = index % RUNNING_COLUMNS;
  return project(100 + (column * 20) / (RUNNING_COLUMNS - 1), 206 + row * 16);
});

const IDLE_ROWS = 3;
const IDLE_COLUMNS = 3;
const IDLE_MACHINES: Point[] = Array.from({ length: IDLE_ROWS * IDLE_COLUMNS }, (_, index) => {
  const row = Math.floor(index / IDLE_COLUMNS);
  const column = index % IDLE_COLUMNS;
  return project(65 + column * 3, 176 + row * 12);
});

function centroid(points: Point[]): Point {
  const count = points.length || 1;
  const x = points.reduce((sum, point) => sum + point.x, 0) / count;
  const y = points.reduce((sum, point) => sum + point.y, 0) / count;
  return { x, y, depth: 0.5 };
}

const RUNNING_CLUSTER = centroid(RUNNING_MACHINES);
const RUNNING_MIDDLE = RUNNING_MACHINES.slice(RUNNING_COLUMNS, RUNNING_COLUMNS * 2);
const RUNNING_LINE = {
  angle: Math.atan2(
    RUNNING_MIDDLE[RUNNING_MIDDLE.length - 1].y - RUNNING_MIDDLE[0].y,
    RUNNING_MIDDLE[RUNNING_MIDDLE.length - 1].x - RUNNING_MIDDLE[0].x,
  ) * 180 / Math.PI,
  length: Math.hypot(
    RUNNING_MIDDLE[RUNNING_MIDDLE.length - 1].x - RUNNING_MIDDLE[0].x,
    RUNNING_MIDDLE[RUNNING_MIDDLE.length - 1].y - RUNNING_MIDDLE[0].y,
  ),
  thickness: Math.hypot(
    RUNNING_MACHINES[0].x - RUNNING_MACHINES[RUNNING_COLUMNS * (RUNNING_ROWS - 1)].x,
    RUNNING_MACHINES[0].y - RUNNING_MACHINES[RUNNING_COLUMNS * (RUNNING_ROWS - 1)].y,
  ),
};
const IDLE_CLUSTER = centroid(IDLE_MACHINES);
const IDLE_WIDE = IDLE_MACHINES.slice(0, IDLE_COLUMNS);
const IDLE_LINE = {
  angle: Math.atan2(IDLE_WIDE[IDLE_WIDE.length - 1].y - IDLE_WIDE[0].y, IDLE_WIDE[IDLE_WIDE.length - 1].x - IDLE_WIDE[0].x) * 180 / Math.PI,
  length: Math.hypot(IDLE_WIDE[IDLE_WIDE.length - 1].x - IDLE_WIDE[0].x, IDLE_WIDE[IDLE_WIDE.length - 1].y - IDLE_WIDE[0].y),
  thickness: Math.hypot(
    IDLE_MACHINES[0].x - IDLE_MACHINES[IDLE_COLUMNS * (IDLE_ROWS - 1)].x,
    IDLE_MACHINES[0].y - IDLE_MACHINES[IDLE_COLUMNS * (IDLE_ROWS - 1)].y,
  ),
};

const SKY_WIDTH = 1440;
const SKY_HEIGHT = 900;

function makeStars(count: number, width: number, height: number, seed: number) {
  const random = seeded(seed);
  return Array.from({ length: count }, () => {
    const brightness = random() ** 1.85;
    return {
      x: random() * width,
      y: random() * height,
      r: 0.35 + brightness * 1.45,
      opacity: 0.16 + brightness * 0.78,
      warm: random() > 0.86,
      spike: brightness > 0.94,
      twinkle: brightness > 0.74,
      delay: -random() * 9,
      duration: 5.5 + random() * 6,
    };
  });
}

const PAGE_STARS = makeStars(640, SKY_WIDTH, SKY_HEIGHT, 20261117);

function StarField({ stars }: { stars: typeof PAGE_STARS }) {
  return (
    <g>
      {stars.map((star, index) => (
        <g
          key={index}
          className={star.twinkle ? 'star-map-twinkle' : undefined}
          opacity={star.opacity}
          style={star.twinkle ? { animationDelay: `${star.delay}s`, animationDuration: `${star.duration}s` } as CSSProperties : undefined}
        >
          {star.spike ? (
            <g stroke={star.warm ? '#f4ead8' : '#f3f7fb'} strokeLinecap="round">
              <line x1={star.x - 8} y1={star.y} x2={star.x + 8} y2={star.y} strokeWidth={0.5} />
              <line x1={star.x} y1={star.y - 5} x2={star.x} y2={star.y + 5} strokeWidth={0.35} />
            </g>
          ) : null}
          <circle cx={star.x} cy={star.y} r={star.r} fill={star.warm ? '#f3e6d0' : '#e7eef6'} />
        </g>
      ))}
    </g>
  );
}

export function LandingSky() {
  return (
    <div className="landing-sky" aria-hidden="true">
      <svg className="landing-sky-svg" viewBox={`0 0 ${SKY_WIDTH} ${SKY_HEIGHT}`} preserveAspectRatio="xMidYMid slice">
        <StarField stars={PAGE_STARS} />
      </svg>
    </div>
  );
}

const FILAMENT = '#c5d0da';

const LINKS: { from: Point; to: Point; color: string }[] = [
  ...STAGE_NODES.map((node) => ({ from: HUB, to: node, color: node.color })),
  { from: HUB, to: DECISION, color: FILAMENT },
  { from: RUNNING_GROUP, to: CURRENT_CAPACITY, color: FILAMENT },
  { from: ORDER_RULE, to: CURRENT_CAPACITY, color: FILAMENT },
  { from: DECISION, to: stageNode('landing.star.postprocess'), color: '#8fb8a4' },
  { from: DECISION, to: stageNode('landing.star.fulfillment'), color: '#d4a8b0' },
  { from: DECISION, to: stageNode('landing.star.quote'), color: '#c9aa7e' },
  { from: DECISION, to: ORDER_RULE, color: FILAMENT },
];

const RUNNING_THREADS = RUNNING_MACHINES;
const IDLE_THREADS = IDLE_MACHINES;

function ringPath(radius: number, lift = 0): string {
  const points = Array.from({ length: 97 }, (_, i) => project(i * (360 / 96), radius, lift));
  return points.map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ') + ' Z';
}

function arcPath(startDeg: number, endDeg: number, radius: number): string {
  const steps = 24;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const point = project(startDeg + ((endDeg - startDeg) * i) / steps, radius);
    return `${i === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  }).join(' ');
}

function sectorPath(startDeg: number, endDeg: number, innerR: number, outerR: number): string {
  const steps = 24;
  const outer = Array.from({ length: steps + 1 }, (_, i) => project(startDeg + ((endDeg - startDeg) * i) / steps, outerR));
  const inner = Array.from({ length: steps + 1 }, (_, i) => project(endDeg - ((endDeg - startDeg) * i) / steps, innerR));
  return [...outer, ...inner].map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ') + ' Z';
}

function smoothCurve(points: Point[]): { d: string; length: number } {
  if (points.length === 0) return { d: '', length: 0 };
  let path = `M${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  let length = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    path += ` C${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    let previous = { x: p1.x, y: p1.y };
    for (let step = 1; step <= 12; step += 1) {
      const t = step / 12;
      const u = 1 - t;
      const point = {
        x: u ** 3 * p1.x + 3 * u ** 2 * t * c1.x + 3 * u * t ** 2 * c2.x + t ** 3 * p2.x,
        y: u ** 3 * p1.y + 3 * u ** 2 * t * c1.y + 3 * u * t ** 2 * c2.y + t ** 3 * p2.y,
      };
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
      previous = point;
    }
  }
  return { d: path, length };
}

function smoothThrough(points: Point[]): string {
  return smoothCurve(points).d;
}

const DECK_RINGS = [
  { d: ringPath(OUTER_RADIUS + 54), className: 'star-map-deck star-map-deck--hair' },
  { d: ringPath(OUTER_RADIUS + 46), className: 'star-map-deck star-map-deck--outer' },
  { d: ringPath(OUTER_RADIUS), className: 'star-map-deck' },
  { d: ringPath(INNER_RADIUS), className: 'star-map-deck star-map-deck--inner' },
  { d: ringPath(72), className: 'star-map-deck star-map-deck--core' },
];

const FLOW_SECTORS = FLOWS.map((flow) => ({
  key: flow.id,
  color: flow.color,
  fill: sectorPath(flow.start, flow.end, INNER_RADIUS + 10, OUTER_RADIUS - 6),
  arc: arcPath(flow.start, flow.end, OUTER_RADIUS),
}));

const FLOW_BOUNDS = FLOWS.flatMap((flow) => [flow.start, flow.end]).map((angle) => {
  const inner = project(angle, INNER_RADIUS + 6);
  const outer = project(angle, OUTER_RADIUS + 46);
  return { x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y };
});

const FLOW_PATHS = FLOWS.map((flow) => smoothThrough(flow.stages.map((stage) => stageNode(stage.key))));

const TICKS = Array.from({ length: 96 }, (_, i) => {
  const major = i % 8 === 0;
  const angle = i * (360 / 96);
  const inner = project(angle, OUTER_RADIUS + 46);
  const outer = project(angle, OUTER_RADIUS + (major ? 60 : 51));
  return { x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y, major };
});

const SPOKES = Array.from({ length: 8 }, (_, i) => {
  const inner = project(i * 45, 72);
  const outer = project(i * 45, INNER_RADIUS - 10);
  return { x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y };
});

const SPINE_TOP = project(0, 0, 108);
const SPINE_BOTTOM = project(0, 0, -58);

function labelAnchor(point: Point): 'start' | 'end' | 'middle' {
  const dx = point.x - CX;
  if (Math.abs(dx) < 36) return 'middle';
  return dx > 0 ? 'start' : 'end';
}

function labelOffset(point: Point, distance: number): { x: number; y: number } {
  const dx = point.x - CX;
  const dy = point.y - CY;
  const length = Math.hypot(dx, dy) || 1;
  return { x: point.x + (dx / length) * distance, y: point.y + (dy / length) * distance + 4 };
}

function linkBend(from: Point, to: Point): Point {
  const bend = 0.055;
  return {
    x: (from.x + to.x) / 2 - (to.y - from.y) * bend,
    y: (from.y + to.y) / 2 + (to.x - from.x) * bend * 0.45,
    depth: 0,
  };
}

function quadLength(from: Point, control: Point, to: Point): number {
  let length = 0;
  let previous = { x: from.x, y: from.y };
  for (let step = 1; step <= 16; step += 1) {
    const t = step / 16;
    const u = 1 - t;
    const point = {
      x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
      y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
    };
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return length;
}

function curve(from: Point, to: Point): string {
  const control = linkBend(from, to);
  return `M${from.x.toFixed(1)} ${from.y.toFixed(1)} Q${control.x.toFixed(1)} ${control.y.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

const PRODUCTION_COMET = smoothCurve(FLOWS[0].stages.map((stage) => stageNode(stage.key)));
const POSTPROCESS = stageNode('landing.star.postprocess');
const FULFILLMENT = stageNode('landing.star.fulfillment');
const DECISION_BEND = linkBend(DECISION, POSTPROCESS);
const FULFILLMENT_BEND = linkBend(DECISION, FULFILLMENT);
const COMET_PATH = [
  PRODUCTION_COMET.d,
  `Q${DECISION_BEND.x.toFixed(1)} ${DECISION_BEND.y.toFixed(1)} ${DECISION.x.toFixed(1)} ${DECISION.y.toFixed(1)}`,
  `Q${FULFILLMENT_BEND.x.toFixed(1)} ${FULFILLMENT_BEND.y.toFixed(1)} ${FULFILLMENT.x.toFixed(1)} ${FULFILLMENT.y.toFixed(1)}`,
].join(' ');
const COMET_SPAN = (PRODUCTION_COMET.length + quadLength(POSTPROCESS, DECISION_BEND, DECISION) + quadLength(DECISION, FULFILLMENT_BEND, FULFILLMENT)) * 0.016;

const COMET_BITS = (() => {
  const random = seeded(20261118);
  const bits = [
    { along: 0, scatter: 0, r: 3.4, opacity: 0.22 },
    { along: 0, scatter: 0, r: 1.35, opacity: 1 },
  ];
  for (let index = 0; index < 22; index += 1) {
    const t = (index + 0.35) / 22;
    const along = (t ** 0.86) * COMET_SPAN;
    const scatter = (random() * 2 - 1) * (0.8 + t * t * 12);
    bits.push({
      along,
      scatter,
      r: 1.05 * (1 - t) ** 1.15 + 0.18,
      opacity: 0.78 * (1 - t) ** 1.4,
    });
  }
  return bits;
})();

function StarBody({
  point,
  color,
  radius,
  spiked = false,
}: {
  point: Point;
  color: string;
  radius: number;
  spiked?: boolean;
}) {
  const size = radius * depthScale(point);
  return (
    <g opacity={depthFade(point)}>
      <circle cx={point.x} cy={point.y} r={size * 4.2} fill={color} opacity={0.07} />
      <circle cx={point.x} cy={point.y} r={size * 1.85} fill={color} opacity={0.22} />
      {spiked ? (
        <g stroke="#f4f8fc" strokeLinecap="round">
          <line
            x1={point.x - size * 3.4}
            y1={point.y}
            x2={point.x + size * 3.4}
            y2={point.y}
            strokeWidth={0.5}
            opacity={0.72}
          />
          <line
            x1={point.x}
            y1={point.y - size * 1.85}
            x2={point.x}
            y2={point.y + size * 1.85}
            strokeWidth={0.35}
            opacity={0.5}
          />
        </g>
      ) : null}
      <circle cx={point.x} cy={point.y} r={Math.max(0.9, size * 0.38)} fill="#f7fbff" />
    </g>
  );
}

export function LandingStarMap() {
  const { t } = useI18n();
  return (
    <svg className="star-map" viewBox="-48 8 1096 544" role="img" aria-label={t('landing.previewLabel')}>
      <defs>
        <radialGradient id="star-map-hub" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="14%" stopColor="#f4f8fc" />
          <stop offset="34%" stopColor="rgba(186, 206, 222, 0.28)" />
          <stop offset="100%" stopColor="rgba(186, 206, 222, 0)" />
        </radialGradient>
        <radialGradient id="star-map-band" gradientUnits="userSpaceOnUse" cx={CX} cy={CY} r="440">
          <stop offset="0%" stopColor="rgba(214, 224, 234, 0.1)" />
          <stop offset="55%" stopColor="rgba(186, 204, 218, 0.035)" />
          <stop offset="100%" stopColor="rgba(8, 8, 8, 0)" />
        </radialGradient>
        <radialGradient id="star-map-nebula" cx="46%" cy="46%" r="58%">
          <stop offset="0%" stopColor="rgba(126, 156, 184, 0.16)" />
          <stop offset="42%" stopColor="rgba(92, 118, 142, 0.06)" />
          <stop offset="100%" stopColor="rgba(8, 8, 8, 0)" />
        </radialGradient>
        <radialGradient id="star-map-dust" cx="68%" cy="58%" r="42%">
          <stop offset="0%" stopColor="rgba(176, 148, 112, 0.09)" />
          <stop offset="100%" stopColor="rgba(8, 8, 8, 0)" />
        </radialGradient>
        <radialGradient id="star-map-plate" gradientUnits="userSpaceOnUse" cx={CX} cy={CY} r="460">
          <stop offset="0%" stopColor="rgba(198, 214, 226, 0.1)" />
          <stop offset="62%" stopColor="rgba(160, 180, 196, 0.035)" />
          <stop offset="100%" stopColor="rgba(8, 8, 8, 0)" />
        </radialGradient>
        <linearGradient id="star-map-spine" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(214, 226, 236, 0)" />
          <stop offset="46%" stopColor="rgba(214, 226, 236, 0.28)" />
          <stop offset="100%" stopColor="rgba(214, 226, 236, 0)" />
        </linearGradient>
        <filter id="star-map-atmosphere" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="18" />
        </filter>
        <filter id="star-map-ink" x="-12%" y="-40%" width="124%" height="180%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.1" floodColor="#07080a" floodOpacity="0.88" />
        </filter>
      </defs>

      <g filter="url(#star-map-atmosphere)">
        <ellipse cx={CX - 20} cy={CY - 8} rx={430} ry={210} fill="url(#star-map-nebula)" transform={`rotate(${TILT_DEG} ${CX} ${CY})`} />
        <ellipse cx={CX + 90} cy={CY + 36} rx={240} ry={110} fill="url(#star-map-dust)" transform={`rotate(${TILT_DEG - 8} ${CX} ${CY})`} />
      </g>

      <ellipse
        cx={CX}
        cy={CY + 4}
        rx={500}
        ry={148}
        fill="url(#star-map-band)"
        transform={`rotate(${TILT_DEG} ${CX} ${CY + 4})`}
      />

      <path d={ringPath(OUTER_RADIUS + 46)} fill="url(#star-map-plate)" />

      <g className="star-map-station">
        {SPOKES.map((spoke, index) => (
          <line key={`spoke-${index}`} {...spoke} className="star-map-spoke" />
        ))}
        {DECK_RINGS.map((ring) => (
          <path key={ring.className + ring.d.slice(0, 24)} d={ring.d} className={ring.className} />
        ))}
        {TICKS.map((tick, index) => (
          <line
            key={`tick-${index}`}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            className={tick.major ? 'star-map-tick star-map-tick--major' : 'star-map-tick'}
          />
        ))}
        {FLOW_SECTORS.map((sector) => (
          <path key={`${sector.key}-fill`} d={sector.fill} fill={sector.color} className="star-map-sector" />
        ))}
        {FLOW_BOUNDS.map((bound, index) => (
          <line key={`bound-${index}`} x1={bound.x1} y1={bound.y1} x2={bound.x2} y2={bound.y2} className="star-map-bound" />
        ))}
        {FLOW_SECTORS.map((sector) => (
          <path key={`${sector.key}-arc`} d={sector.arc} stroke={sector.color} className="star-map-arc" />
        ))}
        <line x1={SPINE_TOP.x} y1={SPINE_TOP.y} x2={SPINE_BOTTOM.x} y2={SPINE_BOTTOM.y} className="star-map-spine" stroke="url(#star-map-spine)" />
      </g>

      <g>
        {LINKS.map((link) => {
          const d = curve(link.from, link.to);
          return (
            <g key={d}>
              <path d={d} stroke={link.color} className="star-map-link star-map-link--bloom" />
              <path d={d} stroke={link.color} className="star-map-link" />
            </g>
          );
        })}
        {RUNNING_THREADS.map((machine) => (
          <line
            key={`rl-${machine.x}-${machine.y}`}
            x1={RUNNING_GROUP.x}
            y1={RUNNING_GROUP.y}
            x2={machine.x}
            y2={machine.y}
            className="star-map-machine-link"
          />
        ))}
        {IDLE_THREADS.map((machine) => (
          <line
            key={`il-${machine.x}-${machine.y}`}
            x1={IDLE_GROUP.x}
            y1={IDLE_GROUP.y}
            x2={machine.x}
            y2={machine.y}
            className="star-map-machine-link star-map-machine-link--idle"
          />
        ))}
      </g>

      <ellipse
        cx={RUNNING_CLUSTER.x}
        cy={RUNNING_CLUSTER.y}
        rx={RUNNING_LINE.length / 2 + 8}
        ry={RUNNING_LINE.thickness / 2 + 6}
        className="star-map-cluster"
        transform={`rotate(${RUNNING_LINE.angle} ${RUNNING_CLUSTER.x} ${RUNNING_CLUSTER.y})`}
      />
      <ellipse
        cx={IDLE_CLUSTER.x}
        cy={IDLE_CLUSTER.y}
        rx={IDLE_LINE.length / 2 + 8}
        ry={IDLE_LINE.thickness / 2 + 6}
        className="star-map-cluster star-map-cluster--idle"
        transform={`rotate(${IDLE_LINE.angle} ${IDLE_CLUSTER.x} ${IDLE_CLUSTER.y})`}
      />

      {FLOW_PATHS.map((path) => (
        <path key={path} d={path} className="star-map-flow" />
      ))}
      <g className="star-map-comet">
        <animateMotion dur="16s" repeatCount="indefinite" rotate="auto" path={COMET_PATH} />
        {COMET_BITS.map((bit, index) => (
          <circle
            key={`comet-${index}`}
            cx={-bit.along}
            cy={bit.scatter}
            r={bit.r}
            fill="#f7fbff"
            opacity={bit.opacity}
          />
        ))}
      </g>

      <g>
        {RUNNING_MACHINES.map((machine) => (
          <circle
            key={`rm-${machine.x.toFixed(1)}-${machine.y.toFixed(1)}`}
            cx={machine.x}
            cy={machine.y}
            r={1.5 * depthScale(machine)}
            className="star-map-machine"
            opacity={0.35 + machine.depth * 0.6}
          />
        ))}
        {IDLE_MACHINES.map((machine) => (
          <circle
            key={`im-${machine.x.toFixed(1)}-${machine.y.toFixed(1)}`}
            cx={machine.x}
            cy={machine.y}
            r={1.5 * depthScale(machine)}
            className="star-map-machine star-map-machine--idle"
            opacity={0.72}
          />
        ))}
      </g>

      {STAGE_NODES.map((node) => (
        <StarBody key={node.key} point={node} color={node.color} radius={node.r} spiked />
      ))}

      {FIELD_NODES.map((node) => (
        <StarBody key={node.key} point={node} color={node.color} radius={node.r} />
      ))}

      <StarBody point={DECISION} color={DECISION.color} radius={DECISION.r} spiked />

      <g className="star-map-hub">
        <circle cx={HUB.x} cy={HUB.y} r={36} fill="url(#star-map-hub)" className="star-map-hub-glow" />
        <ellipse
          cx={HUB.x}
          cy={HUB.y}
          rx={46}
          ry={13}
          className="star-map-hub-ring"
          transform={`rotate(${TILT_DEG} ${HUB.x} ${HUB.y})`}
        />
        <ellipse cx={HUB.x} cy={HUB.y} rx={62} ry={0.55} fill="#f7fbff" opacity={0.55} />
        <ellipse cx={HUB.x} cy={HUB.y} rx={0.45} ry={34} fill="#f7fbff" opacity={0.32} />
        <circle cx={HUB.x} cy={HUB.y} r={2.1} fill="#ffffff" />
      </g>

      <g className="star-map-labels" filter="url(#star-map-ink)">
        {STAGE_NODES.map((node) => {
          const at = labelOffset(node, node.r + 18);
          return (
            <text key={node.key} x={at.x} y={at.y} textAnchor={labelAnchor(node)} className="star-map-label star-map-label--stage">
              {t(node.key)}
            </text>
          );
        })}
        {FIELD_NODES.map((node) => {
          const at = labelOffset(node, node.r + 16);
          return (
            <text key={node.key} x={at.x} y={at.y} textAnchor={labelAnchor(node)} className="star-map-label">
              {t(node.key)}
            </text>
          );
        })}
        <text
          x={labelOffset(DECISION, DECISION.r + 18).x}
          y={labelOffset(DECISION, DECISION.r + 18).y}
          textAnchor={labelAnchor(DECISION)}
          className="star-map-label star-map-label--stage"
        >
          {t(DECISION.key)}
        </text>
        <text x={HUB.x} y={HUB.y - 46} textAnchor="middle" className="star-map-label star-map-label--hub">
          {t(HUB.key)}
        </text>
      </g>
    </svg>
  );
}
