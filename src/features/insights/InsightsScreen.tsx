import { useEffect, useMemo, useRef, useState } from 'react';
import { useJournal, useQuery } from '@/app/JournalContext';
import { goBack } from '@/app/router';
import { CoachAvatar } from '@/core/design/CoachAvatar';
import { Icon } from '@/core/design/icons';
import { useTrainer } from '@/features/coach/Trainer';
import { shiftDate, weekStart } from '../../../supabase/functions/_shared/retention';
import { EARN_DAYS, formatLoad, weekLabel, weekRecap, type WeekRecap } from './recap';
import { StorySheet } from './StorySheet';
import { storyFilename, storyFromWeek } from './story';
import './insights.css';

export const MAX_WEEKS_BACK = 8;

function weekName(offset: number): string {
  if (offset === 0) return 'This week';
  if (offset === 1) return 'Last week';
  return `${offset} weeks ago`;
}

/** Circular consistency meter. The number is always shown as text too. */
export function Ring({ pct, size = 112 }: { pct: number; size?: number }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <svg className="ins-ring" viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${clamped}% consistency`}>
      <circle cx="50" cy="50" r={r} className="ins-ring-track" />
      <circle cx="50" cy="50" r={r} className="ins-ring-fill" strokeDasharray={`${(clamped / 100) * c} ${c}`} transform="rotate(-90 50 50)" />
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central" className="ins-ring-text">{clamped}%</text>
    </svg>
  );
}

/** Luma Insights: this week's recap as a story-style stack of cards, with up to 8 weeks back. */
export function InsightsScreen({ onShare, onOpen }: { onShare?: (kind: string) => void; onOpen?: () => void } = {}) {
  const { today, profile } = useJournal();
  const trainer = useTrainer();
  const [offset, setOffset] = useState(0);
  const [sharing, setSharing] = useState(false);
  const thisMonday = weekStart(today);
  // 8 weeks back, plus the week before (protein trend) and 8 weeks of history (most consistent day).
  const from = shiftDate(thisMonday, -7 * (MAX_WEEKS_BACK + 1) - 56);
  const meals = useQuery((j) => j.mealsBetween(from, today), [from, today]);
  const sessions = useQuery((j) => j.sessions(), []);

  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    onOpen?.();
  }, [onOpen]);

  const start = shiftDate(thisMonday, -7 * offset);
  const recap = useMemo(
    () => (meals && sessions ? weekRecap({ weekStart: start, today, meals, sessions, proteinTarget: profile.targets?.protein_g ?? null }) : null),
    [meals, sessions, start, today, profile.targets?.protein_g],
  );
  const card = recap ? storyFromWeek(recap, trainer.name) : null;

  return (
    <div className="stack ins-screen">
      <div className="row" style={{ gap: 4 }}>
        <button className="icon-btn plain" aria-label="Back" onClick={() => goBack('today')}><Icon name="chevronLeft" /></button>
        <h1 className="sub-title grow">Luma Insights</h1>
      </div>

      <div className="ins-switch" role="group" aria-label="Choose a week">
        <button className="icon-btn" aria-label="Previous week" disabled={offset >= MAX_WEEKS_BACK} onClick={() => setOffset((o) => Math.min(MAX_WEEKS_BACK, o + 1))}>
          <Icon name="chevronLeft" />
        </button>
        <div className="grow ins-switch-label" aria-live="polite">
          <strong>{weekName(offset)}</strong>
          <span className="label">{weekLabel(start, shiftDate(start, 6))}</span>
        </div>
        <button className="icon-btn" aria-label="Next week" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - 1))}>
          <Icon name="chevronRight" />
        </button>
      </div>

      {!recap ? (
        <div className="stack" aria-busy="true">
          <div className="skeleton" style={{ minHeight: 220 }} />
          <div className="skeleton" />
        </div>
      ) : !recap.earned ? (
        <NotEarned recap={recap} current={offset === 0} trainerName={trainer.name} />
      ) : (
        <>
          <WeekCards recap={recap} />
          {recap.surprise ? (
            <section className="card coach ins-noticed" aria-labelledby="ins-noticed-h">
              <CoachAvatar avatar={trainer.avatar} size={48} ring />
              <div className="grow">
                <h2 id="ins-noticed-h" className="eyebrow">{trainer.name} noticed…</h2>
                <p className="ins-noticed-text">{recap.surprise}</p>
              </div>
            </section>
          ) : null}
          <button className="btn block ins-share" onClick={() => setSharing(true)}>
            <Icon name="upload" />
            Share as story
          </button>
          <p className="label ins-center">Your recap is made on this phone from your own logs.</p>
        </>
      )}

      {sharing && card && recap ? (
        <StorySheet card={card} filename={storyFilename(card, recap.weekStart)} onClose={() => setSharing(false)} onDone={() => onShare?.('week')} />
      ) : null}
    </div>
  );
}

function NotEarned({ recap, current, trainerName }: { recap: WeekRecap; current: boolean; trainerName: string }) {
  const n = Math.min(recap.daysLogged, EARN_DAYS);
  return (
    <section className="card ins-unearned" aria-labelledby="ins-unearned-h">
      <div className="ins-dots" role="img" aria-label={`${recap.daysLogged} of ${EARN_DAYS} days logged`}>
        {Array.from({ length: EARN_DAYS }, (_, i) => <span key={i} className={i < n ? 'on' : ''} />)}
      </div>
      {current ? (
        <>
          <h2 id="ins-unearned-h">Log {EARN_DAYS} days this week and {trainerName} will make your recap</h2>
          <p className="muted">
            {recap.daysLogged === 0
              ? 'A meal or a workout counts. Start whenever suits you.'
              : `${recap.daysLogged} of ${EARN_DAYS} so far. A meal or a workout counts.`}
          </p>
        </>
      ) : (
        <>
          <h2 id="ins-unearned-h">A quieter week</h2>
          <p className="muted">Recaps appear for weeks with {EARN_DAYS} or more logged days. Every log counts, and this week is a fresh one.</p>
        </>
      )}
    </section>
  );
}

function trendText(t: WeekRecap['protein']['trend']): string | null {
  if (t === 'up') return 'Up from the week before';
  if (t === 'down') return 'A little lower than the week before';
  if (t === 'flat') return 'Steady with the week before';
  return null;
}

export function WeekCards({ recap }: { recap: WeekRecap }) {
  const p = recap.protein;
  const partial = p.daysWithUnknownProtein > 0;
  const trend = trendText(p.trend);
  return (
    <div className="ins-stack">
      <section className="ins-hero" aria-labelledby="ins-hero-h">
        <div className="grow">
          <h2 id="ins-hero-h" className="ins-hero-eyebrow">Your week</h2>
          <p className="ins-hero-big"><span className="num">{recap.daysLogged}</span> days logged</p>
          <p className="ins-hero-sub">
            {recap.daysElapsed < 7 ? `${recap.daysLogged} of ${recap.daysElapsed} days so far` : `${recap.daysLogged} of 7 days`}
          </p>
        </div>
        <Ring pct={recap.consistencyPct} />
      </section>

      <div className="ins-pair">
        <section className="card train ins-tile" aria-labelledby="ins-wk-h">
          <h2 id="ins-wk-h" className="eyebrow">Workouts</h2>
          <p className="ins-tile-big num">{recap.workouts}</p>
          <p className="small muted">{recap.sets} {recap.sets === 1 ? 'set' : 'sets'} completed</p>
        </section>
        <section className="card ins-tile" aria-labelledby="ins-pr-h">
          <h2 id="ins-pr-h" className="eyebrow">New bests</h2>
          <p className="ins-tile-big num">{recap.prs.length}</p>
          <p className="small muted">{recap.prs.length ? 'Heaviest yet' : 'Strength builds quietly'}</p>
        </section>
      </div>

      {recap.prs.length ? (
        <section className="card ins-prs" aria-labelledby="ins-prlist-h">
          <h2 id="ins-prlist-h">Personal bests</h2>
          <ul className="ins-list">
            {recap.prs.map((b) => (
              <li key={`${b.name}|${b.unit}`}>
                <span className="ins-pr-icon" aria-hidden="true"><Icon name="star" size={18} /></span>
                <span className="grow">{b.name}</span>
                <strong className="num">{formatLoad(b.load)} {b.unit}</strong>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card food ins-protein" aria-labelledby="ins-protein-h">
        <div className="row between wrap">
          <h2 id="ins-protein-h" className="eyebrow">Protein</h2>
          {partial && p.avgPerLoggedDay !== null ? <span className="tag warn">Partial</span> : null}
        </div>
        {p.avgPerLoggedDay !== null ? (
          <>
            <p className="ins-tile-big"><span className="num">{p.avgPerLoggedDay}</span> <small>g / day average</small></p>
            {p.target !== null && p.daysAtTarget !== null ? (
              <p className="small">Target {p.target} g, reached on {p.daysAtTarget} of {p.daysWithKnownProtein} {p.daysWithKnownProtein === 1 ? 'day' : 'days'}</p>
            ) : null}
            {trend ? <p className="small">{trend}</p> : null}
            {partial ? (
              <p className="small ins-note">
                From {p.daysWithKnownProtein} {p.daysWithKnownProtein === 1 ? 'day' : 'days'} with complete protein info.
                {' '}{p.daysWithUnknownProtein} {p.daysWithUnknownProtein === 1 ? 'day has' : 'days have'} foods with unknown protein, so {p.daysWithUnknownProtein === 1 ? 'it’s' : 'they’re'} left out rather than guessed.
              </p>
            ) : null}
          </>
        ) : p.daysWithUnknownProtein > 0 ? (
          <p className="small">Protein isn’t known yet for this week’s meals (some servings haven’t been weighed). Nothing is guessed.</p>
        ) : (
          <p className="small">Log a few meals and your protein average will show up here.</p>
        )}
      </section>
    </div>
  );
}
