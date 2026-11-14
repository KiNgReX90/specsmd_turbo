# Acme Shop

Acme Shop sells digital gift cards. A customer picks an amount, pays, and the card arrives by
email with a code. The recipient redeems the code at checkout, on its own or together with a
card payment.

The service is plain Node with no dependencies. State lives in JSON files under `data/`, which
the store creates on first write. `npm test` runs every test.
