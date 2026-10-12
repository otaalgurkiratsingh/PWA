import { useId, type ReactNode } from 'react';
import { CoachAvatarId } from '@shared/contracts';

/**
 * The person's AI trainer avatar. Original drawings in the app's soft vector style: two abstract
 * "AI" marks (a glowing orb and a bloom knot) and eight cute characters that blink now and then.
 * Purely decorative (aria-hidden); the trainer's name is always shown as text next to it.
 */
export const AVATARS = CoachAvatarId.options;
export type AvatarId = CoachAvatarId;

export const AVATAR_LABEL: Record<AvatarId, string> = {
  orb: 'Glow orb', bloom: 'Bloom', buddy: 'Buddy', spark: 'Spark', panda: 'Panda',
  kitty: 'Kitty', bear: 'Bear', sher: 'Sher (lion)', bot: 'Robot', sprout: 'Sprout',
};


function Eyes({ y = 30, gap = 9, r = 3.2, cx = 32 }: { y?: number; gap?: number; r?: number; cx?: number }) {
  return (
    <g className="av-eyes">
      <circle cx={cx - gap} cy={y} r={r} fill="#1b1f3a" />
      <circle cx={cx + gap} cy={y} r={r} fill="#1b1f3a" />
      <circle cx={cx - gap + 1.1} cy={y - 1.2} r={1} fill="#fff" />
      <circle cx={cx + gap + 1.1} cy={y - 1.2} r={1} fill="#fff" />
    </g>
  );
}
const Smile = ({ y = 38, w = 6 }: { y?: number; w?: number }) => <path d={`M${32 - w} ${y}q${w} ${w * 0.9} ${w * 2} 0`} fill="none" stroke="#1b1f3a" strokeWidth="2.4" strokeLinecap="round" />;
const Blush = ({ y = 37, gap = 15 }: { y?: number; gap?: number }) => (
  <g opacity="0.55"><ellipse cx={32 - gap} cy={y} rx="4" ry="2.4" fill="#ff8fa3" /><ellipse cx={32 + gap} cy={y} rx="4" ry="2.4" fill="#ff8fa3" /></g>
);

function art(id: AvatarId, u: string): ReactNode {
  switch (id) {
    case 'orb':
      return (
        <>
          <defs>
            <radialGradient id={`${u}c`} cx="35%" cy="30%" r="75%"><stop offset="0" stopColor="#ffffff" /><stop offset="0.35" stopColor="#9fd8ff" /><stop offset="1" stopColor="#3b4cff" /></radialGradient>
            <linearGradient id={`${u}r`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#22dcd4" /><stop offset="0.5" stopColor="#6d5cff" /><stop offset="1" stopColor="#ff6fb1" /></linearGradient>
          </defs>
          <circle cx="32" cy="32" r="27" fill="none" stroke={`url(#${u}r)`} strokeWidth="6" className="av-spin" />
          <circle cx="32" cy="32" r="18" fill={`url(#${u}c)`} className="av-pulse" />
        </>
      );
    case 'bloom':
      return (
        <>
          <defs>
            <linearGradient id={`${u}b`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#22dcd4" /><stop offset="1" stopColor="#2563eb" /></linearGradient>
          </defs>
          <circle cx="32" cy="32" r="30" fill="#eef4ff" />
          <g className="av-spin" fill="none" stroke={`url(#${u}b)`} strokeWidth="3.4">
            {[0, 60, 120].map((a) => <ellipse key={a} cx="32" cy="32" rx="9" ry="21" transform={`rotate(${a} 32 32)`} />)}
          </g>
          <circle cx="32" cy="32" r="3.4" fill="#2563eb" />
        </>
      );
    case 'buddy':
      return (
        <>
          <defs><linearGradient id={`${u}g`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9ff3dc" /><stop offset="1" stopColor="#22c7a9" /></linearGradient></defs>
          <path d="M32 6c15 0 26 10 26 26S47 58 32 58 6 48 6 32 17 6 32 6Z" fill={`url(#${u}g)`} />
          <ellipse cx="24" cy="15" rx="7" ry="3" fill="#fff" opacity="0.45" />
          <Eyes /><Blush /><Smile />
        </>
      );
    case 'spark':
      return (
        <>
          <circle cx="32" cy="32" r="30" fill="#fff4d6" />
          <path d="M32 7l6.6 14.2 15.4 2-11.4 10.6 3 15.3L32 41.4 18.4 49.1l3-15.3L10 23.2l15.4-2Z" fill="#ffc83d" stroke="#f5a400" strokeWidth="1.5" strokeLinejoin="round" />
          <Eyes y={29} gap={6} r={2.6} /><Smile y={35} w={4} />
        </>
      );
    case 'panda':
      return (
        <>
          <circle cx="15" cy="14" r="8" fill="#2a2d3a" /><circle cx="49" cy="14" r="8" fill="#2a2d3a" />
          <circle cx="32" cy="34" r="25" fill="#ffffff" stroke="#e3e6ee" strokeWidth="1.5" />
          <ellipse cx="22.5" cy="31" rx="6.5" ry="7.5" fill="#2a2d3a" transform="rotate(-20 22.5 31)" />
          <ellipse cx="41.5" cy="31" rx="6.5" ry="7.5" fill="#2a2d3a" transform="rotate(20 41.5 31)" />
          <g className="av-eyes"><circle cx="23" cy="31" r="2.3" fill="#fff" /><circle cx="41" cy="31" r="2.3" fill="#fff" /></g>
          <ellipse cx="32" cy="40" rx="3.4" ry="2.4" fill="#2a2d3a" />
          <path d="M28.5 44q3.5 3 7 0" fill="none" stroke="#2a2d3a" strokeWidth="2" strokeLinecap="round" />
          <Blush y={42} gap={16} />
        </>
      );
    case 'kitty':
      return (
        <>
          <path d="M10 26 12 6l14 10ZM54 26 52 6 38 16Z" fill="#ffb26b" />
          <path d="M14 22 15 11l7 6ZM50 22l-1-11-7 6Z" fill="#ffd9b8" />
          <circle cx="32" cy="35" r="24" fill="#ffb26b" />
          <Eyes y={33} gap={9} />
          <path d="M30 39.5h4l-2 2.2Z" fill="#e2647a" />
          <path d="M32 41.7q-2.5 3-5.5 1M32 41.7q2.5 3 5.5 1" fill="none" stroke="#1b1f3a" strokeWidth="1.8" strokeLinecap="round" />
          <g stroke="#a36a3d" strokeWidth="1.3" strokeLinecap="round"><path d="M10 37h8M10 42l8-2M46 37h8M46 40l8 2" /></g>
        </>
      );
    case 'bear':
      return (
        <>
          <circle cx="14" cy="15" r="9" fill="#b07a4f" /><circle cx="50" cy="15" r="9" fill="#b07a4f" />
          <circle cx="14" cy="15" r="4.5" fill="#e8b98d" /><circle cx="50" cy="15" r="4.5" fill="#e8b98d" />
          <circle cx="32" cy="35" r="25" fill="#b07a4f" />
          <ellipse cx="32" cy="42" rx="11" ry="8.5" fill="#e8b98d" />
          <Eyes y={31} gap={10} />
          <ellipse cx="32" cy="39" rx="3.6" ry="2.6" fill="#3b2617" />
          <path d="M29 44q3 2.6 6 0" fill="none" stroke="#3b2617" strokeWidth="2" strokeLinecap="round" />
        </>
      );
    case 'sher':
      return (
        <>
          <g fill="#f28c28">{Array.from({ length: 12 }, (_, i) => <circle key={i} cx={32 + 24 * Math.cos((i * Math.PI) / 6)} cy={33 + 24 * Math.sin((i * Math.PI) / 6)} r="8" />)}</g>
          <circle cx="32" cy="33" r="20" fill="#ffc46b" />
          <Eyes y={30} gap={7.5} r={2.8} />
          <path d="M29 36h6l-3 3Z" fill="#7a4310" />
          <path d="M32 39q-3 3.4-6 1.4M32 39q3 3.4 6 1.4" fill="none" stroke="#7a4310" strokeWidth="1.8" strokeLinecap="round" />
          <Blush y={38} gap={12} />
        </>
      );
    case 'bot':
      return (
        <>
          <path d="M32 4v8" stroke="#6d5cff" strokeWidth="2.6" strokeLinecap="round" /><circle cx="32" cy="5" r="3.2" fill="#22dcd4" className="av-pulse" />
          <rect x="9" y="13" width="46" height="42" rx="15" fill="#e9ecff" stroke="#6d5cff" strokeWidth="2.4" />
          <rect x="15" y="21" width="34" height="20" rx="10" fill="#1b1f3a" />
          <g className="av-eyes"><rect x="21" y="26" width="7" height="9" rx="3.5" fill="#22dcd4" /><rect x="36" y="26" width="7" height="9" rx="3.5" fill="#22dcd4" /></g>
          <path d="M26 47q6 4 12 0" fill="none" stroke="#6d5cff" strokeWidth="2.6" strokeLinecap="round" />
        </>
      );
    case 'sprout':
      return (
        <>
          <path d="M32 18c-1-8-7-12-14-11 0 7 6 12 14 11ZM32 18c1-8 7-12 14-11 0 7-6 12-14 11Z" fill="#34c77b" />
          <path d="M32 18v6" stroke="#2a9d5c" strokeWidth="2.4" strokeLinecap="round" />
          <ellipse cx="32" cy="41" rx="22" ry="19" fill="#ffe1c2" />
          <Eyes y={39} gap={8} /><Blush y={45} gap={13} /><Smile y={46} w={4.5} />
        </>
      );
  }
}

export function CoachAvatar({ avatar, size = 40, ring = false }: { avatar: AvatarId; size?: number; ring?: boolean }) {
  const u = useId().replace(/:/g, '');
  return (
    <span className={`coach-avatar${ring ? ' ring' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 64 64" width={size} height={size}>{art(avatar, u)}</svg>
    </span>
  );
}
