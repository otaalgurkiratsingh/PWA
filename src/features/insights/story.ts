import { formatLoad, weekLabel, type WeekRecap, type YearRecap } from './recap';

/**
 * Instagram-Story cards (1080×1920 PNG). The builders are pure and tested; the canvas drawing
 * lives in `renderStoryPng` (jsdom has no canvas). Sharing only ever happens from a button tap.
 */

export interface StoryStat {
  label: string;
  value: string;
}
export interface StoryCard {
  kind: 'week' | 'milestone' | 'year';
  headline: string;
  stats: StoryStat[];
  trainerName: string;
  /** Small line above the headline (defaults to the kind, e.g. "My week"). */
  eyebrow?: string;
}

export const STORY_W = 1080;
export const STORY_H = 1920;
const MAX_STATS = 4;

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
const cleanName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, 24) || 'Luma';

// ---------------------------------------------------------------- builders (pure)

export function storyFromWeek(r: WeekRecap, trainerName: string): StoryCard {
  const stats: StoryStat[] = [
    { label: 'Days logged', value: `${r.daysLogged} of ${r.daysElapsed || 7}` },
  ];
  if (r.workouts) stats.push({ label: 'Workouts', value: `${r.workouts} · ${plural(r.sets, 'set')}` });
  const pr = r.prs[0];
  if (pr) stats.push({ label: r.prs.length > 1 ? `New bests (${r.prs.length})` : 'New best', value: `${pr.name} ${formatLoad(pr.load)} ${pr.unit}` });
  if (r.protein.avgPerLoggedDay !== null) stats.push({ label: 'Avg protein', value: `${r.protein.avgPerLoggedDay} g / day` });
  if (stats.length < MAX_STATS) stats.push({ label: 'Consistency', value: `${r.consistencyPct}%` });
  return {
    kind: 'week',
    eyebrow: `My week · ${weekLabel(r.weekStart, r.weekEnd)}`,
    headline: r.daysLogged >= 7 ? 'Seven for seven this week' : `${r.daysLogged} days of showing up`,
    stats: stats.slice(0, MAX_STATS),
    trainerName: cleanName(trainerName),
  };
}

export function storyFromMilestone(days: number, trainerName: string): StoryCard {
  const note = days >= 100 ? 'Triple digits' : days >= 30 ? 'A month strong' : 'A full week';
  return {
    kind: 'milestone',
    headline: `${days} days in a row!`,
    stats: [
      { label: 'Logging streak', value: `${days} days` },
      { label: 'Milestone', value: note },
    ],
    trainerName: cleanName(trainerName),
  };
}

export function storyFromYear(r: YearRecap, trainerName: string): StoryCard {
  const stats: StoryStat[] = [{ label: 'Days logged', value: r.daysLogged.toLocaleString('en-US') }];
  if (r.workouts) stats.push({ label: 'Workouts', value: `${r.workouts.toLocaleString('en-US')} · ${plural(r.totalSets, 'set')}` });
  if (r.bestStreak) stats.push({ label: 'Best streak', value: plural(r.bestStreak, 'day') });
  const top = r.topExercises[0];
  if (top) stats.push({ label: 'Top exercise', value: top.name });
  if (r.prs && stats.length < MAX_STATS) stats.push({ label: 'Personal bests', value: r.prs.toLocaleString('en-US') });
  if (r.favouriteMeal && stats.length < MAX_STATS) stats.push({ label: 'Favourite meal', value: r.favouriteMeal });
  return {
    kind: 'year',
    headline: `My ${r.year} in training`,
    stats: stats.slice(0, MAX_STATS),
    trainerName: cleanName(trainerName),
  };
}

export function storyFilename(card: StoryCard, stamp: string): string {
  return `trainluma-${card.kind}-${stamp.replace(/[^0-9a-z-]/gi, '')}.png`;
}

// ---------------------------------------------------------------- drawing

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif";

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Greedy word wrap; at most `maxLines`, the last one ellipsized. */
function wrap(ctx: Ctx2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fit(ctx, `${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`, maxWidth);
    return kept;
  }
  return lines.map((l) => fit(ctx, l, maxWidth));
}

function fit(ctx: Ctx2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function drawMark(ctx: Ctx2D, x: number, y: number, s: number) {
  // Four soft tiles, echoing the app icon.
  const g = s * 0.1;
  const t = (s - g) / 2;
  const fills = ['#ffffff', 'rgba(255,255,255,0.72)', 'rgba(255,255,255,0.72)', '#7fe3d7'];
  fills.forEach((f, i) => {
    ctx.fillStyle = f;
    roundRect(ctx, x + (i % 2) * (t + g), y + Math.floor(i / 2) * (t + g), t, t, t * 0.3);
    ctx.fill();
  });
}

function draw(ctx: Ctx2D, card: StoryCard) {
  const W = STORY_W;
  const H = STORY_H;
  const pad = 96;

  // Brand gradient + soft glows.
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, '#1f6bff');
  bg.addColorStop(1, '#071a7a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = (cx: number, cy: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  glow(W * 0.9, H * 0.12, 520, 'rgba(127,227,215,0.35)');
  glow(W * 0.05, H * 0.62, 620, 'rgba(160,140,255,0.28)');

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // Wordmark.
  drawMark(ctx, pad, 150, 72);
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 58px ${FONT}`;
  ctx.fillText('TrainLuma', pad + 96, 207);

  // Eyebrow + headline.
  const eyebrow = (card.eyebrow ?? (card.kind === 'week' ? 'My week' : card.kind === 'year' ? 'My year in training' : 'Milestone')).toUpperCase();
  ctx.font = `700 34px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(fit(ctx, eyebrow, W - pad * 2), pad, 420);

  ctx.font = `800 104px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  const lines = wrap(ctx, card.headline, W - pad * 2, 3);
  let y = 540;
  for (const l of lines) {
    ctx.fillText(l, pad, y);
    y += 118;
  }

  // Stat rows.
  y = Math.max(y + 40, 900);
  const rowH = 168;
  for (const s of card.stats.slice(0, MAX_STATS)) {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(ctx, pad, y, W - pad * 2, rowH - 28, 36);
    ctx.fill();
    ctx.font = `600 32px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.fillText(fit(ctx, s.label, W - pad * 2 - 96), pad + 48, y + 56);
    ctx.font = `800 50px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(fit(ctx, s.value, W - pad * 2 - 96), pad + 48, y + 112);
    y += rowH;
  }

  // Trainer line + footer.
  ctx.font = `italic 600 40px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText(fit(ctx, `— ${card.trainerName}, your AI trainer`, W - pad * 2), pad, H - 260);

  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fillRect(pad, H - 200, W - pad * 2, 2);
  ctx.font = `700 38px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText('trainluma.app', W / 2, H - 120);
}

/** Draw the card as a 1080×1920 PNG. Rejects when this browser can't draw on a canvas. */
export async function renderStoryPng(card: StoryCard): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(STORY_W, STORY_H);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      draw(ctx, card);
      return canvas.convertToBlob({ type: 'image/png' });
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Images can’t be drawn in this browser.');
  draw(ctx, card);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Images can’t be drawn in this browser.'))), 'image/png'),
  );
}

/**
 * Hand the image to the system share sheet when it accepts files, otherwise save it.
 * Call only from a user's tap; never shares on its own.
 */
export async function shareStory(blob: Blob, filename: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: blob.type || 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'TrainLuma' });
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
      // Share sheet unavailable right now: fall through to saving the image.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}
