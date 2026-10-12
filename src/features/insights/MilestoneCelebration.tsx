import { useState } from 'react';
import { CoachAvatar } from '@/core/design/CoachAvatar';
import { Icon } from '@/core/design/icons';
import { Sheet } from '@/core/design/ui';
import { useTrainer } from '@/features/coach/Trainer';
import { StoryPreview } from './StorySheet';
import { storyFilename, storyFromMilestone } from './story';
import './insights.css';

const NOTE: Record<7 | 30 | 100, string> = {
  7: 'A full week of showing up. That’s exactly how habits begin.',
  30: 'A whole month of looking after yourself. This is becoming part of who you are.',
  100: 'One hundred days. That isn’t luck, that’s you, choosing it again and again.',
};

const CONFETTI = Array.from({ length: 18 }, (_, i) => i);

/** Celebration for a 7, 30 or 100-day logging streak. Sharing only happens on a tap. */
export function MilestoneCelebration({ days, onClose, onShare }: {
  days: 7 | 30 | 100;
  onClose: () => void;
  onShare?: (kind: string) => void;
}) {
  const trainer = useTrainer();
  const [sharing, setSharing] = useState(false);
  const card = storyFromMilestone(days, trainer.name);

  return (
    <Sheet
      title={sharing ? 'Share your milestone' : `${days} days in a row!`}
      onClose={onClose}
      actions={
        sharing ? (
          <button className="btn secondary block" onClick={() => setSharing(false)}>Back</button>
        ) : (
          <>
            <button className="btn tonal grow" onClick={() => setSharing(true)}>
              <Icon name="upload" />
              Share card
            </button>
            <button className="btn grow" onClick={onClose}>Keep going</button>
          </>
        )
      }
    >
      {sharing ? (
        <StoryPreview card={card} filename={storyFilename(card, `${days}-days`)} onDone={() => onShare?.('milestone')} />
      ) : (
        <div className="ins-celebrate">
          <div className="ins-confetti" aria-hidden="true">
            {CONFETTI.map((i) => <span key={i} style={{ ['--i' as string]: i }} />)}
          </div>
          <div className="ins-celebrate-badge" aria-hidden="true">
            <span className="ins-celebrate-num">{days}</span>
            <span className="ins-celebrate-unit">days</span>
          </div>
          <p className="ins-celebrate-lead">{NOTE[days]}</p>
          <div className="ins-trainer-note">
            <CoachAvatar avatar={trainer.avatar} size={52} ring />
            <div className="bubble coach">
              So proud of you. Same easy pace tomorrow, one log at a time.
              <span className="ins-signoff">{trainer.name}, your AI trainer</span>
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}
