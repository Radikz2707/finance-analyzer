/* Временный отладочный скрипт (не для продакшена) */
import { DirectorChatStore } from '../src/js/modules/pipeline/director/chat-session.js';
import { createInMemoryMemoryAdapter } from '../src/js/modules/pipeline/director/director-memory.js';

const adapter = createInMemoryMemoryAdapter();
const chat = new DirectorChatStore({ memoryAdapter: adapter });

const s = chat.createSession();
console.log('session:', s.sessionId);

chat.appendMessage(s.sessionId, 'user', 'Что делать с PLZL?', {
  tickers: ['PLZL'],
});
chat.appendMessage(s.sessionId, 'director', 'Ответ Director', {
  connectedAgents: ['ai'],
});

console.log('history now:', chat.getHistory(s.sessionId).length);

const conv = adapter.queryByType('conversation');
console.log('conversations:', conv.length, JSON.stringify(conv[0]));

const chat2 = new DirectorChatStore({ memoryAdapter: adapter });
const restored = chat2.restoreSession(s.sessionId);
console.log(
  'restored:',
  restored.messages.length,
  restored.messages.map((m) => m.role),
);
