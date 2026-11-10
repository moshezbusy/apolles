# החלטה: שדות לא מוכרים בתשובות של Expedia לא מפילים את הקריאה

**תאריך:** 10.11.2026
**אושר על ידי:** משה, בצ'אט ("מאשר").
**סטטוס:** חריגה מכלל ב-CLAUDE.md, סעיף 2: "Validate all input with Zod at the boundary … Reject unknown fields". קבצי ההגנה נעולים, ולכן רק משה יכול להוסיף את החריגה ל-CLAUDE.md עצמו. עד אז, המסמך הזה הוא המקור.

## הכלל לתשובות של ספקים (Expedia)
- כל שדה שהמערכת משתמשת בו נבדק ב-Zod בקפדנות: טיפוס, ערכים מותרים וסכומים.
  - שדה חסר או לא תקין גורם לשגיאה מוגדרת (`SupplierResponseInvalid`). אף פעם לא נוצרת הצעה עם מחיר חלקי.
- שדות ש-Expedia מוסיפה ואנחנו לא מכירים:
  - **מוסרים** מהתשובה (`strip`), ולא דוחים בגללם את כל הקריאה.
  - **השמות** שלהם (לא הערכים) נרשמים ביומן הקריאות, כדי שנדע עליהם.
- **הסיבה:** Expedia מוסיפה שדות לתשובות מדי פעם. אם היינו דוחים אותם, ביום שהם מוסיפים שדה החיפוש היה נעצר בלי אזהרה.

## מה לא משתנה
טפסים, server actions ו-webhooks (כולל ההודעות שמגיעות מ-Expedia ב-push) ממשיכים **לדחות** שדות לא מוכרים, כמו שכתוב ב-CLAUDE.md.

## נוסח מוצע ל-CLAUDE.md (משה מוסיף)
> Supplier responses are the one exception: fields we use are validated strictly; unknown fields are stripped and their names recorded in the supplier log (owner decision 2026-11-10, `docs/decisions/2026-11-10-supplier-unknown-fields.md`).
