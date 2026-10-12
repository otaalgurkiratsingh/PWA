import { useMemo, useState } from 'react';
import { useJournal, useQuery } from '@/app/JournalContext';
import { goBack } from '@/app/router';
import { CoachAvatar } from '@/core/design/CoachAvatar';
import { Icon } from '@/core/design/icons';
import { EmptyState, Metric } from '@/core/design/ui';
import { formatShortDate } from '@/core/time/localDate';
import { useTrainer } from '@/features/coach/Trainer';
import { yearRecap } from './recap';
import { StorySheet } from './StorySheet';
import { storyFilename, storyFromYear } from './story';
import './insights.css';

/** "Your Year in Training": an annual recap made on the phone, shareable as a story. */
export function YearScreen({ year: yearProp, onShare }: { year?: number; onShare?: (kind: string) => void } = {}) {
  const { today } = useJournal();
  const trainer = useTrainer();
  const year = yearProp ?? Number(today.slice(0, 4));
  const [sharing, setSharing] = useState(false);
  const meals = useQuery((j) => j.mealsBetween(`${year}-01-01`, `${year}-12-31`), [year]);
  const sessions = useQuery((j) => j.sessions(), []);
  const recap = useMemo(() => (meals && sessions ? yearRecap({ year, today, meals, sessions }) : null), [meals, sessions, year, today]);
  const card = recap ? storyFromYear(recap, trainer.name) : null;
  const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

  return (
    <div className="stack ins-screen">
      <div className="row" style={{ gap: 4 }}>
        <button className="icon-btn plain" aria-label="Back" onClick={() => goBack('progress')}><Icon name="chevronLeft" /></button>
        <h1 className="sub-title grow">Your Year in Training</h1>
      </div>

      {!recap ? (
        <div className="stack" aria-busy="true">
          <div className="skeleton" style={{ minHeight: 240 }} />
          <div className="skeleton" />
        </div>
      ) : recap.daysLogged === 0 ? (
        <EmptyState icon="sparkle" tone="coach" title={`Your ${year} story starts with one log`}>
          Log a meal or a workout and {trainer.name} will start building your year.
        </EmptyState>
      ) : (
        <>
          <section className="ins-hero ins-hero-year" aria-labelledby="ins-year-h">
            <div className="grow">
              <h2 id="ins-year-h" className="ins-hero-eyebrow">{year} in training</h2>
              <p className="ins-hero-big"><span className="num">{recap.daysLogged.toLocaleString()}</span> days logged</p>
              <p className="ins-hero-line">{recap.identityLine}</p>
            </div>
          </section>

          <div className="metrics">
            <Metric label="Workouts" value={recap.workouts.toLocaleString()} />
            <Metric label="Sets completed" value={recap.totalSets.toLocaleString()} />
            <Metric label="Best streak" value={recap.bestStreak} unit={recap.bestStreak === 1 ? 'day' : 'days'} />
            <Metric label="Personal bests" value={recap.prs.toLocaleString()} />
          </div>

          {recap.topExercises.length ? (
            <section className="card train" aria-labelledby="ins-top-h">
              <h2 id="ins-top-h">Top exercises</h2>
              <ol className="ins-list ins-ranked">
                {recap.topExercises.map((e, i) => (
                  <li key={e.name}>
                    <span className="ins-rank" aria-hidden="true">{i + 1}</span>
                    <span className="grow">{e.name}</span>
                    <span className="small num">{plural(e.sets, 'set')}</span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {recap.favouriteMeal || recap.firstLogDate ? (
            <section className="card food stack-sm" aria-labelledby="ins-food-h">
              <h2 id="ins-food-h">Along the way</h2>
              {recap.favouriteMeal ? (
                <p>Favourite meal: <strong>{recap.favouriteMeal}</strong> <span className="muted">({plural(recap.favouriteMealCount, 'time')})</span></p>
              ) : null}
              {recap.firstLogDate ? <p>First log of the year: <strong>{formatShortDate(recap.firstLogDate)}</strong></p> : null}
            </section>
          ) : null}

          <section className="card coach ins-noticed" aria-label={`A note from ${trainer.name}`}>
            <CoachAvatar avatar={trainer.avatar} size={48} ring />
            <p className="grow">Every one of those days was a choice you made for yourself. I’m proud to be part of it.<span className="ins-signoff">{trainer.name}, your AI trainer</span></p>
          </section>

          <button className="btn block ins-share" onClick={() => setSharing(true)}>
            <Icon name="upload" />
            Share as story
          </button>
        </>
      )}

      {sharing && card && recap ? (
        <StorySheet card={card} filename={storyFilename(card, String(recap.year))} onClose={() => setSharing(false)} onDone={() => onShare?.('year')} />
      ) : null}
    </div>
  );
}
