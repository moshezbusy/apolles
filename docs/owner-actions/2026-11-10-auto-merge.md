# הגדרה חד-פעמית: מיזוג אוטומטי ועדכון staging אוטומטי

**מה יקרה אחרי ההגדרה:** Claude פותח PR. GitHub מריץ את הבדיקות. כשכולן ירוקות, ה-PR מתמזג לבד, ותוך 5 דקות staging מתעדכן לבד.

**מה לא משתנה:**
- העלאה לייצור (כסף אמיתי) נשארת בלחיצה שלך.
- Claude עדיין לא ממזג בעצמו ולא כותב ישירות ל-main.

**הסיכון:** אף אדם לא רואה קוד לפני שהוא עולה ל-staging. ההגנה היא הבדיקות האוטומטיות והסקירות ש-Claude מריץ לפני כל PR. ב-staging יש רק נתוני דמו, ולכן זה סביר שם.

ההגדרה כוללת 4 צעדים ב-GitHub וצעד אחד בשרת. **הסדר חשוב:** צעד 3 (ההגנה על main) חייב לבוא לפני שמסתמכים על המיזוג האוטומטי. בלעדיו, אין לו על מה לחכות.

---

## צעד 1: להוסיף את קובץ המיזוג האוטומטי
1. ב-GitHub: הריפו apolles ← **Add file** ← **Create new file**.
2. בשם הקובץ כתוב בדיוק: `.github/workflows/auto-merge.yml`
3. הדבק את כל התוכן הזה:

```yaml
# Agent PRs (branches named claude/...) merge by themselves once every required check is
# green. Owner decision in chat, 2026-11-10. Needs: "Allow auto-merge" in the repo settings,
# and a rule on main that requires the guardrails checks (without it there is nothing to
# wait for, and GitHub refuses to turn auto-merge on).
name: auto-merge

on:
  pull_request:
    types: [opened, reopened, synchronize, ready_for_review]

permissions:
  contents: write
  pull-requests: write

jobs:
  enable:
    name: Enable auto-merge
    if: >-
      startsWith(github.head_ref, 'claude/') &&
      github.event.pull_request.head.repo.full_name == github.repository &&
      !github.event.pull_request.draft
    runs-on: ubuntu-latest
    steps:
      - name: Merge when the required checks pass
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GH_REPO: ${{ github.repository }}
          PR_URL: ${{ github.event.pull_request.html_url }}
        run: gh pr merge --auto --merge "$PR_URL"
```

4. למטה: **Commit directly to the main branch** ← **Commit changes**.

## צעד 2: לאפשר מיזוג אוטומטי
**Settings** ← **General** ← גלול ל-**Pull Requests** ← סמן ✅ **Allow auto-merge**.

## צעד 3: להגן על main (חובה)
1. **Settings** ← **Rules** ← **Rulesets** ← **New ruleset** ← **New branch ruleset**.
2. **Ruleset name:** `main`. **Enforcement status:** Active.
3. **Target branches** ← **Add target** ← **Include default branch**.
4. סמן ✅ **Require status checks to pass**. לחץ **Add checks** והוסף את שלוש הבדיקות:
   - `Secret scan (gitleaks)`
   - `Typecheck / lint / test / build / audit`
   - `Static analysis (semgrep)`
5. סמן ✅ **Block force pushes**.
6. **אל תסמן** "Require a pull request before merging" עם אישורים (approvals). אחרת המיזוג האוטומטי יחכה לאישור שלך לנצח.
7. **Create**.

## צעד 4: לעדכן את הכללים של Claude (CLAUDE.md)
הכללים אומרים היום שמיזוג הוא פעולה שלך בלבד. אם לא תעדכן אותם, הם יסתרו את מה שהגדרת. Claude לא יכול לערוך את הקובץ הזה (זו הגנה), ולכן אתה עורך אותו:

1. ב-GitHub פתח את `CLAUDE.md` ← סמל העיפרון (Edit).
2. **בסעיף 0**, החלף את השורה:
   > `- **Merging and deploying to production are the owner's actions.** Agents open PRs only.`

   בשורה:
   > `- **Agent PRs merge automatically; production deploy is the owner's action.** A PR from a claude/ branch merges into main by itself once every CI check is green (.github/workflows/auto-merge.yml, owner decision 2026-11-10), and staging follows main within 5 minutes. Agents never merge by hand and never push to main.`
3. **בסעיף 1, שלב 7**, החלף את:
   > `7. **Ship via PR only.** Feature branch → PR → CI green → owner merges. Never push to `main`.`

   ב:
   > `7. **Ship via PR only.** Feature branch → PR → CI green → auto-merge. Never push to `main`. Nobody reviews after the PR is opened, so steps 5 and 6 (verify, review) must be done before it.`
4. **Commit changes** ← **Commit directly to the main branch**.

## צעד 5: בשרת (staging), פעם אחת
תבקש מ-Claude שבמחשב שלך, זה שהתקין את staging:
> "תתקין את העדכון האוטומטי של staging לפי סעיף 5 ב-deploy/staging/README.md"

---

## איך יודעים שזה עובד
- ב-PR הבא של Claude תופיע ההודעה "Auto-merge enabled". אחרי שהבדיקות יהיו ירוקות, ה-PR יהיה **Merged** בלי שתיגע בו.
- תוך 5 דקות, staging.apolles.com מציג את הגרסה החדשה.

## איך מבטלים
- **מיזוג אוטומטי:** מוחקים את הקובץ `.github/workflows/auto-merge.yml`, או מבטלים את הסימון ב-Allow auto-merge.
- **עדכון staging:** בשרת, `crontab -e`, ומוחקים את השורה של auto-update.
