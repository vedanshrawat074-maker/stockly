# Stockly backend API

## Authentication and store access

The backend uses Argon2id password hashes and MongoDB-backed, 24-hour rolling
sessions. Session IDs are HttpOnly cookies (`stockly.sid`); the session
contains the authenticated user and currently selected store. Accounts and
active store memberships are reloaded from MongoDB for protected requests.
Every existing store-scoped API derives its store from that verified session
and checks active membership. A supplied `X-Store-Id` never overrides an
authenticated session.

The old `X-Store-Id` mechanism remains only for unauthenticated local
development requests when `NODE_ENV=development`. It is not authentication,
is unavailable in production, and the authenticated frontend does not send it.

Authentication routes:

- `POST /api/auth/register` accepts `{ "name", "email", "password" }`, creates
  an account, starts a session, and returns
  `{ "data": { "user": { "id", "name", "email" }, "csrfToken" } }` with
  status `201`.
- `POST /api/auth/login` accepts `{ "email", "password" }` and returns the
  same envelope with status `200`. Invalid credentials use the same generic
  `401 INVALID_CREDENTIALS` response regardless of account existence.
- `GET /api/auth/me` returns the public user and the session's CSRF token.
- `POST /api/auth/logout` destroys the authenticated session and returns
  `204`.

Registration and login require an allowed `Origin`; both are rate limited.
Successful registration/login rotates the session ID. State-changing
cookie-authenticated requests require an allowed `Origin` and the
session-bound `X-CSRF-Token` returned by registration, login, or `/me`.

Store routes require authentication:

- `POST /api/stores` accepts `{ "name", "address", "timezone", "currency" }`,
  creates the store and OWNER membership atomically, selects it, and returns
  `201 { "data": { "id", "name", "address", "timezone", "currency", "role" } }`.
- `GET /api/stores` lists only the user's active memberships.
- `GET /api/stores/current` returns the selected authorized store or
  `{ "data": null }`.
- `POST /api/stores/current` accepts `{ "storeId" }`; membership is verified
  before the selection is changed.

API errors use `{ "error": { "code", "message", "details" } }` (details are
omitted when absent). Email verification, password recovery, and staff
invitations are not implemented. Membership queries accept only active OWNER
or STAFF roles. Because there are no store-administration or staff-management
endpoints yet, both active roles currently have the same access to existing
business APIs.

Set `SESSION_SECRET` to a locally generated secret of at least 32 characters.
Local development typically uses `SESSION_COOKIE_SECURE=false` and
`SESSION_COOKIE_SAME_SITE=lax`. Production configuration requires secure
cookies, explicit HTTPS `CORS_ORIGIN` values, and a session store backed by
MongoDB; use `SESSION_COOKIE_SAME_SITE=none` only when the deployment is
cross-site and HTTPS is enabled. Keep the secret server-side. The current
authentication rate limiter uses an in-memory counter, so multi-instance
deployments must configure a shared rate-limit store before relying on limits
across instances.

Existing ownerless development stores and their data are not assigned to an
account automatically. Keep them unchanged unless an administrator deliberately
reviews and performs the documented local owner-adoption procedure in the
root README. Production deployments must provision the required unique indexes
for users and memberships before accepting traffic and must review cookie
domain, HTTPS proxy, CORS, backup, monitoring, and rate-limit configuration.
Passing tests is not a production security certification.

### Explicit demo-data seeder

The optional demo seeder adds four clearly named fictional grocery products,
one tagged batch per product, and three completed sales through the existing
validated product, batch-receipt, and idempotent sale services. It does not
delete or overwrite business data. Demo SKUs, batch numbers, and sale
idempotency keys are deterministic per store. Existing tagged records are
reused only when their immutable seed fields match; conflicting records stop
the operation. New demo sales refuse to run if they could consume a
non-demo batch belonging to a seeded product.

Run it from the `backend/` directory in an interactive terminal after
configuring the backend `.env` for `NODE_ENV=development` and the local
`stockly` database:

```powershell
npm run seed:demo -- --store-id <STORE_OBJECT_ID> --owner-email <OWNER_EMAIL>
```

The command refuses production/test modes, remote MongoDB hosts, databases
other than `stockly`, missing/invalid store IDs, inactive accounts, bad
passwords, and users without active OWNER membership in the exact target store.
It prompts for the account password without echoing it and then requires typing
the exact target store ID before any seeding writes. Never put the password on
the command line or in an environment variable. The seeder was not run as part
of implementation; integration tests use only the dedicated local
`stockly_test` database.

An ownerless store is not eligible. First use the documented explicit
development-store owner-adoption procedure to give an existing account OWNER
membership; the seeder will not adopt a store or create memberships.

## Product and inventory routes

- `POST /api/products`
- `GET /api/products?page=1&limit=20`
- `GET /api/products/:productId`
- `PATCH /api/products/:productId`
- `DELETE /api/products/:productId`
- `GET /api/inventory?page=1&limit=20`
- `GET /api/inventory/:productId`
- `POST /api/inventory/:productId/batches`
- `GET /api/inventory/:productId/batches?page=1&limit=20`
- `POST /api/sales`
- `GET /api/sales?page=1&limit=20`
- `GET /api/alerts?page=1&limit=20&type=LOW_STOCK&status=ACTIVE`
- `POST /api/alerts/run-check`
- `PATCH /api/alerts/:alertId/acknowledge`
- `PATCH /api/alerts/:alertId/resolve`
- `GET /api/demand/history?startDate=2026-01-01&endDate=2026-01-31&productId=<id>`

Prices and quantities are submitted as decimal strings. Batch receiving creates
the batch and its stock movement in a MongoDB transaction; MongoDB must run as
a replica set or on a transaction-capable cluster. On-hand quantity is derived
from the sum of batch remaining quantities and is never accepted from a client.

Sales require an `Idempotency-Key` header and contain distinct product IDs with
positive decimal-string quantities. Unit prices are copied from each active
product at sale time. Batch allocation uses FEFO, excludes expired stock, and
uses batches without expiry after dated unexpired batches. Batch deductions,
sale records, and one negative stock movement per allocation are written in one
transaction. Reusing an idempotency key for different sale contents is rejected.

Only completed sales are currently supported. There is no cancellation or
return endpoint, no refund processing, and no stock restoration. Future
cancellation and return operations must use a separate idempotent transaction
that records compensating stock movements against the original batch
allocations; they must never edit or erase the original sale movements.

The sale unit concurrency tests use mocked, serialized transactions and
conditional batch updates. The dedicated integration suite below separately
exercises concurrent sales against the configured local replica set.

## Alerts

Alert reads, state changes, and checks use the authenticated current store
(or the unauthenticated development-only `X-Store-Id` fallback). The check endpoint accepts only an optional
`expiryWarningDays` value; clients cannot submit alert records. It must be
invoked for one validated store at a time. No scheduler is configured.

Low-stock alerts compare a positive configured inventory threshold against
Decimal128 batch totals after excluding batches whose UTC calendar expiry date
is before the current date in the store's IANA timezone. A batch expiring on
the store-local current date remains usable through that date. Expiry is treated
as a date-only value: the `YYYY-MM-DD` represented by the stored UTC date is
compared with the store-local calendar date. Missing expiry and zero-remaining
batches do not produce expiry alerts. The warning-window end date is inclusive.
Threshold equality counts as low stock; a zero threshold disables low-stock
alerts. Existing active alerts refresh, stale alerts resolve, and resolved
conditions reactivate the same stable-key record. Acknowledged alerts remain
acknowledged while the condition persists.

Low-stock severity is `CRITICAL` at zero usable stock, `HIGH` below the
positive threshold, and `MEDIUM` at equality. Expiry severity is `CRITICAL`
when expiry is today or tomorrow, `HIGH` within three days, and `MEDIUM`
otherwise within the configured warning window.

Alert checks run in a store-scoped transaction. The unique `(store,
deduplicationKey)` index and atomic upsert prevent duplicate condition records;
the same record is reactivated after resolution. MongoDB must support
transactions.

### Sale movement reference migration

New sale stock movements store an optional `sale` ObjectId reference and keep
their existing `reason`. Historical movements are not rewritten automatically.
For a controlled backfill, first take a database backup and review candidates
per store: match only movements with `movementType: "sale"` and an exact
`reason` of `Sale <saleIdentifier>` to exactly one Sale with the same store and
identifier. Confirm the movement's product and batch allocation also match
that Sale. Update `sale` only for manually verified one-to-one matches. Leave
missing, duplicate, or otherwise ambiguous matches unchanged for manual review.

The new `(store, sale)` index can be created with the normal Mongoose index
migration/deployment procedure; adding the optional field is backward
compatible with existing movement documents.

## Demand history data contract

`GET /api/demand/history` requires inclusive ISO calendar-date parameters
`startDate` and `endDate`. It optionally accepts a store-owned `productId`,
`page`, and `limit`. The maximum date range is 366 days and `limit` is capped at
100. Without a product ID, the endpoint paginates through the store's products,
including inactive products, and returns a dense daily series for each product.

The aggregation source is completed `Sale` documents: `lineItems[].product`,
`lineItems[].quantity`, and the Sale `createdAt` timestamp. UTC calendar-day
boundaries are used consistently, so a sale exactly at midnight UTC belongs to
that UTC day. Quantities remain decimal strings representing Decimal128 sums.
The response includes store/product IDs, current product unit/name/SKU/status,
the period and boundary convention, and daily `unitsSold` values. Dates with no
matching sales are emitted as `"0"`.

The response's `availability` is `null`: current batches cannot prove historical
availability because opening balances, closed-shop periods, stockout windows,
and product unavailability intervals are not captured as a complete historical
series. Consequently, a zero-sales day is not evidence that the store was open
or the product was available. This endpoint is a historical-data contract for
future forecasting, not a forecast and not a source of synthetic training
labels. Store context is derived from the authenticated session for signed-in
users; the development header is only a compatibility fallback for local
unauthenticated requests.

## Demand forecasts

`POST /api/forecasts` accepts a store-owned `productId`, inclusive UTC
`startDate` and `endDate`, and optional `horizonDays` (default 7) and
`rollingWindowDays`. The backend obtains history from
the demand-history service and sends only the forecasting contract fields to
the separately deployable Python service. A client cannot supply or override
the store ID; the selected session store is membership-checked on every request.

Configure `ML_SERVICE_URL` and `ML_SERVICE_TIMEOUT_MS` in the backend
environment. Defaults target `http://127.0.0.1:8000` and a 5000 ms timeout.
The ML service exposes `GET /health`, `POST /forecast`, and `POST /evaluate`.
The forecast uses a rolling mean over the recent `rollingWindowDays` (default
7) of recorded daily sales. `MINIMUM_HISTORY_DAYS` configures the service's
minimum history (default 14 calendar days); clients cannot lower this threshold.
Insufficient history returns an explicit
status and no predicted points. An all-zero history returns zero estimates
only after meeting the minimum-history requirement. Fractional quantities are
preserved as decimal strings.

Example request:

```json
{
  "productId": "64b000000000000000000002",
  "startDate": "2026-01-01",
  "endDate": "2026-01-30",
  "horizonDays": 7
}
```

Successful responses contain `data.status`, `data.method`, the minimum and
observed history lengths, and forecast points with `date`, `predictedUnits`,
and `previousWeekUnits`. The previous-week value is a comparator, not a
second trained model. The evaluation endpoint uses rolling-origin chronological
splits and reports MAE and WAPE; WAPE is `null` when the selected actuals sum
to zero. These metrics describe only evaluated historical windows and do not
prove accuracy on future demand or superiority over another model. There is no
trained machine-learning model in this phase.

Example response:

```json
{
  "data": {
    "storeId": "64b000000000000000000001",
    "productId": "64b000000000000000000002",
    "unit": "kg",
    "status": "ok",
    "method": "rolling_average_7d",
    "horizonDays": 7,
    "minimumHistoryDays": 14,
    "observedHistoryDays": 30,
    "historyThrough": "2026-01-30",
    "forecasts": [
      {
        "date": "2026-01-31",
        "predictedUnits": "0.5",
        "previousWeekUnits": "0.4"
      },
      {
        "date": "2026-02-01",
        "predictedUnits": "0.5",
        "previousWeekUnits": "0.6"
      },
      {
        "date": "2026-02-02",
        "predictedUnits": "0.5",
        "previousWeekUnits": "0.4"
      },
      {
        "date": "2026-02-03",
        "predictedUnits": "0.5",
        "previousWeekUnits": "0.3"
      },
      {
        "date": "2026-02-04",
        "predictedUnits": "0.5",
        "previousWeekUnits": "0.2"
      },
      {
        "date": "2026-02-05",
        "predictedUnits": "0.5",
        "previousWeekUnits": "0.1"
      },
      {
        "date": "2026-02-06",
        "predictedUnits": "0.5",
        "previousWeekUnits": "0.7"
      }
    ],
    "comparison": "Previous-week values are same-weekday observations where available.",
    "limitations": ["Historical availability is unknown."]
  }
}
```

Missing recorded sales dates are filled as zero for the baseline. Historical
availability is unknown, so the service cannot distinguish a closed shop,
stockout, or unavailable product from zero customer demand. Forecast results
should be treated as an experimental baseline, not a reliable restocking
recommendation.

## Smart restocking recommendations

`GET /api/restocking/recommendations` returns paginated recommendations for
active products in the authenticated current store (or the unauthenticated
development-only header context). Optionally filter by
`productId`; `page` defaults to 1 and `limit` to 20 (maximum 20). Store IDs
are never accepted as query authorization.

Configuration:

- `RESTOCKING_PLANNING_HORIZON_DAYS` defaults to `7`.
- `RESTOCKING_SAFETY_BUFFER_DAYS` defaults to `2`.
- Their sum must not exceed the forecasting service's 30-day horizon.

The backend requests a forecast for the planning horizon plus the buffer days.
The exact formula, in product base units, is:

```text
planningDemand = sum(forecast[0 .. planningHorizonDays-1])
safetyBuffer = sum(forecast[planningHorizonDays .. planningHorizonDays+safetyBufferDays-1])
targetStock = planningDemand + safetyBuffer
suggestedQuantity = max(0, targetStock - usableStock)
```

The two forecast slices are disjoint, so the buffer is included exactly once.
Forecast baseline averages are emitted with a bounded 32-significant-digit
decimal context; this leaves enough Decimal128 precision to sum the maximum
30-day horizon without binary floating-point or whole-unit rounding. All sums
and differences use decimal-safe arithmetic. `usableStock` is the sum
of batch remaining quantities whose date-only expiry is not before the current
store-local date; batches without an expiry remain eligible. Inventory totals
and minimum stock thresholds are not used to calculate usable stock.

Responses have `NO_RESTOCK_NEEDED` or `RESTOCK_RECOMMENDED` statuses when a
forecast is available. If there is not enough history, the response uses
`INSUFFICIENT_HISTORY`; if the forecasting service cannot provide a valid
forecast, it uses `FORECAST_UNAVAILABLE`. In either case forecast demand,
buffer, and suggested quantity are `null`. A configured inventory minimum
threshold is included only as a separate `lowStockFallback` signal in these
fallback states; it never becomes a fabricated quantity recommendation.

The backend requests the most recent 30 complete UTC calendar days, limited
by the product's creation date. New products with fewer days than the
forecasting service's minimum history are cold starts and do not receive a
forecast-based quantity. Missing sale records are treated by the forecasting
baseline as zero sales, not as evidence the store was open or the product was
available. Recommendations are read-only: they do not alter batches,
inventory, or stock movements, and they do not create purchase orders.

Example request:

```http
GET /api/restocking/recommendations?page=1&limit=20
Cookie: stockly.sid=<session-cookie>
```

Example response:

```json
{
  "data": [
    {
      "productId": "64b000000000000000000002",
      "productName": "Rice",
      "unit": "kg",
      "status": "RESTOCK_RECOMMENDED",
      "currentUsableStock": "0.25",
      "forecastStatus": "ok",
      "forecastDemand": "0.7",
      "safetyBuffer": "0.2",
      "suggestedRestockQuantity": "0.65",
      "lowStockFallback": null,
      "reason": "7-day forecast demand is 0.7 kg; 2-day safety buffer is 0.2 kg. Target stock is 0.9 kg; usable stock is 0.25 kg; suggested quantity is max(0, target - usable stock) = 0.65 kg."
    }
  ],
  "pagination": { "page": 1, "limit": 20, "totalItems": 1, "totalPages": 1 }
}
```

Install the ML service dependencies with:

```powershell
python -m pip install -r requirements.txt
python -m pip install -r requirements-dev.txt
python -m pytest -q tests
```

Run these commands from `ml-service`.

## MongoDB integration tests

The ordinary `npm test` command runs unit tests and does not connect to MongoDB.
Run live replica-set integration tests separately:

```powershell
npm run test:integration
```

Set `MONGODB_TEST_URI` to a local, single-node `rs0` URI whose database is
exactly `stockly_test`. If it is not set, the runner accepts `MONGODB_URI` only
when its database is `stockly` or `stockly_test`, then derives a URI targeting
`stockly_test`. Before any cleanup it verifies the selected database and
replica-set deployment; it refuses remote hosts, other replica sets, mongos,
and any target other than the dedicated test database. The suite drops only
`stockly_test` and closes its Mongoose connection after completion.

The integration concurrency scenario uses actual MongoDB transactions and
writes. MongoDB retryable transaction errors are accepted only as failed
requests; persisted sales, batch quantities, and sale movements are still
checked for oversell and reconciliation.
