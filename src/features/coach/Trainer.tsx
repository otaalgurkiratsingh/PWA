import { useState, type ReactNode } from 'react';
import { DEFAULT_COACH, type CoachAvatarId } from '@shared/contracts';
import { useJournal } from '@/app/JournalContext';
import { goBack, navigate } from '@/app/router';
import { AVATAR_LABEL, AVATARS, CoachAvatar } from '@/core/design/CoachAvatar';
import { Icon } from '@/core/design/icons';
import { Sheet } from '@/core/design/ui';

const NAME_IDEAS = ['Luma', 'Sher', 'Coach Kaur', 'Max', 'Mini', 'Veer'];

/** The person's trainer: their chosen name and avatar (defaults until they pick). */
export function useTrainer() {
  const { profile } = useJournal();
  return profile.coach ?? DEFAULT_COACH;
}

/** "Meet your trainer": name + avatar. A personal touch only — it never changes the advice. */
export function TrainerSheet({ onClose, first = false }: { onClose: () => void; first?: boolean }) {
  const { profile, updateProfile, notify } = useJournal();
  const current = profile.coach ?? DEFAULT_COACH;
  const [name, setName] = useState(current.chosen_at ? current.name : '');
  const [avatar, setAvatar] = useState<CoachAvatarId>(current.avatar);
  const shown = name.trim() || current.name;
  const save = async () => {
    const clean = shown.replace(/\s+/g, ' ').trim().slice(0, 24);
    await updateProfile({ ...profile, coach: { name: clean, avatar, chosen_at: new Date().toISOString() } });
    notify({ kind: 'info', message: `Say hi to ${clean}!` });
    onClose();
  };
  return (
    <Sheet title={first ? 'Meet your trainer' : 'Your AI trainer'} onClose={onClose}
      actions={<button className="btn block" onClick={() => void save()}>{first ? `Start chatting with ${shown}` : 'Save'}</button>}>
      <div className="stack">
        <div className="trainer-preview">
          <CoachAvatar avatar={avatar} size={76} ring />
          <div className="bubble coach">Hi! I’m {shown}. I’ll help you plan workouts and meals from your own logs.</div>
        </div>
        <label className="field">
          Name your trainer
          <input className="input" value={name} maxLength={24} placeholder={current.name} autoComplete="off"
            onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="chips wrap" aria-label="Name ideas">
          {NAME_IDEAS.map((n) => <button key={n} type="button" className="chip" aria-pressed={shown === n} onClick={() => setName(n)}>{n}</button>)}
        </div>
        <div className="stack-sm">
          <span className="label" style={{ fontWeight: 600 }} id="avatar-pick">Pick a look</span>
          <div className="avatar-grid" role="radiogroup" aria-labelledby="avatar-pick">
            {AVATARS.map((a) => (
              <button key={a} type="button" role="radio" aria-checked={avatar === a} aria-label={AVATAR_LABEL[a]}
                className="avatar-choice" onClick={() => setAvatar(a)}>
                <CoachAvatar avatar={a} size={48} />
              </button>
            ))}
          </div>
        </div>
        <p className="label">Just for fun: the name and look don’t change what the coach can do or what it reads.</p>
      </div>
    </Sheet>
  );
}

/** Floating "chat with your trainer" button on the main tabs, like a messenger bubble. */
export function TrainerFab() {
  const trainer = useTrainer();
  return (
    <button className="trainer-fab" aria-label={`Chat with ${trainer.name}, your AI trainer`} onClick={() => navigate('chat', 'new')}>
      <CoachAvatar avatar={trainer.avatar} size={54} ring />
      <span className="tf-dot" aria-hidden="true" />
    </button>
  );
}

/** Chat header: the trainer's avatar and name (tap to change), plus screen actions. */
export function TrainerHead({ children }: { children?: ReactNode }) {
  const trainer = useTrainer();
  const [editing, setEditing] = useState(false);
  return (
    <div className="chat-head">
      <button className="icon-btn plain" aria-label="Back" onClick={() => goBack('coach')}><Icon name="chevronLeft" /></button>
      <button className="trainer-id grow" onClick={() => setEditing(true)} aria-label={`${trainer.name}, your AI trainer. Change name or look`}>
        <CoachAvatar avatar={trainer.avatar} size={38} ring />
        <span className="ti-text">
          <h1 className="sub-title">{trainer.name}</h1>
          <span className="label">Your AI trainer</span>
        </span>
      </button>
      {children}
      {editing ? <TrainerSheet onClose={() => setEditing(false)} /> : null}
    </div>
  );
}

/** Meet-your-trainer prompt shown until the person picks a name and look. */
export function MeetTrainer() {
  const trainer = useTrainer();
  const [open, setOpen] = useState(false);
  if (trainer.chosen_at) return null;
  return (
    <div className="card meet-trainer">
      <CoachAvatar avatar={trainer.avatar} size={52} ring />
      <span className="grow">
        <strong>Make it yours</strong>
        <span className="small muted" style={{ display: 'block' }}>Give your trainer a name and pick a cute look.</span>
      </span>
      <button className="btn sm" onClick={() => setOpen(true)}>Choose</button>
      {open ? <TrainerSheet first onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

