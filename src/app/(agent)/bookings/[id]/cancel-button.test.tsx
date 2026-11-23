import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const status = { pending: false };
vi.mock("react-dom", async (original) => ({ ...(await original<typeof import("react-dom")>()), useFormStatus: () => status }));

describe("CancelButton", () => {
  it("says what it does, and while the cancellation is being sent it is disabled and says so", async () => {
    const { CancelButton } = await import("./cancel-button");
    const idle = renderToStaticMarkup(<CancelButton />);
    expect(idle).toContain(">Cancel this booking<");
    expect(idle).not.toContain('disabled=""');
    status.pending = true;
    const sending = renderToStaticMarkup(<CancelButton />);
    expect(sending).toContain(">Cancelling…<");
    expect(sending).toContain('disabled=""');
    expect(sending).toContain('type="submit"');
  });
});
