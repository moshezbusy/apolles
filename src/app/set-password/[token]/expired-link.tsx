import Link from "next/link";

// Shown for any link that cannot be used (unknown, used, expired). Same text for every case.
export function ExpiredLink() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-gray-900">This link has expired</h1>
      <p className="text-sm text-gray-600">
        Links work for 60 minutes and can be used once.
      </p>
      <Link
        href="/forgot-password"
        className="self-start rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800"
      >
        Send a new link
      </Link>
    </div>
  );
}
