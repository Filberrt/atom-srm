import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../data');
const dataFile = path.join(dataDir, 'local-db.json');

const seedUsers = [
  { login: 'boss', name: 'Boss', city: 'All', role: 'Boss / owner', password: 'pbkdf2$sha256$210000$L3lxgqutACX01ImhfnFI-w$KynITjFEdEnFWDWy9syOPiIDmHo0ujgrBuA7GOzibJw' },
  { login: 'nikita', name: 'Никита', city: 'Уфа', role: 'CRM / руководитель', password: 'pbkdf2$sha256$210000$KZY_bxAtiFqQexcttXNUHg$kqDRihqNkZY8MmcLf1XVlnRlV_xR0MatQF6iLoX7iYY' },
  { login: 'danila', name: 'Данила', city: 'Екатеринбург', role: 'CRM / внедрение', password: 'pbkdf2$sha256$210000$OI7EhRLTCF-PuHcN0Tmocw$v12VL2YUSR4KlsuJyYEqLXzikABpYkFCKCU1Nm--zoQ' },
  { login: 'radik', name: 'Радик', city: 'Казань', role: 'CRM / менеджер', password: 'pbkdf2$sha256$210000$4Cxq8fyGPMsAdi8jAkUdRA$KhKV1wmD5ZmM9g09M50e3Co2A_FpKT3w3t_7e_QVeW0' },
  { login: 'atom', name: 'Atom менеджер', city: 'Москва', role: 'CRM / менеджер', password: 'pbkdf2$sha256$210000$gRAjDOcYcgRvWo_ybBEKRQ$DqfmrV3visjPlmtueAIxVZHKSNS0aR-cSgdkM7rIVQA' },
];

export async function migrate() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(dataFile);
  } catch {
    await writeDb({ users: seedUsers, clients: [], telegramMessages: [] });
  }
}

export async function closeDb() {}

export async function getUser(login) {
  const db = await readDb();
  return db.users.find((user) => user.login === login) || null;
}

export async function listUsers() {
  const db = await readDb();
  return db.users.map(stripPassword);
}

export async function upsertUser(user) {
  const db = await readDb();
  const normalized = normalizeUser(user);
  const index = db.users.findIndex((item) => item.login === normalized.login);
  if (index === -1) db.users.push(normalized);
  else db.users[index] = { ...db.users[index], ...normalized };
  await writeDb(db);
  return stripPassword(normalized);
}

export async function updateUserPassword(login, password) {
  const db = await readDb();
  const user = db.users.find((item) => item.login === login);
  if (!user) return null;
  user.password = String(password || '');
  await writeDb(db);
  return stripPassword(user);
}

export async function deleteUser(login) {
  const db = await readDb();
  db.clients = (db.clients || []).map((client) => (
    String(client.assignedTo || '') === String(login) ? { ...client, assignedTo: 'boss' } : client
  ));
  db.users = db.users.filter((user) => user.login !== login);
  await writeDb(db);
}

export async function listClients() {
  const db = await readDb();
  return db.clients.map((client) => ({
    ...client,
    telegramMessages: db.telegramMessages
      .filter((message) => message.clientId === client.id)
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
      .map(stripClientId),
  })).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export async function getClient(id) {
  const clients = await listClients();
  return clients.find((client) => String(client.id) === String(id)) || null;
}

export async function deleteClient(id) {
  const db = await readDb();
  const before = (db.clients || []).length;
  db.clients = (db.clients || []).filter((client) => String(client.id) !== String(id));
  db.telegramMessages = (db.telegramMessages || []).filter((message) => String(message.clientId) !== String(id));
  await writeDb(db);
  return db.clients.length !== before;
}

export async function upsertClients(clients) {
  const saved = [];
  for (const client of clients) {
    saved.push(await upsertClient(client));
  }
  return saved;
}

export async function upsertClient(client) {
  const db = await readDb();
  const normalized = normalizeClient(client);
  const index = db.clients.findIndex((item) => String(item.id) === String(normalized.id));

  if (index === -1) {
    db.clients.push(normalized);
  } else {
    db.clients[index] = {
      ...db.clients[index],
      ...normalized,
      telegramMessages: undefined,
      updatedAt: new Date().toISOString(),
    };
  }

  if (Array.isArray(normalized.telegramMessages)) {
    replaceMessages(db, normalized.id, normalized.telegramMessages);
  }

  await writeDb(db);
  return getClient(normalized.id);
}

export async function upsertTelegramChat(clientId, chat) {
  const client = await getClient(clientId);
  if (!client) return;
  client.telegramChat = { ...(client.telegramChat || {}), ...(chat || {}) };
  await upsertClient(client);
}

export async function upsertTelegramMessages(clientId, messages) {
  const db = await readDb();
  upsertMessages(db, clientId, messages);
  await writeDb(db);
}

export async function listMessages(clientId) {
  const db = await readDb();
  return db.telegramMessages
    .filter((message) => String(message.clientId) === String(clientId))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    .map(stripClientId);
}

export async function listTelegramInboxChats({ managerLogin = '', includeAll = false } = {}) {
  const db = await readDb();
  return (db.telegramInboxChats || [])
    .filter((chat) => includeAll || chat.managerLogin === managerLogin)
    .map((chat) => ({
      ...chat,
      messages: (db.telegramInboxMessages || [])
        .filter((message) => message.inboxChatId === chat.id)
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
        .map(({ inboxChatId, ...message }) => message),
    }))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

export async function upsertTelegramInboxChats(managerLogin, chats = []) {
  const db = await readDb();
  db.telegramInboxChats ||= [];
  db.telegramInboxMessages ||= [];
  const saved = [];
  for (const chat of chats) {
    const normalized = normalizeInboxChat(managerLogin, chat);
    const index = db.telegramInboxChats.findIndex((item) => item.managerLogin === managerLogin && item.chatId === normalized.chatId);
    if (index === -1) db.telegramInboxChats.push(normalized);
    else db.telegramInboxChats[index] = { ...db.telegramInboxChats[index], ...normalized, updatedAt: new Date().toISOString() };
    for (const message of normalized.messages || []) {
      const row = { ...message, inboxChatId: normalized.id, chatId: message.chatId || normalized.chatId };
      const msgIndex = db.telegramInboxMessages.findIndex((item) => item.inboxChatId === row.inboxChatId && item.chatId === row.chatId && item.messageId === row.messageId);
      if (msgIndex === -1) db.telegramInboxMessages.push(row);
      else db.telegramInboxMessages[msgIndex] = row;
    }
    saved.push(normalized);
  }
  await writeDb(db);
  return saved;
}

export async function deleteTelegramInboxChat(id, { managerLogin = '', includeAll = false } = {}) {
  const db = await readDb();
  const before = (db.telegramInboxChats || []).length;
  db.telegramInboxChats = (db.telegramInboxChats || []).filter((chat) => String(chat.id) !== String(id) || (!includeAll && chat.managerLogin !== managerLogin));
  db.telegramInboxMessages = (db.telegramInboxMessages || []).filter((message) => String(message.inboxChatId) !== String(id));
  await writeDb(db);
  return db.telegramInboxChats.length !== before;
}

export async function updateTelegramInboxChatStatus(id, status, { managerLogin = '', includeAll = false } = {}) {
  const db = await readDb();
  const chat = (db.telegramInboxChats || []).find((item) => (
    String(item.id) === String(id)
    && (includeAll || item.managerLogin === managerLogin)
  ));
  if (!chat) return null;
  chat.status = String(status || 'new');
  chat.updatedAt = new Date().toISOString();
  await writeDb(db);
  return {
    ...chat,
    messages: (db.telegramInboxMessages || [])
      .filter((message) => message.inboxChatId === chat.id)
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
      .map(({ inboxChatId, ...message }) => message),
  };
}

export async function addAuditLog(log) {
  const db = await readDb();
  const row = {
    id: String(log.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
    createdAt: log.createdAt || new Date().toISOString(),
    managerLogin: log.managerLogin || '',
    clientId: log.clientId || '',
    clientName: log.clientName || '',
    action: log.action || '',
    details: log.details || '',
  };
  db.auditLogs ||= [];
  db.auditLogs.push(row);
  db.auditLogs = db.auditLogs.slice(-500);
  await writeDb(db);
  return row;
}

export async function listAuditLogs({ managerLogin } = {}) {
  const db = await readDb();
  return (db.auditLogs || [])
    .filter((row) => !managerLogin || row.managerLogin === managerLogin)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, 200);
}

export async function getTelegramSettings(login, options = {}) {
  const db = await readDb();
  const settings = (db.telegramSettings || {})[login] || defaultTelegramSettings(login);
  if (options.includePrivate) {
    return {
      ...settings,
      telegramSession: decryptTelegramSession(settings.telegramSession || ''),
    };
  }
  const { telegramSession, ...publicSettings } = settings;
  return publicSettings;
}

export async function upsertTelegramSettings(login, settings = {}) {
  const db = await readDb();
  db.telegramSettings ||= {};
  const current = db.telegramSettings[login] || defaultTelegramSettings(login);
  const clearSession = !!settings.clearTelegramSession;
  db.telegramSettings[login] = {
    ...current,
    telegramAccount: settings.telegramAccount ?? current.telegramAccount ?? '',
    telegramMode: settings.telegramMode || 'needed',
    telegramSessionStatus: clearSession ? 'not_configured' : (settings.telegramSession ? 'configured' : (settings.telegramSessionStatus || current.telegramSessionStatus || 'not_configured')),
    telegramSessionHint: clearSession ? '' : (settings.telegramSession ? sessionHint(settings.telegramSession) : (settings.telegramSessionHint || current.telegramSessionHint || '')),
    telegramSession: clearSession ? '' : (settings.telegramSession ? encryptTelegramSession(settings.telegramSession) : (current.telegramSession || '')),
    updatedAt: new Date().toISOString(),
  };
  await writeDb(db);
  const { telegramSession, ...publicSettings } = db.telegramSettings[login];
  return publicSettings;
}

async function readDb() {
  await migrate();
  return JSON.parse(await fs.readFile(dataFile, 'utf8'));
}

async function writeDb(db) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify({
    users: db.users?.length ? db.users : seedUsers,
    clients: db.clients || [],
    telegramMessages: db.telegramMessages || [],
    telegramInboxChats: db.telegramInboxChats || [],
    telegramInboxMessages: db.telegramInboxMessages || [],
    auditLogs: db.auditLogs || [],
    telegramSettings: db.telegramSettings || {},
  }, null, 2), 'utf8');
}

function normalizeUser(user) {
  const login = String(user.login || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return {
    login,
    name: user.name || login,
    city: user.city || '',
    role: user.role || 'CRM / менеджер',
    password: user.password || 'atom2024',
  };
}

function stripPassword(user) {
  const { password, ...rest } = user;
  return rest;
}

function defaultTelegramSettings(login) {
  return {
    managerLogin: login,
    telegramAccount: '',
    telegramMode: 'needed',
    telegramSessionStatus: 'not_configured',
    telegramSessionHint: '',
    updatedAt: '',
  };
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

function upsertMessages(db, clientId, messages = []) {
  for (const message of messages) {
    const normalized = {
      ...message,
      clientId,
      chatId: message.chatId || '',
      messageId: String(message.messageId || ''),
    };
    const index = db.telegramMessages.findIndex((item) =>
      String(item.clientId) === String(clientId)
      && String(item.chatId || '') === String(normalized.chatId)
      && String(item.messageId || '') === String(normalized.messageId)
    );
    if (index === -1) db.telegramMessages.push(normalized);
    else db.telegramMessages[index] = normalized;
  }
}

function replaceMessages(db, clientId, messages = []) {
  db.telegramMessages = (db.telegramMessages || []).filter((message) => String(message.clientId) !== String(clientId));
  upsertMessages(db, clientId, messages);
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
    createdAt: chat.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages,
  };
}

function normalizeClient(client) {
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
    updatedAt: new Date().toISOString(),
  };
}

function cleanTelegramUsername(value) {
  const username = String(value || '').trim();
  return isPlaceholderTelegramUsername(username) ? '' : username;
}

function isPlaceholderTelegramUsername(value) {
  return /^@?client_\d+$/i.test(String(value || '').trim());
}

function stripClientId(message) {
  const { clientId, ...rest } = message;
  return rest;
}
