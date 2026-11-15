import { describe, expect, it } from "vitest";
import { searchPage, searchTarget } from "@/orders/search";

describe("searchTarget", () => {
  it.each(["LB-7K3M9Q2XAB", "lb-7k3m9q2xab", "LB7K3M9Q2XAB", "  LB-7K3M9Q2XAB  "])("reads %j as an order number", (typed) => {
    expect(searchTarget(typed)).toEqual({ kind: "order", orderId: "LB-7K3M9Q2XAB" });
  });

  it("reads anything with an @ as a customer's email, as typed", () => {
    expect(searchTarget(" Bea@Example.com ")).toEqual({ kind: "customer", email: "Bea@Example.com" });
  });

  it.each(["", "   ", "LB-123", "bea", "bea smith@example.com", "7K3M9Q2XAB"])("does not guess at %j", (typed) => {
    expect(searchTarget(typed)).toBeNull();
  });
});

describe("searchPage", () => {
  it("opens the order's page for an order number", () => {
    expect(searchPage({ kind: "order", orderId: "LB-7K3M9Q2XAB" })).toBe("/order?id=LB-7K3M9Q2XAB");
  });

  it("opens the customer's orders for an email, safely encoded", () => {
    expect(searchPage({ kind: "customer", email: "bea+shop@example.com" })).toBe("/customer?email=bea%2Bshop%40example.com");
  });
});
