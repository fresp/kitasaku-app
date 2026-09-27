import { memo } from 'react';
import { Image, ImageSourcePropType, ImageStyle, StyleProp } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { BRAND_ART, type BrandNode } from '../../lib/brand-art';

interface RasterAsset {
  source: ImageSourcePropType;
  width: number;
  height: number;
  title: string;
}

/**
 * Static map of raster PNG assets from the Kitasaku showcase sheet.
 * Metro requires static string paths inside require().
 */
const BRAND_PNG: Record<string, RasterAsset> = {
  'context-budget': {
    source: require('../../assets/context-budget.png'),
    width: 210,
    height: 140,
    title: 'Kitasaku context budget',
  },
  'context-calendar': {
    source: require('../../assets/context-calendar.png'),
    width: 210,
    height: 140,
    title: 'Kitasaku context calendar',
  },
  'context-family': {
    source: require('../../assets/context-family.png'),
    width: 210,
    height: 140,
    title: 'Kitasaku context family',
  },
  'context-goal': {
    source: require('../../assets/context-goal.png'),
    width: 210,
    height: 140,
    title: 'Kitasaku context goal',
  },
  'context-home': {
    source: require('../../assets/context-home.png'),
    width: 210,
    height: 140,
    title: 'Kitasaku context home',
  },
  'context-payment': {
    source: require('../../assets/context-payment.png'),
    width: 210,
    height: 140,
    title: 'Kitasaku context payment',
  },
  'empty-belum-ada-pemasukan': {
    source: require('../../assets/empty-belum-ada-pemasukan.png'),
    width: 192,
    height: 125,
    title: 'Kitasaku empty belum ada pemasukan',
  },
  'empty-belum-ada-rencana': {
    source: require('../../assets/empty-belum-ada-rencana.png'),
    width: 192,
    height: 125,
    title: 'Kitasaku empty belum ada rencana',
  },
  'empty-belum-ada-tabungan': {
    source: require('../../assets/empty-belum-ada-tabungan.png'),
    width: 192,
    height: 125,
    title: 'Kitasaku empty belum ada tabungan',
  },
  'empty-belum-ada-transaksi': {
    source: require('../../assets/empty-belum-ada-transaksi.png'),
    width: 192,
    height: 125,
    title: 'Kitasaku empty belum ada transaksi',
  },
  'empty-data-tidak-ditemukan': {
    source: require('../../assets/empty-data-tidak-ditemukan.png'),
    width: 192,
    height: 125,
    title: 'Kitasaku empty data tidak ditemukan',
  },
  'empty-tidak-ada-tagihan': {
    source: require('../../assets/empty-tidak-ada-tagihan.png'),
    width: 192,
    height: 125,
    title: 'Kitasaku empty tidak ada tagihan',
  },
  'onboarding-01-family-finance': {
    source: require('../../assets/onboarding-01-family-finance.png'),
    width: 420,
    height: 220,
    title: 'Kitasaku onboarding 01 family finance',
  },
  'onboarding-02-expense-tracking': {
    source: require('../../assets/onboarding-02-expense-tracking.png'),
    width: 420,
    height: 220,
    title: 'Kitasaku onboarding 02 expense tracking',
  },
  'onboarding-03-shared-goal': {
    source: require('../../assets/onboarding-03-shared-goal.png'),
    width: 420,
    height: 220,
    title: 'Kitasaku onboarding 03 shared goal',
  },
};

/**
 * Renders one icon from the Kitasaku asset pack.
 *
 * If a raster PNG is available (onboarding, empty states, context illustrations),
 * it renders as a native Image preserving the asset's aspect ratio within `size`.
 *
 * If only SVG vector data exists (categories, brand marks, logos), it falls back
 * to react-native-svg using the transcribed geometry in `lib/brand-art.ts`.
 *
 * Accessibility: the pack's own title becomes the label, so a caller that
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
  style?: StyleProp<ImageStyle>;
}) {
  const png = BRAND_PNG[name];
  if (png) {
    const a11y =
      label === undefined
        ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: png.title }
        : label === ''
          ? { accessible: false }
          : { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label };

    const aspect = png.width / png.height;
    const width = size;
    const height = Math.round(size / aspect);

    return (
      <Image
        source={png.source}
        style={[{ width, height }, style]}
        resizeMode="contain"
        {...a11y}
      />
    );
  }

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
      style={style as any}
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
