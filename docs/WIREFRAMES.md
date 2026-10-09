# Design tokens and the four main screens

This is an original visual system. It aims for the calm clarity of phone health apps without copying any brand's assets. The tokens are in `src/core/design/tokens.css`, and the components are in `src/core/design/app.css`.

## Tokens (summary)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f4f3ef` warm white | `#121211` charcoal | page |
| `--surface` | `#fcfcfb` | `#1a1a19` | cards, chart surface |
| `--ink` / `--ink-3` | `#1b1b19` / `#6b6a64` | `#f2f1ec` / `#a3a19a` | text / secondary text |
| `--accent` | `#1d7a48` green | `#3fae73` | primary actions, completed sets |
| `--info` | `#2a78d6` blue | `#3987e5` | the single chart series (validated ≥3:1 on both surfaces) |
| radii | 10 / 16 / 22 px, pill | | cards are 22 px |
| `--tap` | 48 px | | minimum control size |
| motion | 160 / 220 ms | 0 ms with reduced motion | state transitions only, and saving never waits for an animation |

Safe areas use `env(safe-area-inset-*)`. Dark mode follows the system unless the user picks Light or Dark in Settings.

## Navigation

Bottom bar with **Today · Meals · Train · Progress**. Settings opens from the profile button (top right). The Coach is a card on Today. It is visibly "Not set up" until Phase 2.

## Today

```
┌───────────────────────────────┐
│ Today            (DA Demo A)  │  date + profile/settings button
│ [Demo banner — synthetic]     │
│ ┌ NEXT ─────────────────────┐ │  one concise next action
│ │ Legs is next in your plan │ │
│ │ [ Start Legs ]            │ │
│ └───────────────────────────┘ │
│ Energy & protein     Meals ›  │  ≥ 415 kcal (partial) / target
│ [Estimate][Demo][Unknown]     │  badges explain uncertainty
│ ▓▓▓░░░░░░░  ▓░░░░░░░░         │  striped fill = partial
│ Usual meals — one tap         │  4 most-used presets
│ [Dal katori] [Roti]           │
│ Today's workout  [Start]      │  single Start/Continue
│ Steps & sleep                 │  "Not entered" / "Not tracked" + source
│ This week (one insight)       │
│ Weekly review — Not set up    │
└───────────────────────────────┘
```

## Meals

```
│ Today's intake (meters)       │
│ [ Mark today's log complete ] │
│ Your usual meals              │  big illustrated tiles, most-used first
│ ┌─────────┐ ┌─────────┐       │  tap tile = log default calibrated amount
│ │ (bowl)  │ │ (roti)  │       │  "Amount…" = stepper sheet (½ katori steps, 1 roti steps)
│ │Dal katori│ │ Roti    │       │
│ │1 katori │ │ 2 rotis │       │
│ │Amount…  │ │Amount…  │       │
│ └─────────┘ └─────────┘       │
│ [Repeat yesterday (8)] Photo… │  photo = Phase 2 explanation only
│ Today's timeline              │  time · slot · amount · kcal · [Edit]
```
Every log shows a toast: "Saved on this device · Dal katori, 1 katori [Undo]".

## Train

```
│ Push  (In progress · v1)      │  "2 of 9 sets done · saved after every set"
│ ┌ Bench press ──────────────┐ │
│ │ barbell · 1 warm-up + 3 × 6–8 @ 50 kg
│ │ Last time (Oct 5): 57.5kg×6, …        previous comparable performance
│ │ [W] Reps[10] kg[20]   (✓)  │  large complete button = 48 px
│ │ Planned: 10 reps @ 20 kg   │  planned always shown separately
│ │ [1] Reps[ 6] kg[57.5] (✓)  │  numeric keypad inputs
│ │ RIR [–]  ☐ Discomfort  Skip set
│ └───────────────────────────┘ │
│ [ Finish workout ]            │
│▕ Rest 1:42   [+30s] [Skip] ▏  │  persistent timer bar above nav
```

## Progress

```
│ Period            [7d|28d|90d]│
│ Weight: interpretation text   │  refuses a trend when data is sparse
│ (line chart, gaps on missing) │  tap = readout; "Show numbers" = table
│ [Today's weight (kg)] [Save]  │
│ Logging consistency 24/28 · 9 │
│ Steps (manual source note)    │  hollow markers = missing day, not zero
│ Exercise trend [select]       │  same variant only; e1RM labelled estimate
```

Screenshots of the built screens are in `docs/screenshots/`.
