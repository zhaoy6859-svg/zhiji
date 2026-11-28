'use strict';

const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');

const AGENTS = ['zhiji', 'ziwei', 'qimen'];
const HOME = {
  zhiji: 'conv-zhiji',
  ziwei: 'conv-ziwei',
  qimen: 'conv-qimen',
  hall: 'conv-hall'
};
const SEALS = ['bamboo', 'inkstone', 'star', 'wind', 'moon', 'orchid'];

const DEFAULT_AGENTS = [
  { id: 'zhiji', name: '知几', seal: '几', tint: 'cinnabar', preference: 'conclusion-first', blurb: '先看你问的这件事，再把两盘收成能用的话。' },
  { id: 'ziwei', name: '紫微', seal: '紫', tint: 'pine', preference: 'show-evidence', blurb: '看长期倾向。时辰不详，就说明哪一层看不了。' },
  { id: 'qimen', name: '奇门', seal: '门', tint: 'ink', preference: 'show-evidence', blurb: '只看起局这一刻的这件事。' }
];

function now() {
  return new Date().toISOString();
}
function cleanName(value, emptyMessage) {
  const name = String(value || '').trim();
  if (!name || name.length > 16) throw new Error(emptyMessage || '名字要在 1 到 16 个字之间。');
  return name;
}
function cleanAvatar(value) {
  const avatar = String(value || '');
  if (SEALS.includes(avatar.replace(/^seal:/, '')) && avatar.startsWith('seal:')) return avatar;
  if (/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(avatar) && avatar.length <= 480000) return avatar;
  throw new Error('请选一枚印章，或一张较小的照片。');
}
function cleanSeal(value) {
  const seal = String(value || '').trim();
  if (!/^[\u4e00-\u9fff]$/.test(seal)) throw new Error('印章用一个汉字。');
  return seal;
}

function createStore(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS identity (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      nickname TEXT NOT NULL,
      avatar TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      is_self INTEGER NOT NULL DEFAULT 0,
      date TEXT,
      time_mode TEXT,
      time_index INTEGER,
      fuzzy TEXT,
      gender TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      seal TEXT NOT NULL,
      tint TEXT NOT NULL,
      preference TEXT NOT NULL,
      blurb TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      member_ids TEXT NOT NULL,
      profile_id TEXT,
      snapshot_id TEXT,
      preview TEXT,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      speaker TEXT NOT NULL,
      content TEXT NOT NULL,
      evidence_json TEXT,
      snapshot_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      profile_id TEXT,
      question TEXT,
      cast_at TEXT,
      domain TEXT,
      time_mode TEXT,
      guide TEXT,
      evidence_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ui_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      profile_id TEXT,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      kind TEXT NOT NULL,
      note TEXT,
      source TEXT,
      advance INTEGER NOT NULL DEFAULT 0,
      every_days INTEGER NOT NULL DEFAULT 0,
      notified_on TEXT,
      ahead_on TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_reminders_date ON reminders(date);
  `);
  const reminderColumns = db.prepare('PRAGMA table_info(reminders)').all().map((row) => row.name);
  if (!reminderColumns.includes('advance')) db.exec('ALTER TABLE reminders ADD COLUMN advance INTEGER NOT NULL DEFAULT 0');
  if (!reminderColumns.includes('every_days')) db.exec('ALTER TABLE reminders ADD COLUMN every_days INTEGER NOT NULL DEFAULT 0');
  if (!reminderColumns.includes('ahead_on')) db.exec('ALTER TABLE reminders ADD COLUMN ahead_on TEXT');
  const messageColumns = db.prepare('PRAGMA table_info(messages)').all().map((row) => row.name);
  if (!messageColumns.includes('reply_to')) db.exec('ALTER TABLE messages ADD COLUMN reply_to TEXT');
  if (!messageColumns.includes('reactions_json')) db.exec('ALTER TABLE messages ADD COLUMN reactions_json TEXT');
  if (!messageColumns.includes('delivery_json')) db.exec('ALTER TABLE messages ADD COLUMN delivery_json TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_reply ON messages(conversation_id, speaker, reply_to)');

  function transaction(fn) {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* 已经结束 */ }
      throw error;
    }
  }
  function getState(key) {
    const row = db.prepare('SELECT value FROM ui_state WHERE key = ?').get(key);
    return row ? row.value : null;
  }
  function setState(key, value) {
    db.prepare('INSERT INTO ui_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }
  function mapAgent(row) {
    return { id: row.id, name: row.name, seal: row.seal, tint: row.tint, preference: row.preference, blurb: row.blurb };
  }
  function mapProfile(row) {
    return {
      id: row.id,
      name: row.name,
      isSelf: Boolean(row.is_self),
      date: row.date || '',
      timeMode: row.time_mode || 'unknown',
      timeIndex: row.time_index == null ? null : Number(row.time_index),
      fuzzy: row.fuzzy || '',
      gender: row.gender || '',
      createdAt: row.created_at
    };
  }
  function mapReminder(row) {
    return {
      id: row.id,
      profileId: row.profile_id || null,
      title: row.title,
      date: row.date,
      kind: row.kind,
      note: row.note || '',
      source: row.source || '',
      advance: Boolean(row.advance),
      everyDays: Number(row.every_days || 0),
      notifiedOn: row.notified_on || '',
      aheadOn: row.ahead_on || '',
      createdAt: row.created_at
    };
  }
  function mapConversation(row) {
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      pinned: Boolean(row.pinned),
      memberIds: JSON.parse(row.member_ids),
      profileId: row.profile_id || null,
      snapshotId: row.snapshot_id || null,
      preview: row.preview || '',
      updatedAt: row.updated_at,
      createdAt: row.created_at
    };
  }
  function mapMessage(row) {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      speaker: row.speaker,
      content: row.content,
      evidence: row.evidence_json ? JSON.parse(row.evidence_json) : null,
      snapshotId: row.snapshot_id || null,
      replyTo: row.reply_to || null,
      reactions: parseReactions(row.reactions_json),
      delivery: parseDelivery(row.delivery_json),
      createdAt: row.created_at
    };
  }
  function parseDelivery(raw) {
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object') return null;
      return {
        finish: String(value.finish || ''),
        model: String(value.model || ''),
        channel: String(value.channel || ''),
        usage: value.usage && typeof value.usage === 'object' ? value.usage : null
      };
    } catch {
      return null;
    }
  }
  function parseReactions(raw) {
    if (!raw) return [];
    try {
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      return list.filter((item) => item && typeof item.emoji === 'string' && (item.actor === 'user' || item.actor === 'zhiji'));
    } catch {
      return [];
    }
  }
  function mapSnapshot(row) {
    if (!row) return null;
    return {
      id: row.id,
      conversationId: row.conversation_id,
      profileId: row.profile_id || null,
      question: row.question || '',
      castAt: row.cast_at || '',
      domain: row.domain || '',
      timeMode: row.time_mode || '',
      guide: row.guide || '',
      evidence: JSON.parse(row.evidence_json),
      createdAt: row.created_at
    };
  }
  function identityRow() {
    return db.prepare('SELECT nickname, avatar, created_at FROM identity WHERE id = 1').get() || null;
  }
  function getIdentity() {
    const row = identityRow();
    if (!row) return null;
    return { nickname: row.nickname, avatar: row.avatar, createdAt: row.created_at };
  }
  function listAgents() {
    return db.prepare('SELECT * FROM agents').all().map(mapAgent).sort((a, b) => AGENTS.indexOf(a.id) - AGENTS.indexOf(b.id));
  }
  function listProfiles() {
    return db.prepare('SELECT * FROM profiles ORDER BY created_at ASC').all().map(mapProfile);
  }
  function listConversations() {
    return db.prepare('SELECT * FROM conversations ORDER BY pinned DESC, updated_at DESC').all().map(mapConversation);
  }
  function conversationRow(id) {
    return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  }
  function requireConversation(id) {
    const row = conversationRow(id);
    if (!row) throw new Error('找不到这席对话。');
    return row;
  }

  function insertConversation({ id, kind, title, pinned, memberIds, createdAt }) {
    db.prepare(`INSERT INTO conversations
      (id, kind, title, pinned, member_ids, profile_id, snapshot_id, preview, updated_at, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, '', ?, ?)`).run(id, kind, title, pinned ? 1 : 0, JSON.stringify(memberIds), createdAt, createdAt);
  }
  function ensureSeed() {
    const stamp = now();
    for (const agent of DEFAULT_AGENTS) {
      db.prepare(`INSERT INTO agents (id, name, seal, tint, preference, blurb)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`).run(agent.id, agent.name, agent.seal, agent.tint, agent.preference, agent.blurb);
    }
    const homes = [
      [HOME.zhiji, 'dm', '知几', 1, ['zhiji']],
      [HOME.ziwei, 'dm', '紫微', 0, ['ziwei']],
      [HOME.qimen, 'dm', '奇门', 0, ['qimen']],
      [HOME.hall, 'group', '知几会馆', 0, ['zhiji', 'ziwei', 'qimen']]
    ];
    for (const [id, kind, title, pinned, members] of homes) {
      if (!conversationRow(id)) insertConversation({ id, kind, title, pinned, memberIds: members, createdAt: stamp });
    }
    if (!getState('active')) setState('active', HOME.zhiji);
  }

  function bootstrap() {
    const identity = getIdentity();
    if (!identity) {
      return { identity: null, agents: [], profiles: [], conversations: [], activeConversationId: null };
    }
    ensureSeed();
    const conversations = listConversations();
    let activeConversationId = getState('active');
    if (!conversations.some((item) => item.id === activeConversationId)) activeConversationId = HOME.zhiji;
    return { identity, agents: listAgents(), profiles: listProfiles(), conversations, activeConversationId };
  }

  function setIdentity(input) {
    if (getIdentity()) throw new Error('这台电脑已经有使用知几的人了。');
    const nickname = cleanName(input && input.nickname, '先写一个称呼。');
    const avatar = cleanAvatar(input && input.avatar);
    transaction(() => {
      db.prepare('INSERT INTO identity (id, nickname, avatar, created_at) VALUES (1, ?, ?, ?)').run(nickname, avatar, now());
      ensureSeed();
      setState('active', HOME.zhiji);
    });
    return bootstrap();
  }
  function updateIdentity(input) {
    if (!getIdentity()) throw new Error('还没有进入知几。');
    const nickname = cleanName(input && input.nickname, '先写一个称呼。');
    const avatar = cleanAvatar(input && input.avatar);
    db.prepare('UPDATE identity SET nickname = ?, avatar = ? WHERE id = 1').run(nickname, avatar);
    return getIdentity();
  }
  function updateAgent(input) {
    const id = input && input.id;
    if (id !== 'zhiji') throw new Error('这一版先改知几的称呼、印章和偏好。');
    const current = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
    if (!current) throw new Error('找不到知几。');
    const name = cleanName(input.name, '给知几一个称呼。');
    const seal = cleanSeal(input.seal || current.seal);
    const preference = input.preference === 'show-evidence' ? 'show-evidence' : 'conclusion-first';
    transaction(() => {
      db.prepare('UPDATE agents SET name = ?, seal = ?, preference = ? WHERE id = ?').run(name, seal, preference, id);
      db.prepare('UPDATE conversations SET title = ? WHERE id = ? AND title = ?').run(name, HOME.zhiji, current.name);
    });
    return { agent: mapAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(id)), conversations: listConversations() };
  }

  function cleanProfile(input) {
    const name = cleanName(input && (input.name || (input.isSelf ? '我' : '')), '给这份档案起个名字。可以是「我」。');
    const date = String(input && input.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('先填写公历出生日期。');
    const gender = input && input.gender;
    if (gender !== '女' && gender !== '男') throw new Error('请选择排盘用的性别。');
    const timeMode = input && input.timeMode;
    let timeIndex = null;
    let fuzzy = '';
    if (timeMode === 'exact') {
      timeIndex = Number(input.timeIndex);
      if (!Number.isInteger(timeIndex) || timeIndex < 0 || timeIndex > 12) throw new Error('确切时辰要从早子选到晚子。');
    } else if (timeMode === 'fuzzy') {
      fuzzy = String(input.fuzzy || '');
      if (!['dawn', 'forenoon', 'afternoon', 'dusk', 'night'].includes(fuzzy)) throw new Error('请选择一个大致时段。');
    } else if (timeMode !== 'unknown') {
      throw new Error('时辰可以是确切、模糊，或先不详。');
    }
    return {
      id: input.id ? String(input.id) : '',
      name,
      isSelf: Boolean(input.isSelf),
      date,
      timeMode: timeMode || 'unknown',
      timeIndex,
      fuzzy,
      gender
    };
  }
  function saveProfile(input) {
    const profile = cleanProfile(input || {});
    const id = profile.id || randomUUID();
    transaction(() => {
      if (profile.isSelf) db.prepare('UPDATE profiles SET is_self = 0').run();
      const exists = db.prepare('SELECT id FROM profiles WHERE id = ?').get(id);
      if (exists) {
        db.prepare(`UPDATE profiles SET name=?, is_self=?, date=?, time_mode=?, time_index=?, fuzzy=?, gender=? WHERE id=?`)
          .run(profile.name, profile.isSelf ? 1 : 0, profile.date, profile.timeMode, profile.timeIndex, profile.fuzzy, profile.gender, id);
      } else if (profile.id) {
        throw new Error('找不到这份档案。');
      } else {
        db.prepare(`INSERT INTO profiles (id, name, is_self, date, time_mode, time_index, fuzzy, gender, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, profile.name, profile.isSelf ? 1 : 0, profile.date, profile.timeMode, profile.timeIndex, profile.fuzzy, profile.gender, now());
      }
    });
    return { profile: mapProfile(db.prepare('SELECT * FROM profiles WHERE id = ?').get(id)), profiles: listProfiles() };
  }
  function deleteProfile(id) {
    transaction(() => {
      db.prepare('UPDATE conversations SET profile_id = NULL, snapshot_id = NULL WHERE profile_id = ?').run(String(id || ''));
      db.prepare('DELETE FROM profiles WHERE id = ?').run(String(id || ''));
    });
    return { profiles: listProfiles(), conversations: listConversations() };
  }
  function selectConversation(id) {
    requireConversation(id);
    setState('active', id);
    return { activeConversationId: id };
  }
  function setConversationProfile(conversationId, profileId) {
    requireConversation(conversationId);
    const next = profileId ? String(profileId) : null;
    if (next && !db.prepare('SELECT id FROM profiles WHERE id = ?').get(next)) throw new Error('找不到这份命主档案。');
    const current = conversationRow(conversationId);
    const same = (current.profile_id || null) === next;
    db.prepare('UPDATE conversations SET profile_id = ?, snapshot_id = ? WHERE id = ?')
      .run(next, same ? current.snapshot_id : null, conversationId);
    return { conversation: mapConversation(conversationRow(conversationId)) };
  }

  function createConversation(input) {
    const kind = input && input.kind === 'group' ? 'group' : 'dm';
    let memberIds = [input && input.agentId];
    if (kind === 'group') {
      const requested = Array.isArray(input.memberIds) ? input.memberIds : ['zhiji', 'ziwei', 'qimen'];
      memberIds = [...new Set(requested.filter((id) => AGENTS.includes(id)))];
      if (memberIds.length < 2) throw new Error('群里至少请两位。');
    }
    if (kind === 'dm' && !AGENTS.includes(memberIds[0])) throw new Error('请选择知几、紫微或奇门。');
    if (kind === 'dm') {
      const reusable = db.prepare(`SELECT * FROM conversations WHERE kind = 'dm' AND member_ids = ? AND NOT EXISTS (
        SELECT 1 FROM messages WHERE conversation_id = conversations.id AND speaker = 'user'
      ) ORDER BY pinned DESC LIMIT 1`).get(JSON.stringify(memberIds));
      if (reusable) {
        setState('active', reusable.id);
        return { conversation: mapConversation(reusable), conversations: listConversations(), reused: true };
      }
    }
    const id = randomUUID();
    const title = kind === 'group'
      ? cleanName(String((input && input.title) || '新的群聊').trim().slice(0, 16) || '新的群聊', '给群起个名字。')
      : '新的问事';
    const stamp = now();
    insertConversation({ id, kind, title, pinned: 0, memberIds, createdAt: stamp });
    setState('active', id);
    return { conversation: mapConversation(conversationRow(id)), conversations: listConversations(), reused: false };
  }

  function listMessages(conversationId) {
    requireConversation(conversationId);
    return db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC').all(conversationId).map(mapMessage);
  }
  function appendMessage(input) {
    const conversation = requireConversation(input && input.conversationId);
    const speaker = String(input.speaker || '');
    if (!['user', 'zhiji', 'ziwei', 'qimen', 'note'].includes(speaker)) throw new Error('这条消息没有说话的人。');
    const content = String(input.content || '').trim();
    if (!content || content.length > 8000) throw new Error('这句话空了，或写得太长。');
    const members = JSON.parse(conversation.member_ids);
    if (speaker !== 'user' && speaker !== 'note' && !members.includes(speaker)) throw new Error('这位不在这席对话里。');
    const evidence = Array.isArray(input.evidence) ? input.evidence.slice(0, 40) : null;
    const replyTo = input.replyTo ? String(input.replyTo) : null;
    if (replyTo && speaker !== 'user' && speaker !== 'note') {
      const existing = db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND speaker = ? AND reply_to = ?').get(conversation.id, speaker, replyTo);
      if (existing) {
        return { message: mapMessage(existing), conversation: mapConversation(conversationRow(conversation.id)), duplicate: true };
      }
    }
    const id = randomUUID();
    const stamp = now();
    const preview = content.replace(/\s+/g, ' ').slice(0, 80);
    transaction(() => {
      db.prepare(`INSERT INTO messages (id, conversation_id, speaker, content, evidence_json, snapshot_id, reply_to, delivery_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id,
        conversation.id,
        speaker,
        content,
        evidence ? JSON.stringify(evidence) : null,
        input.snapshotId || null,
        replyTo,
        input.delivery ? JSON.stringify(input.delivery) : null,
        stamp
      );
      let title = conversation.title;
      if (speaker === 'user' && (title === '新的问事' || title === '新的群聊')) {
        title = preview.slice(0, 18);
        db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, conversation.id);
      }
      if (speaker !== 'note') {
        db.prepare('UPDATE conversations SET preview = ?, updated_at = ? WHERE id = ?').run(preview, stamp, conversation.id);
      }
    });
    return { message: mapMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(id)), conversation: mapConversation(conversationRow(conversation.id)) };
  }

  function saveSnapshot(input) {
    const conversation = requireConversation(input && input.conversationId);
    const evidence = Array.isArray(input.evidence) ? input.evidence : [];
    if (!evidence.length) throw new Error('这张盘没有依据。');
    const id = randomUUID();
    const stamp = now();
    transaction(() => {
      db.prepare(`INSERT INTO snapshots
        (id, conversation_id, profile_id, question, cast_at, domain, time_mode, guide, evidence_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id,
        conversation.id,
        input.profileId || conversation.profile_id || null,
        String(input.question || '').slice(0, 600),
        String(input.castAt || ''),
        String(input.domain || ''),
        String(input.timeMode || ''),
        String(input.guide || ''),
        JSON.stringify(evidence),
        stamp
      );
      db.prepare('UPDATE conversations SET snapshot_id = ? WHERE id = ?').run(id, conversation.id);
    });
    return { snapshot: mapSnapshot(db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id)), conversation: mapConversation(conversationRow(conversation.id)) };
  }
  function toggleReaction(input) {
    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(String(input && input.messageId || ''));
    if (!row) throw new Error('找不到这条消息。');
    const emoji = String(input && input.emoji || '').trim();
    const actor = input && input.actor === 'zhiji' ? 'zhiji' : 'user';
    if (!emoji || emoji.length > 8) throw new Error('这个表情不能贴。');
    const reactions = parseReactions(row.reactions_json);
    const index = reactions.findIndex((item) => item.emoji === emoji && item.actor === actor);
    if (index >= 0) {
      if (actor === 'user') reactions.splice(index, 1);
    } else {
      reactions.push({ emoji, actor });
    }
    db.prepare('UPDATE messages SET reactions_json = ? WHERE id = ?').run(reactions.length ? JSON.stringify(reactions) : null, row.id);
    return { message: mapMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(row.id)) };
  }
  function updateMessage(input) {
    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(String(input && input.id || ''));
    if (!row) throw new Error('找不到这条消息。');
    const content = String(input.content || '').trim();
    if (!content || content.length > 8000) throw new Error('这句话空了，或写得太长。');
    const delivery = input.delivery ? JSON.stringify(input.delivery) : row.delivery_json;
    const stamp = now();
    const preview = content.replace(/\s+/g, ' ').slice(0, 80);
    transaction(() => {
      db.prepare('UPDATE messages SET content = ?, delivery_json = ? WHERE id = ?').run(content, delivery, row.id);
      if (row.speaker !== 'note') {
        db.prepare('UPDATE conversations SET preview = ?, updated_at = ? WHERE id = ?').run(preview, stamp, row.conversation_id);
      }
    });
    return { message: mapMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(row.id)) };
  }
  function getSnapshot(id) {
    if (!id) return null;
    return mapSnapshot(db.prepare('SELECT * FROM snapshots WHERE id = ?').get(String(id)));
  }
  function clearSnapshot(conversationId) {
    requireConversation(conversationId);
    db.prepare('UPDATE conversations SET snapshot_id = NULL WHERE id = ?').run(conversationId);
    return { conversation: mapConversation(conversationRow(conversationId)) };
  }

  const REMINDER_KINDS = ['birthday', 'anniversary', 'meeting', 'exam', 'other'];
  function yearlyOf(kind) {
    return kind === 'birthday' || kind === 'anniversary';
  }
  function dayNumber(text) {
    const value = String(text || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    return Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))) / 86400000;
  }
  function cleanReminder(input) {
    const title = cleanName(input && input.title, '给这一天起个名字，比如「六级考试」或「妈妈生日」。');
    const date = String(input && input.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期要写成 2026-11-30 这样。');
    const kind = REMINDER_KINDS.includes(input && input.kind) ? input.kind : 'other';
    const note = String(input && input.note || '').slice(0, 80);
    const source = String(input && input.source || '').slice(0, 160);
    const profileId = input && input.profileId ? String(input.profileId) : null;
    if (profileId && !db.prepare('SELECT id FROM profiles WHERE id = ?').get(profileId)) throw new Error('找不到这份命主档案。');
    const advance = input && (input.advance === true || input.advance === 1 || input.advance === '1') ? 1 : 0;
    let everyDays = Math.floor(Number(input && input.everyDays));
    if (!Number.isFinite(everyDays) || everyDays < 0) everyDays = 0;
    if (everyDays > 365) everyDays = 365;
    if (yearlyOf(kind)) everyDays = 0;
    return { id: input && input.id ? String(input.id) : '', title, date, kind, note, source, profileId, advance, everyDays };
  }
  function listReminders() {
    return db.prepare('SELECT * FROM reminders ORDER BY date ASC, created_at ASC').all().map(mapReminder);
  }
  function saveReminder(input) {
    const reminder = cleanReminder(input || {});
    const id = reminder.id || randomUUID();
    const old = reminder.id ? db.prepare('SELECT * FROM reminders WHERE id = ?').get(id) : null;
    if (reminder.id && !old) throw new Error('找不到这条提醒。');
    const keepMarks = Boolean(old)
      && old.date === reminder.date
      && old.kind === reminder.kind
      && Number(old.every_days) === reminder.everyDays
      && Number(old.advance) === reminder.advance;
    transaction(() => {
      if (old) {
        db.prepare('UPDATE reminders SET profile_id = ?, title = ?, date = ?, kind = ?, note = ?, source = ?, advance = ?, every_days = ?, notified_on = ?, ahead_on = ? WHERE id = ?')
          .run(reminder.profileId, reminder.title, reminder.date, reminder.kind, reminder.note, reminder.source, reminder.advance, reminder.everyDays, keepMarks ? old.notified_on : null, keepMarks ? old.ahead_on : null, id);
      } else {
        db.prepare(`INSERT INTO reminders (id, profile_id, title, date, kind, note, source, advance, every_days, notified_on, ahead_on, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`).run(id, reminder.profileId, reminder.title, reminder.date, reminder.kind, reminder.note, reminder.source, reminder.advance, reminder.everyDays, now());
      }
    });
    return { reminder: mapReminder(db.prepare('SELECT * FROM reminders WHERE id = ?').get(id)), reminders: listReminders() };
  }
  function deleteReminder(id) {
    db.prepare('DELETE FROM reminders WHERE id = ?').run(String(id || ''));
    return { reminders: listReminders() };
  }
  function addDays(text, days) {
    const base = dayNumber(text);
    if (!Number.isFinite(base)) return String(text || '');
    const at = new Date((base + days) * 86400000);
    const pad = (value) => String(value).padStart(2, '0');
    return at.getUTCFullYear() + '-' + pad(at.getUTCMonth() + 1) + '-' + pad(at.getUTCDate());
  }
  function occursOn(row, target) {
    const every = Number(row.every_days || 0);
    if (yearlyOf(row.kind)) return String(row.date || '').slice(5) === String(target || '').slice(5);
    if (every > 0) {
      const gap = dayNumber(target) - dayNumber(row.date);
      return Number.isFinite(gap) && gap >= 0 && gap % every === 0;
    }
    return row.date === target;
  }
  function dueReminders(day) {
    const target = String(day || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) throw new Error('日期要写成 2026-11-30 这样。');
    const tomorrow = addDays(target, 1);
    const hits = [];
    for (const row of db.prepare('SELECT * FROM reminders ORDER BY date ASC').all()) {
      if (occursOn(row, target) && row.notified_on !== target) {
        hits.push(Object.assign(mapReminder(row), { ahead: false, target }));
      } else if (row.advance && occursOn(row, tomorrow) && row.ahead_on !== tomorrow) {
        hits.push(Object.assign(mapReminder(row), { ahead: true, target: tomorrow }));
      }
    }
    return hits.sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));
  }
  function markReminderNotified(id, day, ahead) {
    const target = String(day || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) throw new Error('日期要写成 2026-11-30 这样。');
    if (ahead) db.prepare('UPDATE reminders SET ahead_on = ? WHERE id = ?').run(target, String(id || ''));
    else db.prepare('UPDATE reminders SET notified_on = ? WHERE id = ?').run(target, String(id || ''));
    return { ok: true };
  }

  return {
    bootstrap,
    setIdentity,
    updateIdentity,
    updateAgent,
    saveProfile,
    deleteProfile,
    selectConversation,
    setConversationProfile,
    createConversation,
    listMessages,
    appendMessage,
    updateMessage,
    toggleReaction,
    saveSnapshot,
    getSnapshot,
    clearSnapshot,
    listReminders,
    saveReminder,
    deleteReminder,
    dueReminders,
    markReminderNotified,
    close: () => db.close()
  };
}

module.exports = { createStore, HOME };
