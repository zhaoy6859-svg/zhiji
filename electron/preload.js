'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zhiji', {
  consult: (payload) => ipcRenderer.invoke('zhiji:consult', payload),
  getConfig: () => ipcRenderer.invoke('zhiji:get-config'),
  setConfig: (config) => ipcRenderer.invoke('zhiji:set-config', config),
  chooseFolder: () => ipcRenderer.invoke('zhiji:choose-folder'),
  readWorkspaceFile: (name) => ipcRenderer.invoke('zhiji:read-workspace-file', name),
  chooseCalendar: () => ipcRenderer.invoke('zhiji:choose-calendar'),
  listReminders: () => ipcRenderer.invoke('zhiji:list-reminders'),
  saveReminder: (input) => ipcRenderer.invoke('zhiji:save-reminder', input),
  deleteReminder: (id) => ipcRenderer.invoke('zhiji:delete-reminder', id),
  checkReminders: () => ipcRenderer.invoke('zhiji:check-reminders'),
  onOpenReminders: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('zhiji:open-reminders', listener);
    return () => ipcRenderer.removeListener('zhiji:open-reminders', listener);
  },
  bootstrap: () => ipcRenderer.invoke('zhiji:bootstrap'),
  setIdentity: (input) => ipcRenderer.invoke('zhiji:set-identity', input),
  updateIdentity: (input) => ipcRenderer.invoke('zhiji:update-identity', input),
  updateAgent: (input) => ipcRenderer.invoke('zhiji:update-agent', input),
  saveProfile: (input) => ipcRenderer.invoke('zhiji:save-profile', input),
  deleteProfile: (id) => ipcRenderer.invoke('zhiji:delete-profile', id),
  selectConversation: (id) => ipcRenderer.invoke('zhiji:select-conversation', id),
  setConversationProfile: (conversationId, profileId) => ipcRenderer.invoke('zhiji:set-conversation-profile', { conversationId, profileId }),
  createConversation: (input) => ipcRenderer.invoke('zhiji:create-conversation', input),
  listMessages: (id) => ipcRenderer.invoke('zhiji:list-messages', id),
  appendMessage: (input) => ipcRenderer.invoke('zhiji:append-message', input),
  updateMessage: (input) => ipcRenderer.invoke('zhiji:update-message', input),
  stopSpeak: () => ipcRenderer.invoke('zhiji:stop-speak'),
  toggleReaction: (input) => ipcRenderer.invoke('zhiji:toggle-reaction', input),
  saveSnapshot: (input) => ipcRenderer.invoke('zhiji:save-snapshot', input),
  getSnapshot: (id) => ipcRenderer.invoke('zhiji:get-snapshot', id),
  clearSnapshot: (id) => ipcRenderer.invoke('zhiji:clear-snapshot', id),
  speak: (input) => ipcRenderer.invoke('zhiji:speak', input),
  onSpeakDelta: (handler) => {
    const listener = (_event, piece) => handler(piece);
    ipcRenderer.on('zhiji:speak-delta', listener);
    return () => ipcRenderer.removeListener('zhiji:speak-delta', listener);
  },
  modelStatus: () => ipcRenderer.invoke('zhiji:model-status'),
  startModel: (modelId) => ipcRenderer.invoke('zhiji:start-model', modelId || ''),
  modelSettings: () => ipcRenderer.invoke('zhiji:model-settings'),
  setModelSettings: (input) => ipcRenderer.invoke('zhiji:set-model-settings', input),
  listLocalModels: () => ipcRenderer.invoke('zhiji:list-local-models'),
  testApi: (input) => ipcRenderer.invoke('zhiji:test-api', input),
  previewSend: (input) => ipcRenderer.invoke('zhiji:preview-send', input),
  runCases: () => ipcRenderer.invoke('zhiji:run-cases'),
  runTrial: () => ipcRenderer.invoke('zhiji:run-trial')
});
