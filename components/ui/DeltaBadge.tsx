import { Badge } from './Badge';

export type DeltaKind = 'up' | 'down' | 'same' | 'neutral';

export function DeltaBadge({ kind, text }: { kind: DeltaKind; text: string }) {
  const tone = kind === 'up' ? 'alert' : kind === 'down' ? 'paid' : 'default';
  return <Badge label={text} tone={tone} />;
}
