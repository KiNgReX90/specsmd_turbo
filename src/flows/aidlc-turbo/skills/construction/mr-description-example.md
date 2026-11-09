# Worked example: an MR description before and after

The worked example of `mr-description.md`, next to this file. It shows the same merge request of the invented Acme Shop, !121, described two ways: the earlier reviewer-narrative template, and the template of Dex Horthy's PR skill that replaces it. The merge request adds a fourth state, Frozen, to gift cards. A Turbo merge request follows the same shape, with the story or the brief as its source.

## Before (reviewer-narrative template, 1,295 words)

Not repeated in full. Its shape:

- **Link to the world** with the story, intent and epic keys plus two doc paths.
- **Why**: one long paragraph.
- **What changed (conceptually)**: seven bullets, one per file or layer, with
  class names, constraint names and commit SHAs.
- **Where to focus**: five reviewer questions.
- **Testing notes**, **Out of scope / follow-up**.
- Then three blocks appended by later pushes: **Processed review findings**,
  **Rounds 2 and 3** (again per class, with SHAs) and **Open points**, each
  with its own test results.

It never mentioned that 88 of the 117 changed files were a deleted folder.

## After (Summary, Evidence, Merge danger, 409 words)

**Link to the world:** [SHOP-489](https://example.atlassian.net/browse/SHOP-489)

## Summary

Gift cards that the fraud check stopped get a fourth state, **Frozen**: they
keep their balance, but nothing can be paid with them until support releases
them.

```diff
 public enum GiftCardState {
     Active, Spent, Expired,
+    Frozen
 }
```

| Where | What Frozen does there |
|---|---|
| Database | `gift_card_state_check` allows Frozen. A one-off conversion sets the cards the fraud check flagged to Frozen. |
| New card from the fraud queue | gets Frozen, was Active |
| Public API v1 and v2 | v2 returns `frozen`, v1 keeps returning `active`: contract unchanged |
| Checkout | a Frozen card is refused as a payment |
| Refund to a gift card | never lands on a Frozen card, the refund goes to manual handling |
| Account page | a notice, no top-up button |
| CSV import | accepts Frozen |

Also in this MR: the old `legacy-vouchers` folder is gone (88 files), nothing
called it.

## Evidence

*Screenshot of the notice on the account page: to add.*

The test that failed before and passes now:

```
given  a Frozen gift card with a balance of 25.00
when   checkout pays an order with it
then   the payment is refused, the order stays unpaid
       (old code: paid from the balance)
```

| Test | Old behavior | Now |
|---|---|---|
| `GiftCardPaymentTest` | 2 of 11 red | 11 green |
| `CheckoutGiftCardPageTest` | 2 of 4 red | 4 green |
| `RefundToGiftCardTest` | 1 of 1 red | 1 green |

Conversion on a staging snapshot: 351 gift cards to Frozen. A second run
changes 0 rows.
Full suite on top of story 007: 266 database tests and 432 unit tests, 0 failures.

## Merge danger

**Code: two-way door.** A revert undoes it.
**Conversion: one-way door.** It overwrites the state of 351 gift cards and
keeps no copy of the old one. Only a backup brings it back.

Blast radius: **broad**.

- API v1 clients still see `active` for a Frozen card.
- Paying with a Frozen card is refused. Top-ups still pass; that side follows
  in story 006.
- Refunds to Frozen cards fall to manual handling.
- The conversion queues 351 "gift card changed" mails. On staging no mail went
  out.
- The conversion reads from the `fraud` schema and fails without those grants.
- `LoyaltyPointsProcessor`, `GiftCardLine.resolveState` and `InvoiceDao`
  don't treat Frozen separately yet.

*(The update flow appends the `<!-- turbo-mr-desc synced:… -->` state marker
to live descriptions; it is omitted from this example.)*

## What left the description, and where it lives

- The **Why** paragraph: its first sentence opens the Summary, the rest is in
  the Jira item.
- Per-file and per-class explanation: the diff.
- Review rounds with commit SHAs: the commits and the MR discussion.
- The five reviewer questions: the MR discussion; this template has no
  section for them.
- Open points for the product owner: Jira.

## Why the rewrite is better

1. **A reviewer reads it in a minute**: 409 words instead of 1,295.
2. **The one thing that cannot be undone is on top of the risk**: the
   conversion of 351 gift cards. The old description never said so.
3. **One test proves the change**: a failing-then-passing test instead of
   three rounds of results.
4. **Nothing in the diff goes unnamed**: the 88 deleted files get one line.
