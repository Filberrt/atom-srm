# Atom SRM

A Node.js CRM application with a browser frontend, a PostgreSQL-compatible local database (PGlite), and optional Telegram history import.

## Requirements

- Node.js 20 or later
- npm

## Run locally

```sh
cd backend
npm ci
npm start
```

Open http://127.0.0.1:3000/.

Configure credentials and integrations through environment variables in `backend/.env`. Never commit `.env`, database files, uploads, or customer exports. No production credentials or customer data are included in this repository.

## Database

By default, the app uses PGlite for local development. For PostgreSQL deployments, configure `DB_MODE=postgres` and `DATABASE_URL` in the environment. Review the schema and application configuration before deployment.

## Telegram

Telegram import requires credentials and a session configured in the runtime environment. Do not commit Telegram credentials or session strings.
