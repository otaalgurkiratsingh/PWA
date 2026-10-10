import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { dateParts } from '../time/localDate';

/** Bottom sheet: focus moves in, Escape/backdrop closes, focus returns to the opener. */
export function Sheet({ title, onClose, children, actions, full = false, labelledBy }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  full?: boolean;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button:not([data-close])');
    first?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
        if (!items.length) return;
        const firstEl = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sheet${full ? ' full' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? titleId} ref={ref}>
        {!full ? <div className="sheet-grip" aria-hidden="true" /> : null}
        <div className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn plain" aria-label="Close" data-close onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {children}
        {actions ? <div className="sheet-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Section({ title, action, children, id }: { title: string; action?: ReactNode; children: ReactNode; id?: string }) {
  const hid = useId();
  return (
    <section className="section" aria-labelledby={id ?? hid}>
      <div className="section-head">
        <h2 id={id ?? hid}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Metric({ label, value, unit, sub, empty }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; empty?: boolean }) {
  return (
    <div className={`metric${empty ? ' empty' : ''}`}>
      <span className="m-label">{label}</span>
      <span className="m-value">
        {value}
        {unit && !empty ? <small>{unit}</small> : null}
      </span>
      {sub ? <span className="m-sub">{sub}</span> : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode }) {
  const id = useId();
  return (
    <div className="switch-row">
      <div className="grow">
        <div id={id} style={{ fontWeight: 600 }}>{label}</div>
        {description ? <div className="small muted">{description}</div> : null}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={id} className="switch" onClick={() => onChange(!checked)} />
    </div>
  );
}

export function Stepper({ value, onDec, onInc, label, decLabel = 'Less', incLabel = 'More', disabledDec }: {
  value: ReactNode;
  onDec: () => void;
  onInc: () => void;
  label: string;
  decLabel?: string;
  incLabel?: string;
  disabledDec?: boolean;
}) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="icon-btn" aria-label={decLabel} onClick={onDec} disabled={disabledDec}>
        <Icon name="minus" />
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" className="icon-btn" aria-label={incLabel} onClick={onInc}>
        <Icon name="plus" />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, full }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  full?: boolean;
}) {
  return (
    <div className={`segmented${full ? ' full' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon, tone = 'train', title, children, action }: {
  icon: IconName;
  tone?: 'food' | 'train' | 'coach' | 'neutral';
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const bg = tone === 'neutral' ? 'var(--card-2)' : `var(--${tone})`;
  const fg = tone === 'neutral' ? 'var(--text-2)' : `var(--${tone}-ink)`;
  return (
    <div className="empty">
      <div className="e-art" style={{ background: bg, color: fg }}>
        <Icon name={icon} size={32} />
      </div>
      <div className="e-title">{title}</div>
      {children ? <div className="small">{children}</div> : null}
      {action}
    </div>
  );
}

/** Month over day in a mint tile. Decorative: the row that holds it carries the full date. */
export function DateBadge({ date }: { date: string }) {
  const { month, day } = dateParts(date);
  return (
    <span className="date-badge" aria-hidden="true">
      <span className="db-month">{month}</span>
      <span className="db-day">{day}</span>
    </span>
  );
}
