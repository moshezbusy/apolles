# טיוטה: בקשת שותפות שנייה ל-Expedia Rapid API (דרך ה-LLC האמריקאי)

הבקשה עצמה באנגלית. מה שב-**[סוגריים]** הוא מידע שרק אתה יודע, ואין להגיש לפני שהוא ממולא. לא המצאתי שום פרט.
ההבדל מהבקשה הישראלית: הישות החוזית היא ה-LLC, האתר הוא cayotrip.com, והבקשה **מציינת בגלוי** שיש בקשה קודמת מהעסק הישראלי (הסבר בסוף).

---

## Company overview

**[LLC legal name]**, a limited liability company registered in **[State]**, USA (**[registration / file number]**). Website: **cayotrip.com**. Contact: **[name, role, email, phone]**.

The company is owned and operated by **[your name]**, who also runs **[Israeli business name]**, an Israeli travel business with **[years]** years in the market. In 2025 that business handled about USD 605K in net hotel revenue across 585 bookings. **[Confirm these numbers before sending.]**

**Previous application:** On **[date]** we submitted a Rapid API application through our Israeli entity, **[Israeli business name]**. We are applying through the US LLC because **[reason, for example: we prefer a US contracting entity with USD billing]**. Please treat the two applications as one partnership request, and contract with whichever entity suits Expedia best.

## What we are building

A B2B hotel booking platform for independent travel agents and small agencies. Agents search, compare rooms with full cancellation terms, book in a few steps, and issue a hotel voucher under their own agency brand.

- **Model:** B2B. The traveler deals only with their travel agent; travelers never book on the platform directly.
- **Users:** vetted travel agencies only, approved manually before they get access.
- **Point of sale:** **[Israel / USA / both: must match reality]**. Agent interface in English; prices in USD.
- **Payments:** agencies prepay into an account balance. We pay our supplier. We do not handle traveler card data.
- **Supplier strategy:** Expedia Rapid is planned as our **sole** lodging supplier at launch.

## Integration plan

- Rapid Lodging API (Content, Shopping, Price Check, Booking, Manage Booking), built in-house. The platform is already in development: admin, agency onboarding, prepaid wallet ledger and two-factor admin sign-in run on our staging environment.
- We have reviewed the **B2B standalone launch requirements** and are designing every page to meet them from day one: no Expedia names or logos, a "Supplier Terms & Conditions" link, bed-type and check-in/special instructions on room, booking and voucher pages, a full cancellation policy, fees payable at the property in local and request currency, a unique `affiliate_reference_id` per booking, and the traveler country code, names and phone on every booking.
- Full request/response logging for the site review.
- Security: TLS everywhere, agency data isolation, two-factor authentication for admins, audit logs, no card data on our servers.

## Projected volume

| Period after launch | Active agencies | Bookings per month | Average booking value (USD) |
|---|---|---|---|
| Months 1–3 | 5–10 | **[ ]** | **[ ]** |
| Months 4–6 | 20+ | **[ ]** | **[ ]** |
| Year 1 total | **[ ]** | **[ ]** | **[ ]** |

Use the same numbers as in the Israeli application. Two applications with different forecasts look bad.

## What we would like from Expedia

1. A billing model where we are invoiced or have a credit line (Expedia Affiliate Collect or similar), with no per-booking card payments.
2. Test credentials for the Rapid Lodging API.
3. The current B2B launch-requirements checklist and site-review process.
4. Guidance on displaying itinerary IDs in a B2B flow and on single-room bookings at launch.

---

## הסבר בעברית: למה כתוב ככה

- **הגילוי על הבקשה הישראלית הוא בכוונה.** אותו בעלים, אותו מוצר ואותה תחזית: Expedia עלולה לקשר בין הבקשות. בקשה כפולה שלא סופר עליה עלולה להיראות כמו ניסיון לעקוף דחייה, ולפגוע בשתי הבקשות. כשהיא גלויה, יש לה הסבר ענייני (ישות אמריקאית, חיוב בדולרים). **לא מצאתי מדיניות רשמית של Expedia על בקשות כפולות. זו הערכה שלי, לא עובדה.**
- **Point of sale חייב להיות אמת.** אם הסוכנויות בישראל, כותבים ישראל, גם כשהחברה אמריקאית.
- **cayotrip.com:** Expedia בודקת את האתר. אם יש בו היום משהו אחר, או שהוא ריק, כדאי שיופיע בו לפחות עמוד שמתאר את המוצר.
- **ה-staging** מוזכר כי הוא קיים ועובד. זה מראה רצינות.
