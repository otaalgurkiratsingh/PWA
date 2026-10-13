import { useCallback, useEffect, useState } from 'react';
import type { CoachAvatarId } from '@shared/contracts';
import { useJournal } from '@/app/JournalContext';
import { goBack, replaceRoute } from '@/app/router';
import { AVATARS, AVATAR_LABEL, CoachAvatar } from '@/core/design/CoachAvatar';
import { Icon } from '@/core/design/icons';
import { EmptyState, Section, Sheet, Toggle } from '@/core/design/ui';
import { track } from '@/core/analytics/analytics';
import {
  CIRCLE_MAX, CIRCLE_MIN_BOARD, circleBoard, circleError, circleInviteMessage, circlePosts, createCircle, deletePost, DEMO_CIRCLE, joinCircle, kindBoard,
  leaveCircle, myCircles, setCircleSharing, shareText, type BoardRow, type Circle, type CirclePost,
} from './social';
import './social.css';

function Dots({ n }: { n: number }) {
  return (
    <span className="cb-dots" role="img" aria-label={`Active ${n} of the last 7 days`}>
      {Array.from({ length: 7 }, (_, i) => <span key={i} className={i < n ? 'on' : ''} />)}
    </span>
  );
}

/** The kind board: the most consistent person celebrated, everyone else alphabetical. No ranks. */
export function KindBoard({ rows }: { rows: readonly BoardRow[] }) {
  const b = kindBoard(rows);
  if (!b.ready) {
    const more = CIRCLE_MIN_BOARD - rows.length;
    return <p className="small muted">The week board starts once {more} more friend{more === 1 ? '' : 's'} join{more === 1 ? 's' : ''}. Share your code below.</p>;
  }
  const row = (r: BoardRow) => (
    <li key={r.user_id} className="cb-row">
      <CoachAvatar avatar={r.avatar} size={36} />
      <span className="grow"><strong>{r.is_me ? `${r.display_name} (you)` : r.display_name}</strong></span>
      <Dots n={r.active_days_7} />
    </li>
  );
  return (
    <div className="stack-sm">
      {b.top.length ? (
        <div className="cb-top">
          <span className="eyebrow">Most consistent this week 🌟</span>
          <ul className="cb-list">{b.top.map(row)}</ul>
        </div>
      ) : <p className="small muted">A fresh week. First one to log gets the star 🌟</p>}
      {b.others.length ? <ul className="cb-list" aria-label="Everyone else, alphabetical">{b.others.map(row)}</ul> : null}
      <p className="label">Dots are days with any meal or workout logged. Everyone’s week counts; there are no last places here.</p>
    </div>
  );
}

function Posts({ posts, names, me, onDelete }: { posts: readonly CirclePost[]; names: Record<string, string>; me: string; onDelete?: (id: string) => void }) {
  if (!posts.length) return <p className="small muted">No wins shared yet. Finish a workout with a new best and share it here 🎉</p>;
  return (
    <ul className="cb-posts">
      {posts.map((p) => (
        <li key={p.id} className="row" style={{ gap: 10 }}>
          <span className="cb-post-icon" aria-hidden="true">{p.kind === 'pr' ? '🏋️' : p.kind === 'milestone' ? '🔥' : '✨'}</span>
          <span className="grow"><strong>{names[p.user_id] ?? 'A friend'}</strong> <span>{p.text}</span><br />
            <span className="label">{new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></span>
          {onDelete && p.user_id === me ? <button className="icon-btn plain" aria-label="Remove my post" onClick={() => onDelete(p.id)}><Icon name="close" size={16} /></button> : null}
        </li>
      ))}
    </ul>
  );
}

function ShareSheet({ title, initial, onClose, onShared }: { title: string; initial: string; onClose: () => void; onShared?: () => void }) {
  const [text, setText] = useState(initial);
  const [done, setDone] = useState<string | null>(null);
  return (
    <Sheet title={title} onClose={onClose} actions={
      <button className="btn block" disabled={!text.trim()} onClick={async () => {
        const r = await shareText(text.trim());
        if (r !== 'cancelled') { setDone(r === 'copied' ? 'Copied. Paste it wherever you chat with friends.' : 'Shared 💙'); onShared?.(); }
      }}><Icon name="upload" size={18} /> Share</button>
    }>
      <label className="field">
        Your message (edit it however you like)
        <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <p className="label">Nothing is sent until you pick where to share it.</p>
      {done ? <p className="small" role="status">{done}</p> : null}
    </Sheet>
  );
}

function ProfileFields({ name, setName, avatar, setAvatar }: { name: string; setName: (v: string) => void; avatar: CoachAvatarId; setAvatar: (v: CoachAvatarId) => void }) {
  return (
    <>
      <label className="field">
        Your name in the circle
        <input className="input" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="stack-sm">
        <span className="label" style={{ fontWeight: 600 }}>Your avatar</span>
        <div className="chips wrap" role="radiogroup" aria-label="Your avatar">
          {AVATARS.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={avatar === a} aria-label={AVATAR_LABEL[a]} className={`avatar-pick${avatar === a ? ' on' : ''}`} onClick={() => setAvatar(a)}>
              <CoachAvatar avatar={a} size={36} />
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function CircleCard({ circle, me, today, onLeft }: { circle: Circle; me: string; today: string; onLeft: () => void }) {
  const { notify } = useJournal();
  const [board, setBoard] = useState<BoardRow[] | null>(null);
  const [posts, setPosts] = useState<CirclePost[]>([]);
  const [sharing, setSharing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const mine = circle.members.find((m) => m.user_id === me);
  const [sharePrs, setSharePrs] = useState(mine?.share_prs ?? true);
  const names = Object.fromEntries(circle.members.map((m) => [m.user_id, m.display_name]));

  const load = useCallback(() => {
    void circleBoard(circle.id, today).then(setBoard, () => setBoard([]));
    void circlePosts(circle.id).then(setPosts, () => setPosts([]));
  }, [circle.id, today]);
  useEffect(load, [load]);

  return (
    <section className="card stack-sm circle-card" aria-label={circle.name}>
      <div className="row between">
        <span><strong style={{ fontSize: '1.0625rem' }}>{circle.name}</strong><br /><span className="label">{circle.members.length} of {CIRCLE_MAX} friends · code {circle.join_code}</span></span>
        <button className="btn sm secondary" onClick={() => setSharing(true)}><Icon name="users" size={16} /> Invite</button>
      </div>
      {board ? <KindBoard rows={board} /> : <div className="skeleton" style={{ height: 80 }} />}
      <h3 className="label" style={{ fontWeight: 600, marginTop: 8 }}>Wins this month</h3>
      <Posts posts={posts} names={names} me={me} onDelete={(id) => void deletePost(id).then(load, (e: Error) => notify({ kind: 'error', message: e.message }))} />
      <Toggle label="Offer to share my new bests here" checked={sharePrs}
        description="After a workout with a new best, you’ll get a button to share it. Nothing is posted automatically."
        onChange={(v) => { setSharePrs(v); void setCircleSharing(circle.id, v).catch(() => { setSharePrs(!v); notify({ kind: 'error', message: 'Couldn’t save that. Try again.' }); }); }} />
      <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setLeaving(true)}>Leave circle</button>
      {sharing ? <ShareSheet title={`Invite to ${circle.name}`} initial={circleInviteMessage(circle.name, circle.join_code)} onClose={() => setSharing(false)} /> : null}
      {leaving ? (
        <Sheet title={`Leave ${circle.name}?`} onClose={() => setLeaving(false)} actions={
          <>
            <button className="btn secondary grow" onClick={() => setLeaving(false)}>Stay</button>
            <button className="btn grow" onClick={() => void leaveCircle(circle.id).then(() => { setLeaving(false); onLeft(); }, (e) => notify({ kind: 'error', message: circleError(e) }))}>Leave</button>
          </>
        }>
          <p>Your posts leave with you. You can rejoin any time with the code.</p>
        </Sheet>
      ) : null}
    </section>
  );
}

/** Private friend circles (3–6 people) with a kind week board and shared wins. */
export function CirclesScreen({ code }: { code?: string | null } = {}) {
  const { mode, journal, today, profile, notify } = useJournal();
  const trainerAvatar = profile.coach?.avatar ?? 'orb';
  const [circles, setCircles] = useState<Circle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'create' | 'join' | null>(null);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState(code ?? '');
  const [display, setDisplay] = useState(profile.nickname.split(' ')[0]!.slice(0, 24));
  const [avatar, setAvatar] = useState<CoachAvatarId>(trainerAvatar);
  const [busy, setBusy] = useState(false);
  const account = mode === 'account';

  const reload = useCallback(() => {
    if (!account) return;
    void myCircles().then((c) => { setCircles(c); setError(null); }, (e: Error) => setError(e.message));
  }, [account]);
  useEffect(reload, [reload]);
  // A shared link (#/circles/CODE) opens the join sheet, unless you're already in that circle.
  const linkCode = code?.toUpperCase().replace(/[\s-]/g, '') ?? '';
  const alreadyIn = !!circles?.some((c) => c.join_code === linkCode);
  const [linkHandled, setLinkHandled] = useState(false);
  if (account && linkCode && circles && !linkHandled) {
    setLinkHandled(true);
    if (alreadyIn) replaceRoute('circles');
    else setSheet('join');
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (sheet === 'create') {
        await createCircle(name.trim(), display.trim(), avatar);
        track('circle_created', {});
        notify({ kind: 'info', message: 'Circle created. Invite 2 or more friends to start the board.' });
      } else {
        await joinCircle(joinCode.trim(), display.trim(), avatar);
        track('circle_joined', {});
        replaceRoute('circles');
        notify({ kind: 'info', message: 'You’re in! Say hi with your next win 🎉' });
      }
      setSheet(null);
      reload();
    } catch (e) {
      setError(circleError(e));
    }
    setBusy(false);
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" style={{ gap: 4 }}>
        <button className="icon-btn plain" aria-label="Back" onClick={() => goBack('settings')}><Icon name="chevronLeft" /></button>
        <h1 className="sub-title grow">Circles</h1>
      </div>

      <div className="card notify-hero">
        <span className="nh-icon" aria-hidden="true"><Icon name="users" size={24} /></span>
        <div className="grow">
          <strong>Train together, kindly</strong>
          <p className="small muted">A private circle of 3–6 friends. You see how many days each person showed up and the wins they choose to share. Never what anyone ate or weighs.</p>
        </div>
      </div>

      {!account ? (
        <>
          <div className="notice" role="status">This is a sample circle with made-up friends. Real circles need a signed-in account.</div>
          <section className="card stack-sm" aria-label={DEMO_CIRCLE.name}>
            <span><strong style={{ fontSize: '1.0625rem' }}>{DEMO_CIRCLE.name}</strong><br /><span className="label">{DEMO_CIRCLE.board.length} of {CIRCLE_MAX} friends</span></span>
            <KindBoard rows={DEMO_CIRCLE.board} />
            <h3 className="label" style={{ fontWeight: 600, marginTop: 8 }}>Wins this month</h3>
            <Posts posts={DEMO_CIRCLE.posts} names={Object.fromEntries(DEMO_CIRCLE.board.map((r) => [r.user_id, r.display_name]))} me="me" />
          </section>
        </>
      ) : circles === null && !error ? (
        <div className="skeleton" style={{ height: 200 }} />
      ) : (
        <>
          {circles && circles.length === 0 ? (
            <EmptyState icon="users" tone="coach" title="No circles yet">Start one and share the code, or join a friend’s.</EmptyState>
          ) : null}
          {(circles ?? []).map((c) => <CircleCard key={c.id} circle={c} me={journal.ownerId} today={today} onLeft={reload} />)}
          <Section title="Add a circle">
            <div className="row" style={{ gap: 8 }}>
              <button className="btn grow" onClick={() => { setError(null); setSheet('create'); }}>Start a circle</button>
              <button className="btn secondary grow" onClick={() => { setError(null); setSheet('join'); }}>Join with a code</button>
            </div>
          </Section>
        </>
      )}
      {error && !sheet ? <div className="notice error" role="alert">{error}</div> : null}

      {sheet && account ? (
        <Sheet title={sheet === 'create' ? 'Start a circle' : 'Join a circle'} onClose={() => setSheet(null)} actions={
          <button className="btn block" disabled={busy || !display.trim() || (sheet === 'create' ? !name.trim() : joinCode.replace(/[\s-]/g, '').length !== 6)} onClick={() => void submit()}>
            {busy ? <span className="spinner" /> : sheet === 'create' ? 'Create circle' : 'Join circle'}
          </button>
        }>
          <div className="stack-sm">
            {sheet === 'create' ? (
              <label className="field">
                Circle name
                <input className="input" maxLength={40} placeholder="Morning crew" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
            ) : (
              <label className="field">
                Code from your friend
                <input className="input" maxLength={8} autoCapitalize="characters" placeholder="ABC234" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} />
              </label>
            )}
            <ProfileFields name={display} setName={setDisplay} avatar={avatar} setAvatar={setAvatar} />
            {error ? <div className="notice error" role="alert">{error}</div> : null}
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

export { ShareSheet };
