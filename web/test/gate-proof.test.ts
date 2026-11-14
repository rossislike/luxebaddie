import { expect, test } from "vitest";

test("deliberately failing test to prove the merge gate", () => {
  expect(1).toBe(2);
});
