# Local Product Architecture

`local_product` - это локальная сборка цельного SRM-продукта для демонстрации.

## Runtime

```text
Browser
  http://127.0.0.1:3000/

Node.js backend
  local_product/backend/src/server.mjs

Local database
  PGlite in local_product/backend/data/pglite

Production database later
  PostgreSQL via DATABASE_URL

Telegram import
  local_product/backend/src/telegram.mjs
```

## Data Flow

Создание или изменение клиента:

```text
SRM frontend
  -> PUT /api/sync/clients
  -> backend
  -> clients table
```

Привязка Telegram:

```text
SRM frontend
  -> POST /api/clients/:id/link-telegram
  -> backend finds Telegram chat by username/title/chat id
  -> backend imports message history
  -> telegram_chats + telegram_messages
  -> SRM displays messages in the client card
```

## Difference From Old MVP

Old MVP:

```text
SRM HTML -> Google Apps Script -> Google Sheets
Telegram bridge -> Google Apps Script -> Google Sheets
```

New local product:

```text
SRM frontend -> Node.js backend -> local Postgres-compatible DB
Telegram import -> Node.js backend -> local DB
```

Production:

```text
Timeweb server:
  frontend
  Node.js backend
  Telegram worker/connector

Timeweb database:
  PostgreSQL
```
