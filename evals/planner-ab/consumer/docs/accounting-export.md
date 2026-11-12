# Accounting export format

The accountants import one file a night. It is UTF-8 text, one header line and one line per
balance movement, fields separated by `;`.

```text
type;date;card;order;amount_cents;currency;balance_cents
```

| Field | Meaning |
| --- | --- |
| `type` | The line type, below. The import refuses a file with a type it does not know. |
| `date` | The day of the movement, `YYYY-MM-DD`, UTC. |
| `card` | The card code. |
| `order` | The order the movement belongs to, empty when there is none. |
| `amount_cents` | The movement, signed: positive loads the card, negative takes from it. |
| `currency` | The card's currency. |
| `balance_cents` | The card's balance after the movement. |

## Line types

| Type | Movement | Sign |
| --- | --- | --- |
| `GC-ISSUE` | A card is bought and loaded. | positive |
| `GC-REDEEM` | A card pays (part of) an order. | negative |
| `GC-ADJUST` | Support corrects a balance. The note stays in the shop. | either |

A new line type is agreed with the accountants first and added to this table before the code
writes it. Its row names the movement and its sign.
