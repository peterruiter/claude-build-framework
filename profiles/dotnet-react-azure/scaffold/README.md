# App

One ASP.NET Core API (minimal APIs, Dapper, Azure SQL) serving two React apps (Vite), in one container on
Azure Container Apps.

## Run it

```powershell
dotnet build -c Release          # warnings are errors in Release
dotnet test                      # database tests use LocalDB (Windows) or TEST_SQL_CONNECTION
cd src/web; npm ci; npm test; npm run build
./build/Start-Local.ps1          # http://127.0.0.1:5080/app/ and /portal/
```

## Where things are

| Path | What |
| --- | --- |
| `src/App.Api` | Minimal API: health probes, `migrate` command, public URLs, shared rate limits, log redaction |
| `src/App.Data` | Dapper stores, the embedded migration runner and its ledger, erasure participants |
| `src/App.Domain` | Localizer, CLDR plural rules, the string bundles (`Localization/Resources/*.json`) |
| `db/migrations` | Idempotent SQL migrations, `NNNN_name.sql`, never edited once applied |
| `tests/App.Tests` | xUnit + FluentAssertions; `[LocalDbFact]` for database tests; contract tests |
| `src/web` | Vite + React + TypeScript: `/app/` and `/portal/`, tokens for light and dark, string checks |
| `build/contracts` | Shared registries tests enforce: languages, plural rules, routes, privacy |
| `build/*.ps1` | Release and operations scripts, configured by `profile.config.json` |
| `infra/` | Bicep for everything in Azure |
| `tests/load` | k6 load scenarios and a local test-data generator |

## Languages

Offered languages are in `build/contracts/locales.json`. Add one with
`node src/web/scripts/add-language.mjs <code> [culture]`, then translate its bundles. `npm run check` and the
tests hold every bundle to every key and every plural form the language needs.
