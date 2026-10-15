/**
 * Small anatomical cards for the exercise picker: one simple figure per muscle area with that
 * area filled in the training green. Original inline SVG in the app's flat style; colours come
 * from CSS variables so the cards work in light and dark. They set the same filter as the text
 * chips (glutes matches exercises whose primary muscles include glutes).
 */
import type { MuscleFilter } from '@shared/catalogue/exerciseGuide';

type Area = 'chest' | 'back' | 'legs' | 'shoulders' | 'arms' | 'glutes' | 'core';
export const MUSCLE_CARDS: { value: Area; label: string }[] = [
  { value: 'chest', label: 'Chest' }, { value: 'back', label: 'Back' }, { value: 'legs', label: 'Legs' }, { value: 'shoulders', label: 'Shoulders' },
  { value: 'arms', label: 'Arms' }, { value: 'glutes', label: 'Glutes' }, { value: 'core', label: 'Core' },
];

/** Back-view figures show the spine line; front-view ones don't. */
const BACK_VIEW: readonly Area[] = ['back', 'glutes'];

function Figure({ area }: { area: Area }) {
  const hit = (a: Area | Area[]) => ((Array.isArray(a) ? a : [a]).includes(area) ? 'mc-part mc-hit' : 'mc-part');
  const back = BACK_VIEW.includes(area);
  return (
    <svg width="34" height="50" viewBox="0 0 40 60" aria-hidden="true" focusable="false" className="mc-figure">
      <circle className="mc-part" cx="20" cy="7" r="4.5" />
      {/* upper arms and forearms */}
      <rect className={hit('arms')} x="7.6" y="18" width="4.2" height="10.5" rx="2.1" />
      <rect className={hit('arms')} x="28.2" y="18" width="4.2" height="10.5" rx="2.1" />
      <rect className={hit('arms')} x="7" y="29.5" width="3.8" height="9" rx="1.9" />
      <rect className={hit('arms')} x="29.2" y="29.5" width="3.8" height="9" rx="1.9" />
      {/* upper torso: chest from the front, lats from the back */}
      {back ? (
        <path className={hit('back')} d="M13.5 14h13a1.8 1.8 0 0 1 1.8 2l-1.6 9.5c-.3 1.4-3.2 2.4-6.7 2.4s-6.4-1-6.7-2.4L11.7 16a1.8 1.8 0 0 1 1.8-2Z" />
      ) : (
        <path className={hit('chest')} d="M13.5 14h13a1.8 1.8 0 0 1 1.8 1.8v6.4c0 1.6-3.7 3.3-8.3 3.3s-8.3-1.7-8.3-3.3v-6.4a1.8 1.8 0 0 1 1.8-1.8Z" />
      )}
      {/* core */}
      <rect className={hit('core')} x="14.6" y="26" width="10.8" height="8.4" rx="2" />
      {/* hips / glutes */}
      <path className={hit('glutes')} d="M14.2 35h11.6l.8 5.2c-1.6 1.1-3.8 1.6-6.6 1.6s-5-.5-6.6-1.6Z" />
      {/* thighs and calves */}
      <rect className={hit('legs')} x="14" y="41" width="5.4" height="10" rx="2.7" />
      <rect className={hit('legs')} x="20.6" y="41" width="5.4" height="10" rx="2.7" />
      <rect className={hit('legs')} x="14.6" y="52" width="4.4" height="7" rx="2.2" />
      <rect className={hit('legs')} x="21" y="52" width="4.4" height="7" rx="2.2" />
      {/* shoulders (drawn last so the caps sit over the arms and torso) */}
      <circle className={hit('shoulders')} cx="11" cy="16" r="3.4" />
      <circle className={hit('shoulders')} cx="29" cy="16" r="3.4" />
      {back ? <path className="mc-line" d="M20 15v19" /> : <path className="mc-line" d="M20 27v6.5M15.5 30.2h9" />}
    </svg>
  );
}

export function MuscleCards({ value, onChange }: { value: MuscleFilter | null; onChange: (v: MuscleFilter | null) => void }) {
  return (
    <div className="muscle-cards" role="group" aria-label="Muscle map">
      {MUSCLE_CARDS.map((m) => (
        <button key={m.value} type="button" className="muscle-card" aria-pressed={value === m.value} onClick={() => onChange(value === m.value ? null : m.value)}>
          <Figure area={m.value} />
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  );
}
