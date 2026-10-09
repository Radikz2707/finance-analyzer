/**
 * ReasoningEngine — логический вывод, анализ причин, принятие решений,
 * генерация и проверка гипотез, анализ рисков.
 */

// ──────────────────────────────────────────────
// 1. Типы логического вывода
// ──────────────────────────────────────────────

/** Стратегия логического вывода */
export type ReasoningStrategy =
  | 'deductive' // Дедукция (от общего к частному)
  | 'inductive' // Индукция (от частного к общему)
  | 'abductive' // Абдукция (наилучшее объяснение)
  | 'analogical' // Аналогия
  | 'causal'; // Причинно-следственный анализ

/** Уровень уверенности */
export type ConfidenceLevel =
  | 'very-low'
  | 'low'
  | 'medium'
  | 'high'
  | 'very-high'
  | 'certainty';

/** Статус гипотезы */
export type HypothesisStatus =
  | 'proposed'
  | 'testing'
  | 'validated'
  | 'falsified'
  | 'pending';

/** Тип причинного анализа */
export type CausalAnalysisType =
  | 'root-cause' // Корневая причина
  | 'correlation' // Корреляция
  | 'causation' // Каузальность
  | 'contribution'; // Вклад

// ──────────────────────────────────────────────
// 2. Типы принятия решений
// ──────────────────────────────────────────────

/** Статус решения */
export type DecisionStatus = 'proposed' | 'approved' | 'rejected' | 'pending-review';

/** Тип оценки риска */
export type RiskLevel = 'negligible' | 'low' | 'medium' | 'high' | 'critical';

/** Тип митигации риска */
export type MitigationType =
  | 'avoid' // Избежать
  | 'mitigate' // Снизить
  | 'transfer' // Передать
  | 'accept'; // Принять

/** Тип перспектив мышления */
export type PerspectiveType =
  | 'optimistic' // Оптимистичная
  | 'pessimistic' // Пессимистичная
  | 'realistic' // Реалистичная
  | 'contrarian' // Контарианская
  | 'systemic'; // Системная

// ──────────────────────────────────────────────
// 3. Интерфейсы вывода
// ──────────────────────────────────────────────

/** Атомарный факт */
export interface Fact {
  id: string;
  statement: string;
  verified: boolean;
  source?: string;
  confidence: number; // 0-1
  createdAt: string;
}

/** Логическое правило */
export interface LogicRule {
  id: string;
  name: string;
  premise: string;
  conclusion: string;
  strategy: ReasoningStrategy;
  confidence: number;
  isActive: boolean;
}

/** Результат логического вывода */
export interface ReasoningResult {
  id: string;
  strategy: ReasoningStrategy;
  premises: string[];
  conclusion: string;
  confidence: number;
  reasoningChain: ReasoningStep[];
  createdAt: string;
}

/** Шаг логического вывода */
export interface ReasoningStep {
  step: number;
  statement: string;
  ruleApplied: string;
  confidence: number;
}

// ──────────────────────────────────────────────
// 4. Интерфейсы гипотез
// ──────────────────────────────────────────────

/** Гипотеза */
export interface Hypothesis {
  id: string;
  title: string;
  description: string;
  evidence: string[];
  contraEvidence: string[];
  status: HypothesisStatus;
  probability: number; // 0-1
  testedAt?: string;
  createdBy: string;
  createdAt: string;
}

/** Результат проверки гипотезы */
export interface HypothesisTestResult {
  hypothesisId: string;
  testPassed: boolean;
  confidenceChange: number;
  newEvidence: string[];
  timestamp: string;
}

// ──────────────────────────────────────────────
// 5. Интерфейсы причинного анализа
// ──────────────────────────────────────────────

/** Причинная связь */
export interface CausalLink {
  id: string;
  cause: string;
  effect: string;
  strength: number; // 0-1
  type: CausalAnalysisType;
  evidence: string[];
  confidence: number;
}

/** Результат причинного анализа */
export interface CausalAnalysisResult {
  rootCauses: string[];
  causalLinks: CausalLink[];
  contributingFactors: string[];
  confidence: number;
  recommendations: string[];
}

// ──────────────────────────────────────────────
// 6. Интерфейсы принятия решений
// ──────────────────────────────────────────────

/** Вариант решения */
export interface DecisionOption {
  id: string;
  label: string;
  description: string;
  pros: string[];
  cons: string[];
  expectedOutcome: string;
  probability: number;
  riskLevel: RiskLevel;
  resourcesRequired: string[];
}

/** Оценка риска */
export interface RiskAssessment {
  risk: string;
  probability: number; // 0-1
  impact: number; // 0-1
  level: RiskLevel;
  mitigation: MitigationType;
  mitigationStrategy: string;
}

/** Решение */
export interface Decision {
  id: string;
  question: string;
  options: DecisionOption[];
  selectedOptionId?: string;
  status: DecisionStatus;
  rationale: string;
  risks: RiskAssessment[];
  confidence: number;
  createdAt: string;
  approvedAt?: string;
}

// ──────────────────────────────────────────────
// 7. Интерфейсы перспектив
// ──────────────────────────────────────────────

/** Перспектива анализа */
export interface PerspectiveAnalysis {
  perspective: PerspectiveType;
  analysis: string;
  keyPoints: string[];
  blindSpots: string[];
  confidence: number;
}

/** Мульти-перспективный анализ */
export interface MultiPerspectiveAnalysis {
  topic: string;
  perspectives: PerspectiveAnalysis[];
  synthesis: string;
  overallConfidence: number;
  recommendations: string[];
}

// ──────────────────────────────────────────────
// 8. Статистика и метрики
// ──────────────────────────────────────────────

/** Статистика ReasoningEngine */
export interface ReasoningStats {
  totalReasonings: number;
  byStrategy: Record<ReasoningStrategy, number>;
  averageConfidence: number;
  totalHypotheses: number;
  byHypothesisStatus: Record<HypothesisStatus, number>;
  totalDecisions: number;
  byDecisionStatus: Record<DecisionStatus, number>;
  totalCausalLinks: number;
}

// ──────────────────────────────────────────────
// 9. Входы и выходы
// ──────────────────────────────────────────────

/** Действия ReasoningEngine */
export type ReasoningEngineAction =
  | 'deduce' // Дедукция
  | 'induce' // Индукция
  | 'abduce' // Абдукция
  | 'analyze-analogy' // Аналогия
  | 'causal-analysis' // Причинный анализ
  | 'create-hypothesis' // Создать гипотезу
  | 'test-hypothesis' // Проверить гипотезу
  | 'get-hypotheses' // Получить гипотезы
  | 'make-decision' // Принять решение
  | 'assess-risk' // Оценить риск
  | 'multi-perspective' // Мульти-перспектива
  | 'get-stats' // Получить статистику
  | 'clear-all'; // Очистить всё

/** Дедукция */
export interface DeduceParams {
  premises: string[];
  rules?: LogicRule[];
}

/** Индукция */
export interface InduceParams {
  observations: string[];
  pattern?: string;
}

/** Абдукция */
export interface AbduceParams {
  observation: string;
  possibleCauses: string[];
}

/** Аналогия */
export interface AnalogyParams {
  sourceDomain: string;
  targetDomain: string;
  similarities: string[];
}

/** Причинный анализ */
export interface CausalAnalysisParams {
  effect: string;
  potentialCauses: string[];
  context?: string;
}

/** Создание гипотезы */
export interface CreateHypothesisParams {
  title: string;
  description: string;
  evidence?: string[];
}

/** Проверка гипотезы */
export interface TestHypothesisParams {
  hypothesisId: string;
  testPassed: boolean;
  newEvidence?: string[];
}

/** Получение гипотез */
export interface GetHypothesesParams {
  status?: HypothesisStatus;
}

/** Принятие решения */
export interface MakeDecisionParams {
  question: string;
  options: Omit<DecisionOption, 'id'>[];
  criteria?: string[];
}

/** Оценка риска */
export interface AssessRiskParams {
  scenario: string;
  factors: string[];
}

/** Мульти-перспектива */
export interface MultiPerspectiveParams {
  topic: string;
  perspectives?: PerspectiveType[];
}

/** Получение статистики */
export interface GetStatsParams {
  scope?: 'all' | 'reasonings' | 'hypotheses' | 'decisions';
}

/** Вход ReasoningEngine */
export type ReasoningEngineInput =
  | { action: 'deduce'; params: DeduceParams }
  | { action: 'induce'; params: InduceParams }
  | { action: 'abduce'; params: AbduceParams }
  | { action: 'analyze-analogy'; params: AnalogyParams }
  | { action: 'causal-analysis'; params: CausalAnalysisParams }
  | { action: 'create-hypothesis'; params: CreateHypothesisParams }
  | { action: 'test-hypothesis'; params: TestHypothesisParams }
  | { action: 'get-hypotheses'; params?: GetHypothesesParams }
  | { action: 'make-decision'; params: MakeDecisionParams }
  | { action: 'assess-risk'; params: AssessRiskParams }
  | { action: 'multi-perspective'; params: MultiPerspectiveParams }
  | { action: 'get-stats'; params?: GetStatsParams }
  | { action: 'clear-all'; params?: Record<string, never> };

/** Результат операции */
export interface ReasoningOperationResult {
  success: boolean;
  message: string;
  reasoningResult?: ReasoningResult;
  causalAnalysis?: CausalAnalysisResult;
  hypothesis?: Hypothesis;
  hypotheses?: Hypothesis[];
  testResult?: HypothesisTestResult;
  decision?: Decision;
  riskAssessment?: RiskAssessment;
  multiPerspective?: MultiPerspectiveAnalysis;
  stats?: ReasoningStats;
}

/** Выход ReasoningEngine */
export type ReasoningEngineOutput = ReasoningOperationResult;
