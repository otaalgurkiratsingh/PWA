/**
 * The "Form" button next to an exercise name (workout, plan editor, picker). It opens the How-to
 * sheet in place — no navigation away from the workout. The sheet (FormDemo.tsx) and the exercise
 * library are loaded only when tapped.
 */
import { lazy, Suspense, useState, type ComponentProps, type MouseEvent } from 'react';
import { findGuide, loadGuide, type GuideExercise } from '@shared/catalogue/exerciseGuide';
import { Icon } from '@/core/design/icons';

const loadSheet = () => import('./FormDemo');
const LazySheet = lazy(() => loadSheet().then((m) => ({ default: m.HowToSheet })));

/** The How-to sheet, fetched on first use. */
export function HowToSheet(props: ComponentProps<typeof LazySheet>) {
  return <Suspense fallback={null}><LazySheet {...props} /></Suspense>;
}

export function FormLink({ name, onClick }: { name: string; onClick: (e: MouseEvent) => void }) {
  return (
    <button type="button" className="form-btn" aria-label={`Form: how to do ${name}`} onClick={onClick}>
      <Icon name="info" size={16} /> Form
    </button>
  );
}

/** Form button for a plan or session exercise, found in the library by exercise key + equipment. */
export function FormButton({ exerciseKey, equipment, name }: { exerciseKey: string; equipment: string; name: string }) {
  const [open, setOpen] = useState<{ ex: GuideExercise | null } | null>(null);
  const show = async (e: MouseEvent) => {
    e.stopPropagation();
    const [all] = await Promise.all([loadGuide().catch(() => [] as GuideExercise[]), loadSheet().catch(() => null)]);
    setOpen({ ex: findGuide(all, exerciseKey, equipment) });
  };
  return (
    <>
      <FormLink name={name} onClick={(e) => void show(e)} />
      {open ? <HowToSheet name={name} exercise={open.ex} custom={exerciseKey.startsWith('custom:')} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
