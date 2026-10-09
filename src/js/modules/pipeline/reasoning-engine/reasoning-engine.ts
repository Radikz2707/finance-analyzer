/**
 * ReasoningEngine — логический вывод, анализ причин, принятие решений,
 * генерация и проверка гипотез, анализ рисков.
 */

import { randomUUID } from 'crypto';
import { AgentBase } from '../agent/agent-base.js';
import type { AgentConfig } from '../agent/types.js';
import type {
  ReasoningEngineInput,
  ReasoningEngineOutput,
  DeduceParams,
  InduceParams,
  AbduceParams,
  AnalogyParams,
  CausalAnalysisParams,
  CreateHypothesisParams,
  TestHypothesisParams,
  GetHypothesesParams,
  MakeDecisionParams,
  AssessRiskParams,
  MultiPerspectiveParams,
  GetStatsParams,
  ReasoningResult,
  ReasoningStep,
  Hypothesis,
  HypothesisTestResult,
  CausalLink,
  CausalAnalysisResult,
  DecisionOption,
  RiskAssessment,
  Decision,
  PerspectiveAnalysis,
  MultiPerspectiveAnalysis,
  ReasoningStats,
  ReasoningStrategy,
  HypothesisStatus,
  DecisionStatus,
  RiskLevel,
  MitigationType,
  PerspectiveType,
} from './types.js';

const DEFAULT_CONFIDENCE = 0.7;

export class ReasoningEngine extends AgentBase {
  private reasonings: Map<string, ReasoningResult>;
  private hypotheses: Map<string, Hypothesis>;
  private decisions: Map<string, Decision>;
  private causalLinks: CausalLink[];
  private testResults: HypothesisTestResult[];

  constructor(config: AgentConfig) {
    super({ ...config, timeoutMs: config.timeoutMs ?? 60000 });
    this.reasonings = new Map();
    this.hypotheses = new Map();
    this.decisions = new Map();
    this.causalLinks = [];
    this.testResults = [];
  }

  protected async executeInternal(input: unknown): Promise<unknown> {
    const p = input as ReasoningEngineInput;
    switch (p.action) {
      case 'deduce':
        return this.deduce(p.params as DeduceParams);
      case 'induce':
        return this.induce(p.params as InduceParams);
      case 'abduce':
        return this.abduce(p.params as AbduceParams);
      case 'analyze-analogy':
        return this.analyzeAnalogy(p.params as AnalogyParams);
      case 'causal-analysis':
        return this.causalAnalysis(p.params as CausalAnalysisParams);
      case 'create-hypothesis':
        return this.createHypothesis(p.params as CreateHypothesisParams);
      case 'test-hypothesis':
        return this.testHypothesis(p.params as TestHypothesisParams);
      case 'get-hypotheses':
        return this.getHypotheses(p.params as GetHypothesesParams | undefined);
      case 'make-decision':
        return this.makeDecision(p.params as MakeDecisionParams);
      case 'assess-risk':
        return this.assessRisk(p.params as AssessRiskParams);
      case 'multi-perspective':
        return this.multiPerspective(p.params as MultiPerspectiveParams);
      case 'get-stats':
        return this.getStats(p.params as GetStatsParams | undefined);
      case 'clear-all':
        return this.clearAll();
      default:
        throw new Error('Unknown action: ' + (p as { action: string }).action);
    }
  }

  private now(): string {
    return new Date().toISOString();
  }

  // ── Логический вывод ──

  private deduce(params: DeduceParams): ReasoningEngineOutput {
    if (!params.premises || params.premises.length === 0) {
      return { success: false, message: 'Недостаточно предпосылок' };
    }

    const rules = params.rules ?? this.getDefaultLogicRules();
    const reasoningChain: ReasoningStep[] = [];

    for (let i = 0; i < params.premises.length; i++) {
      reasoningChain.push({
        step: i + 1,
        statement: params.premises[i]!,
        ruleApplied: (rules[i % rules.length]?.name) ?? 'general_logic',
        confidence: DEFAULT_CONFIDENCE,
      });
    }

    const conclusion = this.synthesizeConclusion(params.premises, rules);
    const confidence = this.calculateConfidence(reasoningChain);

    const result: ReasoningResult = {
      id: randomUUID(),
      strategy: 'deductive',
      premises: [...params.premises],
      conclusion,
      confidence,
      reasoningChain,
      createdAt: this.now(),
    };

    this.reasonings.set(result.id, result);

    return {
      success: true,
      message: 'Дедуктивный вывод завершён',
      reasoningResult: result,
    };
  }

  private induce(params: InduceParams): ReasoningEngineOutput {
    if (!params.observations || params.observations.length === 0) {
      return { success: false, message: 'Нет наблюдений для анализа' };
    }

    const pattern = params.pattern ?? this.detectPattern(params.observations);
    const reasoningChain: ReasoningStep[] = [
      {
        step: 1,
        statement: 'Сбор наблюдений: ' + params.observations.length + ' единиц',
        ruleApplied: 'induction',
        confidence: 0.6,
      },
      {
        step: 2,
        statement: 'Обнаружен паттерн: ' + pattern,
        ruleApplied: 'pattern_recognition',
        confidence: 0.75,
      },
      {
        step: 3,
        statement: 'Формирование общего правила',
        ruleApplied: 'generalization',
        confidence: 0.7,
      },
    ];

    const result: ReasoningResult = {
      id: randomUUID(),
      strategy: 'inductive',
      premises: [...params.observations],
      conclusion: 'Общее правило: ' + pattern,
      confidence: 0.7,
      reasoningChain,
      createdAt: this.now(),
    };

    this.reasonings.set(result.id, result);

    return {
      success: true,
      message: 'Индуктивный вывод завершён',
      reasoningResult: result,
    };
  }

  private abduce(params: AbduceParams): ReasoningEngineOutput {
    if (!params.possibleCauses || params.possibleCauses.length === 0) {
      return { success: false, message: 'Нет возможных причин для анализа' };
    }

    const bestCause = this.selectBestCause(
      params.observation,
      params.possibleCauses,
    );
    const reasoningChain: ReasoningStep[] = [
      {
        step: 1,
        statement: 'Наблюдение: ' + params.observation,
        ruleApplied: 'observation',
        confidence: 0.9,
      },
      {
        step: 2,
        statement: 'Возможные причины: ' + params.possibleCauses.length,
        ruleApplied: 'causal_search',
        confidence: 0.7,
      },
      {
        step: 3,
        statement: 'Лучшее объяснение: ' + bestCause,
        ruleApplied: 'inference_to_best_explanation',
        confidence: 0.75,
      },
    ];

    const result: ReasoningResult = {
      id: randomUUID(),
      strategy: 'abductive',
      premises: [params.observation, ...params.possibleCauses],
      conclusion: 'Наилучшее объяснение: ' + bestCause,
      confidence: 0.75,
      reasoningChain,
      createdAt: this.now(),
    };

    this.reasonings.set(result.id, result);

    return {
      success: true,
      message: 'Абдуктивный вывод завершён',
      reasoningResult: result,
    };
  }

  private analyzeAnalogy(params: AnalogyParams): ReasoningEngineOutput {
    if (!params.similarities || params.similarities.length === 0) {
      return { success: false, message: 'Нет сходств для аналогии' };
    }

    const reasoningChain: ReasoningStep[] = [
      {
        step: 1,
        statement: 'Исходная область: ' + params.sourceDomain,
        ruleApplied: 'source_mapping',
        confidence: 0.8,
      },
      {
        step: 2,
        statement: 'Целевая область: ' + params.targetDomain,
        ruleApplied: 'target_mapping',
        confidence: 0.8,
      },
      {
        step: 3,
        statement: 'Сходств найдено: ' + params.similarities.length,
        ruleApplied: 'similarity_analysis',
        confidence: 0.75,
      },
      {
        step: 4,
        statement: 'Перенос свойств из источника в цель',
        ruleApplied: 'property_transfer',
        confidence: 0.65,
      },
    ];

    const confidence = 0.65 + params.similarities.length * 0.03;
    const cappedConfidence = Math.min(confidence, 0.95);

    const result: ReasoningResult = {
      id: randomUUID(),
      strategy: 'analogical',
      premises: [
        'Источник: ' + params.sourceDomain,
        'Цель: ' + params.targetDomain,
        ...params.similarities,
      ],
      conclusion:
        'Аналогия между "' +
        params.sourceDomain +
        '" и "' +
        params.targetDomain +
        '" подтверждена',
      confidence: cappedConfidence,
      reasoningChain,
      createdAt: this.now(),
    };

    this.reasonings.set(result.id, result);

    return {
      success: true,
      message: 'Аналоговый вывод завершён',
      reasoningResult: result,
    };
  }

  private causalAnalysis(params: CausalAnalysisParams): ReasoningEngineOutput {
    if (!params.potentialCauses || params.potentialCauses.length === 0) {
      return { success: false, message: 'Нет потенциальных причин' };
    }

    const causalLinks: CausalLink[] = [];
    const rootCauses: string[] = [];
    const contributingFactors: string[] = [];

    for (const cause of params.potentialCauses) {
      const strength = this.estimateCausalStrength(cause, params.effect);
      const link: CausalLink = {
        id: randomUUID(),
        cause,
        effect: params.effect,
        strength,
        type:
          strength > 0.7
            ? 'causation'
            : strength > 0.4
              ? 'correlation'
              : 'contribution',
        evidence: [cause + ' влияет на ' + params.effect],
        confidence: strength * 0.9,
      };
      causalLinks.push(link);

      if (strength > 0.7) {
        rootCauses.push(cause);
      } else {
        contributingFactors.push(cause);
      }
    }

    this.causalLinks.push(...causalLinks);

    const recommendations = this.generateCausalRecommendations(
      rootCauses,
      contributingFactors,
    );
    const averageConfidence =
      causalLinks.reduce((sum, l) => sum + l.confidence, 0) /
      causalLinks.length;

    const result: CausalAnalysisResult = {
      rootCauses,
      causalLinks,
      contributingFactors,
      confidence: averageConfidence,
      recommendations,
    };

    return {
      success: true,
      message:
        'Причинный анализ завершён. Корневых причин: ' + rootCauses.length,
      causalAnalysis: result,
    };
  }

  // ── Гипотезы ──

  private createHypothesis(
    params: CreateHypothesisParams,
  ): ReasoningEngineOutput {
    const hypothesis: Hypothesis = {
      id: randomUUID(),
      title: params.title,
      description: params.description,
      evidence: params.evidence ?? [],
      contraEvidence: [],
      status: 'proposed',
      probability: 0.5,
      createdBy: 'user',
      createdAt: this.now(),
    };

    this.hypotheses.set(hypothesis.id, hypothesis);

    return {
      success: true,
      message: 'Гипотеза "' + hypothesis.title + '" создана',
      hypothesis,
    };
  }

  private testHypothesis(params: TestHypothesisParams): ReasoningEngineOutput {
    const hypothesis = this.hypotheses.get(params.hypothesisId);
    if (!hypothesis) {
      return { success: false, message: 'Гипотеза не найдена' };
    }

    hypothesis.status = 'testing';

    const newEvidence = params.newEvidence ?? [];
    const confidenceChange = params.testPassed
      ? 0.15 + newEvidence.length * 0.05
      : -0.2 - newEvidence.length * 0.1;

    hypothesis.probability = Math.max(
      0,
      Math.min(1, hypothesis.probability + confidenceChange),
    );
    hypothesis.status = params.testPassed ? 'validated' : 'falsified';
    hypothesis.testedAt = this.now();

    if (params.testPassed) {
      hypothesis.evidence.push(...newEvidence);
    } else {
      hypothesis.contraEvidence.push(...newEvidence);
    }

    const testResult: HypothesisTestResult = {
      hypothesisId: hypothesis.id,
      testPassed: params.testPassed,
      confidenceChange,
      newEvidence,
      timestamp: this.now(),
    };

    this.testResults.push(testResult);

    return {
      success: true,
      message:
        'Гипотеза "' +
        hypothesis.title +
        '" проверена: ' +
        (params.testPassed ? 'подтверждена' : 'опровергнута'),
      hypothesis,
      testResult,
    };
  }

  private getHypotheses(params?: GetHypothesesParams): ReasoningEngineOutput {
    let hypotheses = Array.from(this.hypotheses.values());

    if (params?.status) {
      hypotheses = hypotheses.filter((h) => h.status === params.status);
    }

    return {
      success: true,
      message: 'Найдено ' + hypotheses.length + ' гипотез',
      hypotheses,
    };
  }

  // ── Принятие решений ──

  private makeDecision(params: MakeDecisionParams): ReasoningEngineOutput {
    if (!params.options || params.options.length === 0) {
      return { success: false, message: 'Нет вариантов для выбора' };
    }

    const options: DecisionOption[] = params.options.map((opt, idx) => ({
      ...opt,
      id: randomUUID(),
      label: opt.label ?? 'Вариант ' + (idx + 1),
    }));

    const selectedOption = this.selectBestOption(options);
    const risks = this.assessDecisionRisks(selectedOption);

    const decision: Decision = {
      id: randomUUID(),
      question: params.question,
      options,
      selectedOptionId: selectedOption.id,
      status: 'approved',
      rationale:
        'Выбран вариант "' +
        selectedOption.label +
        '" с ожидаемым результатом: ' +
        selectedOption.expectedOutcome,
      risks,
      confidence: selectedOption.probability,
      createdAt: this.now(),
      approvedAt: this.now(),
    };

    this.decisions.set(decision.id, decision);

    return {
      success: true,
      message: 'Решение принято: ' + selectedOption.label,
      decision,
    };
  }

  private assessRisk(params: AssessRiskParams): ReasoningEngineOutput {
    if (!params.factors || params.factors.length === 0) {
      return { success: false, message: 'Нет факторов для оценки' };
    }

    const riskAssessments: RiskAssessment[] = [];

    for (const factor of params.factors) {
      const probability = this.estimateProbability(factor);
      const impact = this.estimateImpact(factor);
      const level = this.determineRiskLevel(probability, impact);
      const mitigation = this.suggestMitigation(level);

      riskAssessments.push({
        risk: factor,
        probability,
        impact,
        level,
        mitigation,
        mitigationStrategy: this.getMitigationStrategy(factor, level),
      });
    }

    const highestRisk = riskAssessments.reduce((max, r) =>
      r.probability * r.impact > max.probability * max.impact ? r : max,
    );

    return {
      success: true,
      message:
        'Оценка риска завершена. Максимальный риск: ' + highestRisk.level,
      riskAssessment: highestRisk,
    };
  }
  // ── Мульти-перспектива ──

  private multiPerspective(
    params: MultiPerspectiveParams,
  ): ReasoningEngineOutput {
    const perspectives = params.perspectives ?? [
      'optimistic',
      'pessimistic',
      'realistic',
      'contrarian',
      'systemic',
    ];

    const analyses: PerspectiveAnalysis[] = [];

    for (const perspective of perspectives) {
      const analysis = this.analyzeFromPerspective(perspective, params.topic);
      analyses.push(analysis);
    }

    const synthesis = this.synthesizePerspectives(analyses);
    const overallConfidence =
      analyses.reduce((sum, a) => sum + a.confidence, 0) / analyses.length;

    const result: MultiPerspectiveAnalysis = {
      topic: params.topic,
      perspectives: analyses,
      synthesis,
      overallConfidence,
      recommendations: this.generateRecommendations(analyses),
    };

    return {
      success: true,
      message:
        'Мульти-перспективный анализ завершён для ' +
        analyses.length +
        ' перспектив',
      multiPerspective: result,
    };
  }

  // ── Статистика ──

  private getStats(_params?: GetStatsParams): ReasoningEngineOutput {
    const byStrategy: Record<ReasoningStrategy, number> = {
      deductive: 0,
      inductive: 0,
      abductive: 0,
      analogical: 0,
      causal: 0,
    };

    for (const reasoning of this.reasonings.values()) {
      byStrategy[reasoning.strategy]++;
    }

    const totalConfidence = Array.from(this.reasonings.values()).reduce(
      (sum, r) => sum + r.confidence,
      0,
    );

    const byHypothesisStatus: Record<HypothesisStatus, number> = {
      proposed: 0,
      testing: 0,
      validated: 0,
      falsified: 0,
      pending: 0,
    };

    for (const hypothesis of this.hypotheses.values()) {
      byHypothesisStatus[hypothesis.status]++;
    }

    const byDecisionStatus: Record<DecisionStatus, number> = {
      proposed: 0,
      approved: 0,
      rejected: 0,
      'pending-review': 0,
    };

    for (const decision of this.decisions.values()) {
      byDecisionStatus[decision.status]++;
    }

    const stats: ReasoningStats = {
      totalReasonings: this.reasonings.size,
      byStrategy,
      averageConfidence:
        this.reasonings.size > 0 ? totalConfidence / this.reasonings.size : 0,
      totalHypotheses: this.hypotheses.size,
      byHypothesisStatus,
      totalDecisions: this.decisions.size,
      byDecisionStatus,
      totalCausalLinks: this.causalLinks.length,
    };

    return {
      success: true,
      message: 'Статистика ReasoningEngine получена',
      stats,
    };
  }

  private clearAll(): ReasoningEngineOutput {
    this.reasonings.clear();
    this.hypotheses.clear();
    this.decisions.clear();
    this.causalLinks = [];
    this.testResults = [];
    return { success: true, message: 'Все данные ReasoningEngine очищены' };
  }

  // ── Приватные хелперы ──

  private getDefaultLogicRules(): Array<{ name: string }> {
    return [
      { name: 'modus_ponens' },
      { name: 'modus_tollens' },
      { name: 'syllogism' },
      { name: 'disjunctive_syllogism' },
    ];
  }

  private synthesizeConclusion(
    premises: string[],
    rules: Array<{ name: string }>,
  ): string {
    const lastRule = rules[rules.length - 1]?.name ?? 'general_logic';
    return 'Вывод на основе ' + lastRule + ': ' + premises[premises.length - 1];
  }

  private calculateConfidence(steps: ReasoningStep[]): number {
    if (steps.length === 0) return 0;
    const total = steps.reduce((sum, s) => sum + s.confidence, 0);
    return Math.min(total / steps.length, 1);
  }

  private detectPattern(observations: string[]): string {
    const patterns = [
      'Наблюдается повторяющийся паттерн',
      'Выявлена тенденция к росту',
      'Обнаружена циклическая зависимость',
      'Замечена корреляция между событиями',
    ];
    return patterns[observations.length % patterns.length]!;
  }

  private selectBestCause(observation: string, causes: string[]): string {
    return causes.reduce((best, current) => {
      const currentStrength = this.estimateCausalStrength(current, observation);
      const bestStrength = this.estimateCausalStrength(best!, observation);
      return currentStrength > bestStrength ? current : best;
    }, causes[0]!);
  }

  private estimateCausalStrength(cause: string, effect: string): number {
    const hash = cause.length + effect.length;
    return 0.3 + (hash % 70) / 100;
  }

  private generateCausalRecommendations(
    rootCauses: string[],
    contributingFactors: string[],
  ): string[] {
    const recommendations: string[] = [];

    for (const cause of rootCauses) {
      recommendations.push('Устранить корневую причину: ' + cause);
    }

    for (const factor of contributingFactors) {
      recommendations.push('Снизить влияние фактора: ' + factor);
    }

    if (recommendations.length === 0) {
      recommendations.push('Недостаточно данных для рекомендаций');
    }

    return recommendations;
  }

  private selectBestOption(options: DecisionOption[]): DecisionOption {
    return options.reduce((best, current) => {
      const bestScore =
        best.probability * (1 - this.riskLevelToNumber(best.riskLevel));
      const currentScore =
        current.probability * (1 - this.riskLevelToNumber(current.riskLevel));
      return currentScore > bestScore ? current : best;
    });
  }

  private riskLevelToNumber(level: RiskLevel): number {
    switch (level) {
      case 'negligible':
        return 0.05;
      case 'low':
        return 0.2;
      case 'medium':
        return 0.5;
      case 'high':
        return 0.75;
      case 'critical':
        return 0.95;
    }
  }

  private assessDecisionRisks(option: DecisionOption): RiskAssessment[] {
    return option.cons.map((con) => ({
      risk: con,
      probability: 0.3 + Math.random() * 0.4,
      impact: 0.2 + Math.random() * 0.5,
      level: 'medium',
      mitigation: 'mitigate',
      mitigationStrategy: 'Разработать план снижения риска',
    }));
  }

  private estimateProbability(factor: string): number {
    return 0.2 + (factor.length % 80) / 100;
  }

  private estimateImpact(factor: string): number {
    return 0.3 + ((factor.length * 7) % 70) / 100;
  }

  private determineRiskLevel(probability: number, impact: number): RiskLevel {
    const score = probability * impact;
    if (score > 0.7) return 'critical';
    if (score > 0.5) return 'high';
    if (score > 0.25) return 'medium';
    if (score > 0.1) return 'low';
    return 'negligible';
  }

  private suggestMitigation(level: RiskLevel): MitigationType {
    switch (level) {
      case 'critical':
        return 'avoid';
      case 'high':
        return 'mitigate';
      case 'medium':
        return 'transfer';
      default:
        return 'accept';
    }
  }

  private getMitigationStrategy(_factor: string, level: RiskLevel): string {
    switch (level) {
      case 'critical':
        return 'Избегать риска — пересмотреть стратегию';
      case 'high':
        return 'Снизить риск — внедрить контрольные меры';
      case 'medium':
        return 'Передать риск — использовать хеджирование';
      default:
        return 'Принять риск — мониторинг ситуации';
    }
  }

  private analyzeFromPerspective(
    perspective: PerspectiveType,
    topic: string,
  ): PerspectiveAnalysis {
    const analysisMap: Record<
      PerspectiveType,
      {
        analysis: string;
        keyPoints: string[];
        blindSpots: string[];
        confidence: number;
      }
    > = {
      optimistic: {
        analysis: 'Оптимистичный взгляд на: ' + topic,
        keyPoints: ['Возможные выгоды', 'Позитивные сценарии', 'Точки роста'],
        blindSpots: ['Игнорирование рисков', 'Переоценка возможностей'],
        confidence: 0.6,
      },
      pessimistic: {
        analysis: 'Пессимистичный взгляд на: ' + topic,
        keyPoints: [
          'Потенциальные угрозы',
          'Негативные сценарии',
          'Уязвимости',
        ],
        blindSpots: ['Упущенные возможности', 'Чрезмерная осторожность'],
        confidence: 0.55,
      },
      realistic: {
        analysis: 'Реалистичный взгляд на: ' + topic,
        keyPoints: [
          'Фактические данные',
          'Баланс плюсов и минусов',
          'Вероятные исходы',
        ],
        blindSpots: ['Недостаток данных', 'Ограниченная информация'],
        confidence: 0.8,
      },
      contrarian: {
        analysis: 'Контарианский взгляд на: ' + topic,
        keyPoints: [
          'Противоположные точки зрения',
          'Неочевидные связи',
          'Альтернативные гипотезы',
        ],
        blindSpots: ['Контрпродуктивное мышление', 'Отрицание консенсуса'],
        confidence: 0.65,
      },
      systemic: {
        analysis: 'Системный взгляд на: ' + topic,
        keyPoints: [
          'Взаимосвязи элементов',
          'Обратные связи',
          'Эмергентные свойства',
        ],
        blindSpots: ['Слишком высокая абстракция', 'Упущение деталей'],
        confidence: 0.75,
      },
    };

    const data = analysisMap[perspective];
    return {
      perspective,
      analysis: data.analysis,
      keyPoints: data.keyPoints,
      blindSpots: data.blindSpots,
      confidence: data.confidence,
    };
  }

  private synthesizePerspectives(analyses: PerspectiveAnalysis[]): string {
    const perspectives = analyses.map((a) => a.perspective).join(', ');
    return (
      'Синтез перспектив [' +
      perspectives +
      ']: требуется сбалансированный подход с учётом всех точек зрения'
    );
  }

  private generateRecommendations(analyses: PerspectiveAnalysis[]): string[] {
    const recommendations: string[] = [];

    for (const analysis of analyses) {
      for (const point of analysis.keyPoints) {
        recommendations.push('[' + analysis.perspective + '] ' + point);
      }
    }

    return recommendations;
  }

  // ── Публичный API ──

  getReasoningCount(): number {
    return this.reasonings.size;
  }

  getHypothesisCount(): number {
    return this.hypotheses.size;
  }

  getDecisionCount(): number {
    return this.decisions.size;
  }

  getCausalLinkCount(): number {
    return this.causalLinks.length;
  }

  getAllReasonings(): ReasoningResult[] {
    return Array.from(this.reasonings.values());
  }

  getAllHypotheses(): Hypothesis[] {
    return Array.from(this.hypotheses.values());
  }

  getAllDecisions(): Decision[] {
    return Array.from(this.decisions.values());
  }

  getAllCausalLinks(): CausalLink[] {
    return [...this.causalLinks];
  }
}
