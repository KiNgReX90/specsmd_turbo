# 0003: A refund goes back to the card that paid

Status: accepted.

A refund never creates a new gift card or store credit. The card payment share goes back to the
payment card through the provider, and a gift card share goes back onto the gift card it came
from. The gift card half is not built yet: `refundOrder` refuses an order with a gift card share
with `GIFT_CARD_SHARE` until it is.

When only some lines of an order are refunded, each payment gets back its share of those lines
in proportion to what it paid of the order, the remainder cent to the larger payment
(`share` in `src/money.js`).
