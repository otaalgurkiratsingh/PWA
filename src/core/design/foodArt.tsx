import type { ReactNode } from 'react';
import type { FoodIcon } from '@shared/contracts';
import { CatalogueArt, hasCatalogueArt } from './catalogueArt';

/**
 * Original flat food illustrations (drawn for this app; no third-party assets).
 * Each dish has its own recognisable shape and colours. Images are presentation only —
 * they never imply nutrition accuracy.
 */
const PLATE = '#FFFFFF';
const PLATE_RIM = '#E9E2DA';
const BOWL = '#F4F1EC';
const BOWL_SHADE = '#DCD5CC';

function Bowl({ fill, children }: { fill: string; children?: ReactNode }) {
  return (
    <>
      <ellipse cx="48" cy="78" rx="26" ry="5" fill="#000" opacity="0.08" />
      <path d="M14 46h68c0 18-15 30-34 30S14 64 14 46Z" fill={BOWL} />
      <path d="M14 46h68c-1 3-2 5-4 7H18c-2-2-3-4-4-7Z" fill={BOWL_SHADE} opacity="0.6" />
      <ellipse cx="48" cy="46" rx="34" ry="10" fill={BOWL_SHADE} />
      <ellipse cx="48" cy="45.5" rx="31" ry="8.5" fill={fill} />
      {children}
    </>
  );
}

function Plate({ children }: { children?: ReactNode }) {
  return (
    <>
      <ellipse cx="48" cy="60" rx="40" ry="20" fill="#000" opacity="0.07" />
      <ellipse cx="48" cy="56" rx="40" ry="20" fill={PLATE_RIM} />
      <ellipse cx="48" cy="55" rx="31" ry="14.5" fill={PLATE} />
      {children}
    </>
  );
}

const ART: Record<FoodIcon, () => ReactNode> = {
  roti: () => (
    <Plate>
      <ellipse cx="44" cy="51" rx="25" ry="12" fill="#D9A55B" />
      <ellipse cx="50" cy="47" rx="25" ry="12" fill="#E9BE78" />
      <ellipse cx="50" cy="47" rx="25" ry="12" fill="none" stroke="#C98F45" strokeWidth="1.5" />
      <circle cx="40" cy="45" r="2.2" fill="#9C6326" />
      <circle cx="55" cy="43" r="1.6" fill="#9C6326" />
      <circle cx="60" cy="50" r="2" fill="#A86E2E" />
      <circle cx="47" cy="51" r="1.4" fill="#9C6326" />
      <ellipse cx="44" cy="44" rx="4" ry="1.6" fill="#B07533" opacity="0.6" />
    </Plate>
  ),
  dal: () => (
    <Bowl fill="#F2B233">
      <ellipse cx="48" cy="45" rx="24" ry="6" fill="#F7C657" />
      <circle cx="38" cy="44" r="1.6" fill="#C9831B" />
      <circle cx="56" cy="46" r="1.4" fill="#C9831B" />
      <circle cx="48" cy="43" r="1.2" fill="#B4441B" />
      <path d="M52 41c2-3 5-3 6-1-2 0-4 1-6 1Z" fill="#2F9E44" />
      <path d="M41 47c-1-3 1-5 3-4-1 1-2 3-3 4Z" fill="#2F9E44" />
    </Bowl>
  ),
  dahi: () => (
    <>
      <ellipse cx="48" cy="78" rx="26" ry="5" fill="#000" opacity="0.08" />
      <path d="M16 46h64c0 18-14 30-32 30S16 64 16 46Z" fill="#7FB3E8" />
      <ellipse cx="48" cy="46" rx="32" ry="10" fill="#5E97D6" />
      <ellipse cx="48" cy="45.5" rx="29" ry="8.5" fill="#FBFBF7" />
      <path d="M36 45c4-4 10 2 14-1s8-2 10 1" fill="none" stroke="#E7E5DC" strokeWidth="2.2" strokeLinecap="round" />
      <ellipse cx="42" cy="43" rx="6" ry="1.5" fill="#FFFFFF" />
    </>
  ),
  egg: () => (
    <Plate>
      <ellipse cx="36" cy="51" rx="15" ry="10" fill="#FFFFFF" stroke="#EFE9DF" strokeWidth="1.5" />
      <circle cx="36" cy="51" r="6.5" fill="#F7B21E" />
      <circle cx="34.5" cy="49.5" r="2" fill="#FFD66B" />
      <ellipse cx="60" cy="51" rx="15" ry="10" fill="#FFFFFF" stroke="#EFE9DF" strokeWidth="1.5" />
      <circle cx="60" cy="51" r="6.5" fill="#F7B21E" />
      <circle cx="58.5" cy="49.5" r="2" fill="#FFD66B" />
      <circle cx="46" cy="40" r="0.9" fill="#555" />
      <circle cx="50" cy="38" r="0.7" fill="#C0392B" />
    </Plate>
  ),
  chai: () => (
    <>
      <path d="M36 22c-3 4 3 6 0 10M48 18c-3 4 3 6 0 10M60 22c-3 4 3 6 0 10" fill="none" stroke="#C4A68A" strokeWidth="2.4" strokeLinecap="round" />
      <ellipse cx="46" cy="80" rx="22" ry="4" fill="#000" opacity="0.08" />
      <path d="M26 40h40l-4 34a6 6 0 0 1-6 5H36a6 6 0 0 1-6-5Z" fill="#C2693B" />
      <path d="M26 40h40l-1 8H27Z" fill="#A9552C" />
      <ellipse cx="46" cy="40" rx="20" ry="5" fill="#B4552B" />
      <ellipse cx="46" cy="40" rx="17.5" ry="3.8" fill="#C99460" />
      <ellipse cx="42" cy="39.5" rx="5" ry="1.1" fill="#DDB27F" />
    </>
  ),
  rice: () => (
    <Plate>
      <path d="M22 54c2-14 14-20 26-20s24 6 26 20Z" fill="#FAF8F2" />
      {([
        [32, 46], [38, 41], [45, 38], [52, 38], [59, 42], [64, 48], [40, 49], [49, 45], [57, 49], [35, 52], [46, 52], [55, 53], [62, 53], [29, 51], [43, 44],
      ] as [number, number][]).map(([x, y], i) => (
        <ellipse key={i} cx={x} cy={y} rx="2.6" ry="1.1" transform={`rotate(${(i * 37) % 180} ${x} ${y})`} fill="#E8E2D2" />
      ))}
      <path d="M58 37c3-3 7-2 7 0-3 1-5 1-7 0Z" fill="#2F9E44" />
    </Plate>
  ),
  curry: () => (
    <Bowl fill="#D9562B">
      <ellipse cx="48" cy="45" rx="25" ry="6.5" fill="#E46A33" />
      <path d="M33 44c0-4 5-6 8-4s1 7-3 7-5-1-5-3Z" fill="#B9774A" />
      <path d="M50 42c0-3 5-5 8-3s1 6-3 6-5-1-5-3Z" fill="#A9683F" />
      <path d="M42 48c0-2 3-3 5-2s0 4-2 4-3-1-3-2Z" fill="#B9774A" />
      <path d="M59 47c2-3 5-3 6-1-2 0-4 1-6 1Z" fill="#2F9E44" />
      <path d="M44 41c-1-2 1-4 3-3-1 1-2 2-3 3Z" fill="#2F9E44" />
      <circle cx="38" cy="47" r="1" fill="#FFE2B8" />
    </Bowl>
  ),
  paneer: () => (
    <Plate>
      <path d="M24 52c4-10 18-14 26-13s20 6 22 13c-6 5-42 6-48 0Z" fill="#F4D58C" />
      {([[32, 48], [40, 44], [48, 46], [56, 44], [62, 49], [44, 50], [52, 51], [37, 51]] as [number, number][]).map(([x, y], i) => (
        <rect key={i} x={x - 2.5} y={y - 2.5} width="5" height="5" rx="1.4" fill="#FFF8E7" transform={`rotate(${i * 23} ${x} ${y})`} />
      ))}
      <circle cx="45" cy="42" r="1.3" fill="#2F9E44" />
      <circle cx="58" cy="47" r="1.3" fill="#C0392B" />
      <circle cx="35" cy="45" r="1.1" fill="#2F9E44" />
    </Plate>
  ),
  shake: () => (
    <>
      <ellipse cx="48" cy="82" rx="18" ry="3.5" fill="#000" opacity="0.08" />
      <rect x="34" y="16" width="28" height="9" rx="3" fill="#3B4A63" />
      <rect x="44" y="11" width="8" height="6" rx="2" fill="#3B4A63" />
      <path d="M32 26h32l-3 50a4 4 0 0 1-4 4H39a4 4 0 0 1-4-4Z" fill="#DCE7F5" />
      <path d="M33.5 42h29l-2 34a4 4 0 0 1-4 4H39.5a4 4 0 0 1-4-4Z" fill="#E7CDA9" />
      <path d="M34 42h28" stroke="#F6E6CF" strokeWidth="2" />
      <path d="M38 30v8" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
    </>
  ),
  sabzi: () => (
    <Bowl fill="#8DBB4C">
      <ellipse cx="48" cy="45" rx="24" ry="6" fill="#9CC75A" />
      <rect x="33" y="41" width="6" height="5" rx="1.5" fill="#F0A33A" />
      <rect x="52" y="43" width="6" height="5" rx="1.5" fill="#F0A33A" />
      <circle cx="44" cy="46" r="2.4" fill="#4E8F2E" />
      <circle cx="60" cy="42" r="2.2" fill="#4E8F2E" />
      <path d="M40 41c2-2 5-1 5 1-2 0-3 0-5-1Z" fill="#2F7A2B" />
      <circle cx="49" cy="41" r="1.6" fill="#F5E6B8" />
    </Bowl>
  ),
  ghee: () => (
    <>
      <ellipse cx="44" cy="80" rx="20" ry="4" fill="#000" opacity="0.08" />
      <rect x="27" y="30" width="34" height="8" rx="3" fill="#C6A35A" />
      <path d="M26 38h36v34a6 6 0 0 1-6 6H32a6 6 0 0 1-6-6Z" fill="#F3E3B5" />
      <path d="M28 50h32v22a4 4 0 0 1-4 4H32a4 4 0 0 1-4-4Z" fill="#F2C94C" />
      <path d="M62 24l10 40" stroke="#B8BEC8" strokeWidth="3.4" strokeLinecap="round" />
      <ellipse cx="73" cy="68" rx="5" ry="3" fill="#B8BEC8" />
    </>
  ),
  oats: () => (
    <Bowl fill="#E2C899">
      <ellipse cx="48" cy="45" rx="24" ry="6" fill="#EBD5AB" />
      <circle cx="40" cy="44" r="3" fill="#3B5BA9" />
      <circle cx="45" cy="42" r="2.6" fill="#4A6BC0" />
      <circle cx="56" cy="44" r="3" fill="#C0392B" />
      <path d="M50 46h8a1 1 0 0 1 0 2h-8Z" fill="#F4D35E" />
    </Bowl>
  ),
  fruit: () => (
    <>
      <ellipse cx="48" cy="78" rx="30" ry="5" fill="#000" opacity="0.08" />
      <path d="M18 56c10 14 32 16 46 2-12 4-30 4-46-2Z" fill="#F4D03F" />
      <path d="M18 56c10 10 30 12 46 2" fill="none" stroke="#D4AC0D" strokeWidth="2" />
      <circle cx="62" cy="50" r="14" fill="#E74C3C" />
      <path d="M62 36c0-4 2-6 4-7" stroke="#6D4C2F" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M64 33c4-3 8-2 9 0-4 1-6 1-9 0Z" fill="#2F9E44" />
      <ellipse cx="57" cy="45" rx="3" ry="2" fill="#F5B7B1" />
    </>
  ),
  salad: () => (
    <Bowl fill="#6FAF3E">
      <path d="M26 44c4-8 12-8 14-2 2-6 10-7 12 0 3-6 12-5 14 2" fill="#86C152" />
      <circle cx="40" cy="44" r="3.4" fill="#E74C3C" />
      <circle cx="58" cy="45" r="3" fill="#E74C3C" />
      <path d="M46 47h8" stroke="#F5F5DC" strokeWidth="3" strokeLinecap="round" />
    </Bowl>
  ),
  sandwich: () => (
    <Plate>
      <path d="M24 56 48 30l24 26Z" fill="#E9BE78" />
      <path d="M27 54 48 32l21 22Z" fill="#FBF3E1" />
      <path d="M29 50h38" stroke="#6FAF3E" strokeWidth="3" />
      <path d="M32 46h32" stroke="#E74C3C" strokeWidth="2.6" />
      <path d="M24 56 48 30l24 26" fill="none" stroke="#C98F45" strokeWidth="2" />
    </Plate>
  ),
  coffee: () => (
    <>
      <path d="M40 24c-3 4 3 6 0 10M52 22c-3 4 3 6 0 10" fill="none" stroke="#B9A08A" strokeWidth="2.4" strokeLinecap="round" />
      <ellipse cx="46" cy="80" rx="24" ry="4" fill="#000" opacity="0.08" />
      <path d="M24 40h42v26a12 12 0 0 1-12 12H36a12 12 0 0 1-12-12Z" fill="#F4F1EC" />
      <path d="M66 46h4a8 8 0 0 1 0 16h-4" fill="none" stroke="#F4F1EC" strokeWidth="5" />
      <ellipse cx="45" cy="40" rx="21" ry="5" fill="#DCD5CC" />
      <ellipse cx="45" cy="40" rx="18" ry="3.8" fill="#6B4226" />
    </>
  ),
  plate: () => (
    <Plate>
      <path d="M78 26v24M74 26v10a4 4 0 0 0 8 0V26" stroke="#B8BEC8" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <ellipse cx="48" cy="52" rx="16" ry="6" fill="#EEE6DA" />
    </Plate>
  ),
  bowl: () => <Bowl fill="#E7DCCB" />,
  cup: () => ART.chai(),
  glass: () => ART.shake(),
  drumstick: () => ART.curry(),
  cube: () => ART.paneer(),
  generic: () => ART.plate(),
};

export const ART_CHOICES: { key: FoodIcon; label: string }[] = [
  { key: 'roti', label: 'Roti' }, { key: 'dal', label: 'Dal' }, { key: 'dahi', label: 'Dahi' }, { key: 'egg', label: 'Eggs' },
  { key: 'chai', label: 'Chai' }, { key: 'coffee', label: 'Coffee' }, { key: 'rice', label: 'Rice' }, { key: 'curry', label: 'Curry' },
  { key: 'paneer', label: 'Paneer' }, { key: 'sabzi', label: 'Sabzi' }, { key: 'shake', label: 'Shake' }, { key: 'ghee', label: 'Ghee' },
  { key: 'oats', label: 'Oats' }, { key: 'fruit', label: 'Fruit' }, { key: 'salad', label: 'Salad' }, { key: 'sandwich', label: 'Sandwich' },
  { key: 'plate', label: 'Other' },
];

/**
 * Picture for a meal: the person's own photo if they chose one, else the catalogue dish art when
 * the meal came from the catalogue, else the original icon art. Pictures never imply nutrition.
 */
export function FoodArt({ icon, size = 96, photo, label, catalogueId }: { icon: FoodIcon; size?: number; photo?: string | null; label?: string; catalogueId?: string | null }) {
  if (photo) return <img src={photo} alt={label ? `${label} (your photo)` : ''} width={size} height={size} />;
  if (catalogueId && hasCatalogueArt(catalogueId)) return <CatalogueArt id={catalogueId} size={size} />;
  const draw = ART[icon] ?? ART.plate;
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden="true" focusable="false">
      {draw()}
    </svg>
  );
}
