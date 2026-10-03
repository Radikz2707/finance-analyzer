/* Временный отладочный скрипт (не для продакшена) */
import { DirectorAgent } from '../src/js/modules/pipeline/director/director.js';
import { DirectorAgentFacade } from '../src/js/modules/pipeline/director/agent-facade.js';
import {
  createInMemoryMemoryAdapter,
  DirectorMemoryStore,
} from '../src/js/modules/pipeline/director/director-memory.js';
import { DirectorChatStore } from '../src/js/modules/pipeline/director/chat-session.js';
import { DirectorAuditLog } from '../src/js/modules/pipeline/director/director-audit.js';

const facts = {
  assetsAnalysis: [
    {
      ticker: 'PLZL',
      name: 'Полюс',
      currentPercent: 32,
      targetPercent: 15,
      deficitRub: 0,
      status: 'REDUCE',
      balancePrice: 1000,
      currentPrice: 420,
      unrealizedProfitRub: -58000,
      isConcentrated: true,
    },
    {
      ticker: 'SBER',
      name: 'Сбер',
      currentPercent: 8,
      targetPercent: 12,
      deficitRub: 40000,
      status: 'BUY',
      balancePrice: 250,
      currentPrice: 300,
      unrealizedProfitRub: 5000,
    },
  ],
  totalPortfolioValue: 500000,
  freeCashRub: 60000,
};

const sharedAdapter = createInMemoryMemoryAdapter();
const memory1 = new DirectorMemoryStore(sharedAdapter);
const chat1 = new DirectorChatStore({ memoryAdapter: sharedAdapter });
const director1 = new DirectorAgent({
  facade: new DirectorAgentFacade(),
  memory: memory1,
  chat: chat1,
  audit: new DirectorAuditLog(),
  initialFacts: facts,
});
director1.createSession();

console.log('ASK 1...');
await director1.processUserMessage('Что делать с PLZL?');
console.log(
  'currentSession:',
  director1.currentSession ? director1.currentSession.sessionId : null,
);

const sessionId = director1.currentSession!.sessionId;

const convs = sharedAdapter.queryByType('conversation');
console.log('conversations in adapter:', convs.length);
for (const c of convs) {
  console.log(
    '  type=' +
      c.type +
      ' contentHead=' +
      JSON.stringify(c.content.slice(0, 40)),
  );
  console.log(
    '  match=' + /^\[(user|director|system)\]\s?(.*)$/s.test(c.content),
  );
}

const memory2 = new DirectorMemoryStore(sharedAdapter);
const chat2 = new DirectorChatStore({ memoryAdapter: sharedAdapter });
const restoredDirect = chat2.restoreSession(sessionId);
console.log('restoredDirect.messages:', restoredDirect.messages.length);
console.log('adapter null?', chat2 !== null);

const director2 = new DirectorAgent({
  facade: new DirectorAgentFacade(),
  memory: memory2,
  chat: chat2,
  audit: new DirectorAuditLog(),
  initialFacts: facts,
});
director2.restoreSession(sessionId);
console.log('history2:', director2.getChatHistory(sessionId).length);
