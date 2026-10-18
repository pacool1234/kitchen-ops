# 0019. The eval counts a blank discount and 0% as the same

- Status: Accepted
- Date: 2026-10-18

## Context

The eval compares each value read from a document with its gold answer (`packages/extract/src/eval/normalize.ts`). Its rule: ignore only differences that don't change what the document says. A blank in the gold answer (`null`, "not printed") only ever equalled a blank.

In #63 and #68, GPT-6 Luna read the blank discount column on a line of one photo (syn-015) as "0", in every run. Each time that counted as a wrong field, so the document was a silent error unless something else sent it to review.

A blank discount and 0% post the same thing. Validation passes a blank discount on as no discount, and the ledger's `lineTotal` treats a missing discount as "0" (`packages/ledger/src/money.ts`). The line total, the received unit cost and every stock figure come out the same. The spec gives the reason silent errors matter most: "a silent error corrupts the stock figures" (section 5). This one corrupts nothing.

## Decision

**For `discountPercent` only, a blank counts as "0".** Then the two values are compared as decimals, as before. So `null`, "0", "0.00" and "-0" are all the same discount, and "5" against a blank is still wrong.

Every other field keeps its exact comparison. A blank quantity, price or VAT rate read as "0" is still wrong: those change what is posted, or would be a guess at a value that matters.

**Results already committed are not rewritten:** they are the record of what each run measured. Re-scored under this rule, they would change in one place:
- **#63's single Luna v2 run:** syn-015 becomes correct, so that run has 1 silent error instead of 2.
- **The six repeat runs in #68:** Luna also misread the unit on that line of syn-015, so the document stays a silent error and their totals don't change.
- **Decision 0018** is unaffected.

## Alternatives considered

- **Keep the comparison strict.** Reading "0" for a blank goes against prompt rule 1 ("never … complete or guess"), and a model that fills one blank might fill others. But the fields where a guess does harm keep their exact comparison, so the guesses that matter are still caught.
- **A prompt v3 that says more firmly that a blank is null,** compared on repeated runs. That would cost runs for something the default model, Gemini 3.8 Flash, already gets right.
