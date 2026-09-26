import { Icon } from './icon';

export type Tone = 'positive' | 'warning' | 'negative' | 'muted' | 'plain';

export interface StatTileProps {
  label: string;
  value: string;
  /** A short line under the value — what it is of, or where it came from. */
  note?: string;
  tone?: Tone;
  size?: 'md' | 'lg';
  /** Month-on-month movement, when there is a previous month to compare to. */
  delta?: { text: string; direction: 'up' | 'down' | 'flat'; good: boolean; note: string };
}

/**
 * Label, value, note — the figure form from the mockup. The tone tints the
 * value only, and the label is always present, so the colour supplements a
 * written meaning rather than carrying it.
 */
export function StatTile({ label, value, note, tone = 'plain', size = 'md', delta }: StatTileProps) {
  const DeltaIcon =
    delta?.direction === 'up' ? Icon.TrendUp : delta?.direction === 'down' ? Icon.TrendDown : Icon.Minus;

  return (
    <div>
      <div className="tile-label">{label}</div>
      <div className={`tile-value ${toneClass(tone)}`} data-size={size}>
        {value}
      </div>
      {delta ? (
        <div className={`tile-delta ${delta.good ? 'is-positive' : 'is-negative'}`}>
          <DeltaIcon size={11} aria-hidden="true" />
          {delta.text}
          <span className="is-muted">{delta.note}</span>
        </div>
      ) : (
        note && <div className="tile-note">{note}</div>
      )}
    </div>
  );
}

export function TileRow({ children }: { children: React.ReactNode }) {
  return <div className="tile-row">{children}</div>;
}

function toneClass(tone: Tone): string {
  switch (tone) {
    case 'positive':
      return 'is-positive';
    case 'warning':
      return 'is-warning';
    case 'negative':
      return 'is-negative';
    case 'muted':
      return 'is-muted';
    default:
      return '';
  }
}
