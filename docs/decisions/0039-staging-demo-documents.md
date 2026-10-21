# 0039. Staging's demo documents: three from the gold set, ready for review, each row added only if it isn't there

- Status: Accepted
- Date: 2026-10-21
- Updated: 2026-10-21, by #120: a fourth document, the invoice for the first (below). Seeded the same way.

## Context

#119's last "done when": staging's demo gets a few documents to try reviewing and posting with (decision 0028). Staging seeds its demo on every start, filling each table only while it's empty. Its tables already have rows, so documents, or the suppliers and products they need, added to the seed that way would never reach it.

Uploading the documents on staging by hand would read them for real, at about a cent each, but would leave nothing in the repo for the next database. The committed gold set (`eval/gold/`) has synthetic documents whose drafts a person has checked.

## Decision

**Three gold-set delivery notes, seeded ready for review** (`apps/api/src/db/seed-documents.ts`), chosen to try what M7 delivers:

| Folder | What it is | Its supplier |
| --- | --- | --- |
| `syn-017-picture-from-004` | A photo of a priced delivery note, 5 lines | Seeded, with 2 lines mapped |
| `syn-014-picture-from-001` | A photo of one without prices, 5 lines | Not seeded: to create in review |
| `syn-012-delivery-note-no-prices` | A PDF without prices, 16 lines, one with nothing delivered | Seeded, with 2 lines mapped |

The PDFs of the two photos (syn-004, syn-001) are left out: the duplicate check would flag them.

**And, since #120, the invoice for the first** (decision 0041):

| Folder | What it is | Its supplier |
| --- | --- | --- |
| `syn-021-invoice-for-004` | A PDF invoice listing syn-004's delivery note: its 5 lines, 2 at new prices | Seeded: the first's |

Until that delivery note is posted, its supplier has posted none, so the invoice's lines start as received with it, as an invoice-only supplier's are. Once it's posted, each line is suggested its delivery-note line, and posting the invoice corrects two prices.

**Each is what reading it would give,** with no model called:
- its draft is the folder's `expected.json`, validated with the shared schema;
- it's checked as a read document is (`checked`, `extraction/read.ts`): its supplier by tax ID, the checks, the duplicate check;
- its file is stored as an upload stores one, before its rows are written;
- it's uploaded by `office@example.test`, a login both seeds create.

It has no reading cost and no product suggestions, which come from a model.

**The catalogue the documents need comes with them:** the two suppliers, the 16 products their lines need that the seed's catalogue doesn't have, and 4 supplier products. Every line can then be mapped and posted.

**Each row is added only if it isn't there, by its natural key:** a supplier by its tax ID, a product by its name (ignoring case), a supplier product by its supplier and code, a document by its fixed ID. A row that's there is never changed, so a product of the same name created on staging is kept as it is. This refines decision 0028 for these rows only; the rest of the seed still fills a table only while it's empty.

**Skipped, with a log line, never refused:**
- a document whose file is in the database already (its hash is unique): uploaded by hand, say;
- the documents, when there's no storage (CI's seed step) or no office login.

Refusing would stop staging's API from starting, as the seed runs in its start command.

**Everywhere the seed runs with storage:** staging, local development and the browser tests' database, which is the same fictional restaurant (decision 0028). Production is never seeded. Like the rest of the seed, the demo writes no audit entries: a demo document's audit log starts at its first correction.

## Alternatives considered

- **Uploading the files on staging by hand, read for real:** no code, but about a cent each, and nothing for a fresh database.
- **Fixed rows only when their tables are empty, as in 0028:** they'd never reach staging.
- **Refusing to start when a demo file is uploaded already:** a staging that won't start over a demo document.
- **The two photos only:** no PDF on staging's storage to try, and 11 fewer products. A PDF is also the case still to check on Scaleway (a PDF shown in the page).
- **Staging only:** local development and the browser tests would go without the documents, and the seed's real path, with storage, wouldn't run in CI.
