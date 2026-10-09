import type { FoodIcon as FoodIconName, MuscleGroup } from '@shared/contracts';

/** Original, simple line illustrations. Always paired with a visible text label. */
const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export function FoodIcon({ name, size = 30 }: { name: FoodIconName; size?: number }) {
  const s = { width: size, height: size, viewBox: '0 0 32 32', 'aria-hidden': true, ...common };
  switch (name) {
    case 'roti':
      return (<svg {...s}><circle cx="16" cy="16" r="11" /><circle cx="12" cy="13" r="1.2" /><circle cx="19" cy="18" r="1.5" /><circle cx="15" cy="21" r="0.9" /><circle cx="20" cy="11" r="0.9" /></svg>);
    case 'bowl':
      return (<svg {...s}><path d="M4 15h24a12 9 0 0 1-24 0Z" /><path d="M10 11c1-2 2-2 3 0M16 10c1-2 2-2 3 0" /><path d="M11 26h10" /></svg>);
    case 'cup':
      return (<svg {...s}><path d="M6 12h16v8a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6Z" /><path d="M22 14h2a3 3 0 0 1 0 6h-2" /><path d="M11 5c-1 2 1 3 0 5M16 5c-1 2 1 3 0 5" /></svg>);
    case 'egg':
      return (<svg {...s}><path d="M16 4c5 0 9 8 9 14a9 9 0 0 1-18 0c0-6 4-14 9-14Z" /><circle cx="16" cy="19" r="3.5" /></svg>);
    case 'glass':
      return (<svg {...s}><path d="M8 5h16l-2 22H10Z" /><path d="M9 12h14" /></svg>);
    case 'plate':
      return (<svg {...s}><ellipse cx="16" cy="19" rx="13" ry="6" /><path d="M8 17c2-6 14-6 16 0" /><path d="M12 14l1-1M17 12l1 1M21 15l1-1" /></svg>);
    case 'drumstick':
      return (<svg {...s}><path d="M20 4a8 8 0 0 1 5 13c-3 3-7 3-9 2l-5 5a2.5 2.5 0 1 1-3-3l5-5c-1-2-1-6 2-9a8 8 0 0 1 5-3Z" /></svg>);
    case 'cube':
      return (<svg {...s}><path d="M16 4 27 10v12L16 28 5 22V10Z" /><path d="M5 10l11 6 11-6M16 16v12" /></svg>);
    default:
      return (<svg {...s}><circle cx="16" cy="16" r="11" /><path d="M11 16h10M16 11v10" /></svg>);
  }
}

export function MuscleIcon({ group, size = 22 }: { group: MuscleGroup; size?: number }) {
  const s = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, ...common };
  switch (group) {
    case 'chest':
      return (<svg {...s}><path d="M4 7c3-2 6-2 8 0 2-2 5-2 8 0v6c-2 3-6 3-8 1-2 2-6 2-8-1Z" /></svg>);
    case 'back':
      return (<svg {...s}><path d="M12 3v18M6 6l6 3 6-3M5 12l7 2 7-2M7 18l5-1 5 1" /></svg>);
    case 'legs':
      return (<svg {...s}><path d="M8 3v8l-2 10M16 3v8l2 10M8 11h8" /></svg>);
    case 'shoulders':
      return (<svg {...s}><circle cx="12" cy="6" r="3" /><path d="M3 15c1-4 4-6 9-6s8 2 9 6" /></svg>);
    case 'arms':
      return (<svg {...s}><path d="M5 18c0-6 3-10 7-10 2 0 3 1 3 3s-2 3-4 3M15 11c3 0 5 2 5 5" /></svg>);
    case 'core':
      return (<svg {...s}><rect x="7" y="4" width="10" height="16" rx="4" /><path d="M12 4v16M7 10h10M7 15h10" /></svg>);
    default:
      return (<svg {...s}><circle cx="12" cy="5" r="2.5" /><path d="M12 8v7M7 11h10M9 21l3-6 3 6" /></svg>);
  }
}

type NavName = 'today' | 'meals' | 'train' | 'progress';
export function NavIcon({ name }: { name: NavName }) {
  const s = { width: 26, height: 26, viewBox: '0 0 24 24', 'aria-hidden': true, ...common };
  switch (name) {
    case 'today':
      return (<svg {...s}><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></svg>);
    case 'meals':
      return (<svg {...s}><path d="M3 12h18a9 7 0 0 1-18 0Z" /><path d="M8 8c1-2 2-2 3 0M13 7c1-2 2-2 3 0" /></svg>);
    case 'train':
      return (<svg {...s}><path d="M3 12h18M6 8v8M18 8v8M3 10v4M21 10v4" /></svg>);
    case 'progress':
      return (<svg {...s}><path d="M4 19h16M6 15l4-4 3 3 5-6" /></svg>);
  }
}

export function CheckIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...common} strokeWidth={3}>
      <path d="M5 12.5 10 17l9-10" />
    </svg>
  );
}
