'use strict';

const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog, session, Notification } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('./store.cjs');
const { speak, modelStatus, startLocalModel, listLocalModels, previewSend, testApi, MODEL } = require('./local-model.cjs');
const { RULE_VERSION, SCHOOL, evaluateStructure, gradeReply, examFixture } = require('./chart-cases.cjs');
const { resolveTurn } = require('../app/turn.js');

app.setName('知几');
if (process.platform === 'win32') app.setAppUserModelId('com.zhiji.desktop');
let store;

const DEFAULT_N8N = 'http://127.0.0.1:5678/webhook/zhiji-consult';
const CONFIG_FILE = () => path.join(app.getPath('userData'), 'zhiji-config.json');
const TEXT_EXT = new Set(['.md', '.txt', '.json', '.csv', '.yaml', '.yml', '.ics']);
let workspaceRoot = null;

function listWorkspaceFiles(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && TEXT_EXT.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => {
      const full = path.join(root, entry.name);
      const stat = fs.statSync(full);
      return { name: entry.name, size: stat.size };
    })
    .filter((entry) => entry.size <= 512 * 1024)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, 100);
}

function readWorkspaceFile(name) {
  if (!workspaceRoot) throw new Error('还没有选择文件夹');
  const root = fs.realpathSync(workspaceRoot);
  const target = path.resolve(root, String(name || ''));
  if (!target.startsWith(root + path.sep)) throw new Error('文件不在选定文件夹内');
  const real = fs.realpathSync(target);
  if (!real.startsWith(root + path.sep)) throw new Error('文件不在选定文件夹内');
  const stat = fs.statSync(real);
  if (!stat.isFile()) throw new Error('不是文件');
  if (stat.size > 512 * 1024) throw new Error('文件超过 512KB，先不要读整份');
  return { name: path.basename(real), text: fs.readFileSync(real, 'utf8') };
}

function icsDate(value) {
  const raw = String(value || '').replace(/Z$/, '');
  if (/^\d{8}$/.test(raw)) return raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8);
  if (/^\d{8}T\d{6}/.test(raw)) {
    return raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8) + ' ' + raw.slice(9, 11) + ':' + raw.slice(11, 13);
  }
  return raw;
}
function icsText(value) {
  return String(value || '').replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').trim();
}
function parseIcs(text) {
  const lines = String(text || '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let current = null;
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) { current = {}; continue; }
    if (/^END:VEVENT/i.test(line)) {
      if (current && current.start && current.summary) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const key = head.split(';')[0].toUpperCase();
    if (key === 'SUMMARY') current.summary = icsText(value);
    else if (key === 'DTSTART') current.start = icsDate(value);
    else if (key === 'DTEND') current.end = icsDate(value);
    else if (key === 'LOCATION') current.location = icsText(value);
  }
  return events
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
    .slice(0, 80);
}

function localDay(date) {
  const at = date instanceof Date ? date : new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return at.getFullYear() + '-' + pad(at.getMonth() + 1) + '-' + pad(at.getDate());
}

const REMINDER_CHECK_MS = 30 * 60 * 1000;
function remindToday() {
  if (!store) return [];
  const day = localDay();
  const due = store.dueReminders(day);
  if (!due.length) return [];
  if (!Notification.isSupported()) return [];
  for (const item of due) {
    const aheadDays = Number(item.aheadDays || 0);
    const lead = item.ahead ? (aheadDays > 1 ? '还有 ' + aheadDays + ' 天' : '明天') : '';
    const body = lead
      ? lead + (item.note ? '：' + item.title + ' · ' + item.note : '：' + item.title)
      : item.note ? item.title + ' · ' + item.note : item.title;
    const notification = new Notification({
      title: item.ahead ? (aheadDays > 1 ? '知几 · 还有 ' + aheadDays + ' 天' : '知几 · 明天') : '知几 · 今天',
      body
    });
    notification.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('zhiji:open-reminders');
    });
    notification.show();
    store.markReminderNotified(item.id, item.target || day, item.ahead);
  }
  return due;
}

function readConfig() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8')); } catch { raw = {}; }
  let secret = '';
  if (raw.secretEnc) {
    try { secret = safeStorage.decryptString(Buffer.from(raw.secretEnc, 'base64')); } catch { secret = ''; }
  } else if (raw.secret) {
    secret = raw.secret;
  }
  return {
    n8nUrl: raw.n8nUrl || DEFAULT_N8N,
    secret,
    hasSecret: Boolean(secret)
  };
}

function readRawConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8'));
  } catch {
    return {};
  }
}
function decryptKey(raw) {
  if (raw.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(Buffer.from(raw.apiKeyEnc, 'base64')); } catch { return ''; }
  }
  return '';
}
function modelSettingsPublic() {
  const raw = readRawConfig();
  return {
    provider: raw.provider === 'api' ? 'api' : 'local',
    model: raw.model || MODEL,
    effort: raw.effort === 'careful' ? 'careful' : 'fast',
    apiBase: raw.apiBase || '',
    apiModel: raw.apiModel || '',
    hasKey: Boolean(raw.apiKeyEnc),
    trials: raw.trials && typeof raw.trials === 'object' ? raw.trials : {},
    ruleVersion: RULE_VERSION,
    school: SCHOOL
  };
}
function routeForSpeak() {
  const raw = readRawConfig();
  return {
    provider: raw.provider === 'api' ? 'api' : 'local',
    model: raw.model || MODEL,
    effort: raw.effort === 'careful' ? 'careful' : 'fast',
    apiBase: raw.apiBase || '',
    apiModel: raw.apiModel || '',
    apiKey: decryptKey(raw)
  };
}
function writeModelSettings(input) {
  const raw = readRawConfig();
  const next = { ...raw };
  if (input.provider === 'api' || input.provider === 'local') next.provider = input.provider;
  if (typeof input.model === 'string' && input.model.trim()) next.model = input.model.trim();
  if (input.effort === 'careful' || input.effort === 'fast') next.effort = input.effort;
  if (typeof input.apiBase === 'string') next.apiBase = input.apiBase.trim();
  if (typeof input.apiModel === 'string') next.apiModel = input.apiModel.trim();
  if (typeof input.apiKey === 'string' && input.apiKey) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('这台电脑锁不住密钥。');
    next.apiKeyEnc = safeStorage.encryptString(input.apiKey).toString('base64');
    delete next.apiKey;
  }
  fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify(next, null, 2), { mode: 0o600 });
  return modelSettingsPublic();
}
function saveTrial(modelId, trial) {
  const raw = readRawConfig();
  const trials = raw.trials && typeof raw.trials === 'object' ? raw.trials : {};
  trials[modelId] = trial;
  raw.trials = trials;
  fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify(raw, null, 2), { mode: 0o600 });
}
async function runTrial() {
  const route = routeForSpeak();
  const fixture = examFixture();
  const first = resolveTurn({ text: fixture.question, history: [], hasSnapshot: false });
  const second = resolveTurn({
    text: fixture.followUp,
    history: [{ speaker: 'user', content: fixture.question }],
    hasSnapshot: true
  });
  const routeOk = first.plan === 'cast' && first.task === 'read' && first.matter.event === '英语六级'
    && second.task === 'revise' && second.angle === 'fortune' && second.chartText === fixture.question;
  const started = Date.now();
  const spoken = await speak({
    roleId: 'zhiji',
    question: fixture.followUp,
    task: 'revise',
    angle: 'fortune',
    matter: second.matter,
    evidence: fixture.evidence,
    castAt: fixture.castAt,
    timeMode: fixture.timeMode,
    route
  });
  const ms = Date.now() - started;
  const grade = spoken.ok ? gradeReply(spoken.content, fixture.evidence, fixture.timeMode, fixture.castAt) : { ok: false, problems: [spoken.message] };
  const understood = spoken.ok && /六级|考试|通过|有利|阻力|相抵|依据/.test(spoken.content) && !/复习了多久|每天花|准备进度/.test(spoken.content);
  const trial = {
    ok: routeOk && spoken.ok && grade.ok && understood,
    routeOk,
    understood,
    cited: grade.ok,
    problems: grade.problems,
    ms,
    at: new Date().toISOString(),
    excerpt: spoken.ok ? spoken.content.slice(0, 180) : spoken.message
  };
  const modelId = route.provider === 'api' ? route.apiModel : route.model;
  if (modelId) saveTrial(modelId, trial);
  return trial;
}
function writeConfig({ n8nUrl, secret }) {
  const current = readConfig();
  const nextSecret = typeof secret === 'string' && secret.length ? secret : current.secret;
  const raw = { ...readRawConfig(), n8nUrl: (n8nUrl || current.n8nUrl || DEFAULT_N8N).trim() };
  if (nextSecret) {
    if (safeStorage.isEncryptionAvailable()) {
      raw.secretEnc = safeStorage.encryptString(nextSecret).toString('base64');
    } else {
      raw.secret = nextSecret;
    }
  }
  fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify(raw, null, 2), { mode: 0o600 });
  return { n8nUrl: raw.n8nUrl, hasSecret: Boolean(nextSecret) };
}

async function consult(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('请求体不合法');
  const question = String(payload.question || '').trim();
  if (!question) throw new Error('问题为空');
  const history = Array.isArray(payload.history) ? payload.history.slice(-6).map((item) => ({
    speaker: item && item.role === 'assistant' ? 'zhiji' : 'user',
    content: String(item && item.content || '').slice(0, 800)
  })) : [];
  const hasEvidence = Array.isArray(payload.evidence) && payload.evidence.length > 0;
  const result = await speak({
    roleId: 'zhiji',
    question,
    evidence: payload.evidence,
    history,
    preference: 'conclusion-first',
    mode: hasEvidence ? 'read' : 'chat',
    castAt: payload.facts && payload.facts.qimen ? payload.facts.qimen.castAt : null,
    timeMode: payload.timeMode || null,
    guide: payload.facts ? payload.facts.readingGuide : null,
    route: routeForSpeak()
  });
  if (!result.ok) throw new Error(result.message);
  return { content: result.content, sections: null, model: result.model, evidence: result.evidence };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#f6f5f1',
    title: '知几',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, '..', 'app', 'chat.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  return win;
}

app.whenReady().then(() => {
  store = createStore(path.join(app.getPath('userData'), 'zhiji-chat.sqlite'));
  ipcMain.handle('zhiji:bootstrap', () => store.bootstrap());
  ipcMain.handle('zhiji:set-identity', (_event, input) => store.setIdentity(input || {}));
  ipcMain.handle('zhiji:update-identity', (_event, input) => store.updateIdentity(input || {}));
  ipcMain.handle('zhiji:update-agent', (_event, input) => store.updateAgent(input || {}));
  ipcMain.handle('zhiji:save-profile', (_event, input) => store.saveProfile(input || {}));
  ipcMain.handle('zhiji:delete-profile', (_event, id) => store.deleteProfile(id));
  ipcMain.handle('zhiji:select-conversation', (_event, id) => store.selectConversation(id));
  ipcMain.handle('zhiji:set-conversation-profile', (_event, payload) => store.setConversationProfile(payload && payload.conversationId, payload && payload.profileId));
  ipcMain.handle('zhiji:create-conversation', (_event, input) => store.createConversation(input || {}));
  ipcMain.handle('zhiji:list-messages', (_event, id) => store.listMessages(id));
  ipcMain.handle('zhiji:append-message', (_event, input) => store.appendMessage(input || {}));
  ipcMain.handle('zhiji:update-message', (_event, input) => store.updateMessage(input || {}));
  let speakAbort = null;
  ipcMain.handle('zhiji:stop-speak', () => {
    if (speakAbort) speakAbort.abort('user');
    return { ok: true };
  });
  ipcMain.handle('zhiji:toggle-reaction', (_event, input) => store.toggleReaction(input || {}));
  ipcMain.handle('zhiji:save-snapshot', (_event, input) => store.saveSnapshot(input || {}));
  ipcMain.handle('zhiji:get-snapshot', (_event, id) => store.getSnapshot(id));
  ipcMain.handle('zhiji:clear-snapshot', (_event, id) => store.clearSnapshot(id));
  ipcMain.handle('zhiji:speak', (event, input) => {
    if (speakAbort) speakAbort.abort('user');
    const controller = new AbortController();
    speakAbort = controller;
    return speak({
      ...(input || {}),
      route: routeForSpeak(),
      signal: controller.signal,
      onDelta(piece) {
        if (event.sender.isDestroyed()) return;
        event.sender.send('zhiji:speak-delta', piece);
      }
    }).finally(() => {
      if (speakAbort === controller) speakAbort = null;
    });
  });
  ipcMain.handle('zhiji:model-status', () => modelStatus(routeForSpeak().model));
  ipcMain.handle('zhiji:start-model', (_event, modelId) => startLocalModel(modelId || routeForSpeak().model));
  ipcMain.handle('zhiji:model-settings', () => modelSettingsPublic());
  ipcMain.handle('zhiji:set-model-settings', (_event, input) => writeModelSettings(input || {}));
  ipcMain.handle('zhiji:list-local-models', () => listLocalModels());
  ipcMain.handle('zhiji:test-api', (_event, input) => {
    const saved = routeForSpeak();
    return testApi({
      provider: 'api',
      apiBase: input && input.apiBase || saved.apiBase,
      apiModel: input && input.apiModel || saved.apiModel,
      apiKey: input && input.apiKey || saved.apiKey,
      effort: 'fast'
    });
  });
  ipcMain.handle('zhiji:preview-send', (_event, input) => previewSend(input || {}, routeForSpeak()));
  ipcMain.handle('zhiji:run-cases', () => ({ school: SCHOOL, ruleVersion: RULE_VERSION, cases: evaluateStructure() }));
  ipcMain.handle('zhiji:run-trial', () => runTrial());
  ipcMain.handle('zhiji:get-config', () => {
    const config = readConfig();
    return { n8nUrl: config.n8nUrl, hasSecret: config.hasSecret };
  });
  ipcMain.handle('zhiji:set-config', (_event, config) => writeConfig(config || {}));
  ipcMain.handle('zhiji:consult', (_event, payload) => consult(payload));
  ipcMain.handle('zhiji:choose-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    workspaceRoot = result.filePaths[0];
    return { path: workspaceRoot, files: listWorkspaceFiles(workspaceRoot) };
  });
  ipcMain.handle('zhiji:read-workspace-file', (_event, name) => readWorkspaceFile(name));
  ipcMain.handle('zhiji:choose-calendar', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Calendar', extensions: ['ics'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const file = result.filePaths[0];
    const events = parseIcs(fs.readFileSync(file, 'utf8'));
    return { path: file, events };
  });
  ipcMain.handle('zhiji:list-reminders', () => ({ reminders: store.listReminders(), day: localDay() }));
  ipcMain.handle('zhiji:save-reminder', (_event, input) => store.saveReminder(input || {}));
  ipcMain.handle('zhiji:delete-reminder', (_event, id) => store.deleteReminder(id));
  ipcMain.handle('zhiji:check-reminders', () => remindToday().map((item) => ({ id: item.id, title: item.title, date: item.target || item.date, ahead: Boolean(item.ahead), aheadDays: Number(item.aheadDays || 0) })));
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'microphone');
  });
  createWindow();
  setTimeout(() => { try { remindToday(); } catch { /* 通知失败不该拦住启动 */ } }, 4000);
  setInterval(() => { try { remindToday(); } catch { /* 同上 */ } }, REMINDER_CHECK_MS);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (store) store.close();
});
