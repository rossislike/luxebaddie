import type { CategorySlug } from "@luxebaddy/contracts";

/**
 * Stand-in artwork shown until real product photography exists. Each product
 * gets its own variation, generated from its id, so the grid still feels
 * designed rather than empty.
 */
const palettes: Record<CategorySlug, { from: string; to: string; stroke: string }> = {
  wigs: { from: "#3a1323", to: "#17110f", stroke: "#e9c9a0" },
  weaves: { from: "#4a3426", to: "#1d1512", stroke: "#f0d9b5" },
  lashes: { from: "#f3dcd4", to: "#e2b9ad", stroke: "#3a1323" },
};

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic 0..1 values from a seed. */
function series(seed: number) {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function strands(next: () => number, wavy: boolean): string[] {
  const paths: string[] = [];
  const count = 26;
  const amplitude = wavy ? 14 + next() * 14 : 2 + next() * 3;
  const waves = wavy ? 2.5 + next() * 1.5 : 1;
  for (let i = 0; i < count; i++) {
    const x = 70 + (i / (count - 1)) * 260 + (next() - 0.5) * 6;
    const phase = next() * 0.9;
    const length = 360 + next() * 110;
    let d = `M ${x.toFixed(1)} 40`;
    const steps = 8;
    for (let step = 1; step <= steps; step++) {
      const y = 40 + (length / steps) * step;
      const dx = Math.sin((step / steps) * Math.PI * waves + phase) * amplitude;
      const cy = y - length / steps / 2;
      const cdx = Math.sin(((step - 0.5) / steps) * Math.PI * waves + phase) * amplitude;
      d += ` Q ${(x + cdx * 1.6).toFixed(1)} ${cy.toFixed(1)} ${(x + dx).toFixed(1)} ${y.toFixed(1)}`;
    }
    paths.push(d);
  }
  return paths;
}

function lashes(next: () => number): string[] {
  const paths: string[] = [];
  const count = 30;
  const drama = 60 + next() * 70;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    // Points along the lash band, a shallow arc.
    const bx = 70 + t * 260;
    const by = 300 - Math.sin(t * Math.PI) * 38;
    const flare = 0.55 + t * 0.75; // longer towards the outer corner
    const length = drama * flare * (0.8 + next() * 0.4);
    const lean = -0.5 + t * 1.15 + (next() - 0.5) * 0.15;
    const tx = bx + Math.sin(lean) * length;
    const ty = by - Math.cos(lean) * length;
    const cx = bx + Math.sin(lean) * length * 0.3 - 10;
    const cy = by - Math.cos(lean) * length * 0.75;
    paths.push(`M ${bx.toFixed(1)} ${by.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)}`);
  }
  paths.push("M 66 300 Q 200 248 334 300");
  return paths;
}

export function ProductArt({
  productId,
  category,
  className = "",
}: {
  productId: string;
  category: CategorySlug;
  className?: string;
}) {
  const palette = palettes[category];
  const next = series(hash(productId));
  const wavy = !/straight|bob/.test(productId);
  const paths = category === "lashes" ? lashes(next) : strands(next, wavy);
  const gradientId = `art-${productId}`;

  return (
    <svg
      viewBox="0 0 400 500"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Product illustration"
      className={`h-full w-full ${className}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={palette.from} />
          <stop offset="1" stopColor={palette.to} />
        </linearGradient>
      </defs>
      <rect width="400" height="500" fill={`url(#${gradientId})`} />
      <g fill="none" stroke={palette.stroke} strokeLinecap="round">
        {paths.map((d, i) => (
          <path key={i} d={d} strokeWidth={category === "lashes" ? 2.2 : 1.6} opacity={0.35 + ((i * 37) % 50) / 100} />
        ))}
      </g>
    </svg>
  );
}
