const mode = (process.env.DB_MODE || 'pglite').toLowerCase();

const db = mode === 'postgres'
  ? await import('./db.mjs')
  : mode === 'json'
    ? await import('./db-json.mjs')
    : await import('./db-pglite.mjs');

export const migrate = db.migrate;
export const getUser = db.getUser;
export const listUsers = db.listUsers;
export const upsertUser = db.upsertUser;
export const updateUserPassword = db.updateUserPassword;
export const deleteUser = db.deleteUser;
export const listClients = db.listClients;
export const getClient = db.getClient;
export const deleteClient = db.deleteClient || (async () => false);
export const upsertClients = db.upsertClients;
export const upsertClient = db.upsertClient;
export const upsertTelegramChat = db.upsertTelegramChat;
export const upsertTelegramMessages = db.upsertTelegramMessages;
export const listMessages = db.listMessages;
export const listTelegramInboxChats = db.listTelegramInboxChats || (async () => []);
export const upsertTelegramInboxChats = db.upsertTelegramInboxChats || (async (_managerLogin, chats = []) => chats);
export const deleteTelegramInboxChat = db.deleteTelegramInboxChat || (async () => false);
export const updateTelegramInboxChatStatus = db.updateTelegramInboxChatStatus || (async () => null);
export const addAuditLog = db.addAuditLog;
export const listAuditLogs = db.listAuditLogs;
export const getTelegramSettings = db.getTelegramSettings;
export const upsertTelegramSettings = db.upsertTelegramSettings;
export const closeDb = db.closeDb || (async () => {
  if (db.pool) await db.pool.end();
});
