'use strict';

const $ = (id) => document.getElementById(id);
const USER_SEALS = [
  { id: 'bamboo', label: '竹', tint: 'pine' },
  { id: 'inkstone', label: '砚', tint: 'ink' },
  { id: 'star', label: '星', tint: 'cinnabar' },
  { id: 'wind', label: '风', tint: 'pine' },
  { id: 'moon', label: '月', tint: 'ink' },
  { id: 'orchid', label: '兰', tint: 'cinnabar' }
];
const AGENT_SEALS = ['几', '知', '竹', '星', '砚'];
const HOURS = ['早子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥', '晚子'];
const BANDS = [
  ['dawn', '清晨 · 约 03:00–08:59'],
  ['forenoon', '上午 · 约 09:00–12:59'],
  ['afternoon', '午后 · 约 13:00–16:59'],
  ['dusk', '傍晚 · 约 17:00–20:59'],
  ['night', '深夜 · 约 21:00–02:59']
];
const STABILITY = { exact: '已定', common: '多时辰一致', varies: '会随时辰变', withheld: '这层未排' };
const POEMS = {
  zhiji: ['一灯照两卷，细处见端倪', '风过灯花动，微光入砚池', '半窗留月影，一纸候君言'],
  ziwei: ['十二宫中寻旧曜，一轮岁次看星移', '星垣铺素纸，银汉落毫端', '灯前循斗柄，夜静辨星躔'],
  qimen: ['一局随时起，八门待次开', '九宫移日影，风自巽方来', '案头分八序，指下转时盘']
};
const REACTIONS = ['👌', '👍', '🙏', '❤️'];
const AJI_SRC = {
  front: { lg: 'aji/front.png', sm: 'aji/face.png', xs: 'aji/face.png' },
  glance: { lg: 'aji/glance.png', sm: 'aji/glance-face.png', xs: 'aji/glance-face.png' },
  blink: { lg: 'aji/blink.png', sm: 'aji/blink-face.png', xs: 'aji/blink-face.png' },
  cast: { lg: 'aji/cast.png', sm: 'aji/cast.png', xs: 'aji/cast.png' },
  happy: { lg: 'aji/happy.png', sm: 'aji/happy-face.png', xs: 'aji/happy-face.png' },
  sorry: { lg: 'aji/glance.png', sm: 'aji/glance-face.png', xs: 'aji/glance-face.png' }
};

const state = {
  identity: null,
  agents: [],
  profiles: [],
  conversations: [],
  activeId: null,
  messages: [],
  snapshot: null,
  query: '',
  busy: false,
  starting: false,
  typing: null,
  typingPoem: '',
  poemCursor: {},
  pending: null,
  failure: null,
  needProfile: false,
  recastIds: new Set(),
  evidenceMessageId: null,
  evidenceFocus: '',
  welcomeAvatar: 'seal:bamboo',
  settingsAvatar: 'seal:bamboo',
  agentSeal: '几',
  draftId: '',
  model: { ok: false, ready: false },
  modelSettings: null,
  localModels: [],
  ajiPose: 'front',
  mentionIndex: 0,
  attachments: [],
  detailOpen: false,
  voice: '',
  voiceNote: '',
  streamText: '',
  streamRole: '',
  speakGen: 0,
  memberFocus: ''
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function errorText(error) {
  const message = String(error && error.message || '没有完成。');
  const match = message.match(/Error invoking remote method [^:]+:\s*([\s\S]*)$/);
  return match ? match[1] : message;
}
function showFormError(id, error) {
  const node = $(id);
  node.hidden = false;
  node.textContent = errorText(error);
}
function agentById(id) {
  return state.agents.find((item) => item.id === id) || { id, name: id, seal: '几', tint: 'pine', preference: 'conclusion-first' };
}
function active() {
  return state.conversations.find((item) => item.id === state.activeId) || null;
}
function userSpec(identity) {
  if (identity && String(identity.avatar).startsWith('data:')) return { image: identity.avatar };
  const preset = USER_SEALS.find((item) => 'seal:' + item.id === (identity && identity.avatar)) || USER_SEALS[0];
  return { seal: preset.label, tint: preset.tint };
}
function avatarNode(spec) {
  if (spec.image) {
    const image = el('img', 'avatar-img');
    image.alt = '';
    image.src = spec.image;
    return image;
  }
  return el('span', 'seal tint-' + (spec.tint || 'pine'), spec.seal || '几');
}
function reduceMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function ajiSrc(pose, size) {
  const group = AJI_SRC[pose] || AJI_SRC.front;
  return group[size] || group.sm;
}
function setPose(node, pose) {
  const next = AJI_SRC[pose] ? pose : 'front';
  node.dataset.pose = next;
  node.classList.toggle('is-sorry', next === 'sorry');
  const img = node.querySelector('img');
  if (img) img.src = ajiSrc(next, node.dataset.size || 'sm');
}
function livePose() {
  const conversation = active();
  if (!conversation || !state.pending || state.pending.conversationId !== conversation.id) return 'front';
  if (state.failure) return 'sorry';
  return state.ajiPose || 'front';
}
function ajiNode(size, live) {
  const node = el('span', 'aji aji-' + size);
  node.dataset.size = size;
  if (live) node.dataset.live = '1';
  const img = document.createElement('img');
  img.className = 'aji-img';
  img.alt = '';
  img.draggable = false;
  node.append(img);
  setPose(node, live ? livePose() : 'front');
  bindAji(node);
  return node;
}
function bindAji(node) {
  let headTimer = 0;
  let dwellTimer = 0;
  let backTimer = 0;
  const lookAt = (event) => {
    if (node.dataset.pose === 'cast' || node.dataset.pose === 'happy') return;
    const rect = node.getBoundingClientRect();
    const dx = (event.clientX - rect.left - rect.width / 2) / (rect.width / 2 || 1);
    if (reduceMotion()) {
      setPose(node, 'glance');
      return;
    }
    const eye = Math.max(-2, Math.min(2, dx * 2));
    node.style.setProperty('--eye-x', eye + 'px');
    node.classList.add('is-eyed');
    clearTimeout(headTimer);
    headTimer = setTimeout(() => {
      node.style.setProperty('--yaw', Math.max(-5, Math.min(5, dx * 5)) + 'deg');
      node.classList.add('is-turned');
    }, 100);
  };
  node.addEventListener('pointerenter', (event) => {
    clearTimeout(backTimer);
    clearTimeout(dwellTimer);
    lookAt(event);
    if (!reduceMotion() && node.dataset.pose !== 'cast' && node.dataset.pose !== 'happy') {
      dwellTimer = setTimeout(() => blinkOnce(node), 700);
    }
  });
  node.addEventListener('pointermove', lookAt);
  node.addEventListener('pointerleave', () => {
    clearTimeout(headTimer);
    clearTimeout(dwellTimer);
    if (reduceMotion()) {
      if (node.dataset.pose === 'glance' || node.dataset.pose === 'blink') setPose(node, 'front');
      return;
    }
    node.classList.remove('is-eyed');
    node.style.setProperty('--eye-x', '0px');
    backTimer = setTimeout(() => {
      node.classList.remove('is-turned');
      node.style.setProperty('--yaw', '0deg');
    }, 140);
  });
}
function blinkOnce(node) {
  if (node.dataset.blinking || node.dataset.pose === 'cast' || node.dataset.pose === 'happy') return;
  node.dataset.blinking = '1';
  const back = node.dataset.pose === 'sorry' ? 'sorry' : 'front';
  setPose(node, 'blink');
  setTimeout(() => {
    if (node.dataset.pose === 'blink') setPose(node, back);
    node.dataset.blinking = '';
  }, 220);
}
function nodLive() {
  if (reduceMotion()) return;
  document.querySelectorAll('.aji[data-live="1"]').forEach((node) => {
    node.classList.remove('is-nod');
    void node.offsetWidth;
    node.classList.add('is-nod');
  });
}
function applyLivePose() {
  document.querySelectorAll('.aji[data-live="1"]').forEach((node) => setPose(node, livePose()));
}
function mentionQuery() {
  const draft = $('draft');
  const before = draft.value.slice(0, draft.selectionStart);
  const match = before.match(/[@＠]([^\s@＠]*)$/);
  return match ? match[1] : null;
}
function paintMentions() {
  const menu = $('mention-menu');
  const conversation = active();
  const query = mentionQuery();
  if (!conversation || conversation.kind !== 'group' || query == null) {
    menu.hidden = true;
    return;
  }
  const choices = ['紫微', '奇门', '知几'].filter((name) => !query || name.includes(query));
  if (!choices.length) {
    menu.hidden = true;
    return;
  }
  state.mentionIndex = Math.min(state.mentionIndex, choices.length - 1);
  menu.replaceChildren();
  choices.forEach((name, index) => {
    const button = el('button', index === state.mentionIndex ? 'is-on' : '', '@' + name);
    button.type = 'button';
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      insertMention(name);
    });
    menu.append(button);
  });
  menu.hidden = false;
}
function insertMention(name) {
  const draft = $('draft');
  const pos = draft.selectionStart;
  const before = draft.value.slice(0, pos);
  const after = draft.value.slice(pos);
  const written = before.replace(/[@＠][^\s@＠]*$/, '@' + name + ' ');
  draft.value = written + after;
  draft.setSelectionRange(written.length, written.length);
  $('mention-menu').hidden = true;
  resizeDraft();
}
function lightAck(text) {
  const source = String(text || '').trim();
  if (/通过率|能不能过|会不会过|分手|复合|出轨|难过|崩溃|报错|失败了/.test(source)) return '';
  if (/谢谢|感谢|收到了|好的|明白了|知道了/.test(source) && source.length < 24) return 'thanks';
  if (/刚才说的是|更正|补充一下|其实是/.test(source)) return 'correct';
  return '';
}
function replaceConversation(conversation) {
  state.conversations = state.conversations.map((item) => item.id === conversation.id ? conversation : item);
  state.conversations.sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
function formatDay(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.toLocaleDateString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return day + ' ' + time;
}
function formatWhen(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const start = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const day = start(new Date()) - start(date);
  if (day === 0) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (day === 86400000) return '昨天';
  if (date.getFullYear() === new Date().getFullYear()) return (date.getMonth() + 1) + '月' + date.getDate() + '日';
  return date.getFullYear() + '年';
}
function shortCast(value) {
  const match = String(value || '').match(/^\d{4}-(\d{2}-\d{2}) (\d{2}:\d{2})/);
  return match ? match[1] + ' ' + match[2] : String(value || '');
}
function profileClock(profile) {
  if (!profile || profile.timeMode === 'unknown') return '时辰不详';
  if (profile.timeMode === 'fuzzy') {
    const band = BANDS.find((item) => item[0] === profile.fuzzy);
    return band ? band[1].split(' · ')[0] : '模糊时段';
  }
  const hour = HOURS[profile.timeIndex] || '时辰';
  return hour + '时';
}
function watching(profile) {
  if (!profile || !profile.date) return '问盘时再选定命主';
  return profile.isSelf ? '正在看我的盘' : '正在看' + profile.name + '的盘';
}
function nextPoem(roleId) {
  const lines = POEMS[roleId] || POEMS.zhiji;
  const index = state.poemCursor[roleId] || 0;
  state.poemCursor[roleId] = (index + 1) % lines.length;
  return lines[index];
}
function mentionsIn(text, conversation) {
  if (!conversation || conversation.kind !== 'group') return [];
  const source = String(text || '');
  const found = [];
  for (const agent of state.agents) {
    if (source.includes('@' + agent.name) || source.includes('＠' + agent.name)) found.push(agent.id);
  }
  if (/[@＠]紫微/.test(source)) found.push('ziwei');
  if (/[@＠]奇门/.test(source)) found.push('qimen');
  if (/[@＠]知几/.test(source)) found.push('zhiji');
  return [...new Set(found)].filter((id) => conversation.memberIds.includes(id));
}
function speakersFor(conversation, pending) {
  if (pending.action === 'invite') return ['ziwei', 'qimen', 'zhiji'];
  if (conversation.kind === 'group' && pending.mentions.length) {
    return ['ziwei', 'qimen', 'zhiji'].filter((id) => pending.mentions.includes(id));
  }
  return conversation.kind === 'dm' ? conversation.memberIds.slice(0, 1) : ['zhiji'];
}
function taskFor(roleId, pending) {
  if (pending.action === 'invite' && roleId === 'zhiji') return 'summarize';
  return pending.task || 'chat';
}
function peersOf(pending) {
  if (pending.action !== 'invite') return null;
  const start = state.messages.findIndex((item) => item.id === pending.questionMessageId);
  return state.messages.slice(start + 1)
    .filter((item) => item.speaker === 'ziwei' || item.speaker === 'qimen')
    .map((item) => ({ name: agentById(item.speaker).name, content: item.content }));
}

function renderPicker(host, value, onPick) {
  host.replaceChildren();
  for (const preset of USER_SEALS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.toggle('is-picked', value === 'seal:' + preset.id);
    button.append(avatarNode({ seal: preset.label, tint: preset.tint }));
    button.addEventListener('click', () => onPick('seal:' + preset.id));
    host.append(button);
  }
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/png,image/jpeg,image/webp,image/gif';
  file.hidden = true;
  const upload = el('button', 'upload' + (String(value).startsWith('data:') ? ' is-picked' : ''), String(value).startsWith('data:') ? '' : '＋');
  upload.type = 'button';
  upload.setAttribute('aria-label', '用一张照片');
  if (String(value).startsWith('data:')) upload.append(avatarNode({ image: value }));
  upload.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const chosen = file.files && file.files[0];
    if (!chosen) return;
    const reader = new FileReader();
    reader.onload = () => cropImage(String(reader.result || '')).then(onPick).catch((error) => {
      if (error && error.message === 'cancelled') return;
      showFormError(host.id === 'settings-picker' ? 'settings-error' : 'welcome-error', error);
    });
    reader.readAsDataURL(chosen);
  });
  host.append(upload, file);
}
function cropImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const frame = 280;
      const stage = $('crop-stage');
      stage.replaceChildren();
      const img = document.createElement('img');
      img.alt = '';
      img.src = dataUrl;
      img.draggable = false;
      stage.append(img);
      const base = Math.max(frame / image.width, frame / image.height);
      let zoom = 1;
      let x = (frame - image.width * base) / 2;
      let y = (frame - image.height * base) / 2;
      let drag = null;
      const place = () => {
        img.style.width = (image.width * base * zoom) + 'px';
        img.style.height = (image.height * base * zoom) + 'px';
        img.style.left = x + 'px';
        img.style.top = y + 'px';
      };
      place();
      const zoomInput = $('crop-zoom');
      zoomInput.value = '1';
      zoomInput.oninput = () => {
        const next = Number(zoomInput.value) || 1;
        const scale = next / zoom;
        x = frame / 2 - (frame / 2 - x) * scale;
        y = frame / 2 - (frame / 2 - y) * scale;
        zoom = next;
        place();
      };
      img.onpointerdown = (event) => {
        drag = { px: event.clientX, py: event.clientY, x, y };
        img.setPointerCapture(event.pointerId);
      };
      img.onpointermove = (event) => {
        if (!drag) return;
        x = drag.x + event.clientX - drag.px;
        y = drag.y + event.clientY - drag.py;
        place();
      };
      img.onpointerup = () => { drag = null; };
      const dialog = $('crop-dialog');
      const form = $('crop-form');
      const close = $('crop-close');
      const finish = (error, value) => {
        form.onsubmit = null;
        close.onclick = null;
        if (dialog.open) dialog.close();
        if (error) reject(error);
        else resolve(value);
      };
      form.onsubmit = (event) => {
        event.preventDefault();
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const scale = base * zoom;
        canvas.getContext('2d').drawImage(image, -x / scale, -y / scale, frame / scale, frame / scale, 0, 0, 256, 256);
        finish(null, canvas.toDataURL('image/jpeg', 0.86));
      };
      close.onclick = () => finish(new Error('cancelled'));
      dialog.showModal();
    };
    image.onerror = () => reject(new Error('这张照片打不开。'));
    image.src = dataUrl;
  });
}
function renderAgentSeals() {
  const host = $('settings-seals');
  host.replaceChildren();
  for (const seal of AGENT_SEALS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.toggle('is-picked', seal === state.agentSeal);
    button.append(avatarNode({ seal, tint: 'cinnabar' }));
    button.addEventListener('click', () => {
      state.agentSeal = seal;
      renderAgentSeals();
    });
    host.append(button);
  }
}

function convFace(item, size) {
  const id = item.kind === 'group' ? 'zhiji' : item.memberIds[0];
  if (id === 'zhiji') return ajiNode(size || 'sm', item.id === state.activeId);
  const agent = agentById(id);
  return avatarNode({ seal: agent.seal, tint: agent.tint });
}
function paintList() {
  const host = $('conv-list');
  const pinHost = $('pin-slot');
  const top = host.scrollTop;
  const query = state.query.trim().toLowerCase();
  const items = state.conversations.filter((item) => {
    if (!query) return true;
    const names = item.memberIds.map((id) => agentById(id).name).join(' ');
    return (item.title + ' ' + item.preview + ' ' + names).toLowerCase().includes(query);
  });
  const pinned = items.find((item) => item.pinned) || null;
  const rest = items.filter((item) => !pinned || item.id !== pinned.id);
  pinHost.replaceChildren();
  if (pinned) {
    const pinId = pinned.kind === 'group' ? 'zhiji' : pinned.memberIds[0];
    const pinAgent = agentById(pinId);
    const card = el('button', 'pin-card' + (pinned.id === state.activeId ? ' is-active ' + (pinId === 'zhiji' ? 'is-aji' : 'tint-' + pinAgent.tint) : ''));
    card.type = 'button';
    const copy = el('span', 'pin-copy');
    copy.append(el('span', 'pin-title', pinned.title), el('span', 'conv-preview', pinned.preview || '还没有开口'));
    card.append(convFace(pinned, pinned.id === state.activeId ? 'lg' : 'sm'), copy);
    card.addEventListener('click', () => selectConversation(pinned.id));
    pinHost.append(card);
  }
  host.replaceChildren();
  if (!rest.length && !pinned) host.append(el('div', 'empty-list', '没有对上的会话。'));
  for (const item of rest) {
    const button = el('button', 'conv' + (item.id === state.activeId ? ' is-active' : ''));
    button.type = 'button';
    const copy = el('span', 'conv-copy');
    const line = el('span', 'conv-line');
    line.append(el('span', 'conv-name', item.title));
    copy.append(line, el('span', 'conv-preview', item.preview || '还没有开口'));
    button.append(convFace(item), copy);
    button.addEventListener('click', () => selectConversation(item.id));
    host.append(button);
  }
  host.scrollTop = top;
}
function stackOf(memberIds) {
  const stack = el('span', 'stack');
  for (const id of memberIds) {
    const agent = agentById(id);
    stack.append(avatarNode({ seal: agent.seal, tint: agent.tint }));
  }
  return stack;
}
function sourceLabel() {
  return state.modelSettings && state.modelSettings.provider === 'api' ? '云端' : '本地';
}
function roleFace(roleId, size, live) {
  if (roleId === 'zhiji') return ajiNode(size, live);
  const agent = agentById(roleId);
  return avatarNode({ seal: agent.seal, tint: agent.tint });
}
function paintHead() {
  const conversation = active();
  const chip = $('title-chip');
  chip.replaceChildren();
  if (!conversation) return;
  if (conversation.kind === 'group') {
    const stack = el('span', 'chip-stack');
    for (const id of conversation.memberIds) stack.append(roleFace(id, 'xs', id === 'zhiji'));
    chip.append(stack, el('span', null, conversation.title));
  } else {
    const agentId = conversation.memberIds[0];
    chip.append(roleFace(agentId, 'xs', agentId === 'zhiji'), el('span', null, agentById(agentId).name));
  }
  const profile = state.profiles.find((item) => item.id === conversation.profileId);
  const bits = [watching(profile)];
  if (state.snapshot && state.snapshot.id === conversation.snapshotId && state.snapshot.castAt) bits.push('起局 ' + shortCast(state.snapshot.castAt));
  chip.title = bits.filter(Boolean).join(' · ');
}
let enteringMessage = null;
function markSent(id) {
  enteringMessage = { id, since: performance.now() };
}
function rotateWaitingPoem() {
  const bubble = document.querySelector('#transcript .is-poem');
  if (!bubble || !state.typing || state.streamText) return;
  const fresh = bubble.cloneNode(false);
  state.typingPoem = nextPoem(state.typing);
  fresh.textContent = state.typingPoem;
  bubble.replaceWith(fresh);
}
function paintThread(stick) {
  const host = $('transcript');
  const near = host.scrollHeight - host.scrollTop - host.clientHeight < 96;
  const conversation = active();
  host.replaceChildren();
  if (!conversation) return;
  if (!state.messages.length) {
    const empty = el('div', 'empty-poem');
    const poem = el('p', 'poem');
    poem.append('一庭风动竹，', document.createElement('br'), '半砚水涵星。');
    empty.append(poem, el('p', 'empty-hint', emptyHint(conversation)));
    host.append(empty);
  }
  let lastStamp = 0;
  let lastSpeaker = '';
  for (const message of state.messages) {
    if (message.speaker === 'note') {
      host.append(el('div', 'note', message.content));
      lastSpeaker = '';
      continue;
    }
    const at = new Date(message.createdAt).getTime();
    const gap = !lastStamp || at - lastStamp >= 5 * 60 * 1000;
    if (gap) host.append(el('div', 'day', formatDay(message.createdAt)));
    const mine = message.speaker === 'user';
    const starts = mine || gap || message.speaker !== lastSpeaker;
    const row = el('div', 'msg ' + (mine ? 'is-user' : 'is-agent') + (starts ? '' : ' is-cont'));
    const body = el('div', 'msg-body');
    if (!mine && starts) body.append(el('div', 'msg-name', agentById(message.speaker).name));
    const wrap = el('div', 'bubble-wrap');
    const bubble = el('div', 'bubble');
    fillBubble(bubble, message.content, message.id);
    wrap.append(bubble, messageActions(message));
    if ((message.reactions || []).length) wrap.append(reactionRow(message));
    body.append(wrap);
    if (!mine && message.evidence && message.evidence.length) {
      const link = el('button', 'evidence-link', '查看依据');
      link.type = 'button';
      link.addEventListener('click', () => openEvidence(message.id, ''));
      body.append(link);
    }
    const status = deliveryControl(message);
    if (status) body.append(status);
    if (message.id === enteringMessage?.id) {
      const elapsed = performance.now() - enteringMessage.since;
      if (elapsed < 440) {
        row.classList.add('is-pop');
        row.style.setProperty('--enter-delay', -elapsed + 'ms');
      } else enteringMessage = null;
    }
    const face = !starts
      ? el('span', 'avatar-slot')
      : mine
        ? avatarNode(userSpec(state.identity))
        : roleFace(message.speaker, 'sm', false);
    if (mine) row.append(body, face);
    else row.append(face, body);
    host.append(row);
    lastStamp = at;
    lastSpeaker = message.speaker;
  }
  if (state.typing) {
    const agent = agentById(state.typing);
    const row = el('div', 'msg is-agent');
    const body = el('div', 'msg-body');
    const wrap = el('div', 'bubble-wrap');
    const streamed = state.streamText && state.streamRole === state.typing;
    const liveBubble = streamed ? el('div', 'bubble') : el('div', 'bubble is-poem', state.typingPoem);
    if (streamed) fillBubble(liveBubble, state.streamText, '');
    wrap.append(liveBubble);
    body.append(el('div', 'msg-name', agent.name), wrap);
    row.append(roleFace(state.typing, 'sm', state.typing === 'zhiji'), body);
    host.append(row);
  }
  if (state.pending && state.pending.conversationId === conversation.id && (state.failure || state.needProfile)) {
    host.append(failureCard());
  }
  if (stick || near) host.scrollTop = host.scrollHeight;
}
function emptyHint(conversation) {
  if (conversation.kind === 'group') return '把一件具体的事说给知几。想让紫微和奇门看同一张盘，点「请两位参看」。';
  if (conversation.memberIds[0] === 'ziwei') return '这里看长期倾向。时辰不详的地方，会直接说看不了。';
  if (conversation.memberIds[0] === 'qimen') return '把眼前的一件事说具体。按起局的时刻来看。';
  return '从一件具体的事问起。出生资料等要起盘时再填。';
}
function groupedReactions(message) {
  const map = new Map();
  for (const item of message.reactions || []) {
    const row = map.get(item.emoji) || { emoji: item.emoji, actors: [] };
    row.actors.push(item.actor);
    map.set(item.emoji, row);
  }
  return [...map.values()];
}
function reactionRow(message) {
  const host = el('div', 'reactions');
  for (const item of groupedReactions(message)) {
    const chip = el('button', 'reaction' + (item.actors.includes('user') ? ' is-own' : ''), item.emoji + (item.actors.length > 1 ? ' ' + item.actors.length : ''));
    chip.type = 'button';
    chip.addEventListener('click', () => toggleReaction(message.id, item.emoji, 'user'));
    host.append(chip);
  }
  return host;
}
const EMOJI_CATALOG = {
  常用: ['👌', '👍', '🙏', '❤️', '😄', '👀'],
  手势: ['👌', '👍', '👎', '🙏', '👋', '✌️'],
  心意: ['❤️', '💚', '🌸', '🍵', '🌙', '✨']
};
const EMOJI_NAME = {
  '👌': '好 收到', '👍': '赞', '👎': '不行', '🙏': '谢', '❤️': '心', '😄': '笑',
  '👀': '看', '👋': '挥手', '✌️': '胜利', '💚': '绿心', '🌸': '花', '🍵': '茶', '🌙': '月', '✨': '光'
};
function svgIcon(markup) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = markup;
  return svg;
}
function messageActions(message) {
  const bar = el('div', 'msg-actions');
  const react = document.createElement('button');
  react.type = 'button';
  react.setAttribute('aria-label', '贴表情');
  react.append(svgIcon('<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 14.2c.8 1 1.8 1.5 3 1.5s2.2-.5 3-1.5M9 10.2h.1M15 10.2h.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'));
  const pop = reactionPicker(message, react);
  react.addEventListener('click', () => {
    const opening = pop.hidden;
    document.querySelectorAll('.react-pop').forEach((node) => { node.hidden = true; });
    pop.hidden = !opening;
    if (opening) {
      const field = pop.querySelector('input');
      if (field) field.focus();
    } else react.focus();
  });
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.setAttribute('aria-label', '复制');
  copy.append(svgIcon('<rect x="8" y="8" width="10" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 16V6.5A1.5 1.5 0 0 1 7.5 5H15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'));
  copy.addEventListener('click', async () => {
    let wrote = false;
    try {
      await navigator.clipboard.writeText(message.content);
      wrote = true;
    } catch { wrote = false; }
    copy.classList.toggle('is-done', wrote);
    copy.classList.toggle('is-failed', !wrote);
    copy.setAttribute('aria-label', wrote ? '已复制' : '没有写入剪贴板');
    setTimeout(() => {
      copy.classList.remove('is-done', 'is-failed');
      copy.setAttribute('aria-label', '复制');
    }, 1200);
  });
  bar.append(react, pop, copy);
  if (message.evidence && message.evidence.length) {
    const more = document.createElement('button');
    more.type = 'button';
    more.setAttribute('aria-label', '更多');
    more.append(svgIcon('<circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/>'));
    const menu = el('div', 'react-pop');
    menu.hidden = true;
    const view = el('button', null, '查看依据');
    view.type = 'button';
    view.addEventListener('click', () => {
      menu.hidden = true;
      more.focus();
      openEvidence(message.id, '');
    });
    menu.append(view);
    more.addEventListener('click', () => { menu.hidden = !menu.hidden; });
    more.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !menu.hidden) {
        menu.hidden = true;
        more.focus();
      }
    });
    bar.append(more, menu);
  }
  return bar;
}
function reactionPicker(message, opener) {
  const pop = el('div', 'react-pop');
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', '贴表情');
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = '搜索表情';
  search.setAttribute('aria-label', '搜索表情');
  const cats = el('div', 'react-cats');
  const grid = el('div', 'react-grid');
  let category = '常用';
  let query = '';
  let index = 0;
  const names = Object.keys(EMOJI_CATALOG);
  const choices = () => {
    const pool = query
      ? [...new Set(Object.values(EMOJI_CATALOG).flat())]
      : EMOJI_CATALOG[category];
    return pool.filter((emoji) => !query || emoji.includes(query) || (EMOJI_NAME[emoji] || '').includes(query));
  };
  const closeTo = (emoji) => {
    opener.focus();
    pop.hidden = true;
    if (emoji) toggleReaction(message.id, emoji, 'user');
  };
  const paint = () => {
    cats.replaceChildren();
    names.forEach((name) => {
      const button = el('button', name === category && !query ? 'is-on' : '', name);
      button.type = 'button';
      button.tabIndex = -1;
      button.addEventListener('click', () => {
        category = name;
        query = '';
        search.value = '';
        index = 0;
        paint();
        search.focus();
      });
      cats.append(button);
    });
    const list = choices();
    if (index >= list.length) index = 0;
    grid.replaceChildren();
    list.forEach((emoji, itemIndex) => {
      const button = el('button', itemIndex === index ? 'is-on' : '', emoji);
      button.type = 'button';
      button.tabIndex = -1;
      const own = (message.reactions || []).some((item) => item.emoji === emoji && item.actor === 'user');
      if (own) button.classList.add('is-own');
      button.addEventListener('click', () => closeTo(emoji));
      grid.append(button);
    });
    if (!list.length) grid.append(el('span', 'sheet-note', '没有对上的表情'));
  };
  search.addEventListener('input', () => {
    query = search.value.trim();
    index = 0;
    paint();
  });
  search.addEventListener('keydown', (event) => {
    const list = choices();
    const columns = 6;
    if (event.key === 'ArrowRight' && list.length) {
      index = (index + 1) % list.length;
      paint();
      event.preventDefault();
    } else if (event.key === 'ArrowLeft' && list.length) {
      index = (index - 1 + list.length) % list.length;
      paint();
      event.preventDefault();
    } else if (event.key === 'ArrowDown' && list.length) {
      index = Math.min(list.length - 1, index + columns);
      paint();
      event.preventDefault();
    } else if (event.key === 'ArrowUp' && list.length) {
      index = Math.max(0, index - columns);
      paint();
      event.preventDefault();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (list[index]) closeTo(list[index]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeTo('');
    }
  });
  pop.append(search, cats, grid);
  paint();
  return pop;
}
async function toggleReaction(messageId, emoji, actor) {
  const saved = await window.zhiji.toggleReaction({ messageId, emoji, actor });
  const index = state.messages.findIndex((item) => item.id === saved.message.id);
  if (index >= 0) state.messages[index] = saved.message;
  paintThread(false);
}
function fillBubble(node, text, messageId) {
  const clean = String(text || '').replace(/\*\*/g, '').replace(/^#{1,6}\s+/gm, '');
  const parts = clean.split(/\[(E\d+)\]/g);
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      const button = el('button', 'e-ref', '[' + part + ']');
      button.type = 'button';
      button.addEventListener('click', () => openEvidence(messageId, part));
      node.append(button);
    } else if (part) node.append(document.createTextNode(part));
  });
}
function failureCard() {
  const card = el('div', 'failure');
  if (state.needProfile) {
    card.append(el('p', null, '这一问要起盘。头像是你，档案是这次给谁看。问题和稍后排好的盘都会留在这里。'));
    const open = el('button', 'enter slim', '填写命主');
    open.type = 'button';
    open.addEventListener('click', () => openProfile(true));
    card.append(open);
    return card;
  }
  card.append(el('p', null, state.failure.message || '本地模型没有应答。'));
  const start = el('button', 'enter slim', state.starting ? '正在启动' : '启动本地模型');
  start.type = 'button';
  start.disabled = state.starting;
  start.addEventListener('click', startModel);
  const retry = el('button', 'text', '重试');
  retry.type = 'button';
  retry.disabled = state.busy || state.starting;
  retry.addEventListener('click', () => runTurn({ resume: true }));
  card.append(start, retry);
  return card;
}
function paintDetail(drawer) {
  const conversation = active();
  drawer.hidden = false;
  drawer.replaceChildren();
  const head = el('div', 'drawer-head');
  head.append(el('h2', null, conversation ? conversation.title : '会话'));
  const close = el('button', 'text', '收起');
  close.type = 'button';
  close.addEventListener('click', () => {
    state.detailOpen = false;
    state.memberFocus = '';
    paintDrawer();
  });
  head.append(close);
  drawer.append(head);
  if (!conversation) return;
  for (const id of conversation.memberIds) {
    const agent = agentById(id);
    const button = el('button', 'member-row' + (state.memberFocus === id ? ' is-on' : ''));
    button.type = 'button';
    button.append(roleFace(id, 'xs', false), el('span', null, agent.name));
    button.addEventListener('click', () => {
      state.memberFocus = state.memberFocus === id ? '' : id;
      paintDrawer();
    });
    drawer.append(button);
    if (state.memberFocus === id) drawer.append(el('p', 'sheet-note', agent.blurb || ''));
  }
  const profile = state.profiles.find((item) => item.id === conversation.profileId);
  if (profile) drawer.append(el('p', 'sheet-note', '命主 · ' + profile.name));
  const matter = state.pending && state.pending.matter && state.pending.matter.event;
  if (matter) drawer.append(el('p', 'sheet-note', '事项 · ' + matter));
  if (state.snapshot && state.snapshot.castAt) drawer.append(el('p', 'sheet-note', '起局 · ' + state.snapshot.castAt));
  const latest = [...state.messages].reverse().find((item) => item.speaker !== 'user' && item.speaker !== 'note' && item.delivery);
  if (latest) drawer.append(el('p', 'sheet-note', deliveryFact(latest)));
}
function deliveryFact(message) {
  const delivery = message.delivery || {};
  const where = delivery.channel === 'api' ? '云端 API' : '本机';
  const finish = { stop: '正常完成', length: '达到长度上限', interrupted: '回复中断', stopped: '已停止' }[delivery.finish] || delivery.finish || '';
  const usage = delivery.usage && (delivery.usage.completion_tokens || delivery.usage.total_tokens);
  const bits = [where, delivery.model || '未回报模型', finish];
  if (usage) bits.push('用量 ' + usage);
  return bits.filter(Boolean).join(' · ');
}
function deliveryControl(message) {
  const finish = message.delivery && message.delivery.finish;
  if (!finish || finish === 'stop') return null;
  if (finish === 'stopped') return el('p', 'delivery', '已停止');
  const label = finish === 'interrupted' ? '回复中断 · 继续' : '达到长度上限 · 再续';
  const button = el('button', 'delivery', label);
  button.type = 'button';
  button.addEventListener('click', () => continueReply(message));
  return button;
}
function paintDrawer() {
  const drawer = $('drawer');
  const message = state.messages.find((item) => item.id === state.evidenceMessageId);
  if (!message || !message.evidence || !message.evidence.length) {
    if (state.detailOpen) {
      paintDetail(drawer);
      return;
    }
    drawer.hidden = true;
    drawer.replaceChildren();
    return;
  }
  drawer.hidden = false;
  drawer.replaceChildren();
  const head = el('div', 'drawer-head');
  head.append(el('h2', null, '查看依据'));
  const close = el('button', 'text', '收起');
  close.type = 'button';
  close.addEventListener('click', () => {
    state.evidenceMessageId = null;
    paintDrawer();
  });
  head.append(close);
  drawer.append(head);
  const snapshot = state.snapshot && message.snapshotId === state.snapshot.id ? state.snapshot : null;
  const meta = [snapshot && snapshot.castAt ? '起局 ' + snapshot.castAt : '', snapshot ? ({ exact: '时辰已定', fuzzy: '模糊时段', unknown: '时辰不详' }[snapshot.timeMode] || '') : ''].filter(Boolean);
  if (meta.length) drawer.append(el('p', 'cast-line', meta.join(' · ')));
  for (const system of ['ziwei', 'qimen']) {
    const items = message.evidence.filter((item) => item.system === system);
    if (!items.length) continue;
    const group = el('section', 'ev-group');
    group.append(el('h3', null, system === 'ziwei' ? '紫微' : '奇门'));
    for (const item of items) {
      const article = el('article', 'ev-item' + (item.id === state.evidenceFocus ? ' is-hot' : ''));
      article.id = 'ev-' + item.id;
      const title = el('div');
      title.append(el('span', 'eid', item.id), document.createTextNode(item.label || ''));
      if (item.stability && STABILITY[item.stability]) title.append(el('span', 'badge', STABILITY[item.stability]));
      article.append(title, el('p', null, item.fact || ''));
      group.append(article);
    }
    drawer.append(group);
  }
  const hot = state.evidenceFocus ? document.getElementById('ev-' + state.evidenceFocus) : null;
  if (hot) hot.scrollIntoView({ block: 'nearest' });
}
function paintComposer() {
  paintPeek();
  const conversation = active();
  $('invite').hidden = !conversation || conversation.kind !== 'group';
  const name = !conversation ? '知几' : conversation.kind === 'group' ? conversation.title : agentById(conversation.memberIds[0]).name;
  $('draft').placeholder = '给' + name + '发消息';
  $('invite').disabled = state.busy;
  paintVoice();
}
function paintVoice() {
  const recording = state.voice === 'recording';
  const busy = state.busy;
  const empty = !$('draft').value.trim() && !state.attachments.length && !recording && !busy;
  $('voice').hidden = !empty;
  $('send').hidden = (empty || recording) && !busy;
  $('voice-cancel').hidden = !recording;
  $('voice-stop').hidden = !recording;
  $('send').disabled = false;
  $('send').classList.toggle('is-stop', busy);
  $('send').setAttribute('aria-label', busy ? '停止' : '发送');
  const line = $('voice-line');
  line.hidden = !state.voiceNote;
  line.textContent = state.voiceNote || '';
}
let voiceListener = null;
function stopVoiceCapture() {
  if (voiceListener) {
    voiceListener.abort();
    voiceListener = null;
  }
  if (state.voiceStream) {
    state.voiceStream.getTracks().forEach((track) => track.stop());
    state.voiceStream = null;
  }
}
async function startVoice() {
  state.voiceNote = '';
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    state.voice = '';
    state.voiceNote = '麦克风没有打开。可以改用文字。';
    paintVoice();
    return;
  }
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) {
    stream.getTracks().forEach((track) => track.stop());
    state.voice = '';
    state.voiceNote = '这台机器听不到语音。可以改用文字。';
    paintVoice();
    return;
  }
  state.voiceStream = stream;
  const recognition = new Ctor();
  voiceListener = recognition;
  recognition.lang = 'zh-CN';
  recognition.interimResults = true;
  recognition.continuous = false;
  state.voice = 'recording';
  state.voiceNote = '';
  paintVoice();
  recognition.onresult = (event) => {
    if (voiceListener !== recognition) return;
    let text = '';
    for (let i = 0; i < event.results.length; i += 1) text += event.results[i][0].transcript;
    $('draft').value = text;
    resizeDraft();
  };
  recognition.onerror = (event) => {
    if (voiceListener !== recognition) return;
    voiceListener = null;
    stopVoiceCapture();
    state.voice = '';
    $('draft').value = '';
    state.voiceNote = event.error === 'not-allowed' || event.error === 'service-not-allowed'
      ? '麦克风没有打开。可以改用文字。'
      : '没有听清。可以再说一次，或改用文字。';
    paintVoice();
  };
  recognition.onend = () => {
    if (voiceListener !== recognition) return;
    voiceListener = null;
    stopVoiceCapture();
    state.voice = '';
    if (!$('draft').value.trim()) state.voiceNote = '没有听清。可以再说一次，或改用文字。';
    paintVoice();
  };
  try {
    recognition.start();
  } catch {
    stopVoiceCapture();
    state.voice = '';
    state.voiceNote = '没有听清。可以再说一次，或改用文字。';
    paintVoice();
  }
}
function cancelVoice() {
  const recognition = voiceListener;
  voiceListener = null;
  if (recognition) recognition.abort();
  stopVoiceCapture();
  state.voice = '';
  state.voiceNote = '';
  $('draft').value = '';
  resizeDraft();
  paintVoice();
}
function endVoice() {
  if (voiceListener) voiceListener.stop();
}
function paintShell() {
  $('side-avatar').replaceChildren(avatarNode(userSpec(state.identity)));
  paintModelButton();
  paintList();
  paintHead();
  paintThread(false);
  paintDrawer();
  paintComposer();
}
function openEvidence(messageId, focusId) {
  state.evidenceMessageId = messageId;
  state.evidenceFocus = focusId || '';
  paintDrawer();
}

function applyBootstrap(data) {
  state.identity = data.identity;
  state.agents = data.agents || [];
  state.profiles = data.profiles || [];
  state.conversations = data.conversations || [];
  state.activeId = data.activeConversationId;
}
async function showActive() {
  const conversation = active();
  if (!conversation) return;
  state.messages = await window.zhiji.listMessages(conversation.id);
  await window.zhiji.selectConversation(conversation.id);
  state.snapshot = conversation.snapshotId ? await window.zhiji.getSnapshot(conversation.snapshotId) : null;
  paintShell();
}
async function selectConversation(id) {
  if (state.busy || id === state.activeId) return;
  state.activeId = id;
  state.failure = null;
  state.needProfile = false;
  state.evidenceMessageId = null;
  await showActive();
  $('draft').focus();
}

function makePack(profile, question) {
  const shaped = {
    date: profile.date,
    gender: profile.gender,
    timeMode: profile.timeMode,
    time: profile.timeMode === 'exact' ? Number(profile.timeIndex) : '',
    fuzzy: profile.timeMode === 'fuzzy' ? profile.fuzzy : ''
  };
  const domain = inferDomain(question);
  const pack = buildFacts(shaped, domain);
  const built = buildEvidence(pack);
  return {
    domain,
    timeMode: pack.timeMode,
    castAt: pack.qimen && pack.qimen.facts ? pack.qimen.facts.castAt : '',
    guide: pack.facts.readingGuide,
    evidence: built.items.map((item) => ({
      id: item.id, system: item.system, label: item.label, fact: item.fact, stability: item.stability
    }))
  };
}
async function ensureSnapshot(force) {
  let profile = state.profiles.find((item) => item.id === active().profileId);
  if (!profile || !profile.date) {
    const ready = state.profiles.filter((item) => item.date);
    if (ready.length === 1) {
      const attached = await window.zhiji.setConversationProfile(active().id, ready[0].id);
      replaceConversation(attached.conversation);
      profile = ready[0];
    }
  }
  if (!profile || !profile.date) return { needProfile: true };
  const conversation = active();
  if (!force && conversation.snapshotId) {
    if (!state.snapshot || state.snapshot.id !== conversation.snapshotId) {
      state.snapshot = await window.zhiji.getSnapshot(conversation.snapshotId);
    }
    if (state.snapshot) return state.snapshot;
  }
  const chartText = state.pending.chartText || state.pending.text;
  const pack = makePack(profile, chartText);
  const saved = await window.zhiji.saveSnapshot({
    conversationId: conversation.id,
    profileId: profile.id,
    question: chartText,
    castAt: pack.castAt,
    domain: pack.domain,
    timeMode: pack.timeMode,
    guide: pack.guide,
    evidence: pack.evidence
  });
  state.snapshot = saved.snapshot;
  replaceConversation(saved.conversation);
  state.recastIds.delete(conversation.id);
  return saved.snapshot;
}
async function runTurn(options) {
  if (state.busy) return;
  const conversation = active();
  if (!conversation) return;
  const resume = Boolean(options && options.resume);
  state.busy = true;
  state.failure = null;
  state.needProfile = false;
  paintComposer();
  try {
    if (!resume) {
      const typed = $('draft').value.trim();
      const attached = attachmentText();
      const text = [typed, attached].filter(Boolean).join('\n\n').slice(0, 3900);
      const action = options && options.action || 'speak';
      if (!text && action !== 'invite') return;
      let questionMessageId = null;
      if (text) {
        const saved = await window.zhiji.appendMessage({ conversationId: conversation.id, speaker: 'user', content: text });
        state.messages.push(saved.message);
        replaceConversation(saved.conversation);
        questionMessageId = saved.message.id;
        markSent(questionMessageId);
        $('draft').value = '';
        state.attachments = [];
        paintAttachments();
        resizeDraft();
        const ack = lightAck(typed);
        if (ack && conversation.memberIds.includes('zhiji')) {
          const reacted = await window.zhiji.toggleReaction({ messageId: saved.message.id, emoji: '👌', actor: 'zhiji' });
          const index = state.messages.findIndex((item) => item.id === reacted.message.id);
          if (index >= 0) state.messages[index] = reacted.message;
          if (ack === 'thanks') state.ajiPose = 'happy';
        }
        state.turnAck = ack;
      } else {
        const last = [...state.messages].reverse().find((item) => item.speaker === 'user');
        if (!last) return;
        questionMessageId = last.id;
      }
      const question = state.messages.find((item) => item.id === questionMessageId);
      state.pending = {
        conversationId: conversation.id,
        text: question.content,
        action,
        mentions: mentionsIn(question.content, conversation),
        questionMessageId,
        finished: [],
        ack: state.turnAck || '',
        history: state.messages.filter((item) => item.id !== questionMessageId && item.speaker !== 'note').slice(-8)
      };
      state.turnAck = '';
      paintThread(true);
      paintList();
      if (conversation.memberIds.includes('zhiji')) nodLive();
    }
    const pending = state.pending;
    if (!pending || pending.conversationId !== conversation.id) return;
    const conversationNow = active();
    const resolved = ZhijiTurn.resolveTurn({
      text: pending.text,
      history: pending.history.map((item) => ({ speaker: item.speaker, content: item.content })),
      hasSnapshot: Boolean(conversationNow.snapshotId),
      recast: state.recastIds.has(conversationNow.id),
      specialist: pending.action === 'invite'
        || pending.mentions.includes('ziwei')
        || pending.mentions.includes('qimen')
        || (conversationNow.kind === 'dm' && conversationNow.memberIds[0] !== 'zhiji'),
      action: pending.action,
      mentions: pending.mentions
    });
    pending.matter = resolved.matter;
    pending.angle = resolved.angle;
    pending.task = resolved.task;
    pending.chartText = resolved.chartText;
    const plan = resolved.plan;
    if (pending.task === 'offer') {
      const saved = await window.zhiji.appendMessage({
        conversationId: conversation.id,
        speaker: 'zhiji',
        content: '好。你想先看看自己这一年的整体走势，还是心里已经有一件事想问？',
        replyTo: pending.questionMessageId,
        delivery: { finish: 'stop', model: '', channel: 'local', usage: null }
      });
      if (!state.messages.some((item) => item.id === saved.message.id)) state.messages.push(saved.message);
      replaceConversation(saved.conversation);
      state.pending = null;
      return;
    }
    if (plan !== 'none') {
      const snapshot = await ensureSnapshot(plan === 'cast');
      if (snapshot && snapshot.needProfile) {
        state.needProfile = true;
        openProfile(true);
        return;
      }
    }
    for (const roleId of speakersFor(active(), pending)) {
      if (pending.finished.includes(roleId)) continue;
      const already = state.messages.find((item) => item.speaker === roleId && item.replyTo === pending.questionMessageId);
      if (already) {
        pending.finished.push(roleId);
        continue;
      }
      const earlier = [...pending.history].reverse().find((item) => item.speaker === roleId);
      state.typing = roleId;
      state.typingPoem = nextPoem(roleId);
      state.streamText = '';
      state.streamRole = roleId;
      state.ajiPose = roleId === 'zhiji' && (pending.task === 'read' || pending.task === 'revise') ? 'cast' : (state.ajiPose === 'happy' ? 'happy' : 'front');
      paintThread(true);
      const generation = ++state.speakGen;
      const stopDelta = window.zhiji.onSpeakDelta((piece) => {
        if (generation !== state.speakGen || !piece) return;
        if (!state.streamText && (state.ajiPose === 'cast' || state.ajiPose === 'sorry')) state.ajiPose = 'front';
        state.streamText += piece;
        paintThread(true);
      });
      const verseTimer = setInterval(rotateWaitingPoem, 3600);
      let result;
      try {
        result = await window.zhiji.speak({
        roleId,
        question: pending.text,
        history: pending.history.map((item) => ({ speaker: item.speaker, content: item.content })),
        preference: agentById('zhiji').preference,
        task: taskFor(roleId, pending),
        angle: pending.angle,
        matter: pending.matter,
        previousAnswer: earlier ? earlier.content : '',
        evidence: plan === 'none' ? [] : ((state.snapshot && state.snapshot.evidence) || []),
        castAt: state.snapshot && plan !== 'none' ? state.snapshot.castAt : null,
        timeMode: state.snapshot && plan !== 'none' ? state.snapshot.timeMode : null,
        guide: state.snapshot && plan !== 'none' ? state.snapshot.guide : null,
        peers: peersOf(pending)
        });
      } finally {
        clearInterval(verseTimer);
        stopDelta();
        state.streamText = '';
        state.streamRole = '';
      }
      state.typing = null;
      state.typingPoem = '';
      const partial = String(result.content || '').trim();
      if (!result.ok && !partial) {
        state.failure = result;
        state.ajiPose = 'sorry';
        return;
      }
      state.ajiPose = result.ok && pending.ack === 'thanks' ? 'happy' : 'front';
      const saved = await window.zhiji.appendMessage({
        conversationId: conversation.id,
        speaker: roleId,
        content: partial,
        delivery: {
          finish: result.finish || (result.ok ? 'stop' : result.code),
          model: result.model || '',
          channel: result.channel || '',
          usage: result.usage || null
        },
        evidence: result.evidence && result.evidence.length ? result.evidence : null,
        snapshotId: plan === 'none' ? null : (state.snapshot && state.snapshot.id),
        replyTo: pending.questionMessageId
      });
      if (!state.messages.some((item) => item.id === saved.message.id)) state.messages.push(saved.message);
      replaceConversation(saved.conversation);
      pending.finished.push(roleId);
      paintThread(true);
      paintList();
    }
    const ack = pending.ack;
    state.pending = null;
    if (ack === 'thanks') state.ajiPose = 'happy';
    state.recastIds.delete(conversation.id);
  } catch (error) {
    state.failure = { code: 'bad', message: errorText(error) };
    state.ajiPose = 'sorry';
  } finally {
    state.busy = false;
    state.typing = null;
    state.typingPoem = '';
    if (!state.failure && state.ajiPose === 'sorry') state.ajiPose = 'front';
    if (!state.pending && state.ajiPose !== 'happy') state.ajiPose = 'front';
    paintShell();
    if (state.ajiPose === 'happy') {
      setTimeout(() => {
        if (state.ajiPose === 'happy' && !state.typing) {
          state.ajiPose = 'front';
          applyLivePose();
        }
      }, 900);
    }
  }
}
async function requestRecast() {
  const conversation = active();
  if (!conversation || state.busy) return;
  const cleared = await window.zhiji.clearSnapshot(conversation.id);
  replaceConversation(cleared.conversation);
  state.snapshot = null;
  state.recastIds.add(conversation.id);
  const saved = await window.zhiji.appendMessage({
    conversationId: conversation.id,
    speaker: 'note',
    content: '下一问会重新起局。已经写下的回复，仍对着当时那张盘。'
  });
  state.messages.push(saved.message);
  paintShell();
}
async function startModel() {
  if (state.starting) return;
  state.starting = true;
  paintThread(true);
  let ready = false;
  try {
    const started = await window.zhiji.startModel(state.modelSettings?.model);
    ready = started.ok;
    if (!ready) state.failure = { code: 'load', message: started.message };
  } catch (error) {
    state.failure = { code: 'load', message: errorText(error) };
  } finally {
    state.starting = false;
    paintShell();
  }
  if (ready && state.pending && !state.busy) await runTurn({ resume: true });
}

function fillHourSelect() {
  const select = $('profile-hour');
  if (select.options.length) return;
  select.append(new Option('时辰不详', 'unknown'));
  for (const [id, label] of BANDS) select.append(new Option(label, 'fuzzy:' + id));
  HOURS.forEach((label, index) => select.append(new Option(label + '时', 'exact:' + index)));
}
function hourValue(profile) {
  if (!profile || profile.timeMode === 'unknown') return 'unknown';
  if (profile.timeMode === 'fuzzy') return 'fuzzy:' + profile.fuzzy;
  if (profile.timeMode === 'exact' && profile.timeIndex != null) return 'exact:' + profile.timeIndex;
  return 'unknown';
}
function readHour(value) {
  if (String(value).startsWith('exact:')) return { timeMode: 'exact', timeIndex: Number(String(value).slice(6)), fuzzy: '' };
  if (String(value).startsWith('fuzzy:')) return { timeMode: 'fuzzy', timeIndex: null, fuzzy: String(value).slice(6) };
  return { timeMode: 'unknown', timeIndex: null, fuzzy: '' };
}
function fillProfileForm(profile) {
  state.draftId = profile ? profile.id : '';
  $('profile-name').value = profile ? profile.name : '';
  $('profile-self').checked = Boolean(profile && profile.isSelf);
  $('profile-date').value = profile ? profile.date : '';
  $('profile-hour').value = hourValue(profile);
  const gender = profile && profile.gender === '男' ? '男' : '女';
  document.querySelector('#profile-form input[name="gender"][value="' + gender + '"]').checked = true;
  $('profile-delete').hidden = !state.draftId;
  $('profile-error').hidden = true;
}
function paintProfileList() {
  const host = $('profile-list');
  host.replaceChildren();
  if (!state.profiles.length) host.append(el('div', 'empty-list', '还没有命主。'));
  for (const profile of state.profiles) {
    const button = el('button', profile.id === state.draftId ? 'is-active' : '', profile.name + ' · ' + profileClock(profile));
    button.type = 'button';
    button.addEventListener('click', () => {
      fillProfileForm(profile);
      paintProfileList();
    });
    host.append(button);
  }
}
function openProfile(forTurn) {
  state.profileForTurn = Boolean(forTurn);
  fillHourSelect();
  const current = active();
  const selected = state.profiles.find((item) => current && item.id === current.profileId)
    || state.profiles.find((item) => item.isSelf)
    || state.profiles[0]
    || null;
  if (selected) fillProfileForm(selected);
  else fillProfileForm(null);
  paintProfileList();
  if (!$('profile-dialog').open) $('profile-dialog').showModal();
}
async function saveProfile(attach) {
  const clock = readHour($('profile-hour').value);
  const self = $('profile-self').checked;
  const name = $('profile-name').value.trim() || (self ? '我' : '');
  const gender = document.querySelector('#profile-form input[name="gender"]:checked').value;
  const saved = await window.zhiji.saveProfile({
    id: state.draftId || undefined,
    name,
    isSelf: self,
    date: $('profile-date').value,
    gender,
    ...clock
  });
  state.profiles = saved.profiles;
  state.draftId = saved.profile.id;
  if (attach && active()) {
    const linked = await window.zhiji.setConversationProfile(active().id, saved.profile.id);
    replaceConversation(linked.conversation);
    state.snapshot = null;
  }
  return saved.profile;
}

function attachmentText() {
  return state.attachments.map((file) => file.text
    ? '【附件 ' + file.name + '】\n' + file.text
    : '【附件 ' + file.name + '】' + (file.note ? ' ' + file.note : '')).join('\n\n');
}
function paintAttachments() {
  const host = $('attach-row');
  host.replaceChildren();
  host.hidden = !state.attachments.length;
  for (const file of state.attachments) {
    const chip = el('span', 'attach-chip');
    const remove = el('button', null, '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', '移除' + file.name);
    remove.addEventListener('click', () => {
      state.attachments = state.attachments.filter((item) => item !== file);
      paintAttachments();
    });
    chip.append(el('span', null, file.name), remove);
    host.append(chip);
  }
  paintVoice();
}
async function stageAttachments(list) {
  const files = [...(list || [])];
  $('attach-input').value = '';
  for (const file of files) {
    if (state.attachments.length >= 6) break;
    if (file.size > 400 * 1024) {
      state.attachments.push({ name: file.name, text: '', note: '超过 400KB，没有读入' });
      continue;
    }
    const readable = /^(text\/|application\/(json|xml|yaml))/.test(file.type) || /\.(txt|md|csv|json|ya?ml|ics|log)$/i.test(file.name);
    if (!readable) {
      state.attachments.push({ name: file.name, text: '', note: '不是文字，只记下文件名' });
      continue;
    }
    const text = await file.text();
    state.attachments.push({ name: file.name, text: text.slice(0, 2400) });
  }
  paintAttachments();
}
function resizeDraft() {
  const draft = $('draft');
  draft.style.height = 'auto';
  draft.style.height = Math.min(draft.scrollHeight, 140) + 'px';
}
function modelButtonLabel() {
  const settings = state.modelSettings || {};
  const effort = settings.effort === 'careful' ? '细读' : '快速';
  if (settings.provider === 'api') return '云端 API · ' + (settings.apiModel || '未填模型') + ' · ' + effort;
  const found = state.localModels.find((item) => item.id === settings.model);
  const name = found ? found.name : String(settings.model || '本地模型').split('/').pop();
  return '本机 · ' + name + ' · ' + effort;
}
function paintPeek() {
  const peek = $('composer-peek');
  if (!peek) return;
  const draft = $('draft');
  const show = document.activeElement === draft && draft.value.trim() && !state.busy && state.voice !== 'recording';
  peek.classList.toggle('is-up', Boolean(show));
  if (!show) peek.classList.remove('is-listening');
}
async function continueReply(message) {
  if (state.busy || !message || !active()) return;
  const question = state.messages.find((item) => item.id === message.replyTo);
  state.busy = true;
  state.failure = null;
  state.typing = message.speaker;
  state.typingPoem = nextPoem(message.speaker);
  state.streamText = message.content;
  state.streamRole = message.speaker;
  state.ajiPose = message.speaker === 'zhiji' ? 'front' : state.ajiPose;
  paintComposer();
  paintThread(true);
  const generation = ++state.speakGen;
  const stopDelta = window.zhiji.onSpeakDelta((piece) => {
    if (generation !== state.speakGen || !piece) return;
    state.streamText += piece;
    paintThread(true);
  });
  try {
    const result = await window.zhiji.speak({
      roleId: message.speaker,
      question: question ? question.content : message.content,
      history: [],
      preference: agentById('zhiji').preference,
      task: 'read',
      previousAnswer: message.content,
      evidence: message.evidence || [],
      snapshotId: message.snapshotId
    });
    const content = message.content + String(result.content || '');
    const saved = await window.zhiji.updateMessage({
      id: message.id,
      content,
      delivery: {
        finish: result.finish || (result.ok ? 'stop' : result.code),
        model: result.model || '',
        channel: result.channel || '',
        usage: result.usage || null
      }
    });
    const index = state.messages.findIndex((item) => item.id === message.id);
    if (index >= 0) state.messages[index] = saved.message;
  } catch (error) {
    state.failure = { code: 'bad', message: errorText(error) };
  } finally {
    stopDelta();
    state.busy = false;
    state.typing = null;
    state.typingPoem = '';
    state.streamText = '';
    state.streamRole = '';
    paintShell();
  }
}
function paintModelButton() {
  const button = $('model-switch');
  if (button) button.textContent = modelButtonLabel();
  const effort = (state.modelSettings && state.modelSettings.effort) || 'fast';
  document.querySelectorAll('#effort button').forEach((item) => item.classList.toggle('is-on', item.dataset.effort === effort));
}
function sizeText(bytes) {
  if (!bytes) return '';
  return (bytes / 1e9).toFixed(1) + ' GB';
}
async function openModelPop() {
  const pop = $('model-pop');
  pop.hidden = !pop.hidden;
  if (pop.hidden) return;
  const listed = await window.zhiji.listLocalModels();
  state.localModels = listed.models || [];
  const host = $('model-list');
  host.replaceChildren();
  const current = state.modelSettings || {};
  if (!state.localModels.length) host.append(el('p', 'sheet-note', listed.message || '还没有已下载的对话模型。'));
  for (const model of state.localModels) {
    const button = el('button', 'model-row' + (current.provider !== 'api' && current.model === model.id ? ' is-on' : ''));
    button.type = 'button';
    const trial = current.trials && current.trials[model.id];
    const marks = ['已下载'];
    if (model.loaded) marks.push('已加载');
    else marks.push('可加载');
    if (trial && trial.ok) marks.push('已通过试答');
    const meta = el('span', 'model-meta', [marks.join(' · '), model.params, model.quant, sizeText(model.bytes)].filter(Boolean).join(' · '));
    button.append(document.createTextNode(model.name), meta);
    button.addEventListener('click', () => chooseLocal(model.id));
    host.append(button);
  }
  host.append(el('p', 'sheet-note', '这台 24GB 的 Mac 上，Qwen 9B 和 Gemma 12B 可以先对照。列表里出现过，不等于已经能答。'));
  paintModelButton();
}
async function chooseLocal(id) {
  state.modelSettings = await window.zhiji.setModelSettings({ provider: 'local', model: id });
  paintModelButton();
  paintHead();
  const found = state.localModels.find((item) => item.id === id);
  if (!found || !found.loaded) {
    $('trial-line').textContent = '正在加载。';
    const started = await window.zhiji.startModel(id);
    $('trial-line').textContent = started.message || '';
    state.model = await window.zhiji.modelStatus();
    const again = await window.zhiji.listLocalModels();
    state.localModels = again.models || state.localModels;
  }
}
async function openApi() {
  $('model-pop').hidden = true;
  const settings = state.modelSettings || {};
  $('api-base').value = settings.apiBase || '';
  $('api-model').value = settings.apiModel || '';
  $('api-key').value = '';
  $('api-error').hidden = true;
  const preview = await window.zhiji.previewSend({
    question: state.pending && state.pending.text || '下个月我会参加英语六级考试。我通过的概率大吗？',
    history: state.messages.slice(-4).map((item) => ({ speaker: item.speaker, content: item.content })),
    evidence: state.snapshot && state.snapshot.evidence || []
  });
  $('api-preview').textContent = '发往 ' + preview.endpoint + ' 的是：问题、最近对话，以及这些依据原文。\n' + JSON.stringify(preview.willSend, null, 2);
  if (!$('api-dialog').open) $('api-dialog').showModal();
}
async function openCases() {
  $('model-pop').hidden = true;
  $('cases-error').hidden = true;
  $('cases-model-line').textContent = '';
  const report = await window.zhiji.runCases();
  $('cases-school').textContent = report.school + ' 规则版本 ' + report.ruleVersion + '。';
  const host = $('cases-body');
  host.replaceChildren();
  for (const item of report.cases) {
    const block = el('article', 'case');
    block.append(el('h3', null, item.title + (item.pass ? ' · 通过' : ' · 未通过')));
    block.append(el('p', 'sheet-note', '可接受的判断：' + item.accept));
    for (const check of item.checks) block.append(el('p', check.ok ? 'ok' : 'bad', (check.ok ? '通过' : '未通过') + ' · ' + check.name));
    host.append(block);
  }
  if (!$('cases-dialog').open) $('cases-dialog').showModal();
}
const REMINDER_KIND_LABEL = { birthday: '生日', anniversary: '纪念日', meeting: '约定', exam: '考试', other: '其他' };
let reminderCache = [];
let reminderPicked = '';

function reminderDay(date) {
  const time = Date.parse(String(date || '') + 'T00:00:00');
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}
function reminderYearly(item) {
  return item.kind === 'birthday' || item.kind === 'anniversary';
}
function reminderEvery(item) {
  const every = Math.floor(Number(item.everyDays || 0));
  return Number.isFinite(every) && every > 0 ? every : 0;
}
function reminderNext(item, today) {
  const every = reminderEvery(item);
  if (reminderYearly(item)) {
    const tail = String(item.date || '').slice(5);
    const thisYear = String(today || '').slice(0, 4) + '-' + tail;
    if (reminderDay(thisYear) >= reminderDay(today)) return thisYear;
    return String(Number(String(today || '').slice(0, 4)) + 1) + '-' + tail;
  }
  if (every > 0) {
    const anchor = reminderDay(item.date);
    const gap = Math.round((reminderDay(today) - anchor) / 86400000);
    const step = gap <= 0 ? 0 : Math.ceil(gap / every) * every;
    const at = new Date(anchor + step * 86400000);
    const pad = (value) => String(value).padStart(2, '0');
    return at.getFullYear() + '-' + pad(at.getMonth() + 1) + '-' + pad(at.getDate());
  }
  return item.date;
}
function reminderWhen(item, today) {
  const next = reminderNext(item, today);
  const gap = Math.round((reminderDay(next) - reminderDay(today)) / 86400000);
  if (gap === 0) return '今天';
  if (gap === 1) return '明天';
  if (gap > 1 && gap <= 30) return gap + ' 天后 · ' + next.slice(5);
  return next;
}
function renderReminders() {
  const host = $('reminder-list');
  if (!host) return;
  host.replaceChildren();
  const today = state.reminderDay || new Date().toISOString().slice(0, 10);
  if (!reminderCache.length) {
    host.append(el('p', 'sheet-note', '还没有记下任何一天。'));
    return;
  }
  const sorted = reminderCache.slice().sort((a, b) => reminderDay(reminderNext(a, today)) - reminderDay(reminderNext(b, today)));
  for (const item of sorted) {
    const row = el('button', 'reminder-row' + (item.id === reminderPicked ? ' is-picked' : ''));
    row.type = 'button';
    row.addEventListener('click', () => pickReminder(item));
    row.append(el('span', 'reminder-row-title', item.title));
    row.append(el('span', 'reminder-row-when', reminderWhen(item, today)));
    const meta = [REMINDER_KIND_LABEL[item.kind] || '其他'];
    if (reminderEvery(item) > 0) meta.push('每 ' + reminderEvery(item) + ' 天');
    if (item.advance) meta.push('提前一天');
    if (item.note) meta.push(item.note);
    row.append(el('span', 'reminder-row-meta', meta.join(' · ')));
    host.append(row);
  }
}
function reminderEveryOption(value) {
  const select = $('reminder-every');
  const text = String(value || 0);
  if (Number(text) > 0 && !Array.from(select.options).some((option) => option.value === text)) {
    const option = document.createElement('option');
    option.value = text;
    option.textContent = '每 ' + text + ' 天';
    select.append(option);
  }
  return text;
}
function syncReminderKind() {
  const yearly = reminderYearly({ kind: $('reminder-kind').value });
  $('reminder-every').disabled = yearly;
  $('reminder-every-field').style.opacity = yearly ? '0.45' : '';
  if (yearly) $('reminder-every').value = '0';
}
function pickReminder(item) {
  reminderPicked = item.id;
  $('reminder-title').value = item.title;
  $('reminder-date').value = item.date;
  $('reminder-kind').value = item.kind;
  $('reminder-note').value = item.note || '';
  $('reminder-advance').checked = Boolean(item.advance);
  syncReminderKind();
  $('reminder-every').value = reminderEveryOption(reminderEvery(item));
  $('reminder-error').hidden = true;
  const bits = [];
  if (reminderYearly(item)) bits.push('每年 ' + String(item.date).slice(5) + ' 提一次');
  else if (reminderEvery(item) > 0) bits.push('从 ' + item.date + ' 起，每 ' + reminderEvery(item) + ' 天提一次');
  else bits.push('只在 ' + item.date + ' 提一次');
  if (item.advance) bits.push('前一天再提一次');
  $('reminder-line').textContent = bits.join('，') + '。';
  renderReminders();
}
function clearReminderForm() {
  reminderPicked = '';
  $('reminder-title').value = '';
  $('reminder-date').value = state.reminderDay || '';
  $('reminder-kind').value = 'exam';
  $('reminder-note').value = '';
  $('reminder-advance').checked = false;
  $('reminder-every').value = '0';
  syncReminderKind();
  $('reminder-line').textContent = '';
  $('reminder-error').hidden = true;
}
async function openReminders() {
  $('model-pop').hidden = true;
  const data = await window.zhiji.listReminders();
  reminderCache = data.reminders || [];
  state.reminderDay = data.day || '';
  if (reminderPicked && !reminderCache.some((item) => item.id === reminderPicked)) reminderPicked = '';
  if (!reminderPicked) clearReminderForm();
  renderReminders();
  if (!$('reminders-dialog').open) $('reminders-dialog').showModal();
}
async function saveReminderForm() {
  $('reminder-error').hidden = true;
  const saved = await window.zhiji.saveReminder({
    id: reminderPicked || undefined,
    title: $('reminder-title').value,
    date: $('reminder-date').value,
    kind: $('reminder-kind').value,
    note: $('reminder-note').value,
    everyDays: Number($('reminder-every').value || 0),
    advance: $('reminder-advance').checked
  });
  reminderCache = saved.reminders || reminderCache;
  reminderPicked = saved.reminder.id;
  renderReminders();
  pickReminder(saved.reminder);
}

function bind() {
  $('welcome-name').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') $('welcome-enter').click();
  });
  $('welcome-enter').addEventListener('click', async () => {
    $('welcome-enter').disabled = true;
    $('welcome-error').hidden = true;
    try {
      const data = await window.zhiji.setIdentity({ nickname: $('welcome-name').value, avatar: state.welcomeAvatar });
      applyBootstrap(data);
      $('welcome').hidden = true;
      $('shell').hidden = false;
      await showActive();
      state.model = await window.zhiji.modelStatus();
      paintModelButton();
      $('draft').focus();
    } catch (error) {
      showFormError('welcome-error', error);
      $('welcome-enter').disabled = false;
    }
  });
  $('search').addEventListener('input', () => {
    state.query = $('search').value;
    paintList();
  });
  $('new-chat').addEventListener('click', () => {
    const menu = $('new-menu');
    menu.hidden = !menu.hidden;
    $('new-chat').setAttribute('aria-expanded', String(!menu.hidden));
  });
  $('new-menu').addEventListener('click', async (event) => {
    const kind = event.target && event.target.dataset && event.target.dataset.new;
    if (!kind || state.busy) return;
    $('new-menu').hidden = true;
    $('new-chat').setAttribute('aria-expanded', 'false');
    if (kind === 'group') {
      $('group-error').hidden = true;
      $('group-dialog').showModal();
      return;
    }
    try {
      const created = await window.zhiji.createConversation({ kind: 'dm', agentId: kind });
      state.conversations = created.conversations;
      state.activeId = created.conversation.id;
      state.failure = null;
      state.needProfile = false;
      await showActive();
    } catch (error) {
      state.failure = { code: 'bad', message: errorText(error) };
      paintThread(true);
    }
  });
  $('group-close').addEventListener('click', () => $('group-dialog').close());
  $('group-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const memberIds = [...$('group-form').querySelectorAll('input[name="member"]:checked')].map((node) => node.value);
    try {
      const created = await window.zhiji.createConversation({
        kind: 'group',
        title: $('group-title').value.trim() || '新的群聊',
        memberIds
      });
      $('group-dialog').close();
      state.conversations = created.conversations;
      state.activeId = created.conversation.id;
      state.failure = null;
      state.memberFocus = '';
      await showActive();
    } catch (error) {
      showFormError('group-error', error);
    }
  });
  $('collapse-list').addEventListener('click', () => {
    document.querySelector('.shell').classList.add('is-list-hidden');
    $('restore-list').hidden = false;
  });
  $('restore-list').addEventListener('click', () => {
    document.querySelector('.shell').classList.remove('is-list-hidden');
    $('restore-list').hidden = true;
  });
  $('detail-toggle').addEventListener('click', () => {
    if (state.evidenceMessageId) {
      state.evidenceMessageId = null;
      state.detailOpen = true;
    } else {
      state.detailOpen = !state.detailOpen;
    }
    state.memberFocus = '';
    paintDrawer();
  });
  $('voice').addEventListener('click', () => startVoice());
  $('voice-cancel').addEventListener('click', () => cancelVoice());
  $('voice-stop').addEventListener('click', () => endVoice());
  document.addEventListener('click', (event) => {
    if (!$('new-menu').hidden && !event.target.closest('#new-menu') && event.target !== $('new-chat')) $('new-menu').hidden = true;
    document.querySelectorAll('.react-pop').forEach((pop) => {
      if (pop.hidden || pop.contains(event.target)) return;
      const bar = pop.closest('.msg-actions');
      if (bar && bar.contains(event.target)) return;
      pop.hidden = true;
      const opener = bar && bar.querySelector('button');
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (opener && !typing) opener.focus();
    });
    if (!$('model-pop').hidden && !event.target.closest('#model-pop') && event.target !== $('model-switch') && !event.target.closest('.source')) $('model-pop').hidden = true;
  });
  $('side-user').addEventListener('click', openSettings);
  $('rail-profiles').addEventListener('click', () => openProfile(false));
  $('section-toggle').addEventListener('click', () => {
    $('conv-list').hidden = !$('conv-list').hidden;
    $('section-toggle').classList.toggle('is-collapsed', $('conv-list').hidden);
  });
  $('composer-attach').addEventListener('click', () => $('attach-input').click());
  $('attach-input').addEventListener('change', () => stageAttachments($('attach-input').files));
  $('more-profile').addEventListener('click', () => { $('model-pop').hidden = true; openProfile(false); });
  $('more-recast').addEventListener('click', () => { $('model-pop').hidden = true; requestRecast(); });
  $('more-cases').addEventListener('click', () => openCases().catch((error) => showFormError('cases-error', error)));
  $('model-switch').addEventListener('click', () => openModelPop().catch((error) => { $('trial-line').textContent = errorText(error); }));
  $('effort').addEventListener('click', async (event) => {
    const effort = event.target && event.target.dataset && event.target.dataset.effort;
    if (!effort) return;
    state.modelSettings = await window.zhiji.setModelSettings({ effort });
    paintModelButton();
  });
  $('open-api').addEventListener('click', () => openApi().catch((error) => showFormError('api-error', error)));
  $('open-hf').addEventListener('click', () => window.open('https://huggingface.co/models?pipeline_tag=text-generation&sort=trending'));
  $('open-reminders').addEventListener('click', () => openReminders().catch((error) => showFormError('reminder-error', error)));
  $('reminders-close').addEventListener('click', () => $('reminders-dialog').close());
  $('reminder-kind').addEventListener('change', syncReminderKind);
  $('reminders-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await saveReminderForm();
    } catch (error) {
      showFormError('reminder-error', error);
    }
  });
  $('reminder-delete').addEventListener('click', async () => {
    if (!reminderPicked) {
      $('reminder-line').textContent = '先在左边选一条。';
      return;
    }
    try {
      const kept = await window.zhiji.deleteReminder(reminderPicked);
      reminderCache = kept.reminders || [];
      clearReminderForm();
      renderReminders();
      $('reminder-line').textContent = '删掉了。';
    } catch (error) {
      showFormError('reminder-error', error);
    }
  });
  $('reminder-test').addEventListener('click', async () => {
    $('reminder-error').hidden = true;
    try {
      const sent = await window.zhiji.checkReminders();
      $('reminder-line').textContent = sent && sent.length
        ? '刚发了 ' + sent.length + ' 条通知。今天这些：' + sent.map((item) => item.title).join('、')
        : '今天没有还没提醒过的事。';
    } catch (error) {
      showFormError('reminder-error', error);
    }
  });
  $('reminder-import').addEventListener('click', async () => {
    $('reminder-error').hidden = true;
    try {
      const picked = await window.zhiji.chooseCalendar();
      if (!picked) return;
      const events = picked.events || [];
      let added = 0;
      for (const item of events.slice(0, 40)) {
        const date = String(item.start || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        const saved = await window.zhiji.saveReminder({
          title: item.summary,
          date,
          kind: 'other',
          note: item.location || '',
          source: picked.path,
          everyDays: 0,
          advance: false
        });
        reminderCache = saved.reminders || reminderCache;
        added += 1;
      }
      renderReminders();
      $('reminder-line').textContent = added
        ? '从这份日历读进来 ' + added + ' 条。'
        : '这份日历里没有读到能用的日期。';
    } catch (error) {
      showFormError('reminder-error', error);
    }
  });
  $('run-trial').addEventListener('click', async () => {
    $('trial-line').textContent = '正在试答。整段返回后才有用时，没有首字计时。';
    try {
      const trial = await window.zhiji.runTrial();
      state.modelSettings = await window.zhiji.modelSettings();
      const bits = [
        trial.ok ? '通过' : '未通过',
        '用时 ' + Math.round(trial.ms / 1000) + ' 秒',
        trial.routeOk ? '听懂了六级追问' : '没有接上六级',
        trial.understood ? '按命理回答' : '没有按命理收住',
        trial.cited ? '引用在这张盘上' : '引用没对上'
      ];
      if (trial.problems && trial.problems.length) bits.push(trial.problems.join('、'));
      $('trial-line').textContent = bits.join('。');
      paintModelButton();
    } catch (error) {
      $('trial-line').textContent = errorText(error);
    }
  });
  $('api-close').addEventListener('click', () => $('api-dialog').close());
  $('api-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('api-error').hidden = true;
    try {
      state.modelSettings = await window.zhiji.setModelSettings({
        provider: 'api',
        apiBase: $('api-base').value,
        apiModel: $('api-model').value,
        apiKey: $('api-key').value
      });
      $('api-dialog').close();
      paintModelButton();
      paintHead();
    } catch (error) {
      showFormError('api-error', error);
    }
  });
  $('api-test').addEventListener('click', async () => {
    $('api-error').hidden = true;
    try {
      const result = await window.zhiji.testApi({ apiBase: $('api-base').value, apiModel: $('api-model').value, apiKey: $('api-key').value });
      $('api-error').hidden = false;
      $('api-error').textContent = result.ok ? '连上了，用时 ' + Math.round(result.ms / 1000) + ' 秒。' : result.message;
    } catch (error) {
      showFormError('api-error', error);
    }
  });
  $('api-local').addEventListener('click', async () => {
    state.modelSettings = await window.zhiji.setModelSettings({ provider: 'local' });
    $('api-dialog').close();
    paintModelButton();
    paintHead();
  });
  $('cases-close').addEventListener('click', () => $('cases-dialog').close());
  $('cases-model').addEventListener('click', async () => {
    $('cases-model-line').textContent = '正在用当前模型读六级那一题。';
    try {
      const trial = await window.zhiji.runTrial();
      state.modelSettings = await window.zhiji.modelSettings();
      $('cases-model-line').textContent = (trial.ok ? '这一题通过。' : '这一题未通过。') + (trial.problems || []).join('、') + (trial.excerpt ? '\n' + trial.excerpt : '');
      paintModelButton();
    } catch (error) {
      $('cases-model-line').textContent = errorText(error);
    }
  });
  $('composer').addEventListener('submit', (event) => {
    event.preventDefault();
    if (state.busy) {
      window.zhiji.stopSpeak();
      return;
    }
    runTurn({ action: 'speak' });
  });
  let lastGlance = -Infinity;
  let peekBlink = 0, peekRest = 0;
  function followTyping() {
    paintPeek();
    const peek = $('composer-peek');
    const now = performance.now();
    clearTimeout(peekBlink);
    clearTimeout(peekRest);
    if (!peek.classList.contains('is-up') || reduceMotion()) return;
    const face = peek.querySelector('img');
    peekBlink = setTimeout(() => {
      if (!peek.classList.contains('is-up')) return;
      face.src = ajiSrc('blink', 'sm');
      peekRest = setTimeout(() => {
        face.src = ajiSrc('front', 'sm');
        peek.classList.remove('is-listening');
      }, 170);
    }, 850);
    if (now - lastGlance < 500) return;
    lastGlance = now;
    const img = peek.querySelector('img');
    peek.classList.toggle('is-listening');
    img.src = ajiSrc(peek.classList.contains('is-listening') ? 'glance' : 'front', 'sm');
  }
  $('draft').addEventListener('compositionupdate', followTyping);
  $('draft').addEventListener('input', () => {
    resizeDraft();
    state.mentionIndex = 0;
    if (state.voice !== 'recording') state.voiceNote = '';
    paintMentions();
    paintVoice();
    followTyping();
  });
  $('draft').addEventListener('focus', paintPeek);
  $('draft').addEventListener('blur', () => setTimeout(paintPeek, 0));
  $('draft').addEventListener('keydown', (event) => {
    const menu = $('mention-menu');
    if (menu && !menu.hidden) {
      const buttons = [...menu.querySelectorAll('button')];
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        state.mentionIndex = (state.mentionIndex + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
        paintMentions();
        return;
      }
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        const chosen = buttons[state.mentionIndex];
        if (chosen) insertMention(chosen.textContent.replace(/^@/, ''));
        return;
      }
      if (event.key === 'Escape') {
        menu.hidden = true;
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      runTurn({ action: 'speak' });
    }
  });
  $('invite').addEventListener('click', () => runTurn({ action: 'invite' }));
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!$('new-menu').hidden) $('new-menu').hidden = true;
    else if (state.evidenceMessageId) {
      state.evidenceMessageId = null;
      paintDrawer();
    }
  });
  $('profile-close').addEventListener('click', () => $('profile-dialog').close());
  $('profile-new').addEventListener('click', () => {
    fillProfileForm(null);
    paintProfileList();
  });
  $('profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('profile-error').hidden = true;
    try {
      await saveProfile(true);
      $('profile-dialog').close();
      paintShell();
      if (state.profileForTurn && state.pending) runTurn({ resume: true });
    } catch (error) {
      showFormError('profile-error', error);
    }
  });
  $('profile-delete').addEventListener('click', async () => {
    if (!state.draftId) return;
    if (!window.confirm('删除这份命主档案？已经写下的回复还留着当时的依据。')) return;
    const result = await window.zhiji.deleteProfile(state.draftId);
    state.profiles = result.profiles;
    state.conversations = result.conversations;
    state.snapshot = null;
    fillProfileForm(state.profiles[0] || null);
    paintProfileList();
    paintShell();
  });
  $('settings-close').addEventListener('click', () => $('settings-dialog').close());
  $('settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('settings-error').hidden = true;
    try {
      state.identity = await window.zhiji.updateIdentity({ nickname: $('settings-name').value, avatar: state.settingsAvatar });
      const preference = document.querySelector('#settings-form input[name="preference"]:checked').value;
      const updated = await window.zhiji.updateAgent({
        id: 'zhiji',
        name: $('settings-agent-name').value,
        seal: state.agentSeal,
        preference
      });
      state.agents = state.agents.map((item) => item.id === 'zhiji' ? updated.agent : item);
      state.conversations = updated.conversations;
      $('settings-dialog').close();
      paintShell();
    } catch (error) {
      showFormError('settings-error', error);
    }
  });
}
function paintWelcomePicker() {
  renderPicker($('welcome-picker'), state.welcomeAvatar, (value) => {
    state.welcomeAvatar = value;
    paintWelcomePicker();
  });
}
function openSettings() {
  if (!state.identity) return;
  $('settings-name').value = state.identity.nickname;
  state.settingsAvatar = state.identity.avatar;
  fixSettingsPicker();
  const zhiji = agentById('zhiji');
  $('settings-agent-name').value = zhiji.name;
  state.agentSeal = zhiji.seal || '几';
  renderAgentSeals();
  document.querySelector('#settings-form input[name="preference"][value="' + (zhiji.preference || 'conclusion-first') + '"]').checked = true;
  $('settings-error').hidden = true;
  if (!$('settings-dialog').open) $('settings-dialog').showModal();
}

function fixSettingsPicker() {
  renderPicker($('settings-picker'), state.settingsAvatar, (value) => {
    state.settingsAvatar = value;
    fixSettingsPicker();
  });
}

async function init() {
  if (!window.zhiji || !window.zhiji.bootstrap) {
    $('boot').textContent = '请在知几的窗口里打开。';
    return;
  }
  bind();
  fillHourSelect();
  if (window.zhiji.onOpenReminders) {
    window.zhiji.onOpenReminders(() => {
      if (state.identity) openReminders().catch(() => {});
    });
  }
  try {
    const data = await window.zhiji.bootstrap();
    applyBootstrap(data);
    state.modelSettings = await window.zhiji.modelSettings();
    const listed = await window.zhiji.listLocalModels().catch(() => ({ models: [] }));
    state.localModels = listed.models || [];
    $('boot').hidden = true;
    if (!data.identity) {
      $('welcome').hidden = false;
      paintWelcomePicker();
      $('welcome-name').focus();
      return;
    }
    $('shell').hidden = false;
    await showActive();
    state.model = await window.zhiji.modelStatus();
    paintModelButton();
    setInterval(() => {
      if (reduceMotion() || !state.typing || state.ajiPose !== 'cast') return;
      document.querySelectorAll('.aji[data-live="1"][data-pose="cast"]').forEach((node) => {
        setPose(node, 'blink');
        setTimeout(() => {
          if (state.ajiPose === 'cast') setPose(node, 'cast');
        }, 180);
      });
    }, 4500);
  } catch (error) {
    $('boot').textContent = errorText(error);
  }
}

init();
