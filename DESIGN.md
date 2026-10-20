# kitchen-ops — Design spec

This file is the source of truth for kitchen-ops' visual design. Follow it when building or changing any UI. When something isn't covered here, choose the option most consistent with what is.

**Scope:** dark mode only for now. No light theme has been designed yet, so don't invent one. Structure the tokens so a light theme can be added later by redefining the same variables.

**UI language:** Spanish (es-ES). All user-facing copy is in Spanish.

---

## 1. Principles

1. **Neutral first, color with meaning.** About 90% of the UI is near-black and gray. Color appears only where it means something: green for the active item, the primary action and "ready/OK"; amber for pending; red for problems. Never use color as decoration.
2. **The home screen does work.** Screens show what needs attention, not menus of links that duplicate the sidebar.
3. **Hierarchy through size, weight and gray, not boxes.** Avoid stacking borders, nested cards and extra dividers. One card level only.
4. **Numbers are data.** Every amount, count, percentage and keyboard shortcut uses the monospaced font with tabular figures so columns line up.
5. **Calm and spacious.** Use generous padding and consistent gaps from the spacing scale. Never squeeze content to avoid scrolling.

---

## 2. Design tokens

Put these in one global stylesheet (e.g. `src/styles/tokens.css`) as CSS custom properties. Components must use the variables, never raw hex values. If the project uses Tailwind, map these variables into the theme config rather than duplicating values.

```css
:root {
  /* Backgrounds (darkest → lightest) */
  --bg-app:            #0E0F0E;  /* page background */
  --bg-sidebar:        #121412;
  --bg-surface:        #141614;  /* cards */
  --bg-raised:         #161816;  /* inputs, user menu button */
  --bg-hover:          #1B1E1B;  /* list row hover */
  --bg-nav-hover:      #1A1D1A;
  --bg-icon-tile:      #1D201D;  /* square behind list icons */

  /* Borders */
  --border-subtle:     #1B1E1B;  /* dividers between list rows */
  --border-divider:    #1F231F;  /* divider under a card header */
  --border-default:    #222622;  /* card and sidebar borders */
  --border-input:      #262A26;
  --border-strong:     #2E332E;  /* dashed dropzone, kbd hints */

  /* Text */
  --text-primary:      #ECEDEA;
  --text-secondary:    #B4BAB3;  /* inactive nav, icons */
  --text-muted:        #9BA19A;  /* labels, counts */
  --text-faint:        #858C85;  /* meta lines, timestamps, captions */
  --text-decorative:   #5E655E;  /* chevrons only; never for readable text */

  /* Accent (brand) */
  --accent:            #5FD38D;
  --accent-soft:       rgba(95, 211, 141, 0.13); /* active nav bg, OK pill bg */
  --on-accent:         #0B130E;  /* text/icons on solid accent */
  --avatar-bg:         #243026;

  /* Status */
  --warning:           #E8B45A;  /* pending */
  --warning-soft:      #2A2418;
  --danger:            #F28B7D;  /* incidents, price increases */
  --danger-soft:       #2B1C1A;
  /* "OK / ready" uses --accent and --accent-soft */

  /* Typography */
  --font-sans: 'Geist', Inter, system-ui, sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, monospace;

  /* Radius */
  --radius-sm:   8px;   /* nav items, logo mark */
  --radius-tile: 9px;   /* 36px icon tiles */
  --radius-md:  10px;   /* buttons, inputs, user menu */
  --radius-lg:  12px;   /* 44px icon tiles */
  --radius-xl:  14px;   /* cards, dropzone */
  --radius-pill: 999px;

  /* Sizing */
  --control-height: 40px;  /* buttons, inputs, nav items */
  --sidebar-width: 240px;
  --content-max-width: 1180px;
}
```

**Fonts:** load Geist (400, 500, 600, 700) and Geist Mono (400, 500) from Google Fonts or the `geist` npm package.

**Contrast:** `--text-faint` on `--bg-surface` is the minimum for readable text (about 4.9:1). Don't introduce a dimmer gray for text.

---

## 3. Typography scale

| Use | Size | Weight | Other |
|---|---|---|---|
| Page title (h1) | 28px | 600 | letter-spacing −0.02em |
| KPI value | 28px | 500 | mono, letter-spacing −0.02em |
| Section/card title (h2) | 15px | 600 | |
| App name in sidebar | 15px | 600 | letter-spacing −0.01em |
| Body, list primary text | 14px | 400–500 | line-height 1.45 |
| Secondary text, links, labels | 13px | 400 | |
| Meta lines, pills, captions | 12px | 400–500 | |
| Keyboard hint (⌘K) | 11px | 400 | mono, 1px `--border-strong`, radius 5px |

Use the class `.num` (or a component) for anything numeric:

```css
.num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
```

**Number formatting:** use `Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })` for money, which gives `1.248,90 €`. Drop the decimals for large totals (`14.630 €`). Percentages are shown with a sign and one decimal: `+17,7%`.

---

## 4. Spacing

Base unit 4px. Common values:

- Content area padding: `32px 40px 56px`
- Gap between page sections: `28px`
- Gap between cards / columns: `20px`
- Gap between KPI cards: `16px`
- Card padding: `18px 20px`
- Card header: `16px 20px`, with a `--border-divider` line underneath
- List row padding: `14px 20px` (compact rows in side cards: `12px 20px`)
- Gap inside a list row: `14px`
- Sidebar padding: `20px 14px`; gap between nav items: `2px`

---

## 5. Layout shell

- **No top bar.** The app has a left sidebar and a content area only.
- **Sidebar** (`--sidebar-width`, `--bg-sidebar`, 1px right border `--border-default`), top to bottom:
  1. Logo: a 30×30 rounded square (`--radius-sm`) in `--accent` holding a chef-hat icon in `--on-accent`, followed by "kitchen-ops".
  2. Navigation: Inicio, Documentos, Catálogo. Each item is 40px tall, padded 10px, with an 18px icon and a 12px gap.
     - Inactive: `--text-secondary`; hover background `--bg-nav-hover`.
     - Active: background `--accent-soft`, text and icon `--accent`, weight 500, `aria-current="page"`.
     - Documentos shows a count badge of documents to review: mono 12px, 20px tall pill, `--warning-soft` background, `--warning` text. Hide it when the count is 0.
  3. A spacer that pushes the next item to the bottom.
  4. User menu button: 32px avatar circle (`--avatar-bg`, initials in `--accent`), name plus role on a second line ("Restaurante · Propietario", `--text-faint` 12px), and an up/down chevron. Styling: `--bg-raised`, 1px `--border-default` border, `--radius-md`.
- **Content:** padding as in §4, inner container `max-width: var(--content-max-width)` and centered.
- **Responsive:** below roughly 800px the sidebar stacks above the content at full width. Never use a sticky or `100vh` sidebar. Two-column areas wrap into one column. Tables scroll horizontally inside their card.

---

## 6. Components

### Buttons
- **Primary:** 40px tall, padding `0 16px`, `--radius-md`, background `--accent`, text `--on-accent`, weight 600, optional 16px leading icon with an 8px gap. Use one per screen at most.
- **Secondary** (when needed): same size, `--bg-raised` background, 1px `--border-input` border, `--text-primary`.
- **Text link:** 13px, `--accent`, optional trailing 14px chevron-right (e.g. "Ver todos").

### Search input
40px tall, `--bg-raised` background, 1px `--border-input` border, `--radius-md`, a 16px search icon in `--text-faint`, a transparent input, and a ⌘K hint at the end. Width 300px, `max-width: 100%`. It needs a real `<label>`, which can be visually hidden.

### Card
`--bg-surface` background, 1px `--border-default` border, `--radius-xl`, no shadow. A card holding a list uses `overflow: hidden` and lets its rows run edge to edge.

### KPI card
A card with a 13px `--text-muted` label, a 28px mono value, and a 12px `--text-faint` caption that explains the number. Lay KPIs out in a wrapping flex row, `flex: 1 1 200px`. The value takes a status color only when it represents a problem (e.g. incidents in `--danger`).

### List row (documents)
The whole row is a single link (`<a>` or router-link). It contains:
1. A 36×36 icon tile (`--radius-tile`): normally `--bg-icon-tile` with a `--text-secondary` file icon. For incidents use `--danger-soft` with a `--danger` alert-triangle; for "ready" use `--accent-soft` with an `--accent` check.
2. Two lines: primary (supplier name, weight 500) and meta (12px `--text-faint`: `Tipo · cuándo · N líneas`, joined with `·`).
3. A status pill.
4. An amount, right-aligned in a fixed 96px mono column.

Rows are separated by `--border-subtle` and use `--bg-hover` on hover.

### Status pill
12px, weight 500, padding `3px 9px`, `--radius-pill`.

| Status | Label | Background | Text |
|---|---|---|---|
| Pending review | Pendiente | `--warning-soft` | `--warning` |
| Mismatch / problem | Incidencia | `--danger-soft` | `--danger` |
| Ready to approve / OK | Listo para aprobar | `--accent-soft` | `--accent` |

### Dropzone
A full-width `<button>` with a 1.5px dashed `--border-strong` border, `--radius-xl`, transparent background and padding `22px 24px`. It holds a 44px icon tile with an upload icon, a title ("Arrastra aquí albaranes y facturas", weight 500) and a 13px `--text-faint` subtitle. On drag-over, switch the border to `--accent` and the background to `--accent-soft`.

### Compact stat rows (side cards)
Each row is a link with an 18px `--text-secondary` icon, a label, a mono count in `--text-muted`, and a 14px chevron in `--text-decorative`.

### Icons
Use Lucide (`lucide-vue-next`) with stroke width 1.75 and round caps and joins, colored with `currentColor`. Sizes: 18px in nav and rows, 16px in buttons and inputs, 14px for chevrons, 20px in the dropzone tile. Decorative icons get `aria-hidden="true"`, and icon-only buttons get an `aria-label`. Never use emoji.

Icons by concept: home → `House`, documents → `FileText`, catalog → `BookOpen`, upload → `Upload`, incident → `TriangleAlert`, ok → `Check`, price up → `TrendingUp`, products → `Package`, suppliers → `Truck`, warehouses → `Warehouse`, logo → `ChefHat`.

---

## 7. Home screen (Inicio)

Top to bottom:

1. **Header row** (wraps on small screens):
   - Left: today's date in 13px `--text-faint` (e.g. "Martes, 20 de octubre", using `Intl.DateTimeFormat('es-ES')`), then an h1 greeting that depends on the time of day ("Buenos días" / "Buenas tardes" / "Buenas noches", followed by the user's name).
   - Right: the search input and the primary button "Subir documento" with an upload icon.
2. **KPI row** with three cards:
   - *Por revisar*: the count of received documents not yet reviewed (caption "documentos recibidos").
   - *Incidencias abiertas*: the count of invoices that don't match their delivery notes, value in `--danger` when > 0 (caption explains the issue).
   - *Compras en [mes]*: total purchases this month from processed delivery notes.
3. **Two columns** (left `flex: 2 1 520px`, right `flex: 1 1 300px`, gap 20px):
   - **Left:**
     - "Para revisar" card: header with "Ver todos" link, then up to 5 document rows, sorted with incidents first, then pending, then ready, newest first within each group.
     - Dropzone below it.
   - **Right:**
     - "Precios que han subido" card (title has a `TrendingUp` icon in `--danger`): up to 3 rows of `product / unit`, `old → new €` (mono, `--text-faint`) and `+x,x%` (mono, `--danger`, in a 54px right-aligned column). The footer caption explains what the comparison is against.
     - "Catálogo" card: compact rows for Productos, Proveedores and Almacenes with their counts.

**Data:** the mockup used sample data. **Do not hardcode it.** Wire every number and row to real data. If a data source doesn't exist yet (e.g. price-change detection), leave a clear TODO and either hide the section or show an empty state. Never show fake numbers.

**Empty states:** if nothing needs review, replace the list with one calm line ("Todo revisado. No hay documentos pendientes.") and a small `Check` icon. Don't use illustrations.

---

## 8. Accessibility

- Use real elements: `<button>`, `<a>`/router-link, `<input>` with `<label>`. Never put click handlers on `div`s.
- Keep text contrast at 4.5:1 or better using the tokens above.
- Status is never conveyed by color alone: pills always carry a text label.
- Interactive targets are at least 40px tall.
- Use visible focus rings: `outline: 2px solid var(--accent); outline-offset: 2px` on `:focus-visible`.

---

## 9. Don'ts

- No gradients, glows, glassmorphism or drop shadows on cards.
- No colored left borders on cards.
- No more than one accent color. Status colors only for status.
- No top bar, no breadcrumbs on the home screen.
- No hardcoded hex values in components; use the tokens.
- Don't add new grays, radii or font sizes without adding them here first.

---

## 10. How to apply this (instructions for Claude Code)

1. Create the token stylesheet from §2 and load the fonts.
2. Rebuild the layout shell (§5): remove the top bar and move the user menu into the sidebar.
3. Build the shared components from §6 (button, card, KPI card, list row, status pill, dropzone, search input) as reusable components.
4. Rebuild the Inicio screen (§7) with real data and proper empty states.
5. Restyle the existing Documentos and Catálogo pages with the same tokens and components. Don't redesign their structure unless asked.
6. After each step, run the app, take a screenshot and compare it against this spec, fixing any spacing, color or typography differences before moving on.
