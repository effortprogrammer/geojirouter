import { describe, expect, test } from "bun:test";
import { estimate, parseCatalog } from "../src/catalog";

const now = new Date("2026-09-21T00:00:00Z");
const offer = {
  id: "example",
  name: "Example",
  signupUrl: "https://example.com/signup",
  sources: ["https://example.com/pricing"],
  checkedAt: "2026-09-21",
  kind: "credit",
  amount: 7,
  currency: "USD",
  period: "once",
  commercial: "allowed",
  card: "no",
  deposit: "no",
  conditionsVerified: true,
  note: "A test offer, not a real provider.",
};

describe("catalog boundary and valuation", () => {
  test("rejects a non-HTTPS signup URL", () => {
    // Given a catalog-controlled browser destination.
    const input = [{ ...offer, signupUrl: "javascript:alert(1)" }];
    // When parsed, then reject before any browser action.
    expect(() => parseCatalog(input)).toThrow();
  });

  test("rejects duplicate providers rather than multiplying the value", () => {
    // Given two identical accounts of the same provider.
    const input = [offer, offer];
    // When parsed, then there is no double-counting.
    expect(() => parseCatalog(input)).toThrow();
  });

  test("rejects negative credit amounts", () => {
    // Given malformed external data.
    const input = [{ ...offer, amount: -2 }];
    // When parsed, then it cannot enter the ledger.
    expect(() => parseCatalog(input)).toThrow();
  });

  test("separates monthly value from one-time credit", () => {
    // Given independent credit periods.
    const input = [offer, { ...offer, id: "monthly", amount: 0.1, period: "month" }];
    // When estimated, then the periods remain separate.
    expect(estimate(input, now)).toMatchObject({ oneTimeUsd: 7, monthlyUsd: 0.1 });
  });

  test("does not treat conditional credit as guaranteed", () => {
    // Given a payment-method-required trial.
    const input = [{ ...offer, card: "yes", amount: 5 }];
    // When estimated, then only the conditional bucket grows.
    expect(estimate(input, now)).toMatchObject({ oneTimeUsd: 0, conditionalUsd: 5 });
  });

  test("excludes stale, noncommercial, unknown and foreign-currency credits", () => {
    // Given offers that cannot support today's commercial USD claim.
    const input = [
      { ...offer, id: "stale", checkedAt: "2025-01-01" },
      { ...offer, id: "restricted", commercial: "restricted" },
      { ...offer, id: "unknown", conditionsVerified: false },
      { ...offer, id: "cny", currency: "CNY" },
    ];
    // When estimated, then none are counted as guaranteed USD.
    expect(estimate(input, now)).toMatchObject({ oneTimeUsd: 0, monthlyUsd: 0 });
  });
});
