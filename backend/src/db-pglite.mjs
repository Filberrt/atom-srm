import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data/pglite');

export const db = new PGlite(dataDir);

export async function closeDb() {
  await db.close();
}

export async function migrate() {
  await fs.mkdir(dataDir, { recursive: true });
  const schemaPath = path.resolve(__dirname, '../../database/schema.sql');
  const sql = await fs.readFile(schemaPath, 'utf8');
  await db.exec(sql);
}

export async function getUser(login) {
  const result = await db.query('SELECT login, name, city, role, password FROM users WHERE login = $1', [login]);
  return result.rows[0] || null;
}

export async function listUsers() {
  const result = await db.query('SELECT login, name, city, role, created_at FROM users ORDER BY login');
  return result.rows.map((row) => ({
    login: row.login,
    name: row.name,
    city: row.city,
    role: row.role,
    createdAt: toIso(row.created_at),
  }));
}

export async function upsertUser(user) {
  const normalized = normalizeUser(user);
  await db.query(`
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
  await db.query('UPDATE users SET password = $2 WHERE login = $1', [login, password]);
  const saved = await getUser(login);
  return saved ? stripPassword(saved) : null;
}

export async function deleteUser(login) {
  await db.query("UPDATE clients SET assigned_to = 'boss', updated_at = now() WHERE assigned_to = $1", [login]);
  await db.query('DELETE FROM users WHERE login = $1', [login]);
}

export async function listClients() {
  const result = await db.query(`
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
  const result = await db.query(`
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

export async function upsertClients(clients) {
  const saved = [];
  for (const client of clients) {
    saved.push(await upsertClient(client));
  }
  return saved;
}

export async function upsertClient(client) {
  const normalized = normalizeClientForDb(client);
  await db.query(`
    INSERT INTO clients (
      id, name, phone, username, city, category, source, amount, direction, stage, assigned_to, data, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,COALESCE($13::timestamptz, now()), now())
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
    JSON.stringify(normalized),
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
  await db.query(`
    INSERT INTO telegram_chats (
      client_id, chat_id, title, username, status, last_message_at, last_message_text, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,now())
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
    await db.query(`
      INSERT INTO telegram_messages (
        client_id, chat_id, message_id, message_date, sender, text
      )
      VALUES ($1,$2,$3,$4::timestamptz,$5,$6)
      ON CONFLICT (client_id, chat_id, message_id) DO UPDATE SET
        message_date = EXCLUDED.message_date,
        sender = EXCLUDED.sender,
        text = EXCLUDED.text
    `, [
      clientId,
      message.chatId || '',
      String(message.messageId || ''),
      message.date || null,
      message.sender || '',
      message.text || '',
    ]);
  }
}

export async function replaceTelegramMessages(clientId, messages = []) {
  await db.query('DELETE FROM telegram_messages WHERE client_id = $1', [clientId]);
  await upsertTelegramMessages(clientId, messages);
}

export async function listMessages(clientId) {
  const result = await db.query(`
    SELECT chat_id, message_id, message_date, sender, text
    FROM telegram_messages
    WHERE client_id = $1
    ORDER BY message_date ASC NULLS LAST, id ASC
  `, [clientId]);
  return result.rows.map(rowToMessage);
}

export async function addAuditLog(log) {
  const row = normalizeAuditLog(log);
  await db.query(`
    INSERT INTO audit_logs (id, created_at, manager_login, client_id, client_name, action, details)
    VALUES ($1,$2::timestamptz,$3,$4,$5,$6,$7)
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
  const result = await db.query(`
    SELECT id, created_at, manager_login, client_id, client_name, action, details
    FROM audit_logs
    ${where}
    ORDER BY created_at DESC
    LIMIT 200
  `, params);
  return result.rows.map(rowToAuditLog);
}

export async function getTelegramSettings(login, options = {}) {
  const result = await db.query(`
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
  await db.query(`
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

  const placeholders = clientIds.map((_, index) => `$${index + 1}`).join(',');
  const result = await db.query(`
    SELECT client_id, chat_id, message_id, message_date, sender, text
    FROM telegram_messages
    WHERE client_id IN (${placeholders})
    ORDER BY message_date ASC NULLS LAST, id ASC
  `, clientIds);

  return result.rows.reduce((acc, row) => {
    acc[row.client_id] ||= [];
    acc[row.client_id].push(rowToMessage(row));
    return acc;
  }, {});
}

function rowToClient(row, messages) {
  const data = parseJsonData(row.data);
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
    updatedAt: toIso(row.updated_at) || data.updatedAt || '',
    telegramChat: {
      ...(data.telegramChat || {}),
      chatId: row.chat_id || data.telegramChat?.chatId || '',
      title: row.chat_title || data.telegramChat?.title || row.name,
      username: chatUsername,
      status: row.chat_status || data.telegramChat?.status || 'not_linked',
      lastMessageAt: toIso(row.last_message_at) || data.telegramChat?.lastMessageAt || '',
      lastMessageText: row.last_message_text || data.telegramChat?.lastMessageText || '',
    },
    telegramMessages: messages,
  };
}

function rowToMessage(row) {
  return {
    chatId: row.chat_id || '',
    messageId: row.message_id || '',
    date: toIso(row.message_date),
    sender: row.sender || '',
    text: row.text || '',
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
    createdAt: toIso(row.created_at),
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
    updatedAt: toIso(row.updated_at),
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

function parseJsonData(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function toIso(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
