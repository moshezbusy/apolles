import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DateField } from "./DateField";
import { DateRangeField } from "./DateRangeField";

describe("DateField (plan 9)", () => {
  const html = renderToStaticMarkup(<DateField name="receivedOn" label="Received on" defaultValue="2026-12-03" min="2026-01-01" max="2026-12-31" />);

  it("sends the ISO date in a hidden input and shows it as DD/MM/YYYY", () => {
    expect(html).toContain('<input type="hidden" name="receivedOn" value="2026-12-03"/>');
    expect(html).toContain("03/12/2026");
  });

  it("the whole field is one button that opens the calendar, named by its label", () => {
    expect(html).toMatch(/<label[^>]*>[\s\S]*Received on[\s\S]*<button type="button"[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"/);
  });

  it("shows DD/MM/YYYY as a hint while empty", () => {
    const empty = renderToStaticMarkup(<DateField name="d" label="Date" />);
    expect(empty).toContain('<input type="hidden" name="d" value=""/>');
    expect(empty).toContain("DD/MM/YYYY");
  });

  it("ignores a value that is not a date", () => {
    expect(renderToStaticMarkup(<DateField name="d" label="Date" defaultValue="tomorrow" />)).toContain('name="d" value=""');
  });
});

describe("DateRangeField (plan 9)", () => {
  const html = renderToStaticMarkup(<DateRangeField checkin="2026-12-03" checkout="2026-12-06" min="2026-11-19" max="2027-11-19" />);

  it("sends check-in and check-out as ISO dates and shows them as DD/MM/YYYY", () => {
    expect(html).toContain('<input type="hidden" name="checkin" value="2026-12-03"/>');
    expect(html).toContain('<input type="hidden" name="checkout" value="2026-12-06"/>');
    expect(html).toContain("03/12/2026");
    expect(html).toContain("06/12/2026");
  });

  it("labels the two fields and shows the number of nights", () => {
    expect(html).toContain("Check-in");
    expect(html).toContain("Check-out");
    expect(html).toContain("3 nights");
    expect(renderToStaticMarkup(<DateRangeField checkin="2026-12-03" checkout="2026-12-04" min="" max="" />)).toContain("1 night");
  });

  it("drops a check-out that is not after check-in", () => {
    const bad = renderToStaticMarkup(<DateRangeField checkin="2026-12-06" checkout="2026-12-03" min="" max="" />);
    expect(bad).toContain('name="checkout" value=""');
  });
});
