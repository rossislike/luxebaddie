import { describe, expect, it } from "vitest";
import { safeReturnPath } from "@/auth/return-path";

describe("safeReturnPath", () => {
  it.each(["/", "/orders", "/order?id=LB-7K3M9Q2XAB", "/catalog/product?id=body-wave-lace-front-wig"])(
    "returns to %s, a page of the back office",
    (path) => {
      expect(safeReturnPath(path)).toBe(path);
    },
  );

  it.each([
    ["another site", "https://evil.example/orders"],
    ["a protocol-relative address", "//evil.example/orders"],
    ["a backslash trick browsers read as another site", "/\\evil.example"],
    ["a script address", "javascript:alert(1)"],
    ["a relative path", "orders"],
    ["nothing", undefined],
    ["something that is not text", { path: "/orders" }],
  ])("goes home instead of to %s", (_what, candidate) => {
    expect(safeReturnPath(candidate)).toBe("/");
  });
});
