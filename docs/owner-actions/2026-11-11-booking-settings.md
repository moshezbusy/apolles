# Owner action: booking settings (needed before real bookings, not for the demo)

Agents cannot open `.env.example` or the server's settings file. So the settings below are
listed here, and the owner adds them on the staging server, and later in production. They are
business details, not secrets. Until they are set, the pages say "not set yet" instead of
showing made-up values. Real bookings with Expedia refuse to start without the billing contact.

| Setting | What it is | Where it shows |
|---|---|---|
| `EXPEDIA_BILLING_GIVEN_NAME` | Billing contact first name at Taya Tourism (TR3) | Sent to Expedia with every booking |
| `EXPEDIA_BILLING_FAMILY_NAME` | Billing contact family name | Sent to Expedia |
| `EXPEDIA_BILLING_ADDRESS_LINE1` | Taya Tourism street address | Sent to Expedia |
| `EXPEDIA_BILLING_CITY` | City | Sent to Expedia |
| `EXPEDIA_BILLING_POSTAL_CODE` | Postal code (optional for Israel) | Sent to Expedia |
| `APOLLES_SUPPORT_EMAIL` | Support email for agents (ER2) | Review & book, booking summary |
| `APOLLES_SUPPORT_PHONE` | Support phone (optional) | Same |
| `SUPPLIER_TERMS_URL` | The "Supplier Terms & Conditions" https link that Expedia gives us (GR2) | The terms box on review & book |

Also needed from the owner:

- **The text of the Apolles terms and conditions for agents** (GR3), for the `/terms` page.
  Today that page says the terms will be published before bookings open.
- **Confirmation from Expedia's partner manager** about the payment type. The code books with
  `affiliate_collect`: Apolles pays Expedia by invoice, with no card (spec section 2, decision 3).
