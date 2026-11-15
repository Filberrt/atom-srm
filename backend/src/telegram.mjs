import input from 'input';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const telegramClients = new Map();
const telegramLoginFlows = new Map();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.resolve(__dirname, '../uploads');

export async function getTelegramClient(sessionOverride = '') {
  const apiId = Number(process.env.TELEGRAM_API_ID || 0);
  const apiHash = process.env.TELEGRAM_API_HASH || '';
  const sessionString = sessionOverride || process.env.TELEGRAM_SESSION || '';
  const clientOptions = telegramClientOptions();
  const proxyKey = clientOptions.proxy ? `${clientOptions.proxy.ip}:${clientOptions.proxy.port}` : 'direct';
  const cacheKey = `${sessionString || 'default'}:${clientOptions.useWSS ? 'wss' : 'tcp'}:${proxyKey}`;
  if (telegramClients.has(cacheKey)) return telegramClients.get(cacheKey);

  const session = new StringSession(sessionString);

  if (!apiId || !apiHash) {
    throw new Error('Set TELEGRAM_API_ID and TELEGRAM_API_HASH in backend .env');
  }

  if (!sessionString) {
    throw new Error('TELEGRAM_SESSION is empty. Run the old visible connector once, copy TELEGRAM_SESSION, and paste it into local_product/backend/.env.');
  }

  const telegramClient = new TelegramClient(session, apiId, apiHash, clientOptions);

  await telegramClient.start({
    phoneNumber: async () => input.text('Telegram phone: '),
    password: async () => input.text('2FA password, if enabled: '),
    phoneCode: async () => input.text('Telegram login code: '),
    onError: (error) => console.error(error),
  });

  console.log('Telegram session loaded.');

  telegramClients.set(cacheKey, telegramClient);
  return telegramClient;
}

export async function importClientTelegramHistory(client, limit = Number(process.env.TELEGRAM_HISTORY_LIMIT || 100), sessionOverride = '') {
  const tg = await getTelegramClient(sessionOverride);
  const dialogs = await tg.getDialogs({ limit: 500 });
  const target = await resolveTelegramTarget(tg, dialogs, client);

  if (!target) {
    throw new Error('Telegram chat not found. Fill real public @username or chat id.');
  }

  const { dialog, entity } = target;
  const chatId = String(entity.id || dialog?.id || client.telegramChat?.chatId || '');
  const title = dialog?.title || entity.title || formatPersonName(entity) || client.name || 'Telegram chat';
  const username = entity.username ? '@' + entity.username : client.telegramChat?.username || client.username || '';
  const messages = await tg.getMessages(entity, { limit });
  const telegramMessages = await Promise.all(messages
    .slice()
    .reverse()
    .filter((message) => message && (message.message || message.text || message.media || message.photo || message.document))
    .map(async (message) => {
      const attachment = await saveTelegramAttachment(tg, client.id, message);
      const body = String(message.message || message.text || '').trim();
      const text = body
        ? `${body}${attachment?.label ? `\n${attachment.label}` : ''}${attachment?.url ? `\nATTACHMENT:${attachment.url}` : ''}`
        : (attachment?.label ? `${attachment.label}${attachment?.url ? `\nATTACHMENT:${attachment.url}` : ''}` : '[Файл]');
      return {
        chatId,
        messageId: String(message.id || ''),
        date: message.date ? new Date(Number(message.date) * 1000).toISOString() : '',
        sender: message.out ? 'manager' : 'client',
        text: text.slice(0, 2000),
      };
    }));

  return {
    ...client,
    username: client.username || username,
    source: client.source || 'Telegram',
    telegramChat: {
      ...(client.telegramChat || {}),
      chatId,
      title,
      username,
      status: 'linked',
      lastMessageAt: telegramMessages.at(-1)?.date || '',
      lastMessageText: telegramMessages.at(-1)?.text || '',
    },
    telegramMessages,
  };
}

export async function importPrivateTelegramDialogs({
  dialogsLimit = 120,
  historyLimit = 30,
  sessionOverride = '',
  managerLogin = '',
} = {}) {
  const tg = await getTelegramClient(sessionOverride);
  const dialogs = await tg.getDialogs({ limit: Number(dialogsLimit || 120) });
  const privateDialogs = dialogs.filter(isPrivateHumanDialog);
  const chats = [];

  for (const dialog of privateDialogs) {
    const entity = dialog.entity || {};
    const chatId = String(entity.id || dialog.id || '');
    if (!chatId) continue;
    const title = formatPersonName(entity) || dialog.title || entity.username || `Telegram ${chatId}`;
    const username = entity.username ? `@${entity.username}` : '';
    const phone = entity.phone ? `+${entity.phone}` : '';
    const messages = await tg.getMessages(entity, { limit: Number(historyLimit || 30) });
    const normalizedMessages = await Promise.all(messages
      .slice()
      .reverse()
      .filter((message) => message && (message.message || message.text || message.media || message.photo || message.document))
      .map((message) => telegramMessageToRecord(tg, `inbox-${managerLogin || 'manager'}-${chatId}`, chatId, message)));
    chats.push({
      id: `${managerLogin || 'manager'}-${chatId}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
      managerLogin,
      chatId,
      title,
      username,
      phone,
      status: 'new',
      lastMessageAt: normalizedMessages.at(-1)?.date || '',
      lastMessageText: normalizedMessages.at(-1)?.text || '',
      messages: normalizedMessages,
    });
  }

  return chats;
}

export async function sendClientTelegramMessage(client, text, sessionOverride = '') {
  const messageText = String(text || '').trim();
  if (!messageText) {
    throw new Error('Message text is empty.');
  }

  const tg = await getTelegramClient(sessionOverride);
  const dialogs = await tg.getDialogs({ limit: 500 });
  const target = await resolveTelegramTarget(tg, dialogs, client);

  if (!target) {
    throw new Error('Telegram chat not found. Fill real public @username or chat id.');
  }

  const { dialog, entity } = target;
  const chatId = String(entity.id || dialog?.id || client.telegramChat?.chatId || '');
  const title = dialog?.title || entity.title || formatPersonName(entity) || client.name || 'Telegram chat';
  const username = entity.username ? '@' + entity.username : client.telegramChat?.username || client.username || '';
  const sent = await tg.sendMessage(entity, { message: messageText });
  const sentMessage = {
    chatId,
    messageId: String(sent?.id || Date.now()),
    date: new Date().toISOString(),
    sender: 'manager',
    text: messageText.slice(0, 2000),
  };

  return {
    telegramChat: {
      ...(client.telegramChat || {}),
      chatId,
      title,
      username,
      status: 'linked',
      lastMessageAt: sentMessage.date,
      lastMessageText: sentMessage.text,
    },
    sentMessage,
  };
}

async function telegramMessageToRecord(tg, ownerId, chatId, message) {
  const attachment = await saveTelegramAttachment(tg, ownerId, message);
  const body = String(message.message || message.text || '').trim();
  const text = body
    ? `${body}${attachment?.label ? `\n${attachment.label}` : ''}${attachment?.url ? `\nATTACHMENT:${attachment.url}` : ''}`
    : (attachment?.label ? `${attachment.label}${attachment?.url ? `\nATTACHMENT:${attachment.url}` : ''}` : '[Файл]');
  return {
    chatId,
    messageId: String(message.id || ''),
    date: message.date ? new Date(Number(message.date) * 1000).toISOString() : '',
    sender: message.out ? 'manager' : 'client',
    text: text.slice(0, 2000),
  };
}

export async function beginTelegramLogin(phoneNumber, login = '') {
  const apiId = Number(process.env.TELEGRAM_API_ID || 0);
  const apiHash = process.env.TELEGRAM_API_HASH || '';
  if (!apiId || !apiHash) {
    throw new Error('Set TELEGRAM_API_ID and TELEGRAM_API_HASH in backend .env');
  }

  const phone = String(phoneNumber || '').trim();
  if (!phone) throw new Error('Telegram phone is required.');

  cleanupTelegramLoginFlows();
  const session = new StringSession('');
  const client = new TelegramClient(session, apiId, apiHash, telegramClientOptions());
  await client.connect();
  const sent = await client.sendCode({ apiId, apiHash }, phone);
  const flowId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  telegramLoginFlows.set(flowId, {
    client,
    session,
    login,
    phone,
    phoneCodeHash: sent.phoneCodeHash,
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  return {
    flowId,
    phone,
    isCodeViaApp: !!sent.isCodeViaApp,
    expiresInSec: 600,
  };
}

export async function completeTelegramLogin(flowId, code = '', password = '') {
  cleanupTelegramLoginFlows();
  const flow = telegramLoginFlows.get(String(flowId || ''));
  if (!flow) throw new Error('Telegram auth flow expired. Send code again.');

  const apiId = Number(process.env.TELEGRAM_API_ID || 0);
  const apiHash = process.env.TELEGRAM_API_HASH || '';
  try {
    if (password) {
      await flow.client.signInWithPassword({ apiId, apiHash }, {
        password: async () => String(password),
        onError: () => true,
      });
    } else {
      const phoneCode = String(code || '').trim();
      if (!phoneCode) throw new Error('Telegram code is required.');
      try {
        const result = await flow.client.invoke(new Api.auth.SignIn({
          phoneNumber: flow.phone,
          phoneCodeHash: flow.phoneCodeHash,
          phoneCode,
        }));
        if (result instanceof Api.auth.AuthorizationSignUpRequired) {
          throw new Error('This phone is not registered in Telegram.');
        }
      } catch (error) {
        if (error?.errorMessage === 'SESSION_PASSWORD_NEEDED') {
          return { needsPassword: true };
        }
        throw error;
      }
    }

    const me = await flow.client.getMe();
    const sessionString = flow.session.save();
    if (!sessionString) throw new Error('Telegram session was not created.');
    telegramLoginFlows.delete(String(flowId || ''));
    await flow.client.disconnect();
    return {
      needsPassword: false,
      sessionString,
      profile: {
        id: String(me?.id || ''),
        username: me?.username ? `@${me.username}` : '',
        phone: me?.phone ? `+${me.phone}` : flow.phone,
        name: [me?.firstName, me?.lastName].filter(Boolean).join(' '),
      },
    };
  } catch (error) {
    if (!password && error?.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      return { needsPassword: true };
    }
    throw error;
  }
}

function findDialogForClient(dialogs, client) {
  const chat = client.telegramChat || {};
  const wantedChatId = String(chat.chatId || '');
  const wantedUsername = normalizeSafeUsername(chat.username || client.username || '');

  return dialogs.find((dialog) => {
    const entity = dialog.entity || {};
    const chatId = String(entity.id || dialog.id || '');
    const username = normalizeUsername(entity.username || '');

    return (wantedChatId && chatId === wantedChatId)
      || (wantedUsername && username === wantedUsername);
  });
}

function isPrivateHumanDialog(dialog) {
  const entity = dialog?.entity || {};
  const className = String(entity.className || dialog?.className || '');
  if (className !== 'User') return false;
  if (entity.bot || entity.deleted || entity.self) return false;
  return !!(entity.id || dialog.id);
}

async function resolveTelegramTarget(tg, dialogs, client) {
  const dialog = findDialogForClient(dialogs, client);
  if (dialog) return { dialog, entity: dialog.entity || {} };

  const chat = client.telegramChat || {};
  const wantedUsername = normalizeSafeUsername(chat.username || client.username || '');
  if (wantedUsername) {
    const entity = await tryGetTelegramEntity(tg, `@${wantedUsername}`);
    if (entity) return { dialog: null, entity };
  }

  const wantedChatId = String(chat.chatId || '').trim();
  if (wantedChatId) {
    const entity = await tryGetTelegramEntity(tg, wantedChatId);
    if (entity) return { dialog: null, entity };
  }

  return null;
}

async function tryGetTelegramEntity(tg, value) {
  try {
    return await tg.getEntity(value);
  } catch {
    return null;
  }
}

function normalizeUsername(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function normalizeSafeUsername(value) {
  const username = normalizeUsername(value);
  if (!username || /^client_\d+$/.test(username)) return '';
  return username;
}

function telegramClientOptions() {
  const proxy = telegramProxyOptions();
  const options = {
    connectionRetries: Number(process.env.TELEGRAM_CONNECTION_RETRIES || 10),
    reconnectRetries: Number(process.env.TELEGRAM_RECONNECT_RETRIES || 20),
    retryDelay: Number(process.env.TELEGRAM_RETRY_DELAY_MS || 1000),
    autoReconnect: true,
    useWSS: proxy ? false : isEnvEnabled(process.env.TELEGRAM_USE_WSS),
  };
  if (proxy) options.proxy = proxy;
  return options;
}

function telegramProxyOptions() {
  const host = String(process.env.TELEGRAM_PROXY_HOST || '').trim();
  const port = Number(process.env.TELEGRAM_PROXY_PORT || 0);
  if (!host || !port) return null;
  return {
    ip: host,
    port,
    socksType: Number(process.env.TELEGRAM_PROXY_SOCKS_TYPE || 5),
    username: process.env.TELEGRAM_PROXY_USER || undefined,
    password: process.env.TELEGRAM_PROXY_PASS || undefined,
    timeout: Number(process.env.TELEGRAM_PROXY_TIMEOUT_SEC || 10),
  };
}

function isEnvEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function formatPersonName(entity) {
  return [entity.firstName, entity.lastName].filter(Boolean).join(' ');
}

async function saveTelegramAttachment(tg, clientId, message) {
  const attachment = describeTelegramAttachment(message);
  if (!attachment) return null;

  const size = attachment.size ? Number(attachment.size) : 0;
  const maxBytes = Number(process.env.TELEGRAM_ATTACHMENT_MAX_MB || 15) * 1024 * 1024;
  if (size && size > maxBytes) return attachment;

  try {
    await fs.mkdir(uploadsDir, { recursive: true });
    const source = message.media || message.document || message.photo;
    const bytes = await tg.downloadMedia(source, { workers: 1 });
    if (!bytes) return attachment;
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const safeClientId = safeFilePart(clientId || 'client');
    const safeMessageId = safeFilePart(message.id || Date.now());
    const fileName = safeFilePart(attachment.name || `${attachment.type}-${safeMessageId}${attachment.ext}`);
    const finalName = `${safeClientId}-${safeMessageId}-${fileName}`;
    await fs.writeFile(path.join(uploadsDir, finalName), buffer);
    return {
      ...attachment,
      url: `/uploads/${finalName}`,
    };
  } catch {
    return attachment;
  }
}

function describeTelegramAttachment(message) {
  const media = message.media || {};
  const document = message.document || media.document;
  const photo = message.photo || media.photo;

  if (photo || media.className === 'MessageMediaPhoto') {
    return { type: 'photo', label: '[Фото]', name: 'photo.jpg', ext: '.jpg', mime: 'image/jpeg' };
  }

  if (document) {
    const mime = String(document.mimeType || '').toLowerCase();
    const name = documentFileName(document);
    const ext = extensionFromNameOrMime(name, mime);
    if (mime.startsWith('image/')) return { type: 'photo', label: `[Фото${name ? `: ${name}` : ''}]`, name: name || `photo${ext}`, ext, mime, size: document.size };
    if (mime.startsWith('video/')) return { type: 'video', label: `[Видео${name ? `: ${name}` : ''}]`, name: name || `video${ext}`, ext, mime, size: document.size };
    if (mime.startsWith('audio/')) return { type: 'audio', label: `[Аудио${name ? `: ${name}` : ''}]`, name: name || `audio${ext}`, ext, mime, size: document.size };
    return { type: 'file', label: `[Файл${name ? `: ${name}` : ''}]`, name: name || `file${ext}`, ext, mime, size: document.size };
  }

  if (media.className) {
    return { type: 'file', label: `[Файл: ${media.className}]`, name: 'telegram-file.bin', ext: '.bin', mime: 'application/octet-stream' };
  }

  return null;
}

function documentFileName(document) {
  const attrs = Array.isArray(document.attributes) ? document.attributes : [];
  const attr = attrs.find((item) => item?.fileName);
  return attr?.fileName || '';
}

function extensionFromNameOrMime(name, mime) {
  const fromName = path.extname(String(name || '')).toLowerCase();
  if (fromName) return fromName;
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'video/mp4') return '.mp4';
  if (mime === 'audio/mpeg') return '.mp3';
  if (mime === 'application/pdf') return '.pdf';
  return '.bin';
}

function safeFilePart(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9а-яА-Я._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'file';
}

function cleanupTelegramLoginFlows() {
  const now = Date.now();
  for (const [flowId, flow] of telegramLoginFlows.entries()) {
    if (flow.expiresAt <= now) {
      telegramLoginFlows.delete(flowId);
      flow.client?.disconnect?.().catch?.(() => {});
    }
  }
}
