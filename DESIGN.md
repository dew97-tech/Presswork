# DESIGN

Design system for the portfolio. Every component and page must follow this file. If a value is missing here, add it here first, then use it.

The system is **Vertical**, the technical design skill from TypeUI (`https://www.typeui.sh/design-skills/vertical`). Vertical is light, cool, and engineered: a gray page surface, raised white panels, deep charcoal brand moments, sharp 4px corners, monospace labels, and an editorial serif for headings. It should read as precise and confident, never cold or cluttered.

Dials: `DESIGN_VARIANCE 3` · `MOTION_INTENSITY 2` · `VISUAL_DENSITY 4`

---

## Palette

Defined in `src/app/globals.css`. Colors below are the source of truth; never introduce a hex value that is not listed here.

### Light (default)

| Token | Value | Role |
| --- | --- | --- |
| `--paper` | `#F4F4F5` | Page surface. Application and page background. |
| `--paper-soft` | `#FAFAFA` | Soft panel. Subtle fills and the `band-surface` band. |
| `--surface` | `#FFFFFF` | Raised panel. Cards, modals, menus, the `band-paper` band. |
| `--ink` | `#18181B` | Heading and primary text. |
| `--ink-brown` | `#18181B` | Headings. Alias of `--ink`; kept so components read consistently. |
| `--ink-muted` | `#52525B` | Body, descriptions, secondary copy. |
| `--ink-faint` | `#71717A` | Meta, captions, placeholders. |
| `--rule` | `#E4E4E7` | Decorative rails and dividers. |
| `--rule-strong` | `#18181B` | Emphatic rules. |
| `--clay` | `#232323` | Brand. Emphasis, bullet markers, registration crosshairs. |
| `--clay-text` | `#232323` | Link text. |
| `--clay-deep` | `#232323` | Primary action background. |
| `--clay-deep-hover` | `#09090B` | Primary action hover. |
| `--clay-soft` | `rgba(35,35,35,0.06)` | Accent tint. |
| `--focus` | `#232323` | Focus ring. |
| `--input` | `#71717A` | Interactive control borders (3:1 minimum). |

`--ink`, `--ink-muted`, `--clay`, `--focus` and `--input` are the only tones that carry meaning. Everything else derives from them.

### Inverted band (`band-invert`)

The header, hero, and footer run on a charcoal band. The class redefines the semantic tokens for its subtree, so components need no special handling: page `#232323`, text `#FAFAFA`, secondary text `#A1A1AA`, rules `#3F3F46`, actions `#F4F4F5` with `#18181B` text.

### Dark mode

Derived by inverting the roles: page `#18181B`, panel `#27272A`, text `#FAFAFA`, secondary `#A1A1AA`, rules `#3F3F46`, actions `#F4F4F5` with `#18181B` text. The inverted band lifts to `#27272A` so it stays distinct from the page.

Semantic status colors (`--ok`, `--warn`, `--danger`) are functional, not decorative, and keep their own values in both modes.

---

## Color rules

- **No decorative accent.** Vertical is monochrome plus charcoal. Do not introduce yellow, sage, mustard, lavender, coral, or any second brand hue. The highlighter is charcoal.
- Never use pure black or pure white as text color.
- Body text must hold 4.5:1 against its background; metadata and control boundaries must hold 3:1. Both were verified across every mode.
- No gradients, glass, neon, glow, or heavy shadows.
- The only decorative treatments on the public site are text selection, the highlight marker, the registration crosshairs, and the two vertical guide rails.

---

## Typography

| Role | Family | Notes |
| --- | --- | --- |
| Display and headings | **EB Garamond** 400/500 | Medium weight, tight tracking, `#18181B` |
| Body and UI | **Inter** 400/500/600 | 16px minimum, line-height 1.65 |
| Article body | **Newsreader** 400/600 + italic | 19px, line-height 1.75, 60 to 75ch measure |
| Labels, meta, tags, code | **Geist Mono** 400/500 | Uppercase for labels, tabular figures for numbers |

Scale: name `clamp(2.75rem, 6.5vw, 5.25rem)`; section title `clamp(1.75rem, 3vw, 2.25rem)`; case-study title `clamp(2.5rem, 5.5vw, 4rem)`; metric value `3xl` to `4xl`; entry title `1.25rem` Inter 600; body `1.125rem`; article body `1.1875rem`; small `0.875rem`.

Rules:

- **Labels and eyebrows are uppercase Geist Mono at 12px with `0.08em` tracking.** This is Vertical's signature. Apply with the `.eyebrow` class and use it sparingly: metadata lines, bylines, and tags only.
- Content headings stay sentence case in EB Garamond. Do not uppercase a heading.
- Headings are `#18181B`, never charcoal-as-decoration.
- Body copy measures 65ch on the home page, 60 to 75ch in articles.
- Apply `text-wrap: balance` to headings and `text-wrap: pretty` to body copy.

---

## Shape

Vertical's rule is one slight radius: **4px** on buttons, inputs, badges, cards, menus, modals, tabs, tables, code blocks, and images. Only functionally round controls such as toggles, avatars, radios, and range thumbs use full rounding.

Depth comes from white raised surfaces, subtle borders, and spacing. Heavy shadows, glow, oversized rounding, pastel surfaces, and decorative striping are outside the system.

Rules do the work: 1px `--rule` for separation, 2px `--rule-strong` for emphasis. Hairline borders only.

---

## Structure

- **Charcoal band hero and footer** (`band-invert`), with a light content body between them.
- Content sections alternate `band-paper` (white) and `band-surface` (soft gray).
- Page and band surfaces are flat. No texture, grid, or pattern is painted behind content.
- Two 1px vertical guide rails at 10% run the full height from `xl` up, framing the container 590px either side of centre.
- Container is 1180px with 20px gutters on mobile and 32px at `md`.
- Article pages keep a 720px reading measure and, from `xl`, gain a 300px sticky contents rail inside the same container, so the guide rails frame the pair rather than a half-empty column. Posts with fewer than three headings stay single column.
- Topic hubs under `/blog/tag` reuse the blog ledger; hubs below three posts stay `noindex` and out of the sitemap.
- Registration crosshair: a 9px `+` in charcoal, centred on the section rule at the container's left edge. Hidden below `md`.
- Project rows are an asymmetric ledger: title and meta left, detail right at `lg`. No three equal cards.
- Hero carries three text elements: name, role line, actions. No scroll cue, badge, availability dot, or facts strip.

---

## Motion

Typed line appears in three places only: the hero role line (mount, with caret), section headings (on view, 28ms per character, no caret), and the Experience total (450ms delay, with caret).

Marker placements: `4+ years`, one outcome per project row, and `mark` in articles. Never highlight a technology name just because it is listed elsewhere.

Reveals use one pattern: opacity plus 8px rise, 500ms, `cubic-bezier(0.23, 1, 0.32, 1)`, once. Only `transform` and `opacity` animate.

Link affordances are drawn, not stacked: `.link-draw` sweeps an underline on hover, and arrow glyphs are hidden until hover so lists stay quiet at rest.

---

## Copy

Sentence case everywhere except mono labels.

Banned: elevate, seamless, unleash, next-gen, game-changer, robust, delve, journey, dive, deep dive, passion, craft as filler, cutting-edge, empower, leverage, landscape, supercharge.

No em dash, no en dash separator, no ellipsis in headings or body. Use a spaced hyphen in date ranges: `Oct 2024 - Present`.

No invented numbers, no fake precision, no mock metrics. Every figure on this site must be checkable.

---

## Accessibility

WCAG 2.2 AA. Focus is a 3px `--focus` outline with 3px offset, visible on every interactive element. Touch targets are at least 44px. Body text holds 4.5:1 and control boundaries hold 3:1 in light, dark, and inverted-band modes.

---

## Assets

Real images only. No div-built fake screenshots and no hand-drawn decorative SVG. Project rows accept an optional real screenshot; until one exists the rows stand on typography alone.
