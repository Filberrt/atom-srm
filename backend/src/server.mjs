import 'dotenv/config';
import http from 'node:http';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  getClient,
  getUser,
  listUsers,
  upsertUser,
  updateUserPassword,
  deleteUser,
  deleteClient,
  listClients,
  listMessages,
  listTelegramInboxChats,
  upsertTelegramInboxChats,
  deleteTelegramInboxChat,
  updateTelegramInboxChatStatus,
  migrate,
  closeDb,
  upsertClient,
  upsertClients,
  addAuditLog,
  listAuditLogs,
  getTelegramSettings,
  upsertTelegramSettings,
} from './db-router.mjs';
import {
  beginTelegramLogin,
  completeTelegramLogin,
  importClientTelegramHistory,
  importPrivateTelegramDialogs,
  sendClientTelegramMessage,
} from './telegram.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const defaultAuthSecret = 'atom-local-dev-secret-change-on-server';
const authSecret = process.env.AUTH_SECRET || defaultAuthSecret;
const isProduction = process.env.NODE_ENV === 'production';
const tokenTtlMs = Number(process.env.AUTH_TOKEN_TTL_HOURS || 12) * 60 * 60 * 1000;
const loginRateWindowMs = Number(process.env.AUTH_LOGIN_RATE_WINDOW_MS || 15 * 60 * 1000);
const loginRateMax = Number(process.env.AUTH_LOGIN_RATE_MAX || 10);
const loginAttempts = new Map();
const wsClients = new Map();
let wsTelegramBusy = false;
let wsSlowTick = 0;
const execFileAsync = promisify(execFile);

if (isProduction && authSecret === defaultAuthSecret) {
  throw new Error('AUTH_SECRET must be set in production');
}

await migrate();

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/health') {
      return sendJson(res, { ok: true, service: 'Атом SRM backend' }, 200, { head: req.method === 'HEAD' });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
      const uploadUser = await requestUser(req);
      if (!uploadUser) return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      return serveUpload(url.pathname, res);
    }

    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = await readJson(req);
      const attemptKey = loginAttemptKey(req, body.login);
      const attemptStatus = loginAttemptStatus(attemptKey);
      if (attemptStatus.blocked) {
        return sendJson(
          res,
          { ok: false, error: 'Too many login attempts' },
          429,
          { headers: { 'Retry-After': String(Math.ceil(attemptStatus.retryAfterMs / 1000)) } }
        );
      }
      const user = await getUser(String(body.login || '').trim().toLowerCase());
      if (!user || !verifyPassword(String(body.password || ''), user.password)) {
        recordFailedLogin(attemptKey);
        return sendJson(res, { ok: false, error: 'Invalid login or password' }, 401);
      }
      clearLoginAttempts(attemptKey);
      if (!isPasswordHash(user.password)) {
        await updateUserPassword(user.login, hashPassword(String(body.password || '')));
      }

      const token = signToken({ login: user.login, ts: Date.now() });
      return sendJson(res, {
        ok: true,
        token,
        profile: {
          login: user.login,
          name: user.name,
          city: user.city,
          role: user.role,
        },
      }, 200, { headers: authCookieHeader(token) });
    }

    if (req.method === 'POST' && url.pathname === '/api/logout') {
      return sendJson(res, { ok: true }, 200, { headers: clearAuthCookieHeader() });
    }

    if (req.method === 'GET' && url.pathname === '/api/clients') {
      const user = await requestUser(req);
      if (!user) return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      const allClients = await listClients();
      const clients = isBossUser(user)
        ? allClients
        : allClients.filter((client) => String(client.assignedTo || '') === String(user.login));
      return sendJson(res, { ok: true, clients });
    }

    if (req.method === 'GET' && url.pathname === '/api/vps/warp') {
      const user = await requestUser(req);
      if (!user) return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      return sendJson(res, { ok: true, warp: await warpStatus() });
    }

    const clientDeleteMatch = url.pathname.match(/^\/api\/clients\/([^/]+)$/);
    if (req.method === 'DELETE' && clientDeleteMatch) {
      const user = await requestUser(req);
      if (!user) return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      const id = decodeURIComponent(clientDeleteMatch[1]);
      const client = await getClient(id);
      if (!client) return sendJson(res, { ok: false, error: 'Client not found' }, 404);
      if (!isBossUser(user) && String(client.assignedTo || '') !== String(user.login)) {
        return sendJson(res, { ok: false, error: 'Forbidden' }, 403);
      }
      await deleteClient(id);
      await addAuditLog({
        managerLogin: user.login,
        clientId: id,
        clientName: client.name || '',
        action: 'Удалил клиента',
        details: client.username || client.phone || '',
      });
      return sendJson(res, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/users') {
      const user = await requireBoss(req, res);
      if (!user) return;
      return sendJson(res, { ok: true, users: await listUsers() });
    }

    if (req.method === 'POST' && url.pathname === '/api/users') {
      const user = await requireBoss(req, res);
      if (!user) return;
      const body = await readJson(req);
      const login = String(body.login || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const existing = login ? await getUser(login) : null;
      if (!login) return sendJson(res, { ok: false, error: 'Login is required' }, 400);
      if (!existing && (!body.password || String(body.password).length < 4)) {
        return sendJson(res, { ok: false, error: 'Password is required for a new user' }, 400);
      }
      if (body.password && String(body.password).length < 4) {
        return sendJson(res, { ok: false, error: 'Password is too short' }, 400);
      }
      const saved = await upsertUser({
        ...body,
        password: body.password ? hashPassword(String(body.password)) : '',
      });
      await addAuditLog({
        managerLogin: user.login,
        action: body.password ? 'Создал/обновил учетку' : 'Обновил учетку',
        details: saved.login,
      });
      return sendJson(res, { ok: true, user: saved });
    }

    const userPasswordMatch = url.pathname.match(/^\/api\/users\/([^/]+)\/password$/);
    if (req.method === 'PATCH' && userPasswordMatch) {
      const user = await requireBoss(req, res);
      if (!user) return;
      const login = decodeURIComponent(userPasswordMatch[1]).trim().toLowerCase();
      const body = await readJson(req);
      if (!body.password || String(body.password).length < 4) {
        return sendJson(res, { ok: false, error: 'Password is too short' }, 400);
      }
      const saved = await updateUserPassword(login, hashPassword(String(body.password)));
      if (!saved) return sendJson(res, { ok: false, error: 'User not found' }, 404);
      await addAuditLog({ managerLogin: user.login, action: 'Сменил пароль менеджеру', details: login });
      return sendJson(res, { ok: true, user: saved });
    }

    const userDeleteMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
    if (req.method === 'DELETE' && userDeleteMatch) {
      const user = await requireBoss(req, res);
      if (!user) return;
      const login = decodeURIComponent(userDeleteMatch[1]).trim().toLowerCase();
      if (login === 'boss') return sendJson(res, { ok: false, error: 'Boss cannot be deleted' }, 400);
      await deleteUser(login);
      await addAuditLog({ managerLogin: user.login, action: 'Удалил учетку', details: login });
      return sendJson(res, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/audit-log') {
      const user = await requestUser(req);
      if (!user) return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      const logs = await listAuditLogs(isBossUser(user) ? {} : { managerLogin: user.login });
      return sendJson(res, { ok: true, logs });
    }

    if (req.method === 'POST' && url.pathname === '/api/audit-log') {
      const user = await requestUser(req);
      if (!user) return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      const body = await readJson(req);
      const saved = await addAuditLog({
        ...body,
        managerLogin: user.login,
      });
      return sendJson(res, { ok: true, log: saved });
    }

    if (req.method === 'GET' && url.pathname === '/api/telegram-settings') {
      const user = await requestUser(req);
      if (!user) return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      const users = isBossUser(user) ? await listUsers() : [user];
      const settings = [];
      for (const item of users) settings.push(await getTelegramSettings(item.login));
      return sendJson(res, { ok: true, settings });
    }

    if (req.method === 'GET' && url.pathname === '/api/telegram-inbox') {
      const user = await requestUser(req);
      if (!user) return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      const chats = await listTelegramInboxChats({
        managerLogin: user.login,
        includeAll: isBossUser(user),
      });
      return sendJson(res, { ok: true, chats });
    }

    if (req.method === 'POST' && url.pathname === '/api/telegram-inbox/import-private') {
      const user = await requestUser(req);
      if (!user) return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      const body = await readJson(req);
      const session = await managerTelegramSession(user.login);
      if (!session) {
        return sendJson(res, { ok: false, error: 'Telegram is not connected for this account' }, 400);
      }
      const imported = await importPrivateTelegramDialogs({
        dialogsLimit: Number(body.dialogsLimit || 120),
        historyLimit: Number(body.historyLimit || 30),
        sessionOverride: session,
        managerLogin: user.login,
      });
      const saved = await upsertTelegramInboxChats(user.login, imported);
      await addAuditLog({
        managerLogin: user.login,
        action: 'Импортировал личные Telegram-чаты',
        details: `${saved.length} чатов`,
      });
      return sendJson(res, { ok: true, chats: saved, chatsCount: saved.length });
    }

    const telegramInboxDeleteMatch = url.pathname.match(/^\/api\/telegram-inbox\/([^/]+)$/);
    if (req.method === 'DELETE' && telegramInboxDeleteMatch) {
      const user = await requestUser(req);
      if (!user) return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      const id = decodeURIComponent(telegramInboxDeleteMatch[1]);
      const deleted = await deleteTelegramInboxChat(id, {
        managerLogin: user.login,
        includeAll: isBossUser(user),
      });
      if (!deleted) return sendJson(res, { ok: false, error: 'Telegram chat not found' }, 404);
      await addAuditLog({ managerLogin: user.login, action: 'Удалил Telegram-чат из inbox', details: id });
      return sendJson(res, { ok: true });
    }

    const telegramInboxStatusMatch = url.pathname.match(/^\/api\/telegram-inbox\/([^/]+)\/status$/);
    if (req.method === 'PATCH' && telegramInboxStatusMatch) {
      const user = await requestUser(req);
      if (!user) return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      const id = decodeURIComponent(telegramInboxStatusMatch[1]);
      const body = await readJson(req);
      const status = String(body.status || 'new').trim().toLowerCase();
      if (!['new', 'active', 'archived'].includes(status)) {
        return sendJson(res, { ok: false, error: 'Invalid chat status' }, 400);
      }
      const chat = await updateTelegramInboxChatStatus(id, status, {
        managerLogin: user.login,
        includeAll: isBossUser(user),
      });
      if (!chat) return sendJson(res, { ok: false, error: 'Telegram chat not found' }, 404);
      await addAuditLog({
        managerLogin: user.login,
        action: status === 'archived' ? 'Отправил Telegram-чат в архив' : 'Вернул Telegram-чат из архива',
        details: chat.title || chat.username || id,
      });
      return sendJson(res, { ok: true, chat });
    }

    const telegramSettingsMatch = url.pathname.match(/^\/api\/telegram-settings\/([^/]+)$/);
    if (req.method === 'PUT' && telegramSettingsMatch) {
      const user = await requestUser(req);
      if (!user) return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      const login = decodeURIComponent(telegramSettingsMatch[1]).trim().toLowerCase();
      if (login !== user.login) {
        return sendJson(res, { ok: false, error: 'Forbidden' }, 403);
      }
      const body = await readJson(req);
      const saved = await upsertTelegramSettings(login, body);
      await addAuditLog({ managerLogin: user.login, action: 'Обновил Telegram-настройки', details: login });
      return sendJson(res, { ok: true, settings: saved });
    }

    const telegramSessionDeleteMatch = url.pathname.match(/^\/api\/telegram-settings\/([^/]+)\/session$/);
    if (req.method === 'DELETE' && telegramSessionDeleteMatch) {
      const user = await requestUser(req);
      if (!user) return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      const login = decodeURIComponent(telegramSessionDeleteMatch[1]).trim().toLowerCase();
      if (login !== user.login) {
        return sendJson(res, { ok: false, error: 'Forbidden' }, 403);
      }
      const current = await getTelegramSettings(login);
      const saved = await upsertTelegramSettings(login, {
        telegramAccount: current.telegramAccount || '',
        telegramMode: current.telegramMode || 'needed',
        clearTelegramSession: true,
      });
      await addAuditLog({ managerLogin: user.login, action: 'Отвязал Telegram-сессию', details: login });
      return sendJson(res, { ok: true, settings: saved });
    }

    const telegramAuthStartMatch = url.pathname.match(/^\/api\/telegram-auth\/([^/]+)\/start$/);
    if (req.method === 'POST' && telegramAuthStartMatch) {
      const user = await requestUser(req);
      if (!user) return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      const login = decodeURIComponent(telegramAuthStartMatch[1]).trim().toLowerCase();
      if (login !== user.login) {
        return sendJson(res, { ok: false, error: 'Forbidden' }, 403);
      }
      const body = await readJson(req);
      if (!String(body.phone || '').trim()) {
        return sendJson(res, { ok: false, error: 'Telegram phone is required' }, 400);
      }
      const flow = await beginTelegramLogin(body.phone, login);
      await addAuditLog({ managerLogin: user.login, action: 'Запросил Telegram-код', details: login });
      return sendJson(res, { ok: true, ...flow });
    }

    const telegramAuthCompleteMatch = url.pathname.match(/^\/api\/telegram-auth\/([^/]+)\/complete$/);
    if (req.method === 'POST' && telegramAuthCompleteMatch) {
      const user = await requestUser(req);
      if (!user) return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      const login = decodeURIComponent(telegramAuthCompleteMatch[1]).trim().toLowerCase();
      if (login !== user.login) {
        return sendJson(res, { ok: false, error: 'Forbidden' }, 403);
      }
      const body = await readJson(req);
      if (!String(body.flowId || '').trim()) {
        return sendJson(res, { ok: false, error: 'Telegram auth flow is required' }, 400);
      }
      if (!String(body.code || '').trim() && !String(body.password || '').trim()) {
        return sendJson(res, { ok: false, error: 'Telegram code is required' }, 400);
      }
      const auth = await completeTelegramLogin(body.flowId, body.code, body.password);
      if (auth.needsPassword) return sendJson(res, { ok: true, needsPassword: true });

      const current = await getTelegramSettings(login);
      const account = auth.profile?.username || auth.profile?.phone || current.telegramAccount || '';
      const saved = await upsertTelegramSettings(login, {
        telegramAccount: account,
        telegramSession: auth.sessionString,
      });
      await addAuditLog({ managerLogin: user.login, action: 'Подключил Telegram-сессию', details: login });
      return sendJson(res, { ok: true, needsPassword: false, settings: saved, telegramProfile: auth.profile });
    }

    if (req.method === 'PUT' && url.pathname === '/api/sync/clients') {
      const user = await requestUser(req);
      if (!user) return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      const body = await readJson(req);
      const clients = [];
      for (const client of (Array.isArray(body.clients) ? body.clients : [])) {
        if (isBossUser(user)) {
          clients.push(client);
          continue;
        }
        const existing = client?.id ? await getClient(client.id) : null;
        if (existing && !canUseClient(user, existing)) continue;
        clients.push({ ...client, assignedTo: user.login });
      }
      const saved = await upsertClients(clients);
      return sendJson(res, { ok: true, clientsCount: saved.length });
    }

    const linkMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/link-telegram$/);
    if (req.method === 'POST' && linkMatch) {
      const user = await requestUser(req);
      if (!user) return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      const id = decodeURIComponent(linkMatch[1]);
      const body = await readJson(req);
      const current = await getClient(id);
      if (current && !canUseClient(user, current)) {
        return sendJson(res, { ok: false, error: 'Forbidden' }, 403);
      }
      const client = {
        ...(current || {}),
        ...(body.client || {}),
        id,
        assignedTo: current?.assignedTo || body.client?.assignedTo || user.login,
      };
      if (!canUseClient(user, client)) {
        return sendJson(res, { ok: false, error: 'Forbidden' }, 403);
      }
      const imported = await importClientTelegramHistory(client, Number(body.historyLimit || 100), await telegramSessionForClient(client, user));
      const saved = await upsertClient(imported);
      return sendJson(res, {
        ok: true,
        client: saved,
        messagesCount: saved.telegramMessages?.length || 0,
      });
    }

    const sendTelegramMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/send-telegram$/);
    if (req.method === 'POST' && sendTelegramMatch) {
      const user = await requestUser(req);
      if (!user) return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      const id = decodeURIComponent(sendTelegramMatch[1]);
      const body = await readJson(req);
      const current = await getClient(id);
      if (current && !canUseClient(user, current)) {
        return sendJson(res, { ok: false, error: 'Forbidden' }, 403);
      }
      const client = {
        ...(current || {}),
        ...(body.client || {}),
        id,
        assignedTo: current?.assignedTo || body.client?.assignedTo || user.login,
      };
      if (!canUseClient(user, client)) {
        return sendJson(res, { ok: false, error: 'Forbidden' }, 403);
      }
      const sent = await sendClientTelegramMessage(client, body.text, await telegramSessionForClient(client, user));
      const saved = await upsertClient({
        ...client,
        telegramChat: sent.telegramChat,
        telegramMessages: [
          ...(client.telegramMessages || []),
          sent.sentMessage,
        ],
      });
      await addAuditLog({
        managerLogin: user.login,
        clientId: saved.id,
        clientName: saved.name,
        action: 'Отправил Telegram',
        details: String(body.text || '').slice(0, 120),
      });
      return sendJson(res, {
        ok: true,
        client: saved,
        sentMessage: sent.sentMessage,
      });
    }

    const messagesMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/messages$/);
    if (req.method === 'GET' && messagesMatch) {
      const user = await requestUser(req);
      if (!user) return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      const id = decodeURIComponent(messagesMatch[1]);
      const client = await getClient(id);
      if (!canUseClient(user, client)) {
        return sendJson(res, { ok: false, error: 'Forbidden' }, 403);
      }
      const messages = await listMessages(id);
      return sendJson(res, { ok: true, messages });
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveFrontend(url.pathname, res, { head: req.method === 'HEAD' });
    }

    sendJson(res, { ok: false, error: 'Not found' }, 404);
  } catch (error) {
    console.error(error);
    const message = isProduction ? 'Internal server error' : String(error && error.message ? error.message : error);
    sendJson(res, { ok: false, error: message }, 500);
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (req, socket, head) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const payload = verifyToken(webSocketAuthToken(req, url));
    const user = payload?.login ? await getUser(String(payload.login).trim().toLowerCase()) : null;
    if (!user) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, stripPassword(user));
    });
  } catch {
    socket.destroy();
  }
});

wss.on('connection', (ws, req, user) => {
  wsClients.set(ws, {
    user,
    activeClientId: '',
    visibleClientIds: [],
    visibleCursor: 0,
  });
  wsSend(ws, { type: 'connected', login: user.login });

  ws.on('message', (raw) => {
    let message = null;
    try {
      message = JSON.parse(String(raw || '{}'));
    } catch {
      return;
    }
    if (message.type === 'watch-chats') {
      const state = wsClients.get(ws);
      if (!state) return;
      state.activeClientId = String(message.activeClientId || '');
      state.visibleClientIds = Array.isArray(message.visibleClientIds)
        ? [...new Set(message.visibleClientIds.map((id) => String(id || '')).filter(Boolean))].slice(0, 80)
        : [];
      pollWatchedTelegramChats(true).catch((error) => {
        wsSend(ws, { type: 'telegram-error', clientId: state.activeClientId, error: error.message });
      });
    }
  });

  ws.on('close', () => {
    wsClients.delete(ws);
  });
});

setInterval(() => {
  pollWatchedTelegramChats().catch((error) => {
    console.warn('WebSocket Telegram poll failed:', error.message);
  });
}, Number(process.env.TELEGRAM_WS_POLL_MS || 5000));

server.listen(port, process.env.HOST || '127.0.0.1', () => {
  const host = process.env.HOST || '127.0.0.1';
  console.log(`Атом SRM backend: http://${host}:${port}`);
  console.log(`Frontend: http://${host}:${port}/`);
});

process.on('SIGINT', async () => {
  await closeDb();
  process.exit(0);
});

async function serveFrontend(urlPath, res, options = {}) {
  const frontendDir = path.resolve(__dirname, '../../frontend');
  const safePath = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.normalize(path.join(frontendDir, safePath));

  if (!filePath.startsWith(frontendDir)) {
    return sendJson(res, { ok: false, error: 'Forbidden' }, 403);
  }

  try {
    const stat = await fs.stat(filePath);
    res.writeHead(200, {
      'Content-Type': contentType(filePath),
      'Content-Length': stat.size,
      ...securityHeaders(),
    });
    if (options.head) return res.end();
    createReadStream(filePath).pipe(res);
  } catch {
    sendJson(res, { ok: false, error: 'Not found' }, 404);
  }
}

async function serveUpload(urlPath, res) {
  const uploadsDir = path.resolve(__dirname, '../uploads');
  const requested = decodeURIComponent(urlPath.replace(/^\/uploads\//, ''));
  const filePath = path.resolve(uploadsDir, requested);

  if (!filePath.startsWith(uploadsDir + path.sep)) {
    res.writeHead(403, securityHeaders());
    res.end('Forbidden');
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    res.writeHead(200, {
      'Content-Type': contentType(filePath),
      'Content-Length': stat.size,
      'Cache-Control': 'private, max-age=86400',
      ...securityHeaders(),
    });
    createReadStream(filePath).pipe(res);
  } catch {
    sendJson(res, { ok: false, error: 'Not found' }, 404);
  }
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg';
  if (filePath.endsWith('.webp')) return 'image/webp';
  if (filePath.endsWith('.gif')) return 'image/gif';
  if (filePath.endsWith('.pdf')) return 'application/pdf';
  if (filePath.endsWith('.mp4')) return 'video/mp4';
  if (filePath.endsWith('.mp3')) return 'audio/mpeg';
  return 'application/octet-stream';
}

function stripPassword(user) {
  if (!user) return null;
  const { password, ...safe } = user;
  return safe;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const iterations = 210_000;
  const digest = 'sha256';
  const hash = crypto.pbkdf2Sync(String(password || ''), salt, iterations, 32, digest).toString('base64url');
  return `pbkdf2$${digest}$${iterations}$${salt}$${hash}`;
}

function isPasswordHash(value) {
  return /^pbkdf2\$sha256\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(String(value || ''));
}

function verifyPassword(password, stored) {
  const value = String(stored || '');
  if (!isPasswordHash(value)) return value === String(password || '');
  const [, digest, iterationText, salt, expected] = value.split('$');
  const iterations = Number(iterationText);
  if (!iterations || !salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(String(password || ''), salt, iterations, 32, digest).toString('base64url');
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function wsSend(ws, payload) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify(payload));
}

async function pollWatchedTelegramChats(forceActiveOnly = false) {
  if (wsTelegramBusy || !wsClients.size) return;
  wsTelegramBusy = true;
  try {
    wsSlowTick += 1;
    const jobs = [];
    const seen = new Set();

    for (const state of wsClients.values()) {
      if (state.activeClientId) addWsJob(jobs, seen, state.user, state.activeClientId, 'active');
    }

    if (!forceActiveOnly) {
      for (const state of wsClients.values()) {
        const ids = state.visibleClientIds || [];
        if (!ids.length) continue;
        const batch = [];
        for (let i = 0; i < Math.min(8, ids.length); i += 1) {
          batch.push(ids[(state.visibleCursor + i) % ids.length]);
        }
        state.visibleCursor = (state.visibleCursor + batch.length) % ids.length;
        for (const id of batch) addWsJob(jobs, seen, state.user, id, 'visible');
      }
    }

    for (const job of jobs.slice(0, 12)) {
      await refreshTelegramClientForWs(job).catch((error) => {
        broadcastWsError(job.clientId, job.user, error);
      });
    }
  } finally {
    wsTelegramBusy = false;
  }
}

function addWsJob(jobs, seen, user, clientId, reason) {
  const key = `${user.login}:${clientId}`;
  if (seen.has(key)) return;
  seen.add(key);
  jobs.push({ user, clientId, reason });
}

async function refreshTelegramClientForWs(job) {
  const current = await getClient(job.clientId);
  if (!canUseClient(job.user, current)) return;
  const session = await telegramSessionForClient(current, job.user);
  if (!session) return;
  const beforeKeys = new Set((current.telegramMessages || []).map(messageKey));
  const imported = await importClientTelegramHistory(current, 40, session);
  const saved = await upsertClient(imported);
  const newMessages = (saved.telegramMessages || []).filter((message) => !beforeKeys.has(messageKey(message)));
  if (!newMessages.length) return;

  for (const [ws, state] of wsClients.entries()) {
    if (!canUseClient(state.user, saved)) continue;
    const watchesClient = state.activeClientId === saved.id || (state.visibleClientIds || []).includes(saved.id);
    if (!watchesClient) continue;
    wsSend(ws, {
      type: 'telegram-update',
      reason: job.reason,
      client: saved,
      messages: newMessages,
      incomingCount: newMessages.filter((message) => String(message.sender) !== 'manager').length,
    });
  }
}

function messageKey(message) {
  return `${message.chatId || ''}:${message.messageId || ''}:${message.date || ''}:${message.text || ''}`;
}

function broadcastWsError(clientId, user, error) {
  for (const [ws, state] of wsClients.entries()) {
    if (state.user.login !== user.login) continue;
    if (state.activeClientId !== clientId) continue;
    wsSend(ws, {
      type: 'telegram-error',
      clientId,
      error: String(error?.message || error),
    });
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10_000_000) {
        reject(new Error('Request body is too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, data, statusCode = 200, options = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...securityHeaders(),
    ...(options.headers || {}),
  });
  res.end(options.head ? undefined : JSON.stringify(data));
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || 'https://crm.atomexchange.ru');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

async function warpStatus() {
  const status = {
    installed: false,
    connected: false,
    provider: '',
    proxyPort: Number(process.env.TELEGRAM_PROXY_PORT || 0) || null,
    warpOn: false,
    telegramReachable: false,
    telegramCheck: '',
    statusText: '',
    trace: {},
    checkedAt: new Date().toISOString(),
  };

  try {
    const { stdout } = await execFileAsync('systemctl', ['is-active', 'sing-box-happ.service'], { timeout: 6000 });
    status.provider = 'Happ / sing-box';
    status.installed = true;
    status.connected = String(stdout || '').trim() === 'active';
    status.statusText = `sing-box-happ.service: ${String(stdout || '').trim() || 'unknown'}`;
  } catch {
    // Fall back to the old WARP check when Happ/sing-box is not installed.
  }

  if (!status.installed) try {
    const { stdout } = await execFileAsync('warp-cli', ['--accept-tos', '--no-ansi', 'status'], { timeout: 6000 });
    status.provider = 'Cloudflare WARP';
    status.installed = true;
    status.statusText = String(stdout || '').trim();
    status.connected = /Connected/i.test(status.statusText);
  } catch (error) {
    status.statusText = error?.code === 'ENOENT'
      ? 'VPN-клиент не установлен'
      : String(error?.stderr || error?.message || error);
    return status;
  }

  if (!status.proxyPort) return status;

  try {
    const { stdout } = await execFileAsync('curl', [
      '-m',
      '8',
      '--socks5-hostname',
      `127.0.0.1:${status.proxyPort}`,
      '-s',
      'https://www.cloudflare.com/cdn-cgi/trace',
    ], { timeout: 10000 });
    const trace = parseTrace(stdout);
    status.trace = trace;
    status.warpOn = trace.warp === 'on';
    status.telegramReachable = await canReachTelegramViaProxy(status.proxyPort);
    status.telegramCheck = status.telegramReachable
      ? `Telegram MTProto доступен через ${status.provider} proxy`
      : `Telegram MTProto недоступен через ${status.provider} proxy`;
  } catch (error) {
    status.trace = { error: String(error?.stderr || error?.message || error) };
    status.telegramCheck = 'Не удалось проверить VPN proxy';
  }

  return status;
}

async function canReachTelegramViaProxy(proxyPort) {
  const targets = [
    'telnet://149.154.167.91:80',
    'telnet://149.154.167.91:443',
    'telnet://149.154.167.50:443',
  ];
  for (const target of targets) {
    try {
      await execFileAsync('curl', [
        '-v',
        '-m',
        '6',
        '--socks5-hostname',
        `127.0.0.1:${proxyPort}`,
        '-s',
        target,
      ], { timeout: 8000 });
      return true;
    } catch (error) {
      const output = `${error?.stdout || ''}\n${error?.stderr || ''}`;
      if (/SOCKS5 request granted/i.test(output)) return true;
      // Try the next Telegram DC/port pair.
    }
  }
  return false;
}

function parseTrace(value) {
  return String(value || '').split('\n').reduce((acc, line) => {
    const [key, ...rest] = line.split('=');
    if (key) acc[key.trim()] = rest.join('=').trim();
    return acc;
  }, {});
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

function loginAttemptKey(req, login) {
  return `${clientIp(req)}:${String(login || '').trim().toLowerCase()}`;
}

function loginAttemptStatus(key) {
  const now = Date.now();
  const record = loginAttempts.get(key);
  if (!record || now - record.firstAt > loginRateWindowMs) {
    loginAttempts.delete(key);
    return { blocked: false, retryAfterMs: 0 };
  }
  if (record.count < loginRateMax) return { blocked: false, retryAfterMs: 0 };
  return {
    blocked: true,
    retryAfterMs: Math.max(1000, loginRateWindowMs - (now - record.firstAt)),
  };
}

function recordFailedLogin(key) {
  const now = Date.now();
  const record = loginAttempts.get(key);
  if (!record || now - record.firstAt > loginRateWindowMs) {
    loginAttempts.set(key, { count: 1, firstAt: now });
    return;
  }
  record.count += 1;
}

function clearLoginAttempts(key) {
  loginAttempts.delete(key);
}

async function requestUser(req) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1] : cookieValue(req, 'atom_auth');
  if (!token) return null;

  return userFromToken(token);
}

async function userFromToken(token) {
  const payload = verifyToken(token);
  return payload?.login ? getUser(String(payload.login).trim().toLowerCase()) : null;
}

async function requireBoss(req, res) {
  const user = await requestUser(req);
  if (!user) {
    sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
    return null;
  }
  if (!isBossUser(user)) {
    sendJson(res, { ok: false, error: 'Forbidden' }, 403);
    return null;
  }
  return user;
}

function isBossUser(user) {
  return user?.login === 'boss' || String(user?.role || '').toLowerCase().includes('boss');
}

async function managerTelegramSession(login) {
  const settings = await getTelegramSettings(login, { includePrivate: true });
  return settings.telegramSession || '';
}

async function telegramSessionForClient(client, user) {
  const assignedTo = String(client?.assignedTo || '').trim().toLowerCase();
  if (assignedTo && assignedTo !== String(user?.login || '').trim().toLowerCase()) {
    const assignedSession = await managerTelegramSession(assignedTo);
    if (assignedSession) return assignedSession;
  }
  return managerTelegramSession(user.login);
}

function canUseClient(user, client) {
  if (!client) return false;
  return isBossUser(user) || String(client.assignedTo || '') === String(user.login);
}

function webSocketAuthToken(req, url) {
  const protocols = String(req.headers['sec-websocket-protocol'] || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const markerIndex = protocols.indexOf('atom.crm.auth');
  if (markerIndex >= 0 && protocols[markerIndex + 1]) return protocols[markerIndex + 1];
  return cookieValue(req, 'atom_auth') || '';
}

function cookieValue(req, name) {
  const prefix = `${name}=`;
  return String(req.headers.cookie || '')
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length) || '';
}

function authCookieHeader(token) {
  return {
    'Set-Cookie': cookieString('atom_auth', token, { maxAge: Math.floor(tokenTtlMs / 1000) }),
  };
}

function clearAuthCookieHeader() {
  return {
    'Set-Cookie': cookieString('atom_auth', '', { maxAge: 0 }),
  };
}

function cookieString(name, value, { maxAge }) {
  const secure = process.env.COOKIE_SECURE === 'true' || isProduction;
  return [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', authSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyToken(token) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) return null;

  const expected = crypto.createHmac('sha256', authSecret).update(body).digest('base64url');
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.ts || Date.now() - Number(payload.ts) > tokenTtlMs) return null;
    return payload;
  } catch {
    return null;
  }
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; script-src-elem 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://t.me; media-src 'self' blob:; object-src 'none'; connect-src 'self' wss://crm.atomexchange.ru https://crm.atomexchange.ru; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  };
}
