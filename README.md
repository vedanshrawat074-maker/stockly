# Stockly

Stockly is an inventory and expiry-management application for independent
grocery stores, with sales tracking, alerts, and a demand-forecasting baseline.
This repository contains the application source and local-development
instructions. It does **not** configure a cloud deployment or hosting.

## Architecture

```text
Browser
  └── frontend/     Next.js App Router, React, TypeScript, Tailwind CSS
        ├── calls the backend over HTTP using session cookies + CSRF tokens
        └── does not connect directly to MongoDB or the ML service

backend/             Express + TypeScript API, Mongoose models, MongoDB sessions
  ├── validates requests and enforces account/store authorization
  ├── owns product, inventory, batch, sales, alert, and forecast orchestration
  └── calls the Python service for forecasts

ml-service/          FastAPI demand-forecasting service
                      Rolling-average baseline; not an accuracy-certified model

MongoDB              Local rs0 replica set required for transaction workflows
```

The local application is split across four processes: MongoDB, the Node.js
backend, the Python ML service, and the Next.js frontend.

## Prerequisites (Windows)

Install these tools before continuing:

- **Git for Windows** — [git-scm.com/download/win](https://git-scm.com/download/win)
- **Node.js LTS with npm** — [nodejs.org/en/download](https://nodejs.org/en/download/)
  (Node.js 22 LTS is recommended; the frontend uses Next.js 16.)
- **Python 3.11** — [python.org/downloads/windows](https://www.python.org/downloads/windows/)
  (check “Add Python to PATH”, or use the Python launcher `py`.)
- **MongoDB Community Server** — [mongodb.com/try/download/community](https://www.mongodb.com/try/download/community)
- **MongoDB Shell (`mongosh`)** — [mongodb.com/try/download/shell](https://www.mongodb.com/try/download/shell)

MongoDB Compass is optional. During MongoDB installation, a Windows service
may be installed. The instructions below run a dedicated local `mongod`
process with the replica-set option; do not start a second server on the same
port or data directory. If you already have MongoDB data you need to preserve,
do not point this setup at that data directory.

For the simplest walkthrough, choose not to install MongoDB as a Windows
service in the installer so the terminal command below can own the server
process. If MongoDB was already installed as a service, stop that service
before using the command, or configure the service's MongoDB configuration
file with replica-set name `rs0` and restart it instead. Do not start both
options on the same port.

Open PowerShell and verify the tools are on PATH:

```powershell
git --version
node --version
npm --version
py --version
mongod --version
mongosh --version
```

## Get the source

Replace `<repository-url>` with the clone URL provided by your team:

```powershell
Set-Location $HOME
git clone <repository-url> stockly
Set-Location stockly
```

There is no root npm workspace command. Install and run the frontend and
backend from their own directories as shown below.

## 1. Start MongoDB with the required `rs0` replica set

Use one dedicated PowerShell window for MongoDB and leave it open. This creates
a local data directory and starts MongoDB bound to this computer only:

```powershell
New-Item -ItemType Directory -Force -Path 'C:\data\stockly-mongo'
mongod --replSet rs0 --dbpath 'C:\data\stockly-mongo' --bind_ip 127.0.0.1 --port 27017
```

If this reports that port 27017 is already in use, check whether a MongoDB
Windows service or another local `mongod` is already running. Stop or
reconfigure that server before continuing; do not run two servers against
the same data directory.

Open a second PowerShell window and check whether the replica set is already
initialized:

```powershell
mongosh 'mongodb://127.0.0.1:27017/admin' --eval "rs.status().set"
```

If this prints `rs0`, continue to the next section. If it reports that no
replica-set configuration exists, initialize it **once**:

```powershell
mongosh 'mongodb://127.0.0.1:27017/admin' --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'127.0.0.1:27017'}]})"
```

Wait a few seconds, then verify the set:

```powershell
mongosh 'mongodb://127.0.0.1:27017/admin?replicaSet=rs0' --eval "rs.status().set"
```

The output should be `rs0`. Do not repeatedly run `rs.initiate` on an
initialized replica set. The backend's transaction workflows require this
replica set even though the health route itself does not require the database
to answer.

## 2. Configure and start the backend

Open a third PowerShell window. If it did not open in your home directory,
first run `Set-Location $HOME`, then:

```powershell
Set-Location stockly\backend
Copy-Item .env.example .env
```

Edit the local `backend\.env` file using an editor such as Notepad. For a
default local MongoDB installation with no MongoDB authentication, use these
development values:

```dotenv
NODE_ENV=development
PORT=4000
MONGODB_URI=mongodb://127.0.0.1:27017/stockly?replicaSet=rs0
MONGODB_TEST_URI=mongodb://127.0.0.1:27017/stockly_test?replicaSet=rs0
SESSION_SECRET=<your-private-random-secret-at-least-32-characters>
SESSION_COOKIE_SECURE=false
SESSION_COOKIE_SAME_SITE=lax
ML_SERVICE_URL=http://127.0.0.1:8000
ML_SERVICE_TIMEOUT_MS=5000
RESTOCKING_PLANNING_HORIZON_DAYS=7
RESTOCKING_SAFETY_BUFFER_DAYS=2
CORS_ORIGIN=http://localhost:3000
```

Keep the `MONGODB_TEST_URI` pointed at the separate `stockly_test` database;
automated integration tests are designed to use that dedicated test database,
not the development `stockly` database. Local MongoDB Community Server commonly
has authentication disabled unless you configured it. If you enabled MongoDB
authentication, configure a local URI for your own MongoDB user without
sharing or committing it.

Generate a session secret locally with Node.js:

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Paste that output only into your private `backend\.env`. Do not commit or send
the generated value. The backend requires at least 32 characters.

Install exactly from the backend lockfile and start the API:

```powershell
npm ci
npm run dev
```

Backend scripts, available from `backend\`, include:

```powershell
npm run build
npm start
npm test
npm run test:integration
```

`npm start` runs the compiled server and requires `npm run build` first.
Integration tests require a local MongoDB `rs0` replica set and use
`MONGODB_TEST_URI`.

## 3. Set up and start the Python ML service

Open a fourth PowerShell window. If needed, first run `Set-Location $HOME`,
then:

```powershell
Set-Location stockly\ml-service
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt -r requirements-dev.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

If PowerShell prevents virtual-environment activation, change the policy for
this terminal only, then activate again:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

Keep this window running. `requirements-dev.txt` includes the project test
dependencies. To run the Python tests, use a separate PowerShell window:

```powershell
Set-Location stockly\ml-service
.\.venv\Scripts\Activate.ps1
python -m pytest
```

## 4. Configure and start the frontend

Open a fifth PowerShell window. If needed, first run `Set-Location $HOME`,
then:

```powershell
Set-Location stockly\frontend
Copy-Item .env.example .env.local
```

The checked-in example already sets the local backend URL:

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api
```

Do not add database credentials or session secrets to frontend environment
variables. Use `localhost` consistently for the frontend and configured CORS
origin; using `127.0.0.1` for one browser origin and `localhost` for the other
can cause cookie or CORS issues.

Install and start Next.js:

```powershell
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Useful frontend routes:

- [http://localhost:3000/register](http://localhost:3000/register) — register
- [http://localhost:3000/login](http://localhost:3000/login) — sign in
- [http://localhost:3000/dashboard](http://localhost:3000/dashboard) — overview

## Register and create your first store

1. Open `/register`, create an account, and sign in.
2. On `/onboarding`, enter the store name, address, IANA time zone (for
   example `Asia/Kolkata`), and three-letter currency code (for example `INR`).
3. Continue to the dashboard. The backend creates the store and OWNER
   membership; it verifies the selected store membership on store-scoped
   requests. Store creation is not automatically seeded with products or sales.

The current frontend/API setup uses session cookies and in-memory CSRF tokens.
If the session has expired, sign in again.

## Optional demo data (explicit and owner-only)

Do not run this unless you want fictional products, batches, and completed
sales in the chosen development store. The seeder was designed to run
interactively and safely; it requires `NODE_ENV=development`, a local MongoDB
host, the `stockly` database, a valid target store ID, and the account
password for an active OWNER member. It then asks you to type the exact store
ID before writing.

From `backend\`, run:

```powershell
npm run seed:demo -- --store-id <STORE_OBJECT_ID> --owner-email <OWNER_EMAIL>
```

Retrieve the ID of the intended store from the authenticated
`GET /api/stores/current` response or `GET /api/stores` response. Keep it
private and verify it before confirming. The seeder creates only explicitly
tagged demo records; repeated runs reuse matching demo products/batches and
replay matching sales. It refuses to modify conflicting records and refuses
to let demo sales consume non-demo batches for those products. It does not
delete or reset business records. Do not use the test database.

If you have an older ownerless **Stockly Local Development Store**, it is not
automatically assigned to an account. The separate provisioning/adoption
commands are documented in [backend/README.md](./backend/README.md); adoption
requires an explicit interactive confirmation and is not part of normal
onboarding.

## Health checks and service URLs

With the services running, check:

| Service | URL | Expected result |
|---|---|---|
| Frontend | [http://localhost:3000/login](http://localhost:3000/login) | Stockly login page |
| Backend API | [http://localhost:4000/api/health](http://localhost:4000/api/health) | JSON with `"status":"ok"` and a separate `database` state |
| Python ML service | [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health) | JSON with `"status":"ok"` and service name |

The backend health endpoint reports API and database state separately. The
database may briefly report `connecting`; wait for `connected`. The health
route can still report API status without making the database connection a
prerequisite to serving that health response.

## Troubleshooting

- **`mongod` is not recognized:** install MongoDB Community Server and ensure
  its `bin` directory is on PATH, then open a new PowerShell window. Install
  MongoDB Shell separately if `mongosh` is not recognized.
- **Port 27017 is already in use:** check Windows Services and running
  `mongod` processes. Avoid starting a second instance on the same port or
  sharing its data directory. Configure the instance you intend to use with
  replica set name `rs0`.
- **Replica-set or transaction errors:** verify `rs.status().set` prints
  `rs0`, the set has an elected primary, and `MONGODB_URI` includes
  `?replicaSet=rs0`.
- **Backend exits with invalid environment configuration:** ensure
  `backend\.env` exists, `NODE_ENV=development`, `MONGODB_URI` is a valid local
  MongoDB URI, and `SESSION_SECRET` is at least 32 characters.
- **MongoDB connection refused:** keep `mongod` running, check port 27017, and
  check the database URI. For local setup, use the exact host `127.0.0.1`.
- **Browser reports CORS errors or login cookies do not persist:** use
  `http://localhost:3000` for the frontend and
  `CORS_ORIGIN=http://localhost:3000` in the backend, then restart the
  backend after editing `.env`.
- **Forecast or restocking forecast is unavailable:** confirm the ML service
  is running at port 8000 and that `ML_SERVICE_URL` in the backend is
  `http://127.0.0.1:8000`.
- **`npm ci` fails:** verify Node.js and npm versions, network access to the
  package registry, and that the command is run in `backend\` or `frontend\`
  (each has its own lockfile).
- **Python package installation or activation fails:** verify Python 3.11 is
  installed; recreate the local `.venv` only if it is incomplete. If script
  activation is blocked, use the process-scoped policy command shown above.

## Stop all services

In each of the four service windows (MongoDB, backend, ML service, and
frontend), press **Ctrl+C** and wait for the process to exit. If you started
MongoDB as a Windows service instead of in a terminal, stop it through Windows
Services only if you intend to stop that shared service. The Python virtual
environment can be exited with:

```powershell
deactivate
```

## Existing capabilities and limitations

The frontend includes real-API pages for Overview, Inventory, Sales, Smart
Restocking, Alerts, and Analytics. Demand history is returned as UTC daily
recorded sales with zero-filled missing sale dates; historical store closures
and stockouts are not available. Forecasts use a rolling-average baseline and
are not presented as accuracy-validated predictions.

Sales history is paginated and has no separate sale-detail or filtering
endpoint. Supplier and purchase-order workflows are not implemented. Email
verification and password recovery are not implemented. The repository does
not include cloud hosting or production deployment configuration.

For endpoint contracts, data behavior, authentication caveats, and further
backend detail, see [backend/README.md](./backend/README.md). Python API
documentation is available at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
while the local ML service is running.

## Windows developer handoff checklist

- [ ] Git for Windows, Node.js LTS, Python 3.11, MongoDB Community Server, and
      `mongosh` are installed and on PATH.
- [ ] Repository cloned and the `backend\`, `frontend\`, and `ml-service\`
      folders are present.
- [ ] MongoDB is running locally on `127.0.0.1:27017` with replica set `rs0`
      and an elected primary.
- [ ] `backend\.env` was copied from `.env.example`, points to the local
      `stockly` database and `rs0`, and contains a private 32+-character
      `SESSION_SECRET`.
- [ ] `frontend\.env.local` was copied from `.env.example` and points to
      `http://localhost:4000/api`.
- [ ] Backend and frontend dependencies were installed with `npm ci` in each
      package directory.
- [ ] Python `.venv` was created and both requirements files were installed.
- [ ] MongoDB, backend, ML service, and frontend are running in separate
      PowerShell windows.
- [ ] Backend and ML health URLs return successful JSON; frontend login page
      opens at `http://localhost:3000/login`.
- [ ] Account registered and first store created via onboarding.
- [ ] Optional demo seeder is run only if wanted, with the verified target
      store ID and the correct OWNER account.
- [ ] No `.env`, `.env.local`, generated secret, database files, virtual
      environment, `node_modules`, or build output is included when sharing.
