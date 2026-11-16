### spec: analytics ingest and webhook delivery schemas

- New `./analytics`: `analyticsIngestRequestSchema`, `analyticsIngestResponseSchema`, `analyticsIngestErrorSchema` and `trackedEventSchema`, with the limits of the ingest route (50 events, 64-character names, 20 props, id pattern `^[A-Za-z0-9_.:-]{1,64}$`).
- New `./webhooks`: `webhookBodySchema`, `webhookHeadersSchema`, `webhookOutboxMessageSchema` and `webhookDeliverySchema`.
- New generated files under `schemas/` and `/spec/v1/`: `analytics-ingest-request.schema.json`, `analytics-ingest-response.schema.json`, `tracked-event.schema.json` and `webhook-delivery.schema.json`. Existing files are unchanged.
