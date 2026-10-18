# 0024. The design system: Reka UI, Tailwind CSS and our own tokens and components

- Status: Accepted
- Date: 2026-10-18

## Context

Phase 2 aims for an app that looks and behaves like a professional product (spec section 11.2), and every phase 2 screen needs forms, lists and dialogs. Until now, the three views each had their own plain styles. The interface must meet WCAG 2.2 AA, work on phones and desktops, follow the system's light or dark setting, and never turn a quantity or a price into a JavaScript `number` (CLAUDE.md).

Spec section 11.3 proposed a headless component library with Tailwind CSS and our own design tokens.

## Decision

**Tokens** in `apps/web/src/design/tokens.css`, as Tailwind 4's `@theme`: colours, a type scale, spacing, radius and shadows. Tailwind's own palette is switched off, so only our colours exist.
- **Each colour is `light-dark(light, dark)`.** The browser picks one from the page's `color-scheme`, which follows the system unless the gallery forces one.
- **A test reads the file** and checks every colour pair the components use against WCAG 2.2 AA in both themes: 4.5:1 for text, 3:1 for a control's edge and the focus ring.
- **One focus ring for everything:** a 2px blue outline that no other state uses.

**Components** in `apps/web/src/components/ui/`, prefixed `Ui` so none shares a name with an HTML element (`UiButton`, not `Button`).
- **Built on Reka UI** (formerly Radix Vue) where the keyboard and screen-reader behaviour is hard: select, combobox, checkbox, switch, dialog, tabs and toasts. Reka is headless: it gives the behaviour and the ARIA, and our classes give the look.
- **Our own:**
  - the button, text field, card, badge, and the empty, loading and error states;
  - **the number field.** Reka's works with JavaScript numbers. Ours keeps a decimal string, reads a comma or a point, refuses thousands separators (is "1.234" 1234 or 1.234?), and refuses extra decimals instead of rounding them;
  - **the data table.** It's controlled: it shows the page of rows it's given and emits the sort and page asked for, so the same table works whether the browser sorts and pages the rows or the API does (#89).
- **Every component's own text goes through i18n** (decision 0023).

**A component gallery at `/gallery`** shows every component in every state, with switches for the theme and the language.
- **Builds:** it's in the dev server and the browser tests' build (`vite build --mode e2e`), and left out of staging and production builds entirely, route and code. A test builds both ways to prove it.
- **Tests:** the browser tests run axe on it in light and dark, and work every component with the keyboard alone.

**Inter,** self-hosted through Fontsource, so it's the same on every device and works offline in the PWA. Tables use its tabular figures, so amounts line up.

## Alternatives considered

- **shadcn-vue:** the same Reka UI and Tailwind, with ready-made components copied into the repo. It's quicker to start, but the copied code comes with its own conventions and tokens to adapt, and writing each component is where the accessibility and the money rules are learnt and kept.
- **A styled library** such as PrimeVue or Vuetify. It has more components on day one, but it looks like that library, and a design of our own fights its theme.
- **Tailwind's `dark:` variant** instead of `light-dark()`. Every component would repeat each colour twice, and the contrast test couldn't read the pairs from one place.
- **The gallery in development only** (`import.meta.env.DEV`): the browser tests run a production build, so they couldn't visit it.
