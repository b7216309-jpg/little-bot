'use strict';
// Little Bot has three kinds of chat: the one continuous conversation (where proactive messages and scheduled runs
// land), the unsaved Quick session (marked private), and any number of saved sessions (marked session).

const MAX_SESSIONS = 200;
const TITLE_LIMIT = 80;
const isQuick = chat => chat?.private === true;
const isSession = chat => chat?.session === true && chat.private !== true;
const isMain = chat => Boolean(chat) && chat.private !== true && chat.session !== true;
const mainChat = data => (data?.chats || []).find(isMain) || null;
const quickChat = data => (data?.chats || []).find(isQuick) || null;
const sessions = data => (data?.chats || []).filter(isSession);
const chatKind = chat => isQuick(chat) ? 'quick' : isSession(chat) ? 'session' : 'main';

function cleanTitle(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}
// A new session is named after the start of its first message; the user can rename it.
function sessionTitle(text) {
  const line = String(text || '').split(/\r?\n/).map(item => item.trim()).find(Boolean) || '';
  const title = cleanTitle(line.replace(/^\/goal\s+/i, ''));
  if (!title) return 'New session';
  return title.length > 48 ? `${title.slice(0, 47).trimEnd()}…` : title;
}
function validTitle(value) {
  const title = cleanTitle(value);
  if (!title || title.length > TITLE_LIMIT) throw new Error(`Name the session with 1 to ${TITLE_LIMIT} characters.`);
  return title;
}

module.exports = { MAX_SESSIONS, TITLE_LIMIT, isQuick, isSession, isMain, mainChat, quickChat, sessions, chatKind, sessionTitle, validTitle };
