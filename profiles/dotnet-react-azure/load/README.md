# Load tests (k6)

A starter: one scenario per journey, each with its own thresholds for p95 latency and error rate, a guard
that decides where a test may run, and a test-data generator for a local API. `scaffold.ps1` copies this
folder to `tests/load/` in the new repository.

| File | What |
| --- | --- |
| `lib/target.js` | Where a test may run (see "Where" below), shared thresholds, per-user client address for a local API |
| `scenarios/browse.js` | A visitor opens the app and reads: ramping users, p95 < 400 ms (items < 300 ms), errors < 1% |
| `scenarios/create.js` | People create things at a fixed arrival rate: p95 < 800 ms; 429 from the shared rate limit counts as an answer, not an error |
| `scenarios/mixed.js` | The peak hour: readers and writers together, from the generated fixture; use it to size replicas and vCores |
| `generate-data.mjs` | Makes N items over M tags through the API and writes `out/fixture.json`; refuses anything but a loopback address |

Add a scenario per real journey of your product (sign in, search, check out ...), each with the thresholds
the product promises. Keep the thresholds in the scenario file so a change to them is reviewed.

## Install k6 (pinned)

The scripts are written against **k6 v2.3.0**. Install exactly that version, so a run today and a run in
three months measure the same way:

```powershell
# Windows: the release zip (winget lags behind; on 17 Oct 2026 it offered 2.2.0)
gh release download v2.3.0 -R grafana/k6 -p "k6-v2.3.0-windows-amd64.zip"   # or from the releases page
# Linux/macOS: the matching k6-v2.3.0-<os>-<arch> archive from https://github.com/grafana/k6/releases/tag/v2.3.0
# Anywhere with Docker (the scenario folder mounted, so lib/ imports resolve):
docker run --rm -v ${PWD}/tests/load:/load -w /load grafana/k6:2.3.0 run scenarios/browse.js
# (inside a container 127.0.0.1 is the container: on Linux add --network host to reach a local API)
```

`k6 version` must print v2.3.0. When you move to a newer k6, re-run the scenarios locally first and record
the new baseline.

## Local trial (any time, no approval needed)

Against the API on your machine with LocalDB. This finds slow queries, missing indexes, lock contention and
N+1 calls; it does not tell you what Azure will do.

```powershell
./build/Start-Local.ps1 -Port 5080 -Database MyProduct_Load      # its own database
node tests/load/generate-data.mjs --items 2000 --tags 50
k6 run tests/load/scenarios/browse.js
k6 run -e RATE=20 tests/load/scenarios/create.js
k6 run -e READERS=20 -e RAMP=5s -e DURATION=20s -e WRITE_START=5s -e WRITE_DURATION=20s tests/load/scenarios/mixed.js
```

A local API believes `X-Forwarded-For`, so each virtual user gets its own address and the per-address rate
limit partitions by user. Behind Azure's ingress the real address wins, as it should: plan for that in a
real run (many load generators, or a test-only limit set for the load-test environment).

## A real run (a separate environment, the owner's go per run)

Never against production. A real run happens in a **separate resource group** built from the same
templates, so it measures the same infrastructure without touching real users or real data:

1. Ask the owner, with the cost: the environment runs for the hours of the test (database vCores, replicas,
   Log Analytics ingestion, k6 machines). Record the date of the go.
2. Make a config for it: a copy of `profile.config.json` as `profile.config.local.json` with its own
   `azure.resourceGroup` (`rg-myproduct-loadtest`), `azure.namePrefix` (`myproductlt`), no `alertEmail`,
   and the capacity you want to test (`app.maxReplicas`, `database.maxVCores`).
3. `./build/Deploy-Infrastructure.ps1`, `./build/Initialize-Database.ps1`, `./build/Grant-DatabaseAccess.ps1`,
   `./build/Publish-Container.ps1` against it. Seed it through its API (extend `generate-data.mjs` for a
   non-loopback target only for this environment, in a reviewed change).
4. Run with the guard satisfied, and production listed so it can never be hit by mistake:

   ```powershell
   $env:BASE_URL = 'https://myproductlt-api.<env>.swedencentral.azurecontainerapps.io'
   $env:TARGET = 'loadtest'; $env:OWNER_GO = '2026-10-17'
   $env:PRODUCTION_HOSTS = 'www.example.com,example.com'
   k6 run tests/load/scenarios/mixed.js
   ```

5. While it runs, watch the container app's replica count and the database's `workers_percent` and
   `cpu_percent` (the alert rules name the same metrics). Write down: users or arrival rate, p95 per
   journey, error rate, replicas reached, database vCores and workers at peak.
6. Delete the resource group the same day (`az group delete --name rg-myproduct-loadtest --subscription <id>`),
   after the owner confirms. Record the results in STATE.md with the image tag tested.

`lib/target.js` refuses: any non-loopback address without `TARGET=loadtest` and `OWNER_GO=<date>`, and any
host listed in `PRODUCTION_HOSTS`, always. Running against production would need a written decision with a
time window and a reviewed change to that guard for that one run.
