import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/money";

describe("formatMoney", () => {
  it("drops the cents from whole-dollar amounts", () => {
    expect(formatMoney(18_900)).toBe("$189");
    expect(formatMoney(123_400)).toBe("$1,234");
  });

  it("shows cents when there are any", () => {
    expect(formatMoney(795)).toBe("$7.95");
  });
});
