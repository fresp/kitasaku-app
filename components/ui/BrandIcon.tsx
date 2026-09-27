import { memo } from 'react';
import Svg, { Circle, Ellipse, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { BRAND_ART, type BrandNode } from '../../lib/brand-art';

/**
 * Renders one icon from the Kitasaku asset pack.
 *
 * The geometry lives in `lib/brand-art.ts` as data rather than as .svg imports,
 * so this component is the single place that touches react-native-svg. Adding
 * an icon to the pack means rerunning gen-brand-art.py; no component changes.
 *
 * `size` is the only sizing control. Every icon is authored on a 512x512
 * viewBox and the design places them at 44 (categories), 84 (empty states,
 * context) and 180 (onboarding), so scaling the viewBox to `size` is what keeps
 * a 7.2-unit stroke on an onboarding illustration proportionally the same as a
 * 20-unit stroke on a category glyph.
 *
 * Accessibility: the pack's own <title> becomes the label, so a caller that
 * passes no `label` still gets a meaningful one ("Kitasaku category rumah")
 * instead of an unlabelled image. Pass `label=""` for decorative art that sits
 * beside a visible caption, which is most of the empty states.
 */
export const BrandIcon = memo(function BrandIcon({
  name,
  size,
  label,
  style,
}: {
  name: string;
  size: number;
  /** Overrides the pack title. Pass '' for purely decorative art. */
  label?: string;
  style?: object;
}) {
  const art = BRAND_ART[name];
  if (!art) return null;

  const a11y =
    label === undefined
      ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: art.title }
      : label === ''
        ? { accessible: false }
        : { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label };

  return (
    <Svg
      width={size}
      height={size}
      viewBox={`0 0 ${art.viewBox} ${art.viewBox}`}
      style={style}
      {...a11y}
    >
      {art.nodes.map((node, i) => (
        <Node key={i} node={node} />
      ))}
    </Svg>
  );
});

function Node({ node }: { node: BrandNode }) {
  // The `in` checks are the narrowing: `g` and `text` are in the union but carry
  // no stroke, and `text` carries no transform. Reading the field off the union
  // directly does not compile, and a cast would hide a genuinely missing field.
  const paint = {
    // A missing `fill` on a shape means black to SVG, which is not what the
    // pack means — a stroke-only outline must say `fill="none"`. The
    // transcription drops the attribute when it is "none", so absence here is
    // "no fill", not "default black". `text` supplies its own.
    fill: 'fill' in node ? (node.fill ?? 'none') : undefined,
    stroke: 'stroke' in node ? node.stroke : undefined,
    strokeWidth: 'sw' in node ? node.sw : undefined,
    strokeLinecap: ('cap' in node ? node.cap : undefined) as 'round' | 'butt' | 'square' | undefined,
    strokeLinejoin: ('join' in node ? node.join : undefined) as 'round' | 'miter' | 'bevel' | undefined,
    transform: 'transform' in node ? node.transform : undefined,
  };

  switch (node.t) {
    case 'path':
      return <Path d={node.d} {...paint} />;
    case 'circle':
      return <Circle cx={node.cx} cy={node.cy} r={node.r} {...paint} />;
    case 'rect':
      return <Rect x={node.x} y={node.y} width={node.w} height={node.h} rx={node.rx} {...paint} />;
    case 'ellipse':
      return <Ellipse cx={node.cx} cy={node.cy} rx={node.rx} ry={node.ry} {...paint} />;
    case 'g':
      return (
        <G transform={node.transform}>
          {node.children.map((child, i) => (
            <Node key={i} node={child} />
          ))}
        </G>
      );
    case 'text':
      // primary-logo's wordmark and the "Rp" on onboarding-03's coin. The
      // device font is not Arial, so the glyph shapes differ slightly from the
      // design; the size and position are the design's.
      return (
        <SvgText
          x={node.x}
          y={node.y}
          fontSize={node.size}
          fontWeight="700"
          fill={node.fill}
          textAnchor={(node.anchor ?? 'start') as 'start' | 'middle' | 'end'}
        >
          {node.content}
        </SvgText>
      );
  }
}
