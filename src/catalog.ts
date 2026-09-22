import { z } from "zod";
import records from "../data/providers.json";

const httpsUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Expected a credential-free HTTPS URL");

export const offerSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name: z.string().min(1),
    signupUrl: httpsUrl,
    sources: z.array(httpsUrl).min(1).readonly(),
    checkedAt: z.iso.date(),
    kind: z.enum(["quota", "credit", "paid", "unknown"]).default("unknown"),
    amount: z.number().finite().nonnegative().nullable().default(null),
    currency: z.enum(["USD", "CNY", "EUR"]).nullable().default(null),
    period: z.enum(["once", "day", "month"]).nullable().default(null),
    commercial: z.enum(["allowed", "restricted", "unknown"]).default("unknown"),
    card: z.enum(["yes", "no", "unknown"]).default("unknown"),
    deposit: z.enum(["yes", "no", "unknown"]).default("unknown"),
    conditionsVerified: z.boolean().default(false),
    expiresInDays: z.number().int().positive().nullable().default(null),
    validUntil: z.iso.date().nullable().default(null),
    quota: z.string().nullable().default(null),
    modelIds: z.array(z.string().min(1)).default([]).readonly(),
    termsUrl: httpsUrl.nullable().default(null),
    adapter: z.boolean().default(false),
    note: z.string().min(1),
  })
  .strict()
  .readonly();

export type Offer = z.infer<typeof offerSchema>;

const catalogSchema = z
  .array(offerSchema)
  .superRefine((offers, ctx) => {
    const seen = new Set<string>();
    for (const offer of offers) {
      if (seen.has(offer.id)) {
        ctx.addIssue({ code: "custom", message: `Duplicate provider: ${offer.id}` });
      }
      seen.add(offer.id);
    }
  })
  .readonly();

export function parseCatalog(input: unknown) {
  return catalogSchema.parse(input);
}
export function loadCatalog() {
  return parseCatalog(
    records.providers.map((record) => ({
      ...record,
      checkedAt: records.checkedAt,
    })),
  );
}
export function estimate(input: unknown, now: Date) {
  const offers = parseCatalog(input);
  let oneTimeUsd = 0;
  let monthlyUsd = 0;
  let conditionalUsd = 0;
  let advertisedOneTimeUsd = 0;
  let advertisedMonthlyUsd = 0;
  const excluded: { id: string; reason: string }[] = [];
  const quotas: { id: string; quota: string; conditions: string }[] = [];
  for (const offer of offers) {
    const age = now.getTime() - Date.parse(offer.checkedAt);
    const current =
      age >= 0 &&
      age <= 30 * 86_400_000 &&
      (offer.validUntil === null || Date.parse(offer.validUntil) + 86_400_000 > now.getTime());
    if (offer.quota !== null) {
      quotas.push({ id: offer.id, quota: offer.quota, conditions: offer.note });
    }
    if (!current || offer.kind !== "credit" || offer.amount === null || offer.currency !== "USD") {
      excluded.push({
        id: offer.id,
        reason: "No current quantified USD credit; quota is separate.",
      });
      continue;
    }
    if (offer.period === "once") advertisedOneTimeUsd += offer.amount;
    if (offer.period === "month") advertisedMonthlyUsd += offer.amount;
    if (!offer.conditionsVerified || offer.commercial !== "allowed" || offer.deposit !== "no") {
      excluded.push({
        id: offer.id,
        reason: "Eligibility, commercial terms or no-deposit condition unverified.",
      });
      continue;
    }
    if (offer.card !== "no") {
      if (offer.period === "once") conditionalUsd += offer.amount;
      excluded.push({
        id: offer.id,
        reason: "Payment-method checkpoint; not unconditional credit.",
      });
      continue;
    }
    if (offer.period === "once") oneTimeUsd += offer.amount;
    if (offer.period === "month") monthlyUsd += offer.amount;
  }
  return {
    oneTimeUsd,
    monthlyUsd,
    conditionalUsd,
    advertisedOneTimeUsd,
    advertisedMonthlyUsd,
    maximumUsd: null,
    reason:
      "There is no universal maximum: eligibility, expiry, model prices and recurring quotas vary.",
    quotas,
    excluded,
  };
}
