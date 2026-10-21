# 0045. Performance budgets, checked in CI; the stock list valued once per posting

- Status: Accepted
- Date: 2026-10-21

## Context

Spec 11.2 asks for "a performance budget per screen, checked in CI", and lists of hundreds of products that stay instant. Nothing measured speed until now. The first list that needs it is the stock list (#150): every product in every storeroom, valued at its average cost.

Stock and cost come from packages/ledger, replaying a place's movements in order, so a correction counts in the place of the receipt it corrects (decision 0032). A year of the restaurant spec 11.1 designs for is about 400 products and 43 000 movements. Measured locally, reading them all takes about 115 ms and valuing them about 30 ms. The list is searched as it's typed, and staging runs on a smaller machine than a laptop.

## Decision

1. **A budget is a test, against a realistic amount of data, in the suite that runs in CI.** It names its numbers next to the data it was measured with. The stock list's (`apps/api/src/stock/budget.test.ts`) seeds a year: 400 products and 3600 delivery notes of 12 lines.
2. **The stock list's budget:**
   - the first answer after a posting, which reads and values every movement again: within 1000 ms;
   - every answer after it, until something more is posted: within 100 ms, the median of six searches.
   - Locally these take about 180 ms and 5 ms. The margins are for CI's shared machines; a budget that fails now and then teaches people to ignore it.
3. **The valuation is kept in memory until more is posted.** The API keeps the last one with the movements it came from: how many there were, and the last one's `sequence`. Each answer reads those two numbers and values again only if they changed.
   - That's sound because movements are append-only (invariant 3) and numbered under the posting lock, which is held until commit. Movements added later always have a higher `sequence`, so the same count and last number are the same movements.
   - Each API process keeps its own. One that hasn't valued yet does it on its first answer.
4. **Screens get their budgets in the browser tests** (#150's second PR, and the screens after it): the time from opening a page to its rows showing, with the same amount of data.

## Alternatives considered

- **A stock table updated by each posting.** Instant to read, but a second copy of stock and cost that could drift from the movements, kept right by every posting path. Replaying the ledger is fast enough with the cache.
- **Summing in SQL.** On hand is a sum, but the average cost isn't: it's a replay in the ledger's order, and a correction counts where its receipt is. Doing it in SQL would be a second implementation of the ledger.
- **A load-testing tool** (k6, autocannon) in a separate job. More realistic under concurrency, but another tool and job for a restaurant with about 10 users. A test in the suite is enough until it isn't.
- **No cache, with a budget of 1000 ms for every answer.** It would pass, but a search that takes a fifth of a second on each key isn't instant, and on staging it would be slower.
