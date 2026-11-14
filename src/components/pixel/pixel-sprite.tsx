import type { CSSProperties } from "react";

export type Palette = Record<string, string>;

interface Props {
  rows: readonly string[];
  palette: Palette;
  size?: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
}

/** Renders a pixel-art sprite from a character grid as crisp SVG rects. */
export function PixelSprite({ rows, palette, size = 96, title, className, style }: Props) {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const rects: React.ReactNode[] = [];
  rows.forEach((row, y) => {
    // merge horizontal runs of the same colour to keep the DOM small
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let run = 1;
      while (x + run < row.length && row[x + run] === ch) run++;
      const fill = palette[ch];
      if (fill) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={run} height={1} fill={fill} />);
      x += run;
    }
  });
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={size}
      height={(size * h) / w}
      shapeRendering="crispEdges"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={className}
      style={style}
    >
      {rects}
    </svg>
  );
}
