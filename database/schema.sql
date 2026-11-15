CREATE TABLE IF NOT EXISTS users (
  login TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  role TEXT NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  username TEXT,
  city TEXT,
  category TEXT,
  source TEXT,
  amount NUMERIC DEFAULT 0,
  direction TEXT,
  stage TEXT,
  assigned_to TEXT REFERENCES users(login),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_accounts (
  id BIGSERIAL PRIMARY KEY,
  manager_login TEXT NOT NULL REFERENCES users(login),
  phone TEXT,
  session_encrypted TEXT,
  status TEXT NOT NULL DEFAULT 'connected',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_chats (
  client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  chat_id TEXT,
  title TEXT,
  username TEXT,
  status TEXT NOT NULL DEFAULT 'linked',
  last_message_at TIMESTAMPTZ,
  last_message_text TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_messages (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  chat_id TEXT,
  message_id TEXT,
  message_date TIMESTAMPTZ,
  sender TEXT,
  text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, chat_id, message_id)
);

CREATE TABLE IF NOT EXISTS telegram_inbox_chats (
  id TEXT PRIMARY KEY,
  manager_login TEXT NOT NULL REFERENCES users(login) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  title TEXT,
  username TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  note TEXT,
  amount NUMERIC DEFAULT 0,
  city TEXT,
  category TEXT,
  last_message_at TIMESTAMPTZ,
  last_message_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (manager_login, chat_id)
);

CREATE TABLE IF NOT EXISTS telegram_inbox_messages (
  id BIGSERIAL PRIMARY KEY,
  inbox_chat_id TEXT NOT NULL REFERENCES telegram_inbox_chats(id) ON DELETE CASCADE,
  chat_id TEXT,
  message_id TEXT,
  message_date TIMESTAMPTZ,
  sender TEXT,
  text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (inbox_chat_id, chat_id, message_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  manager_login TEXT,
  client_id TEXT,
  client_name TEXT,
  action TEXT NOT NULL,
  details TEXT
);

CREATE TABLE IF NOT EXISTS manager_settings (
  manager_login TEXT PRIMARY KEY REFERENCES users(login) ON DELETE CASCADE,
  telegram_account TEXT,
  telegram_mode TEXT NOT NULL DEFAULT 'needed',
  telegram_session TEXT,
  telegram_session_status TEXT NOT NULL DEFAULT 'not_configured',
  telegram_session_hint TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE manager_settings ADD COLUMN IF NOT EXISTS telegram_session TEXT;

CREATE INDEX IF NOT EXISTS clients_stage_idx ON clients(stage);
CREATE INDEX IF NOT EXISTS clients_assigned_to_idx ON clients(assigned_to);
CREATE INDEX IF NOT EXISTS clients_username_idx ON clients(username);
CREATE INDEX IF NOT EXISTS telegram_messages_client_id_idx ON telegram_messages(client_id);
CREATE INDEX IF NOT EXISTS telegram_messages_message_date_idx ON telegram_messages(message_date);
CREATE INDEX IF NOT EXISTS telegram_inbox_chats_manager_login_idx ON telegram_inbox_chats(manager_login);
CREATE INDEX IF NOT EXISTS telegram_inbox_chats_updated_at_idx ON telegram_inbox_chats(updated_at);
CREATE INDEX IF NOT EXISTS telegram_inbox_messages_chat_id_idx ON telegram_inbox_messages(inbox_chat_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS audit_logs_manager_login_idx ON audit_logs(manager_login);

INSERT INTO users (login, name, city, role, password) VALUES
  ('boss', 'Boss', 'All', 'Boss / owner', 'pbkdf2$sha256$210000$L3lxgqutACX01ImhfnFI-w$KynITjFEdEnFWDWy9syOPiIDmHo0ujgrBuA7GOzibJw'),
  ('nikita', 'Никита', 'Уфа', 'CRM / руководитель', 'pbkdf2$sha256$210000$KZY_bxAtiFqQexcttXNUHg$kqDRihqNkZY8MmcLf1XVlnRlV_xR0MatQF6iLoX7iYY'),
  ('danila', 'Данила', 'Екатеринбург', 'CRM / внедрение', 'pbkdf2$sha256$210000$OI7EhRLTCF-PuHcN0Tmocw$v12VL2YUSR4KlsuJyYEqLXzikABpYkFCKCU1Nm--zoQ'),
  ('radik', 'Радик', 'Казань', 'CRM / менеджер', 'pbkdf2$sha256$210000$4Cxq8fyGPMsAdi8jAkUdRA$KhKV1wmD5ZmM9g09M50e3Co2A_FpKT3w3t_7e_QVeW0'),
  ('atom', 'Atom менеджер', 'Москва', 'CRM / менеджер', 'pbkdf2$sha256$210000$gRAjDOcYcgRvWo_ybBEKRQ$DqfmrV3visjPlmtueAIxVZHKSNS0aR-cSgdkM7rIVQA')
ON CONFLICT (login) DO UPDATE SET
  name = EXCLUDED.name,
  city = EXCLUDED.city,
  role = EXCLUDED.role,
  password = EXCLUDED.password;
