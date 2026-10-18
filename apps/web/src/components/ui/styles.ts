// Classes the components share (#85), so every control looks and behaves the same.

/** A text-like control: text field, number field, select and combobox. 44px tall to tap. */
export const control = [
  "block w-full min-h-11 rounded-md border border-line-strong bg-surface px-3",
  "text-base text-fg placeholder:text-fg-muted",
  "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-muted",
  "data-disabled:cursor-not-allowed data-disabled:bg-surface-muted data-disabled:text-fg-muted",
  // An error shows in the border too, thicker, so it's not told by colour alone (WCAG 1.4.1).
  "aria-invalid:border-2 aria-invalid:border-danger",
].join(" ");

/** An option in a select's or a combobox's list: highlighted in the primary colour. */
export const option = [
  "relative flex min-h-11 cursor-default select-none items-center gap-2 rounded-sm py-2 ps-8 pe-3",
  "text-fg outline-none",
  "data-highlighted:bg-primary data-highlighted:text-on-primary",
  "data-disabled:pointer-events-none data-disabled:text-fg-muted",
].join(" ");

/** The floating list of a select or combobox. */
export const popover =
  "z-50 overflow-hidden rounded-md border border-line bg-surface p-1 text-fg shadow-md";
