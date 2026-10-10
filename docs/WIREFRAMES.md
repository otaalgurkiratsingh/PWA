# Design system and screens (redesign, 2026-10-09)

This is an original design. The direction takes the clarity, white space and soft rounded surfaces of the references (Headspace, Spotify, Apple Health), but copies no logos, layouts or assets. All screenshots below are real renders. They are in `docs/screenshots/` at 360 px and 390 px widths, regenerated with `npm run screenshots` plus `SHOTS=1 npx playwright test --project=auth-harness`.

## Tokens (`src/core/design/tokens.css`)

| Purpose | Light | Dark |
|---|---|---|
| Page / card | `#F7F8FA` / `#FFFFFF` | `#101216` / `#1B1E24` |
| Text / secondary | `#17191D` / `#626975` (5.4:1) | `#F4F5F7` / `#A9B1BE` |
| Border | `#E7EAF0` | `#303640` |
| Primary action | `#2563EB` (white text 5.2:1) | `#80A7FF` (dark text) |
| Food surface / ink | `#FFF0E6` / `#9A3412` | `#35251D` / `#FDBA8C` |
| Training surface / ink | `#E6F5EF` / `#166534` | `#183128` / `#86EFAC` |
| Coach surface / ink | `#F1ECFF` / `#5B21B6` | `#29213D` / `#C4B5FD` |
| Chart: weight / training | `#2563EB` / `#16A37A` | `#5B8DEF` / `#24A27A` (both passed the palette validator for lightness, chroma and ≥3:1 contrast) |

- **Type:** system font stack. Titles 30 px, sections 20 px, body 16 px, labels 13 px. Scales with browser text size; tested at 200% without horizontal scrolling.
- **Layout:** 8 px rhythm, 20 px gutters, 22 px card radius, 12 px control radius, 48 px controls (44 px minimum).
- **Motion:** 140 ms press feedback, 220 ms content transitions, 280 ms sheets. Animated: set ✓ pop, meal insertion, sheet rise, segmented changes. Everything is disabled with reduced motion. Saving never waits on animation.
- **Theme:** light on first launch, even on a dark-mode phone. A sun/moon control sits in Settings and on the welcome screen, with a Light / Dark / System setting. `/theme-init.js` sets the theme before first paint, so there is no flash.

## Components (`src/core/design/`)

Page header with date, Demo chip, backup chip and avatar. Also: section header with action link; card (neutral, food, train, coach); metric tile; labelled bar meter; meal card (thumbnail, name, usual amount, one-tap +); meal row; day card; exercise row with equipment art; set table (Set / Target / Weight / Reps / ✓); bottom sheet with focus trap and Escape; segmented control; chips; toggle; stepper; labelled tool row; toast with Undo; empty state; skeleton; single-series chart with touch readout and table alternative; calendar heatmap with legend; photo cropper.

**Imagery:** original flat illustrations, one per dish type: roti, dal, dahi, eggs, chai, coffee, rice, curry, paneer, sabzi, shake, ghee, oats, fruit, salad, sandwich, plus a neutral plate. Eggs look like eggs, and dal (yellow in a white bowl) differs from dahi (white in a blue bowl). The equipment drawings are simple and accurate; they are not form demonstrations. Your own meal photo replaces the illustration when you save one.

## Navigation

Bottom tabs: **Today · Food · Workout · Progress**. The **Coach** opens from the Today card and from Settings. **Settings** opens from the avatar. The plan and meal editors are full-screen with Back and Save.

## Screens

| Screen | First glance | Tap for detail | Behind Info/More |
|---|---|---|---|
| Welcome | mark, "Your routine, made simpler", calm illustration, email, Continue | code step with resend countdown and "use a different email" | demo entry; a truthful "being set up" notice |
| Today | greeting; one featured action (continue/start workout, or log a meal); energy and protein | usual-meal carousel; last 3 meals; small weight/steps/workouts tiles only when data exists; Coach card | — |
| Food | day switcher; energy/protein against targets | carousel of usual meals → portion sheet (amount, meal type, Add); Add food → Usual / Create / Photo; Breakfast/Lunch/Snack/Dinner rows → edit, add again, delete with Undo | carbs/fat/fibre; per-item grams and sources |
| Meal editor | picture (illustration or own photo), name, favourite | usual portion with grams per unit ("weigh once"); nutrition from a label/food or a recipe (raw/dry/cooked, oil counted once, cooked batch weight) | live estimate of the usual portion |
| Workout | "Up next" card with Start; My plan day cards (number or weekday badge, muscles, exercises) | recent workouts → summary | — |
| Plan editor | plan name; in order / on set weekdays; day chips + Add day | per day: rename, weekday, earlier/later, duplicate, remove; exercises: up/down/copy/replace/remove; sets: warmup/working, reps min–max, optional weight, rest | library search, create my own exercise, notebook-photo import (AI) |
| Active workout | day name, sets done, progress bar, Finish | current exercise expanded; set rows with target vs actual; Add set; Something hurts | set options: effort ("how many more reps"), skip, "something hurt"; finish summary with Reopen |
| Progress | 7 days / 4 weeks / 3 months; four metric tiles | weight chart with readout and one-line takeaway; workout calendar; exercise picker and best-set chart; nutrition and steps when present | trend method, e1RM note, data tables |
| Coach | weekly review: Evidence / Suggested next step / Missing information | starter questions and short Q&A; proposed target change with before/after, Accept / Keep current | memory you can add, edit or delete; usage left today |
| Settings | name, theme | units, goal, targets; backup status and conflicts; AI help consent; export/restore | sign-out safety; account deletion; demo controls |

All states are built: empty (no meals, no plan, no weigh-ins, nothing this period), loading skeletons, offline notices, save errors with a plain message, AI not configured / consent off / limit reached / paused / provider error, sign-in errors, unapproved account, and sync conflicts.
