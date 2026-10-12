import type { ReactNode } from 'react';
import type { CoachAvatarId } from '@shared/contracts';
import { CoachAvatar } from '@/core/design/CoachAvatar';

/** One trainer message: small avatar beside the bubble, like a messenger. */
export function CoachLine({ avatar, children }: { avatar: CoachAvatarId; children: ReactNode }) {
  return (
    <div className="coach-line">
      <CoachAvatar avatar={avatar} size={28} />
      <div className="stack-sm" style={{ alignItems: 'flex-start', minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** "Luma is thinking" with three bouncing dots (static under reduced motion). */
export function Typing({ name }: { name: string }) {
  return (
    <div className="bubble coach typing" role="status" aria-label={`${name} is thinking`}>
      <span className="dots" aria-hidden="true"><i /><i /><i /></span>
    </div>
  );
}
