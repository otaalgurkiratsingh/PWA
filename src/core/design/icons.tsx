import type { Equipment } from '@shared/contracts';

/** Original line icons. Always paired with a visible label or an accessible name. */
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const PATHS = {
  today: <><path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1Z" /></>,
  food: <><path d="M3.5 11h17a8.5 7 0 0 1-17 0Z" /><path d="M8 7.5c.8-1.5 1.7-1.5 2.5 0M13 6.5c.8-1.5 1.7-1.5 2.5 0" /></>,
  workout: <><path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11" /></>,
  progress: <><path d="M4 19h16" /><path d="M6 15l4-4 3 3 5-6" /><circle cx="18" cy="8" r="1" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  send: <><path d="M5 12h13M13 6l6 6-6 6" /></>,
  photo: <><rect x="4" y="5" width="16" height="14" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="M5 17l4.5-4.5 3 3L15 13l4 4" /></>,
  minus: <><path d="M5 12h14" /></>,
  close: <><path d="M6 6l12 12M18 6 6 18" /></>,
  check: <><path d="M5 12.5 10 17l9-10" /></>,
  chevronRight: <><path d="M9 6l6 6-6 6" /></>,
  chevronLeft: <><path d="M15 6l-6 6 6 6" /></>,
  chevronDown: <><path d="M6 9l6 6 6-6" /></>,
  chevronUp: <><path d="M6 15l6-6 6 6" /></>,
  more: <><circle cx="5.5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18.5" cy="12" r="1.2" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></>,
  moon: <><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></>,
  camera: <><path d="M4 8h3l2-2.5h6L17 8h3v11H4Z" /><circle cx="12" cy="13" r="3.5" /></>,
  sparkle: <><path d="M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8Z" /><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8Z" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16Z" /><path d="M13.5 6.5l4 4" /></>,
  trash: <><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" /></>,
  copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M5 15V5h10" /></>,
  cloud: <><path d="M7 18h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6-1A4.5 4.5 0 0 0 7 18Z" /></>,
  cloudCheck: <><path d="M7 18h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6-1A4.5 4.5 0 0 0 7 18Z" /><path d="M9.5 13.5l2 2 3.5-4" /></>,
  phone: <><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M11 18h2" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  star: <><path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6Z" /></>,
  repeat: <><path d="M4 10a6 6 0 0 1 10.5-3.5L17 9M17 4v5h-5M20 14a6 6 0 0 1-10.5 3.5L7 15M7 20v-5h5" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>,
  user: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  heart: <><path d="M12 20s-7.5-4.6-7.5-10A4.5 4.5 0 0 1 12 7.5 4.5 4.5 0 0 1 19.5 10C19.5 15.4 12 20 12 20Z" /></>,
  alert: <><path d="M12 4 2.8 19.5h18.4Z" /><path d="M12 10v4M12 17h.01" /></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="M4 7l8 6 8-6" /></>,
  download: <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" /></>,
  upload: <><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14" /></>,
  notebook: <><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M9 3.5v17M12 8h4M12 11.5h4" /></>,
  scale: <><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M9 9.5a4 4 0 0 1 6 0l-2 2" /></>,
  walk: <><circle cx="13" cy="4.5" r="1.8" /><path d="M10 21l2-6 3 3v3M9 11l3-3.5 3 3.5 2.5 1M12 7.5 10 14" /></>,
  signout: <><path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l-4-4 4-4M6 12h10" /></>,
  hurt: <><circle cx="12" cy="12" r="9" /><path d="M8.5 15.5c2-1.5 5-1.5 7 0M9 9.5l2 1M15 9.5l-2 1" /></>,
  grip: <><path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01" /></>,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, strokeWidth = 2 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...base} strokeWidth={strokeWidth}>
      {PATHS[name]}
    </svg>
  );
}

/** Simple, accurate equipment drawings for exercise rows (not form demonstrations). */
export function EquipmentArt({ equipment, size = 34 }: { equipment: Equipment | string; size?: number }) {
  const s = { width: size, height: size, viewBox: '0 0 32 32', 'aria-hidden': true, focusable: false, ...base } as const;
  switch (equipment) {
    case 'barbell':
      return (<svg {...s}><path d="M3 16h26" /><rect x="6" y="9" width="3" height="14" rx="1" fill="currentColor" /><rect x="23" y="9" width="3" height="14" rx="1" fill="currentColor" /><rect x="9.5" y="11" width="2" height="10" rx="1" /><rect x="20.5" y="11" width="2" height="10" rx="1" /></svg>);
    case 'dumbbell':
      return (<svg {...s}><path d="M11 16h10" /><rect x="5" y="10" width="6" height="12" rx="2" fill="currentColor" /><rect x="21" y="10" width="6" height="12" rx="2" fill="currentColor" /></svg>);
    case 'cable':
      return (<svg {...s}><path d="M6 4v24M6 6h14" /><circle cx="20" cy="8" r="2.5" /><path d="M20 10.5V21" /><path d="M16 21h8" strokeWidth="3" /></svg>);
    case 'machine':
      return (<svg {...s}><rect x="21" y="4" width="6" height="24" rx="1.5" /><path d="M21 10h6M21 15h6M21 20h6" /><path d="M5 22h10l2-8H9" /><path d="M8 22v6M15 22v6" /></svg>);
    case 'kettlebell':
      return (<svg {...s}><path d="M11 13a5 5 0 1 1 10 0" /><path d="M8 20a8 8 0 0 1 16 0c0 4-3 6-8 6s-8-2-8-6Z" fill="currentColor" stroke="none" /></svg>);
    case 'band':
      return (<svg {...s}><path d="M6 8c6 4 14 4 20 0M6 24c6-4 14-4 20 0" /><path d="M6 8v16M26 8v16" /></svg>);
    case 'bodyweight':
      return (<svg {...s}><circle cx="16" cy="6" r="2.6" /><path d="M16 9v9M9 13l7-2 7 2M12 28l4-10 4 10" /></svg>);
    default:
      return (<svg {...s}><circle cx="16" cy="16" r="10" /><path d="M12 16h8M16 12v8" /></svg>);
  }
}

/** TrainLuma mark: white T and mint L on the brand blue (vector version of the owner's logo). */
export function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <defs>
        <linearGradient id="tl-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0057FF" /><stop offset="1" stopColor="#0A1FB8" /></linearGradient>
        <linearGradient id="tl-l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#B9F8E4" /><stop offset="1" stopColor="#22DCD4" /></linearGradient>
      </defs>
      <rect width="512" height="512" rx="120" fill="url(#tl-bg)" />
      <rect x="100" y="128" width="266" height="77" rx="38.5" fill="#FFFFFF" />
      <rect x="185" y="150" width="71" height="235" rx="35.5" fill="#FFFFFF" />
      <rect x="271" y="223" width="65" height="159" rx="32.5" fill="url(#tl-l)" />
      <rect x="271" y="318" width="162" height="64" rx="32" fill="url(#tl-l)" />
    </svg>
  );
}
