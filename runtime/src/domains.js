'use strict';

const {
  Micronaut,
  Fold,
  Field,
  Tool,
  Agent,
  Rule,
  MicronautRegistry,
  FoldRegistry,
  FieldRegistry,
  ToolRegistry,
  AgentRegistry,
  RuleRegistry,
} = require('./micronaut.js');

// ================================================================
// Coder Domain
// ================================================================
class CoderDomain {
  constructor(config = {}) {
    this.config = {
      languages: config.languages || ['javascript', 'python', 'typescript'],
      frameworks: config.frameworks || ['react', 'node', 'django'],
      style: config.style || 'clean',
      ...config,
    };
    this.toolIds = [];
    this.foldIds = [];
    this._init();
  }

  _init() {
    this._initTools();
    this._initFolds();
    this._initAgents();
    this._initRules();

    this.micronaut = new Micronaut({
      name: 'coder-orchestrator',
      role: 'code_generator',
      version: '1.0.0',
      priority: 'precision',
      entropy_budget: 0.3,
      timeout_ms: 30000,
      routing_strategy: 'consistent_hash',
      orchestrates: this.foldIds,
      permissions: ['fold:execute', 'fold:compose', 'tool:use'],
      tools: this.toolIds,
      metadata: { domain: 'coder', ...this.config },
    });
    MicronautRegistry.register(this.micronaut.id, this.micronaut);
  }

  _initTools() {
    const codeGen = new Tool({
      name: 'code-gen',
      fold: 'COMPUTE',
      signature: { input: 'spec', output: 'code' },
      execute: (input) => ({
        code: this._generateCode(input.spec, input.language || 'javascript', input.framework || 'default'),
        language: input.language || 'javascript',
        framework: input.framework || 'default',
        generated_at: new Date().toISOString(),
      }),
    });
    ToolRegistry.register(codeGen.id, codeGen);

    const codeReview = new Tool({
      name: 'code-review',
      fold: 'COMPUTE',
      signature: { input: 'code', output: 'review' },
      execute: (input) => this._reviewCode(input.code, input.language || 'javascript'),
    });
    ToolRegistry.register(codeReview.id, codeReview);

    const codeOptimize = new Tool({
      name: 'code-optimize',
      fold: 'COMPUTE',
      signature: { input: 'code', output: 'optimized' },
      execute: (input) => this._optimizeCode(input.code, input.target || 'performance'),
    });
    ToolRegistry.register(codeOptimize.id, codeOptimize);

    this.toolIds = [codeGen.id, codeReview.id, codeOptimize.id];
  }

  _initFolds() {
    const codeGenFold = new Fold({
      name: 'code_gen',
      type: 'generation',
      version: '1.0.0',
      metadata: { actions: ['generate'] },
      nodes: [
        { id: 'spec_input', type: 'input' },
        { id: 'parse_spec', type: 'process', config: { tool: this.toolIds[0] } },
        { id: 'generate_impl', type: 'process', config: { tool: this.toolIds[0] } },
        { id: 'output_code', type: 'output' },
      ],
      edges: [
        { from: 'spec_input', to: 'parse_spec' },
        { from: 'parse_spec', to: 'generate_impl' },
        { from: 'generate_impl', to: 'output_code' },
      ],
    });
    FoldRegistry.register(codeGenFold.id, codeGenFold);

    const reviewFold = new Fold({
      name: 'code_review',
      type: 'reasoning',
      version: '1.0.0',
      metadata: { actions: ['review'] },
      nodes: [
        { id: 'code_input', type: 'input' },
        { id: 'analyze', type: 'process', config: { tool: this.toolIds[1] } },
        { id: 'check_style', type: 'process' },
        { id: 'review_output', type: 'output' },
      ],
      edges: [
        { from: 'code_input', to: 'analyze' },
        { from: 'analyze', to: 'check_style' },
        { from: 'check_style', to: 'review_output' },
      ],
    });
    FoldRegistry.register(reviewFold.id, reviewFold);

    const optimizeFold = new Fold({
      name: 'code_optimize',
      type: 'compute',
      version: '1.0.0',
      metadata: { actions: ['optimize'] },
      nodes: [
        { id: 'code_input', type: 'input' },
        { id: 'optimize', type: 'process', config: { tool: this.toolIds[2] } },
        { id: 'output_optimized', type: 'output' },
      ],
      edges: [
        { from: 'code_input', to: 'optimize' },
        { from: 'optimize', to: 'output_optimized' },
      ],
    });
    FoldRegistry.register(optimizeFold.id, optimizeFold);

    this.foldIds = [codeGenFold.id, reviewFold.id, optimizeFold.id];
  }

  _initAgents() {
    const coderAgent = new Agent({
      name: 'coder-agent',
      type: 'creator',
      tools: this.toolIds,
      goals: [
        { description: 'Generate clean, efficient code', priority: 1.0 },
        { description: 'Review and improve code quality', priority: 0.8 },
      ],
      constraints: ['max_lines: 500', 'max_complexity: 10', 'style: clean'],
    });
    AgentRegistry.register(coderAgent.id, coderAgent);
  }

  _initRules() {
    const rule = new Rule({
      name: 'code_quality_check',
      priority: 5,
      entropyCost: 0.1,
      condition: { field: 'code.complexity', operator: '>', value: 10 },
      action: { type: 'dispatch', target: 'optimize', params: { target: 'simplicity' } },
    });
    RuleRegistry.register(rule.id, rule);
  }

  _generateCode(spec, language, framework) {
    const name = (spec && spec.name) || 'Function';
    const templates = {
      javascript: {
        react: `function ${name}(props) {\n  return <div>{props.children}</div>;\n}`,
        node: `module.exports.${name} = function() {\n  return '${name}';\n};`,
        default: `function ${name}() {\n  return '${name}';\n}`,
      },
      python: {
        django: `def ${name}(request):\n    return HttpResponse('${name}')`,
        default: `def ${name}():\n    return '${name}'`,
      },
      typescript: {
        react: `interface ${name}Props { children: React.ReactNode; }\nexport function ${name}(props: ${name}Props) {\n  return <div>{props.children}</div>;\n}`,
        default: `export function ${name}(): string {\n  return '${name}';\n}`,
      },
    };
    const lang = templates[language] || templates.javascript;
    return lang[framework] || lang.default;
  }

  _reviewCode(code, language) {
    const issues = [];
    const suggestions = [];
    let score = 100;
    if (String(code).includes('console.log')) {
      issues.push('Contains console.log statements');
      suggestions.push('Remove console.log statements');
      score -= 5;
    }
    if (code.length > 1000) {
      issues.push('Code is too long');
      suggestions.push('Break code into smaller functions');
      score -= 10;
    }
    return { issues, suggestions, score: Math.max(0, score), language };
  }

  _optimizeCode(code, target) {
    const improvements = [];
    let optimized = String(code);
    if (target === 'performance' && optimized.includes('for')) {
      improvements.push('Optimized loop structure');
      optimized = optimized.replace(/for\s*\([^)]*\)/, '// Optimized loop');
    }
    if (target === 'simplicity') {
      optimized = optimized.replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ').trim();
      improvements.push('Simplified code structure');
    }
    return { optimized, improvements, target };
  }

  async generateCode(spec, language = 'javascript', framework = null) {
    await this.micronaut.start();
    try {
      return await this.micronaut.orchestrate({
        spec,
        language,
        framework: framework || 'default',
        action: 'generate',
      });
    } finally {
      await this.micronaut.stop();
    }
  }

  async reviewCode(code, language = 'javascript') {
    await this.micronaut.start();
    try {
      return await this.micronaut.orchestrate({ code, language, action: 'review' });
    } finally {
      await this.micronaut.stop();
    }
  }

  async optimizeCode(code, target = 'performance') {
    await this.micronaut.start();
    try {
      return await this.micronaut.orchestrate({ code, target, action: 'optimize' });
    } finally {
      await this.micronaut.stop();
    }
  }
}

// ================================================================
// Instructor Domain
// ================================================================
class InstructorDomain {
  constructor(config = {}) {
    this.config = {
      subjects: config.subjects || ['mathematics', 'science', 'language'],
      levels: config.levels || ['beginner', 'intermediate', 'advanced'],
      pedagogy: config.pedagogy || 'adaptive',
      ...config,
    };
    this.toolIds = [];
    this.foldIds = [];
    this._init();
  }

  _init() {
    this._initTools();
    this._initFolds();
    this._initAgents();
    this._initRules();

    this.micronaut = new Micronaut({
      name: 'instructor-orchestrator',
      role: 'teacher',
      version: '1.0.0',
      priority: 'quality',
      entropy_budget: 0.2,
      timeout_ms: 20000,
      routing_strategy: 'least_loaded',
      orchestrates: this.foldIds,
      permissions: ['fold:execute', 'tool:use', 'gram:resolve'],
      tools: this.toolIds,
      metadata: { domain: 'instructor', ...this.config },
    });
    MicronautRegistry.register(this.micronaut.id, this.micronaut);
  }

  _initTools() {
    const lessonPlanner = new Tool({
      name: 'lesson-planner',
      fold: 'PLANNING',
      signature: { input: 'topic', output: 'lesson_plan' },
      execute: (input) => ({
        topic: input.topic,
        level: input.level || 'beginner',
        duration: input.duration || 60,
        objectives: this._getObjectives(input.topic, input.level || 'beginner'),
        activities: this._getActivities(input.level || 'beginner'),
        assessment: this._getAssessment(input.level || 'beginner'),
      }),
    });
    ToolRegistry.register(lessonPlanner.id, lessonPlanner);

    const assessor = new Tool({
      name: 'assessor',
      fold: 'REASONING',
      signature: { input: 'response', output: 'assessment' },
      execute: (input) => this._assessResponse(input.response, input.expected || '', input.subject || 'general'),
    });
    ToolRegistry.register(assessor.id, assessor);

    const feedbackGen = new Tool({
      name: 'feedback-gen',
      fold: 'GENERATION',
      signature: { input: 'assessment', output: 'feedback' },
      execute: (input) => this._generateFeedback(input.assessment, input.level || 'beginner'),
    });
    ToolRegistry.register(feedbackGen.id, feedbackGen);

    this.toolIds = [lessonPlanner.id, assessor.id, feedbackGen.id];
  }

  _initFolds() {
    const lessonFold = new Fold({
      name: 'lesson_plan',
      type: 'planning',
      version: '1.0.0',
      metadata: { actions: ['plan_lesson'] },
      nodes: [
        { id: 'topic_input', type: 'input' },
        { id: 'plan_lesson', type: 'process', config: { tool: this.toolIds[0] } },
        { id: 'validate_plan', type: 'gate' },
        { id: 'output_plan', type: 'output' },
      ],
      edges: [
        { from: 'topic_input', to: 'plan_lesson' },
        { from: 'plan_lesson', to: 'validate_plan' },
        { from: 'validate_plan', to: 'output_plan' },
      ],
    });
    FoldRegistry.register(lessonFold.id, lessonFold);

    const assessmentFold = new Fold({
      name: 'assessment',
      type: 'reasoning',
      version: '1.0.0',
      metadata: { actions: ['assess'] },
      nodes: [
        { id: 'response_input', type: 'input' },
        { id: 'assess', type: 'process', config: { tool: this.toolIds[1] } },
        { id: 'map_assessment', type: 'transform', config: { transform: (inputs) => ({ assessment: (inputs.assess && inputs.assess.result) ? inputs.assess.result : inputs.assess }) } },
        { id: 'generate_feedback', type: 'process', config: { tool: this.toolIds[2] } },
        { id: 'output_assessment', type: 'output' },
      ],
      edges: [
        { from: 'response_input', to: 'assess' },
        { from: 'assess', to: 'map_assessment' },
        { from: 'map_assessment', to: 'generate_feedback' },
        { from: 'generate_feedback', to: 'output_assessment' },
      ],
    });
    FoldRegistry.register(assessmentFold.id, assessmentFold);

    this.foldIds = [lessonFold.id, assessmentFold.id];
  }

  _initAgents() {
    const teacherAgent = new Agent({
      name: 'teacher-agent',
      type: 'manager',
      tools: this.toolIds,
      goals: [
        { description: 'Create effective lesson plans', priority: 1.0 },
        { description: 'Assess student progress', priority: 0.9 },
        { description: 'Provide constructive feedback', priority: 0.8 },
      ],
      constraints: ['approach: adaptive', 'style: encouraging', 'clarity: high'],
    });
    AgentRegistry.register(teacherAgent.id, teacherAgent);
  }

  _initRules() {
    const rule = new Rule({
      name: 'adapt_difficulty',
      priority: 8,
      entropyCost: 0.15,
      condition: { field: 'student.performance', operator: '<', value: 0.7 },
      action: { type: 'mutate', target: 'lesson.difficulty', params: { value: 'lower' } },
    });
    RuleRegistry.register(rule.id, rule);
  }

  _getObjectives(topic, level) {
    const map = {
      mathematics: { beginner: ['Understand basic concepts', 'Solve simple problems'], intermediate: ['Apply concepts', 'Solve complex problems'], advanced: ['Prove theorems', 'Create new solutions'] },
      science: { beginner: ['Observe phenomena', 'Identify patterns'], intermediate: ['Explain mechanisms', 'Design experiments'], advanced: ['Theorize models', 'Conduct research'] },
      language: { beginner: ['Learn vocabulary', 'Basic communication'], intermediate: ['Complex grammar', 'Fluid conversation'], advanced: ['Literary analysis', 'Creative writing'] },
    };
    return (map[topic]?.[level]) || ['Understand topic', 'Apply knowledge'];
  }

  _getActivities(level) {
    const map = { beginner: ['Guided practice', 'Simple exercises'], intermediate: ['Problem solving', 'Group discussions'], advanced: ['Independent projects', 'Peer teaching'] };
    return map[level] || map.beginner;
  }

  _getAssessment(level) {
    const map = { beginner: ['Multiple choice', 'Short answer'], intermediate: ['Essay questions', 'Practical tasks'], advanced: ['Research papers', 'Presentations'] };
    return map[level] || map.beginner;
  }

  _assessResponse(response, expected, subject) {
    const r = String(response || '').toLowerCase().split(/\s+/).filter(Boolean);
    const e = String(expected || '').toLowerCase().split(/\s+/).filter(Boolean);
    const common = r.filter((w) => e.includes(w));
    const total = new Set([...r, ...e]);
    const similarity = total.size ? common.length / total.size : 0;
    const score = Math.min(1, similarity * 1.2);
    return { score, correct: score > 0.7, feedback: score > 0.8 ? 'Excellent!' : score > 0.6 ? 'Good, but could improve' : 'Needs more practice', subject };
  }

  _generateFeedback(assessment, level) {
    let feedback = assessment.score > 0.8 ? 'You demonstrated excellent understanding!' : assessment.score > 0.6 ? 'Good work! Elaborate more on key points.' : 'Focus on understanding the core concepts.';
    if (level === 'beginner') feedback += ' Great start! Keep practicing!';
    else if (level === 'intermediate') feedback += ' Good progress! Challenge yourself.';
    else if (level === 'advanced') feedback += ' Excellent depth! Explore new applications.';
    return { feedback, next_steps: assessment.score > 0.8 ? 'Move to next topic' : assessment.score > 0.6 ? 'Review key concepts' : 'Practice basics again' };
  }

  async planLesson(topic, level = 'beginner', duration = 60) {
    await this.micronaut.start();
    try {
      return await this.micronaut.orchestrate({ topic, level, duration, action: 'plan_lesson' });
    } finally {
      await this.micronaut.stop();
    }
  }

  async assessResponse(response, expected, subject) {
    await this.micronaut.start();
    try {
      return await this.micronaut.orchestrate({ response, expected, subject, action: 'assess' });
    } finally {
      await this.micronaut.stop();
    }
  }
}

// ================================================================
// Assistant Domain
// ================================================================
class AssistantDomain {
  constructor(config = {}) {
    this.config = {
      capabilities: config.capabilities || ['search', 'summarize', 'translate', 'organize'],
      personality: config.personality || 'helpful',
      ...config,
    };
    this.toolIds = [];
    this.foldIds = [];
    this._init();
  }

  _init() {
    this._initTools();
    this._initFolds();
    this._initAgents();

    this.micronaut = new Micronaut({
      name: 'assistant-orchestrator',
      role: 'assistant',
      version: '1.0.0',
      priority: 'balanced',
      entropy_budget: 0.5,
      timeout_ms: 15000,
      routing_strategy: 'round_robin',
      orchestrates: this.foldIds,
      permissions: ['fold:execute', 'tool:use', 'geodesic:traverse'],
      tools: this.toolIds,
      metadata: { domain: 'assistant', ...this.config },
    });
    MicronautRegistry.register(this.micronaut.id, this.micronaut);
  }

  _initTools() {
    const searcher = new Tool({
      name: 'searcher',
      fold: 'NETWORK',
      signature: { input: 'query', output: 'results' },
      execute: (input) => ({
        query: input.query,
        results: this._search(input.query, input.limit || 5),
      }),
    });
    ToolRegistry.register(searcher.id, searcher);

    const summarizer = new Tool({
      name: 'summarizer',
      fold: 'GENERATION',
      signature: { input: 'text', output: 'summary' },
      execute: (input) => ({
        summary: this._summarize(input.text, input.maxLength || 100),
        original_length: String(input.text).length,
      }),
    });
    ToolRegistry.register(summarizer.id, summarizer);

    const translator = new Tool({
      name: 'translator',
      fold: 'GENERATION',
      signature: { input: 'text', output: 'translation' },
      execute: (input) => ({
        original: input.text,
        translation: this._translate(input.text, input.from, input.to),
        from: input.from || 'auto',
        to: input.to || 'en',
      }),
    });
    ToolRegistry.register(translator.id, translator);

    const organizer = new Tool({
      name: 'organizer',
      fold: 'STORAGE',
      signature: { input: 'items', output: 'organized' },
      execute: (input) => this._organize(input.items, input.by || 'category'),
    });
    ToolRegistry.register(organizer.id, organizer);

    this.toolIds = [searcher.id, summarizer.id, translator.id, organizer.id];
  }

  _initFolds() {
    const searchFold = new Fold({
      name: 'search',
      type: 'network',
      version: '1.0.0',
      metadata: { actions: ['search'] },
      nodes: [
        { id: 'query_input', type: 'input' },
        { id: 'search', type: 'process', config: { tool: this.toolIds[0] } },
        { id: 'filter_results', type: 'gate' },
        { id: 'output_results', type: 'output' },
      ],
      edges: [
        { from: 'query_input', to: 'search' },
        { from: 'search', to: 'filter_results' },
        { from: 'filter_results', to: 'output_results' },
      ],
    });
    FoldRegistry.register(searchFold.id, searchFold);

    const summarizeFold = new Fold({
      name: 'summarize',
      type: 'generation',
      version: '1.0.0',
      metadata: { actions: ['summarize'] },
      nodes: [
        { id: 'text_input', type: 'input' },
        { id: 'summarize', type: 'process', config: { tool: this.toolIds[1] } },
        { id: 'output_summary', type: 'output' },
      ],
      edges: [
        { from: 'text_input', to: 'summarize' },
        { from: 'summarize', to: 'output_summary' },
      ],
    });
    FoldRegistry.register(summarizeFold.id, summarizeFold);

    const translateFold = new Fold({
      name: 'translate',
      type: 'generation',
      version: '1.0.0',
      metadata: { actions: ['translate'] },
      nodes: [
        { id: 'text_input', type: 'input' },
        { id: 'translate', type: 'process', config: { tool: this.toolIds[2] } },
        { id: 'output_translation', type: 'output' },
      ],
      edges: [
        { from: 'text_input', to: 'translate' },
        { from: 'translate', to: 'output_translation' },
      ],
    });
    FoldRegistry.register(translateFold.id, translateFold);

    this.foldIds = [searchFold.id, summarizeFold.id, translateFold.id];
  }

  _initAgents() {
    const assistantAgent = new Agent({
      name: 'assistant-agent',
      type: 'helper',
      tools: this.toolIds,
      goals: [
        { description: 'Provide helpful information', priority: 1.0 },
        { description: 'Organize and structure data', priority: 0.8 },
        { description: 'Assist with tasks', priority: 0.9 },
      ],
      constraints: ['helpful: true', 'concise: true', 'accurate: true'],
    });
    AgentRegistry.register(assistantAgent.id, assistantAgent);
  }

  _search(query, limit) {
    return Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
      title: `Result ${i + 1} for ${query}`,
      relevance: 0.9 - i * 0.2,
      content: '...',
    }));
  }

  _summarize(text, maxLength) {
    const summary = String(text).split(/[.!?]+/).slice(0, 3).join('. ');
    return summary.length > maxLength ? summary.substring(0, maxLength) + '...' : summary;
  }

  _translate(text, from, to) {
    return `[${to || 'en'}] ${text}`;
  }

  _organize(items, by) {
    const organized = {};
    for (const item of items || []) {
      const key = item[by] || 'uncategorized';
      if (!organized[key]) organized[key] = [];
      organized[key].push(item);
    }
    return organized;
  }

  async search(query, limit = 5) {
    await this.micronaut.start();
    try {
      return await this.micronaut.orchestrate({ query, limit, action: 'search' });
    } finally {
      await this.micronaut.stop();
    }
  }

  async summarize(text, maxLength = 100) {
    await this.micronaut.start();
    try {
      return await this.micronaut.orchestrate({ text, maxLength, action: 'summarize' });
    } finally {
      await this.micronaut.stop();
    }
  }

  async translate(text, from = 'auto', to = 'en') {
    await this.micronaut.start();
    try {
      return await this.micronaut.orchestrate({ text, from, to, action: 'translate' });
    } finally {
      await this.micronaut.stop();
    }
  }
}

// ================================================================
// Domain Factory
// ================================================================
class DomainFactory {
  static create(domain, config = {}) {
    const map = {
      coder: CoderDomain,
      code: CoderDomain,
      instructor: InstructorDomain,
      teacher: InstructorDomain,
      assistant: AssistantDomain,
      help: AssistantDomain,
    };
    const DomainClass = map[domain.toLowerCase()];
    if (!DomainClass) {
      throw new Error(`Unknown domain: ${domain}. Available: ${Object.keys(map).join(', ')}`);
    }
    return new DomainClass(config);
  }
}

module.exports = {
  CoderDomain,
  InstructorDomain,
  AssistantDomain,
  DomainFactory,
  createCoder: (config) => new CoderDomain(config),
  createInstructor: (config) => new InstructorDomain(config),
  createAssistant: (config) => new AssistantDomain(config),
};