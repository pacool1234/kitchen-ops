# 0027. The catalogue's screens: one place in the navigation, forms checked by the shared schemas, lists kept in the URL

- Status: Accepted
- Date: 2026-10-19

## Context

M5's catalogue (#89) is the app's first set of screens that people fill in: storerooms and suppliers first, then products and supplier products. Spec 11.4 asks for them in Spanish, with validation messages, on desktop and phone, and spec section 6 says counter staff read the catalogue while office and owner change it. Later milestones add documents, counts, stock and reports, and every one of them will have lists and forms like these.

## Decision

**One "Catálogo" item in the navigation,** with links to its sections: products, suppliers and storerooms.
- The phone's bottom bar keeps room for M6 to M9.
- Routes: `/catalogue/<section>`, `/catalogue/<section>/new` and `/catalogue/<section>/:id`. Breadcrumbs follow them: Inicio › Catálogo › Proveedores › Frutas El Huerto.
- An item's page titles itself with the item's name (`usePageTitle`).

**What a role sees comes from the contract:** `mayCall(endpoint, role)` in `packages/shared` follows the same rule the API's auth hook enforces.
- **Counter staff** get the lists, and each item's details to read. There's no "Nuevo" button and no form: greyed-out fields are harder to read than plain text.
- **Office and owner** get the forms.
- A page a role can't use (a new item's form) sends it to the page's parent.

**Forms are checked by the same Zod schemas as the API** (`useForm`, `apps/web/src/catalogue/form.ts`).
- `fieldErrors` in `packages/shared` turns Zod's issues into field codes, for both, so a form says what the API would.
- A field's error shows once it has been left, or after a try to save, never while it's first typed. A supplier's tax ID shows its error as soon as it's long enough to be whole, and its kind ("CIF válido") once it's valid.
- What only the API can know, such as a tax ID another supplier has, comes back as a 400 or 409 with field codes, and shows on the same field.
- Each code has a message in each language (`errors.fields`), and a field may word one its own way ("Ya hay un proveedor con este NIF/CIF").
- After a refused save, the first field with an error takes focus, so a screen reader reads it.

**Unsaved changes are warned about:** a dialog before leaving a changed form inside the app, and the browser's own warning on closing or reloading the tab. "Changed" means different from what was loaded, not merely touched.

**Lists keep their search, filters and page in the URL** (`useCatalogueList`), so the back button and a refresh keep them.
- The API searches and pages. The browser holds 20 rows, however big the catalogue.
- Typing searches once it pauses for 250 ms.
- A late answer to an older search never replaces a newer one.

**On phones, lists are cards.** `UiDataTable` takes a `card` slot and shows it below 768 px instead of the table. Only one layout shows at a time, so a screen reader meets one. An empty list or an error shows once.

**After saving,** a new item's page opens and an edited item stays, each with a notice. **Deactivating asks first;** reactivating doesn't, since it hides nothing.

## Alternatives considered

- **A navigation item for each section:** three items for the catalogue alone would fill a phone's bottom bar before M6.
- **The same form for counter staff, disabled:** disabled fields are low-contrast by design and are skipped by the keyboard. Details to read are clearer.
- **Checking in the browser with rules of its own:** the browser and the API would drift. The shared schemas can't.
- **The list's state in the component only:** the back button from an item would lose the search, and a list couldn't be linked to.
- **Searching in the browser over the whole list:** fine for 40 suppliers, but not for about 400 products, and the API already searches ignoring accents (decision 0026).
