const { contextBridge, ipcRenderer, webUtils } = require('electron');
const invoke = name => data => ipcRenderer.invoke(`bot:${name}`, data);
contextBridge.exposeInMainWorld('bot', {
  getState: invoke('getState'), getContextUsed: invoke('getContextUsed'), reportError: invoke('reportError'), openLogs: invoke('openLogs'), chooseWorkspace: invoke('chooseWorkspace'),
  saveProfile: invoke('saveProfile'), openProfileFolder: invoke('openProfileFolder'),
  saveSettings: invoke('saveSettings'), login: invoke('login'), send: invoke('send'),
  saveConnection: invoke('saveConnection'), refreshConnection: invoke('refreshConnection'), refreshProviderUsage: invoke('refreshProviderUsage'),
  chooseAttachments: invoke('chooseAttachments'), importAttachment: invoke('importAttachment'),
  attachFiles: files => {
    if (!Array.isArray(files) || files.length > 8) return Promise.reject(new Error('Choose up to 8 files.'));
    const paths = files.map(file => webUtils.getPathForFile(file));
    if (paths.some(filePath => !filePath)) return Promise.reject(new Error('This file has no local path. Use the attach button.'));
    return ipcRenderer.invoke('bot:attachFiles', paths);
  },
  openAttachment: invoke('openAttachment'), saveAttachment: invoke('saveAttachment'),
  releaseAttachment: invoke('releaseAttachment'), deleteAttachment: invoke('deleteAttachment'),
  attachmentStorage: invoke('attachmentStorage'), cleanupAttachments: invoke('cleanupAttachments'),
  saveServiceKey: invoke('saveServiceKey'), openServicePage: invoke('openServicePage'),
  openAgentBrowser: invoke('openAgentBrowser'), closeAgentBrowser: invoke('closeAgentBrowser'), installAgentBrowser: invoke('installAgentBrowser'),
  stop: invoke('stop'), challengeIndependentCheck: invoke('challengeIndependentCheck'), compact: invoke('compact'), deleteChat: invoke('deleteChat'), respondApproval: invoke('respondApproval'),
  saveAutomation: invoke('saveAutomation'), deleteAutomation: invoke('deleteAutomation'), runAutomation: invoke('runAutomation'),
  saveStandingIntent: invoke('saveStandingIntent'), deleteStandingIntent: invoke('deleteStandingIntent'), toggleStandingIntent: invoke('toggleStandingIntent'),
  saveCalendarEvent: invoke('saveCalendarEvent'), deleteCalendarEvent: invoke('deleteCalendarEvent'), openWorkspace: invoke('openWorkspace'),
  saveGoal: invoke('saveGoal'), runGoal: invoke('runGoal'), pauseGoal: invoke('pauseGoal'), resumeGoal: invoke('resumeGoal'),
  answerGoal: invoke('answerGoal'),
  deleteGoal: invoke('deleteGoal'), pauseAutonomy: invoke('pauseAutonomy'), resumeAutonomy: invoke('resumeAutonomy'),
  previewGoalRestore: invoke('previewGoalRestore'), restoreGoal: invoke('restoreGoal'), discardGoalSnapshot: invoke('discardGoalSnapshot'),
  saveMemory: invoke('saveMemory'), saveFact: invoke('saveFact'), deleteFact: invoke('deleteFact'), clearEpisodes: invoke('clearEpisodes'),
  searchMemory: invoke('searchMemory'), getMemorySource: invoke('getMemorySource'),
  configureMemory: invoke('configureMemory'), linkMemoryProject: invoke('linkMemoryProject'),
  retryMemoryLearning: invoke('retryMemoryLearning'), discardMemoryLearning: invoke('discardMemoryLearning'),
  listBackups: invoke('listBackups'), createBackup: invoke('createBackup'), restoreBackup: invoke('restoreBackup'),
  relayState: invoke('relayState'), relaySetEnabled: invoke('relaySetEnabled'), relaySetPort: invoke('relaySetPort'), relaySetApprovals: invoke('relaySetApprovals'),
  relayPair: invoke('relayPair'), relayCancelPair: invoke('relayCancelPair'), relayRemoveDevice: invoke('relayRemoveDevice'), relayTailscaleHttps: invoke('relayTailscaleHttps'),
  answerProactive: invoke('answerProactive'), setActivityAwareness: invoke('setActivityAwareness'), removeWebWatch: invoke('removeWebWatch'),
  saveHeartbeat: invoke('saveHeartbeat'), runHeartbeat: invoke('runHeartbeat'), stopHeartbeat: invoke('stopHeartbeat'), readHeartbeat: invoke('readHeartbeat'),
  heartbeatFeedback: invoke('heartbeatFeedback'),
  refreshExtensions: invoke('refreshExtensions'), saveMcpServer: invoke('saveMcpServer'), deleteMcpServer: invoke('deleteMcpServer'),
  toggleMcpTool: invoke('toggleMcpTool'), loginMcpServer: invoke('loginMcpServer'),
  saveSkill: invoke('saveSkill'), importSkill: invoke('importSkill'), deleteSkill: invoke('deleteSkill'),
  importPlugin: invoke('importPlugin'), togglePlugin: invoke('togglePlugin'), deletePlugin: invoke('deletePlugin'),
  onEvent(callback) {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('bot:event', handler);
    return () => ipcRenderer.removeListener('bot:event', handler);
  },
});
