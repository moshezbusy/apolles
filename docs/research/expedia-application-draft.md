# טיוטה: בקשת שותפות ל-Expedia Rapid API

הבקשה עצמה באנגלית. מה שב-**[סוגריים]** הוא מידע שרק אתה יודע, ואין להגיש לפני שהוא ממולא. לא המצאתי מספרים: התחזית מבוססת על היעדים שכתבת בתוכנית שלך מ-11.3.2026, וצריך שתאשר אותה.

---

## Company overview

**[Legal company name]**, registered in Israel (**[company / business registration number]**), operating **Apolles**, a B2B hotel booking platform for travel agents. Website: **[domain]**. Contact: **[name, role, email, phone]**.

**[Optional: one or two sentences on your existing travel business and years of experience in the Israeli travel market.]**

## What we are building

Apolles gives independent travel agents and small agencies in Israel one modern tool to search, book and manage hotel stays for their clients. Agents search, compare rooms with full cancellation terms, book in a few steps, and issue a hotel voucher under their own agency brand.

- **Model:** B2B. The traveler deals only with their travel agent; travelers never book on Apolles directly.
- **Users:** vetted travel agencies only, approved manually before they get access.
- **Point of sale:** Israel. Agent interface in English; prices in USD.
- **Payments:** agencies prepay into an Apolles account balance. Apolles pays its supplier. Apolles does not handle traveler card data.
- **Supplier strategy:** Expedia Rapid is planned as our **sole** lodging supplier at launch.

## Integration plan

- Rapid Lodging API (Content, Shopping, Price Check, Booking, Manage Booking), built in-house.
- We have reviewed the **B2B standalone launch requirements** and are designing every page to meet them from day one: no Expedia names or logos, a "Supplier Terms & Conditions" link, bed-type and check-in/special instructions on room, booking and voucher pages, a full cancellation policy, fees payable at the property in local and request currency, a unique `affiliate_reference_id` per booking, and the traveler country code, names and phone on every booking.
- Full request/response logging for the site review.
- Security: TLS everywhere, agency data isolation, two-factor authentication for admins, audit logs, no card data on our servers.

## Projected volume

| Period after launch | Active agencies | Bookings per month | Average booking value (USD) |
|---|---|---|---|
| Months 1–3 | 5–10 (your plan) | **[ ]** | **[ ]** |
| Months 4–6 | 20+ (your plan) | **[ ]** | **[ ]** |
| Year 1 total | **[ ]** | **[ ]** | **[ ]** |

## What we would like from Expedia

1. A billing model where Apolles is invoiced or has a credit line (Expedia Affiliate Collect or similar), with no per-booking card payments.
2. Test credentials for the Rapid Lodging API.
3. The current B2B launch-requirements checklist and site-review process.
4. Guidance on displaying itinerary IDs in a B2B flow, on sharing selling prices with travelers through private quote links, and on single-room bookings at launch.

---

## הסבר בעברית: מה כתוב ולמה

- **"ספק יחיד"** כתוב בכוונה. זה מראה ל-Expedia שכל ההזמנות שלנו ילכו אליהם.
- **ארנק מראש וחשבונית בלי כרטיס** פותרים את דרישות ה-PCI ומראים שהסיכון הכספי נמוך.
- **"קראנו את דרישות ה-B2B"** מראה רצינות, ומקצר את הבדיקה.
- **התחזית** היא החלק הרגיש. אל תכתוב מספרים גבוהים ממה שאתה מאמין בהם. Expedia תבדוק, ומספרים מנופחים פוגעים באמינות.
