import { describe, expect, it } from "vitest";
import { LONGEST_SIDE, storedSize } from "@/catalog/photo-upload";

describe("the size a photo is stored at", () => {
  it("shrinks a phone camera's photo to fit, keeping its proportions", () => {
    expect(storedSize({ width: 4000, height: 3000 })).toEqual({ width: LONGEST_SIDE, height: 1500 });
    expect(storedSize({ width: 3024, height: 4032 })).toEqual({ width: 1500, height: LONGEST_SIDE });
  });

  it("leaves a photo that already fits exactly as it is", () => {
    expect(storedSize({ width: 1200, height: 1500 })).toEqual({ width: 1200, height: 1500 });
    expect(storedSize({ width: LONGEST_SIDE, height: LONGEST_SIDE })).toEqual({ width: LONGEST_SIDE, height: LONGEST_SIDE });
  });

  it("never enlarges a small photo", () => {
    expect(storedSize({ width: 300, height: 200 })).toEqual({ width: 300, height: 200 });
  });
});
