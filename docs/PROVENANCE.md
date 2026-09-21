# Provider provenance

The machine-readable source of truth is `data/providers.json`. Each record includes
the signup URL, one or more HTTPS source URLs, the observation date, offer class,
conditions and an explicit note when a claim remains unknown.

The catalogue deliberately keeps paid, expired, non-commercial, card-required and
unverified entries visible. They are not included in the guaranteed USD estimate and
they cannot become an eligible gateway route without explicit local confirmation.

OmniRoute's MIT-licensed catalog was inspected for:

- shared-pool deduplication instead of adding every model's quota;
- separate buckets for recurring, one-time, gated and uncapped access;
- a terms-risk verdict rather than treating every advertised free endpoint as usable.

No OmniRoute source was copied into this repository. Freebuff's public landing page was
also inspected. Its 100 daily Freebucks are one shared allowance, and its public site
does not establish a general OpenAI-compatible API contract or commercial-use permission.
Its internal endpoints are therefore not used.

## Evidence captured locally

- `.omo/evidence/everyone-gateway/research/aside-contract.md`
- `.omo/evidence/everyone-gateway/research/remote-contract.md`
- `.omo/evidence/everyone-gateway/research/aggregators.md`
- `.omo/evidence/everyone-gateway/research/cloud.md`
- `.omo/evidence/everyone-gateway/research/inference.md`
- `.omo/evidence/everyone-gateway/remote-probe.mjs`
