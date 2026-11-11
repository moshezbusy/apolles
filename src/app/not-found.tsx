import Link from "next/link";
import { StatePanel } from "@/components/StatePanel";
import { btnPrimary, btnSecondary } from "@/components/ui";

// 404 (screen 24). Someone not signed in who follows "Go to search" lands on the sign-in page.
export default function NotFound() {
  return (
    <StatePanel
      icon="?"
      tone="neutral"
      title="We couldn't find this page"
      actions={
        <>
          <Link href="/search" className={btnPrimary}>
            Go to search
          </Link>
          <Link href="/bookings" className={btnSecondary}>
            My bookings
          </Link>
        </>
      }
    >
      The link may be old or mistyped. Your bookings are safe.
    </StatePanel>
  );
}
