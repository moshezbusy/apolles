// The client page's words in English (mockup 16) and Hebrew (mockup 17). Hotel and room names
// stay as the supplier gives them. Dates are the hotel's calendar days (YYYY-MM-DD), shown in UTC.

export type Lang = "EN" | "HE";

const T = {
  EN: {
    proposal: "Your travel proposal",
    advisor: "Travel advisor",
    whatsapp: "WhatsApp",
    call: "Call",
    choose: "Choose your hotels",
    chooseHelp: "Choose one hotel and room in each destination. To skip a destination, leave it unselected. Tap a selected room again to unselect it.",
    selectedOf: (n: number, total: number) => `${n} of ${total} selected`,
    tapRoom: "Tap a room to select it",
    noSelection: "No selection",
    bookedStay: "Booked",
    selected: "Selected",
    from: "From",
    nightTotal: (n: number) => `${n}-night total`,
    showRooms: "Show rooms",
    hideRooms: "Hide rooms",
    agencyPick: "Our recommendation",
    freeUntil: (d: string) => `Free cancellation until ${d}`,
    nonRefundable: "Non-refundable",
    paidAtHotel: (amount: string) => `Hotel taxes and fees ${amount}, paid at the hotel`,
    note: "Prices and availability can change until the reservation is confirmed. Hotel taxes are paid directly at the hotel. Your selection tells your travel advisor which options you prefer and does not create a booking or charge your card.",
    noteLabel: "Anything to tell your advisor? (optional)",
    notePlaceholder: "For example: we prefer a high floor, or a room with a sea view",
    barTitle: "Choose the options you prefer",
    nothingYet: "Nothing has been selected yet.",
    total: "Selected total",
    send: "Send my selections",
    update: "Update my selections",
    sending: "Sending…",
    sent: "Your selections were sent to your travel advisor.",
    lastSent: "Your last selection was sent to your advisor",
    failed: "Something went wrong. Try again, or message your advisor.",
    limited: "Too many tries. Try again later, or message your advisor.",
    lockedTitle: "Your advisor is handling the booking",
    lockedText: "Your travel advisor is booking the hotels you chose. For any change, contact your advisor directly.",
    emptyTitle: "Your proposal is almost ready",
    emptyText: "Your advisor is still preparing the hotel options. Check again soon.",
    footer: (code: string, agency: string) => `Proposal ${code} · Prepared by ${agency}`,
    footerHelp: "Questions? Message your advisor on WhatsApp or call.",
    goneTitle: "This proposal link is not available",
    goneText: "The link may be incomplete, or the proposal was removed. Ask your travel advisor for a new link.",
    adults: (n: number) => (n === 1 ? "1 adult" : `${n} adults`),
    children: (n: number) => (n === 1 ? "1 child" : `${n} children`),
    destinations: (n: number) => (n === 1 ? "1 destination" : `${n} destinations`),
    nights: (n: number) => (n === 1 ? "1 night" : `${n} nights`),
    to: "to",
  },
  HE: {
    proposal: "הצעת הנסיעה שלך",
    advisor: "יועץ נסיעות",
    whatsapp: "וואטסאפ",
    call: "שיחה",
    choose: "בחרו את המלונות",
    chooseHelp: "בחרו מלון וחדר אחד בכל יעד. אם לא רוצים לבחור ביעד מסוים, משאירים אותו בלי בחירה. לחיצה נוספת על חדר שנבחר מבטלת את הבחירה.",
    selectedOf: (n: number, total: number) => `נבחרו ${n} מתוך ${total}`,
    tapRoom: "לחצו על חדר כדי לבחור אותו",
    noSelection: "לא נבחר",
    bookedStay: "הוזמן",
    selected: "נבחר",
    from: "החל מ-",
    nightTotal: (n: number) => (n === 1 ? "סה״כ ללילה אחד" : `סה״כ ל-${n} לילות`),
    showRooms: "הצגת חדרים",
    hideRooms: "הסתרת חדרים",
    agencyPick: "ההמלצה שלנו",
    freeUntil: (d: string) => `ביטול חינם עד ${d}`,
    nonRefundable: "ללא החזר",
    paidAtHotel: (amount: string) => `מסי מלון ${amount}, משולמים במלון`,
    note: "המחירים והזמינות יכולים להשתנות עד שההזמנה מאושרת. מסי המלון משולמים ישירות במלון. הבחירה שלכם מראה ליועץ אילו אפשרויות אתם מעדיפים. היא לא יוצרת הזמנה ולא מחייבת כרטיס אשראי.",
    noteLabel: "רוצים לכתוב משהו ליועץ? (לא חובה)",
    notePlaceholder: "לדוגמה: מעדיפים קומה גבוהה, או חדר עם נוף לים",
    barTitle: "בחרו את האפשרויות שאתם מעדיפים",
    nothingYet: "עדיין לא נבחר כלום.",
    total: "סה״כ לבחירות",
    send: "שלחו את הבחירות",
    update: "עדכנו את הבחירות",
    sending: "שולח…",
    sent: "הבחירות נשלחו ליועץ הנסיעות שלכם.",
    lastSent: "הבחירה האחרונה שלכם נשלחה ליועץ",
    failed: "משהו השתבש. נסו שוב, או כתבו ליועץ.",
    limited: "יותר מדי ניסיונות. נסו שוב מאוחר יותר, או כתבו ליועץ.",
    lockedTitle: "היועץ שלכם מטפל בהזמנה",
    lockedText: "יועץ הנסיעות מזמין את המלונות שבחרתם. לכל שינוי, פנו ישירות ליועץ.",
    emptyTitle: "ההצעה שלכם כמעט מוכנה",
    emptyText: "היועץ עדיין מכין את אפשרויות המלונות. בדקו שוב בקרוב.",
    footer: (code: string, agency: string) => `הצעה ${code} · הוכנה על ידי ${agency}`,
    footerHelp: "שאלות? כתבו ליועץ בוואטסאפ או התקשרו.",
    goneTitle: "הקישור להצעה לא זמין",
    goneText: "ייתכן שהקישור לא שלם, או שההצעה הוסרה. פנו ליועץ הנסיעות לקבלת קישור חדש.",
    adults: (n: number) => (n === 1 ? "מבוגר אחד" : `${n} מבוגרים`),
    children: (n: number) => (n === 1 ? "ילד אחד" : `${n} ילדים`),
    destinations: (n: number) => (n === 1 ? "יעד אחד" : `${n} יעדים`),
    nights: (n: number) => (n === 1 ? "לילה אחד" : `${n} לילות`),
    to: "עד",
  },
} as const;

export type Texts = (typeof T)[Lang];

export function texts(lang: Lang): Texts {
  return T[lang];
}

export function day(iso: string, lang: Lang, withYear = false): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const options: Intl.DateTimeFormatOptions =
    lang === "HE" ? { day: "numeric", month: "long", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" };
  if (withYear) options.year = "numeric";
  return new Intl.DateTimeFormat(lang === "HE" ? "he-IL" : "en-US", options).format(date);
}

export function nightsBetween(checkin: string, checkout: string): number {
  return Math.round((Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / 86_400_000);
}
