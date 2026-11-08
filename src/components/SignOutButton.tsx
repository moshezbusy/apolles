// "Sign out": a plain POST form to /logout, which ends this browser's session in the database
// and clears the cookie (CSRF-checked there). No client JavaScript needed. A form cannot sit
// inside another form, so place it next to other forms, not in them.
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form method="post" action="/logout">
      <button type="submit" className={className ?? "text-sm text-blue-700 hover:underline"}>
        Sign out
      </button>
    </form>
  );
}
