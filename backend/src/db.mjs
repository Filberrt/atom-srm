import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/oneex_srm',
});

export async function closeDb() {
  await pool.end();
}

export async function migrate() {
  const schemaPath = path.resolve(__dirname, '../../database/schema.sql');
  const sql = await fs.readFile(schemaPath, 'utf8');
  await pool.query(sql);
}

export async function getUser(login) {
  const result = await pool.query('SELECT login, name, city, role, password FROM users WHERE login = $1', [login]);
  return result.rows[0] || null;
}

export async function listUsers() {
  const result = await pool.query('SELECT login, name, city, role, created_at FROM users ORDER BY login');
  return result.rows.map((row) => ({
    login: row.login,
    name: row.name,
    city: row.city,
    role: row.role,
    createdAt: row.created_at ? row.created_at.toISOString() : '',
  }));
}

export async function upsertUser(user) {
  const normalized = normalizeUser(user);
  await pool.query(`
    INSERT INTO users (login, name, city, role, password)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (login) DO UPDATE SET
      name = EXCLUDED.name,
      city = EXCLUDED.city,
      role = EXCLUDED.role,
      password = COALESCE(NULLIF(EXCLUDED.password, ''), users.password)
  `, [normalized.login, normalized.name, normalized.city, normalized.role, normalized.password || '']);
  const saved = await getUser(normalized.login);
  return stripPassword(saved);
}

export async function updateUserPassword(login, password) {
  await pool.query('UPDATE users SET password = $2 WHERE login = $1', [login, password]);
  const saved = await getUser(login);
  return saved ? stripPassword(saved) : null;
}

export async function deleteUser(login) {
  await pool.query("UPDATE clients SET assigned_to = 'boss', updated_at = now() WHERE assigned_to = $1", [login]);
  await pool.query('DELETE FROM users WHERE login = $1', [login]);
}

export async function listClients() {
  const result = await pool.query(`
    SELECT
      c.*,
      tc.chat_id,
      tc.title AS chat_title,
      tc.username AS chat_username,
      tc.status AS chat_status,
      tc.last_message_at,
      tc.last_message_text
    FROM clients c
    LEFT JOIN telegram_chats tc ON tc.client_id = c.id
    ORDER BY c.updated_at DESC
  `);

  const messagesByClient = await listMessagesForClients(result.rows.map((row) => row.id));
  return result.rows.map((row) => rowToClient(row, messagesByClient[row.id] || []));
}

export async function getClient(id) {
  const result = await pool.query(`
    SELECT
      c.*,
      tc.chat_id,
      tc.title AS chat_title,
      tc.username AS chat_username,
      tc.status AS chat_status,
      tc.last_message_at,
      tc.last_message_text
    FROM clients c
    LEFT JOIN telegram_chats tc ON tc.client_id = c.id
    WHERE c.id = $1
  `, [id]);

  if (!result.rows[0]) return null;
  const messages = await listMessages(id);
  return rowToClient(result.rows[0], messages);
}

export async function deleteClient(id) {
  const result = await pool.query('DELETE FROM clients WHERE id = $1 RETURNING id', [String(id || '')]);
  return result.rowCount > 0;
}

export async function upsertClients(clients) {
  const saved = [];
  for (const client of clients) {
    saved.push(await upsertClient(client));
  }
  return saved;
}

export async function upsertClient(client) {
  const normalized = normalizeClientForDb(client);
  await pool.query(`
    INSERT INTO clients (
      id, name, phone, username, city, category, source, amount, direction, stage, assigned_to, data, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13::timestamptz, now()), now())
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      phone = EXCLUDED.phone,
      username = EXCLUDED.username,
      city = EXCLUDED.city,
      category = EXCLUDED.category,
      source = EXCLUDED.source,
      amount = EXCLUDED.amount,
      direction = EXCLUDED.direction,
      stage = EXCLUDED.stage,
      assigned_to = EXCLUDED.assigned_to,
      data = EXCLUDED.data,
      updated_at = now()
  `, [
    normalized.id,
    normalized.name,
    normalized.phone,
    normalized.username,
    normalized.city,
    normalized.category,
    normalized.source,
    normalized.amount,
    normalized.direction,
    normalized.stage,
    normalized.assignedTo,
    normalized,
    normalized.createdAt || null,
  ]);

  if (normalized.telegramChat) {
    await upsertTelegramChat(normalized.id, normalized.telegramChat);
  }

  if (Array.isArray(normalized.telegramMessages)) {
    await replaceTelegramMessages(normalized.id, normalized.telegramMessages);
  }

  return getClient(normalized.id);
}

export async function upsertTelegramChat(clientId, chat) {
  await pool.query(`
    INSERT INTO telegram_chats (
      client_id, chat_id, title, username, status, last_message_at, last_message_text, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,now())
    ON CONFLICT (client_id) DO UPDATE SET
      chat_id = EXCLUDED.chat_id,
      title = EXCLUDED.title,
      username = EXCLUDED.username,
      status = EXCLUDED.status,
      last_message_at = EXCLUDED.last_message_at,
      last_message_text = EXCLUDED.last_message_text,
      updated_at = now()
  `, [
    clientId,
    chat.chatId || '',
    chat.title || '',
    chat.username || '',
    chat.status || 'linked',
    chat.lastMessageAt || null,
    chat.lastMessageText || '',
  ]);
}

export async function upsertTelegramMessages(clientId, messages) {
  for (const message of messages) {
    await pool.query(`
      INSERT INTO telegram_messages (
        client_id, chat_id, message_id, message_date, sender, text
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (client_id, chat_id, message_id) DO UPDATE SET
        message_date = EXCLUDED.message_date,
        sender = EXCLUDED.sender,
        text = EXCLUDED.text
    `, [
      clientId,
      message.chatId || '',
      message.messageId || '',
      message.date || null,
      message.sender || '',
      message.text || '',
    ]);
  }
}

export async function replaceTelegramMessages(clientId, messages = []) {
  await pool.query('DELETE FROM telegram_messages WHERE client_id = $1', [clientId]);
  await upsertTelegramMessages(clientId, messages);
}

export async function listMessages(clientId) {
  const result = await pool.query(`
    SELECT chat_id, message_id, message_date, sender, text
    FROM telegram_messages
    WHERE client_id = $1
    ORDER BY message_date ASC NULLS LAST, id ASC
  `, [clientId]);
  return result.rows.map(rowToMessage);
}

export async function listTelegramInboxChats({ managerLogin = '', includeAll = false } = {}) {
  const params = [];
  let where = '';
  if (!includeAll) {
    params.push(managerLogin);
    where = 'WHERE tic.manager_login = $1';
  }

  const result = await pool.query(`
    SELECT tic.*
    FROM telegram_inbox_chats tic
    ${where}
    ORDER BY tic.updated_at DESC, tic.last_message_at DESC NULLS LAST
    LIMIT 300
  `, params);

  const messagesByChat = await listInboxMessagesForChats(result.rows.map((row) => row.id));
  return result.rows.map((row) => rowToInboxChat(row, messagesByChat[row.id] || []));
}

export async function upsertTelegramInboxChats(managerLogin, chats = []) {
  const saved = [];
  for (const chat of chats) {
    saved.push(await upsertTelegramInboxChat(managerLogin, chat));
  }
  return saved;
}

export async function upsertTelegramInboxChat(managerLogin, chat) {
  const row = normalizeInboxChat(managerLogin, chat);
  await pool.query(`
    INSERT INTO telegram_inbox_chats (
      id, manager_login, chat_id, title, username, phone, status, note, amount, city, category,
      last_message_at, last_message_text, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14::timestamptz, now()), now())
    ON CONFLICT (manager_login, chat_id) DO UPDATE SET
      title = EXCLUDED.title,
      username = EXCLUDED.username,
      phone = EXCLUDED.phone,
      status = COALESCE(NULLIF(telegram_inbox_chats.status, ''), EXCLUDED.status),
      note = COALESCE(NULLIF(telegram_inbox_chats.note, ''), EXCLUDED.note),
      amount = COALESCE(NULLIF(telegram_inbox_chats.amount, 0), EXCLUDED.amount),
      city = COALESCE(NULLIF(telegram_inbox_chats.city, ''), EXCLUDED.city),
      category = COALESCE(NULLIF(telegram_inbox_chats.category, ''), EXCLUDED.category),
      last_message_at = EXCLUDED.last_message_at,
      last_message_text = EXCLUDED.last_message_text,
      updated_at = now()
  `, [
    row.id,
    row.managerLogin,
    row.chatId,
    row.title,
    row.username,
    row.phone,
    row.status,
    row.note,
    row.amount,
    row.city,
    row.category,
    row.lastMessageAt || null,
    row.lastMessageText,
    row.createdAt || null,
  ]);

  if (Array.isArray(row.messages)) {
    await upsertTelegramInboxMessages(row.id, row.chatId, row.messages);
  }

  const result = await pool.query('SELECT * FROM telegram_inbox_chats WHERE manager_login = $1 AND chat_id = $2', [row.managerLogin, row.chatId]);
  const saved = result.rows[0];
  const messages = saved ? await listTelegramInboxMessages(saved.id) : [];
  return saved ? rowToInboxChat(saved, messages) : null;
}

export async function deleteTelegramInboxChat(id, { managerLogin = '', includeAll = false } = {}) {
  const params = [String(id || '')];
  let where = 'WHERE id = $1';
  if (!includeAll) {
    params.push(managerLogin);
    where += ' AND manager_login = $2';
  }
  const result = await pool.query(`DELETE FROM telegram_inbox_chats ${where} RETURNING id`, params);
  return result.rowCount > 0;
}

export async function updateTelegramInboxChatStatus(id, status, { managerLogin = '', includeAll = false } = {}) {
  const params = [String(status || 'new'), String(id || '')];
  let where = 'WHERE id = $2';
  if (!includeAll) {
    params.push(managerLogin);
    where += ' AND manager_login = $3';
  }
  const result = await pool.query(`
    UPDATE telegram_inbox_chats
    SET status = $1, updated_at = now()
    ${where}
    RETURNING *
  `, params);
  if (!result.rows[0]) return null;
  const messages = await listTelegramInboxMessages(result.rows[0].id);
  return rowToInboxChat(result.rows[0], messages);
}

async function upsertTelegramInboxMessages(inboxChatId, chatId, messages = []) {
  for (const message of messages) {
    await pool.query(`
      INSERT INTO telegram_inbox_messages (
        inbox_chat_id, chat_id, message_id, message_date, sender, text
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (inbox_chat_id, chat_id, message_id) DO UPDATE SET
        message_date = EXCLUDED.message_date,
        sender = EXCLUDED.sender,
        text = EXCLUDED.text
    `, [
      inboxChatId,
      message.chatId || chatId || '',
      message.messageId || '',
      message.date || null,
      message.sender || '',
      message.text || '',
    ]);
  }
}

async function listTelegramInboxMessages(inboxChatId) {
  const result = await pool.query(`
    SELECT chat_id, message_id, message_date, sender, text
    FROM telegram_inbox_messages
    WHERE inbox_chat_id = $1
    ORDER BY message_date ASC NULLS LAST, id ASC
  `, [inboxChatId]);
  return result.rows.map(rowToMessage);
}

export async function addAuditLog(log) {
  const row = normalizeAuditLog(log);
  await pool.query(`
    INSERT INTO audit_logs (id, created_at, manager_login, client_id, client_name, action, details)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (id) DO NOTHING
  `, [row.id, row.createdAt, row.managerLogin, row.clientId, row.clientName, row.action, row.details]);
  return row;
}

export async function listAuditLogs({ managerLogin } = {}) {
  const params = [];
  let where = '';
  if (managerLogin) {
    params.push(managerLogin);
    where = 'WHERE manager_login = $1';
  }
  const result = await pool.query(`
    SELECT id, created_at, manager_login, client_id, client_name, action, details
    FROM audit_logs
    ${where}
    ORDER BY created_at DESC
    LIMIT 200
  `, params);
  return result.rows.map(rowToAuditLog);
}

export async function getTelegramSettings(login, options = {}) {
  const result = await pool.query(`
    SELECT manager_login, telegram_account, telegram_mode, telegram_session, telegram_session_status, telegram_session_hint, updated_at
    FROM manager_settings
    WHERE manager_login = $1
  `, [login]);
  return result.rows[0] ? rowToTelegramSettings(result.rows[0], options) : defaultTelegramSettings(login);
}

export async function upsertTelegramSettings(login, settings = {}) {
  const current = await getTelegramSettings(login);
  const clearSession = !!settings.clearTelegramSession;
  const status = clearSession
    ? 'not_configured'
    : settings.telegramSession
    ? 'configured'
    : (settings.telegramSessionStatus || current.telegramSessionStatus || 'not_configured');
  const hint = clearSession
    ? ''
    : settings.telegramSession
    ? sessionHint(settings.telegramSession)
    : (settings.telegramSessionHint || current.telegramSessionHint || '');
  await pool.query(`
    INSERT INTO manager_settings (
      manager_login, telegram_account, telegram_mode, telegram_session, telegram_session_status, telegram_session_hint, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,now())
    ON CONFLICT (manager_login) DO UPDATE SET
      telegram_account = EXCLUDED.telegram_account,
      telegram_mode = EXCLUDED.telegram_mode,
      telegram_session = CASE WHEN $7 THEN '' ELSE COALESCE(NULLIF(EXCLUDED.telegram_session, ''), manager_settings.telegram_session) END,
      telegram_session_status = EXCLUDED.telegram_session_status,
      telegram_session_hint = EXCLUDED.telegram_session_hint,
      updated_at = now()
  `, [
    login,
    settings.telegramAccount || '',
    settings.telegramMode || 'needed',
    encryptTelegramSession(settings.telegramSession || ''),
    status,
    hint,
    clearSession,
  ]);
  return getTelegramSettings(login);
}

async function listMessagesForClients(clientIds) {
  if (!clientIds.length) return {};
  const result = await pool.query(`
    SELECT client_id, chat_id, message_id, message_date, sender, text
    FROM telegram_messages
    WHERE client_id = ANY($1)
    ORDER BY message_date ASC NULLS LAST, id ASC
  `, [clientIds]);

  return result.rows.reduce((acc, row) => {
    acc[row.client_id] ||= [];
    acc[row.client_id].push(rowToMessage(row));
    return acc;
  }, {});
}

async function listInboxMessagesForChats(chatIds) {
  if (!chatIds.length) return {};
  const result = await pool.query(`
    SELECT inbox_chat_id, chat_id, message_id, message_date, sender, text
    FROM telegram_inbox_messages
    WHERE inbox_chat_id = ANY($1)
    ORDER BY message_date ASC NULLS LAST, id ASC
  `, [chatIds]);

  return result.rows.reduce((acc, row) => {
    acc[row.inbox_chat_id] ||= [];
    acc[row.inbox_chat_id].push(rowToMessage(row));
    return acc;
  }, {});
}

function rowToClient(row, messages) {
  const data = row.data || {};
  const username = cleanTelegramUsername(row.username || data.username || '');
  const chatUsername = cleanTelegramUsername(row.chat_username || data.telegramChat?.username || username);
  return {
    ...data,
    id: row.id,
    name: row.name,
    phone: row.phone || '',
    username,
    city: row.city || data.city || 'Уфа',
    category: row.category || data.category || 'Криптообмен',
    source: row.source || data.source || 'Telegram',
    amount: Number(row.amount || data.amount || 0),
    direction: row.direction || data.direction || 'buy',
    stage: row.stage || data.stage || 'active',
    assignedTo: row.assigned_to || data.assignedTo || 'nikita',
    telegramChat: {
      ...(data.telegramChat || {}),
      chatId: row.chat_id || data.telegramChat?.chatId || '',
      title: row.chat_title || data.telegramChat?.title || row.name,
      username: chatUsername,
      status: row.chat_status || data.telegramChat?.status || 'not_linked',
      lastMessageAt: row.last_message_at ? row.last_message_at.toISOString() : data.telegramChat?.lastMessageAt || '',
      lastMessageText: row.last_message_text || data.telegramChat?.lastMessageText || '',
    },
    telegramMessages: messages,
  };
}

function rowToInboxChat(row, messages = []) {
  return {
    id: row.id,
    managerLogin: row.manager_login || '',
    chatId: row.chat_id || '',
    title: row.title || '',
    username: row.username || '',
    phone: row.phone || '',
    status: row.status || 'new',
    note: row.note || '',
    amount: Number(row.amount || 0),
    city: row.city || '',
    category: row.category || '',
    lastMessageAt: row.last_message_at ? row.last_message_at.toISOString() : '',
    lastMessageText: row.last_message_text || '',
    createdAt: row.created_at ? row.created_at.toISOString() : '',
    updatedAt: row.updated_at ? row.updated_at.toISOString() : '',
    messages,
  };
}

function rowToMessage(row) {
  return {
    chatId: row.chat_id || '',
    messageId: row.message_id || '',
    date: row.message_date ? row.message_date.toISOString() : '',
    sender: row.sender || '',
    text: row.text || '',
  };
}

function normalizeInboxChat(managerLogin, chat) {
  const chatId = String(chat.chatId || '').trim();
  const id = String(chat.id || `${managerLogin}-${chatId}`.replace(/[^a-zA-Z0-9_-]/g, '_'));
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const last = messages.at(-1);
  return {
    id,
    managerLogin,
    chatId,
    title: chat.title || chat.name || chat.username || 'Telegram chat',
    username: cleanTelegramUsername(chat.username || ''),
    phone: chat.phone || '',
    status: chat.status || 'new',
    note: chat.note || '',
    amount: Number(chat.amount || 0),
    city: chat.city || '',
    category: chat.category || '',
    lastMessageAt: chat.lastMessageAt || last?.date || '',
    lastMessageText: String(chat.lastMessageText || last?.text || '').slice(0, 500),
    createdAt: chat.createdAt || '',
    messages,
  };
}

function normalizeClientForDb(client) {
  const placeholderUsername = isPlaceholderTelegramUsername(client.username || client.telegramChat?.username);
  const username = cleanTelegramUsername(client.username || '');
  const chatUsername = cleanTelegramUsername(client.telegramChat?.username || username);
  const chatId = placeholderUsername ? '' : (client.telegramChat?.chatId || '');
  const telegramChat = client.telegramChat
    ? {
        ...client.telegramChat,
        username: chatUsername,
        chatId,
        status: chatUsername || chatId ? (client.telegramChat.status || 'linked') : 'not_linked',
        lastMessageAt: chatUsername || chatId ? (client.telegramChat.lastMessageAt || '') : '',
        lastMessageText: chatUsername || chatId ? (client.telegramChat.lastMessageText || '') : '',
      }
    : client.telegramChat;
  return {
    ...client,
    id: String(client.id || Date.now()),
    name: client.name || 'Клиент',
    phone: client.phone || '',
    username,
    city: client.city || 'Уфа',
    category: client.category || 'Криптообмен',
    source: client.source || 'Telegram',
    amount: Number(client.amount || 0),
    direction: client.direction || 'buy',
    stage: client.stage || 'active',
    assignedTo: client.assignedTo || 'nikita',
    deals: Array.isArray(client.deals) ? client.deals : [],
    touches: Array.isArray(client.touches) ? client.touches : [],
    telegramChat,
    telegramMessages: placeholderUsername ? [] : (Array.isArray(client.telegramMessages) ? client.telegramMessages : []),
  };
}

function cleanTelegramUsername(value) {
  const username = String(value || '').trim();
  return isPlaceholderTelegramUsername(username) ? '' : username;
}

function isPlaceholderTelegramUsername(value) {
  return /^@?client_\d+$/i.test(String(value || '').trim());
}

function normalizeUser(user) {
  const login = String(user.login || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return {
    login,
    name: user.name || login,
    city: user.city || '',
    role: user.role || 'CRM / менеджер',
    password: user.password || '',
  };
}

function stripPassword(user) {
  if (!user) return null;
  const { password, ...rest } = user;
  return rest;
}

function normalizeAuditLog(log) {
  return {
    id: String(log.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
    createdAt: log.createdAt || new Date().toISOString(),
    managerLogin: log.managerLogin || '',
    clientId: log.clientId || '',
    clientName: log.clientName || '',
    action: log.action || '',
    details: log.details || '',
  };
}

function rowToAuditLog(row) {
  return {
    id: row.id,
    createdAt: row.created_at ? row.created_at.toISOString() : '',
    managerLogin: row.manager_login || '',
    clientId: row.client_id || '',
    clientName: row.client_name || '',
    action: row.action || '',
    details: row.details || '',
  };
}

function defaultTelegramSettings(login) {
  return {
    managerLogin: login,
    telegramAccount: '',
    telegramMode: 'needed',
    telegramSession: '',
    telegramSessionStatus: 'not_configured',
    telegramSessionHint: '',
    updatedAt: '',
  };
}

function rowToTelegramSettings(row, options = {}) {
  const settings = {
    managerLogin: row.manager_login,
    telegramAccount: row.telegram_account || '',
    telegramMode: row.telegram_mode || 'needed',
    telegramSessionStatus: row.telegram_session_status || 'not_configured',
    telegramSessionHint: row.telegram_session_hint || '',
    updatedAt: row.updated_at ? row.updated_at.toISOString() : '',
  };
  if (options.includePrivate) settings.telegramSession = decryptTelegramSession(row.telegram_session || '');
  return settings;
}

function sessionHint(session) {
  const value = String(session || '');
  if (!value) return '';
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function telegramSessionKey() {
  const secret = process.env.TELEGRAM_SESSION_SECRET || process.env.AUTH_SECRET || '';
  return crypto.createHash('sha256').update(secret || 'atom-local-dev-session-secret').digest();
}

function encryptTelegramSession(session) {
  const value = String(session || '');
  if (!value || value.startsWith('enc:v1:')) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', telegramSessionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

function decryptTelegramSession(session) {
  const value = String(session || '');
  if (!value || !value.startsWith('enc:v1:')) return value;
  try {
    const [, , ivText, tagText, encryptedText] = value.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', telegramSessionKey(), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
}
