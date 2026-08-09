// kuhul-es/compiler/src/parser.ts
import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

export interface KUHULASTNode {
  type: string;
  start: number;
  end: number;
  value?: any;
  children?: KUHULASTNode[];
}

export class KUHULParser {
  private sourceFile: ts.SourceFile;
  private πBindings = new Map<string, any>();
  private τBindings = new Map<string, any>();
  private glyphCalls: Array<{glyph: string, args: any[]}> = [];
  
  constructor(source: string, filename: string = 'source.kuhul') {
    this.source = source;
    this.sourceFile = ts.createSourceFile(
      filename,
      source,
      ts.ScriptTarget.ESNext,
      true
    );
  }
  
  parse(): KUHULProgram {
    const program: KUHULProgram = {
      πBindings: new Map(),
      τBindings: new Map(),
      glyphCalls: [],
      functions: [],
      directives: [],
      transformedCode: ''
    };
    
    this.visitNode(this.sourceFile, program);

    // regex fallback: `pi X = v;` / `tau X = v;` do not parse as TS variable
    // statements (bare `pi` splits into two expression statements), so extract
    // them from the raw source like the runtime does.
    const piRe = /(?:π|pi)\s+([A-Za-z_]\w*)\s*=\s*([^;]+)/g;
    for (const m of this.source.matchAll(piRe)) {
      if (!program.πBindings.has(m[1])) {
        program.πBindings.set(m[1], { value: this.evaluateText(m[2].trim()), immutable: true, source: m[0], position: m.index });
      }
    }
    const tauRe = /(?:τ|tau)\s+([A-Za-z_]\w*)\s*=\s*([^;]+)/g;
    for (const m of this.source.matchAll(tauRe)) {
      if (!program.τBindings.has(m[1])) {
        program.τBindings.set(m[1], { initialValue: this.evaluateText(m[2].trim()), temporal: true, updates: [], source: m[0], position: m.index });
      }
    }

    program.transformedCode = this.generateTransformedCode(program);
    
    return program;
  }
  
  private visitNode(node: ts.Node, program: KUHULProgram) {
    // π-binding detection (π x = 10;)
    if (ts.isVariableStatement(node)) {
      const declaration = node.declarationList.declarations[0];
      if (declaration.name.getText().startsWith('π ')) {
        const varName = declaration.name.getText().slice(2).trim();
        const initializer = declaration.initializer;
        const value = initializer ? this.evaluateExpression(initializer) : undefined;
        
        program.πBindings.set(varName, {
          value,
          immutable: true,
          source: node.getText(),
          position: node.getStart()
        });
        return;
      }
      
      // τ-binding detection (τ x = 10;)
      if (declaration.name.getText().startsWith('τ ')) {
        const varName = declaration.name.getText().slice(2).trim();
        const initializer = declaration.initializer;
        const value = initializer ? this.evaluateExpression(initializer) : undefined;
        
        program.τBindings.set(varName, {
          initialValue: value,
          temporal: true,
          updates: [],
          source: node.getText(),
          position: node.getStart()
        });
        return;
      }
    }
    
    // Glyph call detection (yield* Sek('log', message))
    if (ts.isYieldExpression(node)) {
      const expression = node.expression;
      if (expression && ts.isCallExpression(expression)) {
        const callText = expression.getText();
        if (callText.includes('Sek(') || callText.includes('Pop(') || 
            callText.includes('Yax(') || callText.includes('Xul(')) {
          
          // Extract glyph name and arguments
          const match = callText.match(/(Sek|Pop|Wo|Ch'en|Yax|Xul)\(([^)]*)\)/);
          if (match) {
            const glyph = match[1];
            const argsText = match[2];
            const args = this.parseArgs(argsText);
            
            program.glyphCalls.push({
              glyph,
              args,
              position: node.getStart(),
              source: callText
            });
          }
        }
      }
    }
    
    // @-directive detection (@if, @for, @while)
    if (ts.isIfStatement(node)) {
      const ifText = node.getText();
      if (ifText.startsWith('@if')) {
        program.directives.push({
          type: '@if',
          condition: node.expression.getText(),
          thenBranch: node.thenStatement.getText(),
          elseBranch: node.elseStatement ? node.elseStatement.getText() : undefined,
          position: node.getStart()
        });
        return;
      }
    }
    
    // Function detection (function* name() { ... })
    if (ts.isFunctionDeclaration(node)) {
      if (node.asteriskToken) { // Generator function
        program.functions.push({
          name: node.name?.getText() || 'anonymous',
          parameters: node.parameters.map(p => p.getText()),
          body: node.body?.getText() || '',
          isGenerator: true,
          position: node.getStart()
        });
      }
    }
    
    // Visit children
    ts.forEachChild(node, (child) => this.visitNode(child, program));
  }
  
  private evaluateExpression(node: ts.Expression): any {
    const text = node.getText();
    
    // Simple evaluation for literals
    if (ts.isNumericLiteral(node)) {
      return parseFloat(text);
    }
    if (ts.isStringLiteral(node)) {
      return text.slice(1, -1); // Remove quotes
    }
    if (ts.isArrayLiteralExpression(node)) {
      return node.elements.map(el => this.evaluateExpression(el));
    }
    if (ts.isObjectLiteralExpression(node)) {
      const obj: any = {};
      node.properties.forEach(prop => {
        if (ts.isPropertyAssignment(prop)) {
          const name = prop.name.getText();
          obj[name] = this.evaluateExpression(prop.initializer);
        }
      });
      return obj;
    }
    
    return undefined;
  }
  
  private evaluateText(text: string): any {
    const t = text.trim();
    if ((t.startsWith('[') && t.endsWith(']')) || (t.startsWith('{') && t.endsWith('}'))) {
      try { return JSON.parse(t.replace(/'/g, '"')); } catch { /* keep text */ }
    }
    if (!isNaN(parseFloat(text))) return parseFloat(text);
    if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
      return text.slice(1, -1);
    }
    return text;
  }

  private parseArgs(argsText: string): any[] {
    // Simple argument parsing
    const args: any[] = [];
    let current = '';
    let inString = false;
    let stringChar = '';
    let depth = 0;
    
    for (let i = 0; i < argsText.length; i++) {
      const char = argsText[i];
      
      if (!inString && (char === '\'' || char === '"')) {
        inString = true;
        stringChar = char;
        current += char;
      } else if (inString && char === stringChar && argsText[i-1] !== '\\') {
        inString = false;
        current += char;
      } else if (!inString && char === '[') {
        depth++;
        current += char;
      } else if (!inString && char === ']') {
        depth--;
        current += char;
      } else if (!inString && char === '{') {
        depth++;
        current += char;
      } else if (!inString && char === '}') {
        depth--;
        current += char;
      } else if (!inString && depth === 0 && char === ',') {
        args.push(this.parseArgValue(current.trim()));
        current = '';
      } else {
        current += char;
      }
    }
    
    if (current.trim()) {
      args.push(this.parseArgValue(current.trim()));
    }
    
    return args;
  }
  
  private parseArgValue(text: string): any {
    // Parse argument values
    if (text.startsWith("'") || text.startsWith('"')) {
      return text.slice(1, -1);
    }
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (text === 'null') return null;
    if (text === 'undefined') return undefined;
    if (!isNaN(parseFloat(text))) return parseFloat(text);
    if (text.startsWith('[') && text.endsWith(']')) {
      try { return JSON.parse(text); } catch { return text; }
    }
    if (text.startsWith('{') && text.endsWith('}')) {
      try { return JSON.parse(text); } catch { return text; }
    }
    return text; // Variable reference
  }
  
  private generateTransformedCode(program: KUHULProgram): string {
    let code = `
// ============================================
// KUHUL-ES Transformed Code
// Generated: ${new Date().toISOString()}
// π-Bindings: ${program.πBindings.size}
// τ-Bindings: ${program.τBindings.size}
// Glyph Calls: ${program.glyphCalls.length}
// ============================================

// ----- π-BINDINGS (Immutable) -----
`;
    
    // Generate π-bindings
    program.πBindings.forEach((binding, name) => {
      code += `const __π_${name} = Object.freeze(${JSON.stringify(binding.value)});\n`;
    });
    
    code += '\n// ----- τ-BINDINGS (Temporal) -----\n';
    
    // Generate τ-bindings
    program.τBindings.forEach((binding, name) => {
      code += `let __τ_${name} = ${JSON.stringify(binding.initialValue)};\n`;
      code += `const __τ_${name}_history = [];\n`;
    });
    
    code += '\n// ----- GLYPH EXECUTION -----\n';
    code += 'const glyphQueue = [];\n';
    code += 'const glyphResults = new Map();\n\n';
    
    // Generate glyph execution functions
    program.glyphCalls.forEach((call, index) => {
      const args = call.args.map(arg => 
        typeof arg === 'string' && !['true', 'false', 'null', 'undefined'].includes(arg) && 
        isNaN(parseFloat(arg)) ? `"${arg}"` : JSON.stringify(arg)
      ).join(', ');
      
      code += `// Original: ${call.source}\n`;
      code += `glyphQueue.push({\n`;
      code += `  id: ${index},\n`;
      code += `  glyph: '${call.glyph}',\n`;
      code += `  args: [${args}],\n`;
      code += `  timestamp: Date.now()\n`;
      code += `});\n\n`;
    });
    
    // Generate execution engine
    code += `
// ----- EXECUTION ENGINE -----
class KUHULRuntime {
  constructor() {
    this.π = new Map();
    this.τ = new Map();
    this.τHistory = new Map();
    this.glyphQueue = [];
    this.frame = 0;
    this.hashChain = [];
    
    // Initialize π-bindings
    ${Array.from(program.πBindings.keys()).map(name => 
      `this.π.set('${name}', __π_${name});`
    ).join('\n    ')}
    
    // Initialize τ-bindings
    ${Array.from(program.τBindings.keys()).map(name => 
      `this.τ.set('${name}', __τ_${name});\n    this.τHistory.set('${name}', __τ_${name}_history);`
    ).join('\n    ')}
  }
  
  async executeGlyph(glyph, args) {
    switch(glyph) {
      case 'Sek':
        return await this.executeSek(...args);
      case 'Pop':
        return await this.executePop(...args);
      case 'Wo':
        return await this.executeWo(...args);
      case 'Ch\\'en':
        return await this.executeChen(...args);
      case 'Yax':
        return await this.executeYax(...args);
      case 'Xul':
        return await this.executeXul(...args);
      default:
        console.warn('Unknown glyph:', glyph);
    }
  }
  
  async executeSek(operation, ...args) {
    console.log('[Sek]', operation, args);
    // Implementation in runtime
    return { operation, args, result: null };
  }
  
  async executePop(value) {
    console.log('[Pop]', value);
    return value;
  }
  
  async executeWo(operation, ...args) {
    console.log('[Wo]', operation, args);
    return { operation, args };
  }
  
  async executeChen(source, ...args) {
    console.log('[Ch\\'en] Reading from:', source, args);
    return { source, data: null };
  }
  
  async executeYax(condition, value) {
    console.log('[Yax] Condition:', condition, 'Value:', value);
    return condition ? value : null;
  }
  
  async executeXul() {
    console.log('[Xul] Stopping execution');
    return { stopped: true };
  }
  
  async executeAll() {
    for (const glyphCall of glyphQueue) {
      const result = await this.executeGlyph(glyphCall.glyph, glyphCall.args);
      glyphResults.set(glyphCall.id, result);
      
      // Hash the execution
      const hash = this.hashState({
        frame: this.frame,
        glyph: glyphCall.glyph,
        args: glyphCall.args,
        result: result
      });
      this.hashChain.push(hash);
      this.frame++;
    }
  }
  
  hashState(state) {
    // Simple deterministic hash
    const str = JSON.stringify(state);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return hash.toString(16);
  }
}

// ----- START EXECUTION -----
(async () => {
  const runtime = new KUHULRuntime();
  await runtime.executeAll();
  console.log('Execution complete. Hash chain:', runtime.hashChain);
})();
`;
    
    return code;
  }
}

export interface KUHULProgram {
  πBindings: Map<string, any>;
  τBindings: Map<string, any>;
  glyphCalls: Array<{glyph: string, args: any[], position?: number, source?: string}>;
  functions: Array<{name: string, parameters: string[], body: string, isGenerator: boolean, position?: number}>;
  directives: Array<{type: string, condition?: string, thenBranch?: string, elseBranch?: string, position?: number}>;
  transformedCode: string;
}

// ── KAST emitter: align the ECMAScript front end with the canonical IR ──────
// Lowering rules:
//   phase glyph != opcode   (fold = where, opcode = what, glyph = notation)
//   application KAST != driver KAST  (@driver only for provider bindings)

const GLYPH_OPCODE: Record<string, string> = {
  Pop: 'PROBE',
  Wo: 'BIND',
  Yax: 'RESOLVE',
  Sek: 'DISPATCH',
  "Ch'en": 'COLLECT',
  Xul: 'COMMIT',
};

function canonicalJson(obj: any): string {
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(', ') + ']';
  if (obj !== null && typeof obj === 'object') {
    return '{' + Object.keys(obj).sort().map(k => JSON.stringify(k) + ': ' + canonicalJson(obj[k])).join(', ') + '}';
  }
  return JSON.stringify(obj);
}

export function toKast(program: KUHULProgram, sourceId: string, opts: { driver?: boolean; driverOnly?: boolean; provider?: string; capabilities?: any; phaseHooks?: any; resources?: any } = {}): any {
  const crypto = require('crypto');
import { toDriverOnly } from './driver-kast';

  // driver-only KAST: build the FULL application KAST (with @driver), then
  // strip to the secure admission surface via toDriverOnly() — allowed
  // glyphs/opcodes/folds derived from actual usage (least privilege).
  const nodes: any[] = [], edges: any[] = [];
  let nodeId = 0, edgeId = 0, entry: string | null = null;
  const pushNode = (n: any) => { nodes.push(n); if (entry === null) entry = n.id; };

  for (const [name, b] of program.πBindings) {
    pushNode({ id: 'n' + nodeId++, kind: 'bind', fold: 'Pop', lane: 'config',
      glyph: 'bind', opcode: 'BIND', symbol: name, type: 'constant',
      operands: [name], attributes: { value: b.value, immutable: true } });
  }
  for (const [name, b] of program.τBindings) {
    pushNode({ id: 'n' + nodeId++, kind: 'bind', fold: 'Wo', lane: 'state',
      glyph: 'bind', opcode: 'BIND', symbol: name, type: 'temporal',
      operands: [name], attributes: { value: b.initialValue, temporal: true } });
  }
  let prev: string | null = nodes.length ? nodes[nodes.length - 1].id : null;
  for (const call of program.glyphCalls) {
    const fold = call.glyph;
    const opcode = GLYPH_OPCODE[fold] || 'CALL';
    const symbol = (typeof call.args[0] === 'string' && !['true','false','null'].includes(call.args[0]))
      ? call.args[0] : (call.source || call.glyph);
    const nid = 'n' + nodeId++;
    pushNode({ id: nid, kind: 'call', fold: fold, lane: 'compute',
      glyph: call.glyph, opcode: opcode, symbol: symbol,
      type: 'operator_call', operands: call.args, attributes: {} });
    if (prev) edges.push({ id: 'e' + edgeId++, from: prev, to: nid,
      kind: 'control', label: opcode, ordinal: edgeId - 1 });
    prev = nid;
  }
  for (const fn of program.functions) {
    const nid = 'n' + nodeId++;
    pushNode({ id: nid, kind: 'glyph', fold: 'Sek', lane: 'driver',
      glyph: fn.name, opcode: 'GLYPH', symbol: fn.name, type: 'driver_glyph',
      operands: fn.parameters, attributes: { body: fn.body } });
    if (prev) edges.push({ id: 'e' + edgeId++, from: prev, to: nid,
      kind: 'control', label: 'call', ordinal: edgeId - 1 });
    prev = nid;
  }
  for (const d of program.directives) {
    const nid = 'n' + nodeId++;
    pushNode({ id: nid, kind: d.type.slice(1), fold: 'Sek', lane: 'control',
      glyph: d.type, opcode: d.type.slice(1).toUpperCase(), symbol: d.condition || '',
      type: 'control_flow', operands: [], attributes: {} });
    if (prev) edges.push({ id: 'e' + edgeId++, from: prev, to: nid,
      kind: 'control', label: d.type, ordinal: edgeId - 1 });
    prev = nid;
  }

  const semantic_hash = crypto.createHash('sha256')
    .update(canonicalJson({ nodes, edges })).digest('hex');

  const doc: any = {
    protocol: 'kast/1',
    registry_hash: crypto.createHash('sha256').update(sourceId || '').digest('hex'),
    source_kind: 'kuhul-es',
    source_id: sourceId || 'source.kuhules',
    entry_node_id: entry,
    nodes, edges, semantic_hash,
  };
  const wantsDriver = opts.driver || opts.driverOnly;
  if (wantsDriver) {
    const provider = opts.provider || program.πBindings.get('provider')?.value
      || (sourceId ? String(sourceId).split('.')[0].toLowerCase() : 'kuhul-es');
    const caps = program.πBindings.get('capabilities')?.value || ['tensor.map'];
    doc['@driver'] = {
      '@abi': 1,
      '@requires': { kuhul: '>= 1.0', khl_abi: 1, scxq2: '>= 2.0' },
      '@capabilities': Array.isArray(caps) ? caps : [caps],
      '@phase_hooks': { Sek: 'dispatch', "Ch'en": 'collect_status', Xul: 'commit_tensor_state' },
      '@provider': provider,
      '@resources': [], '@hash': semantic_hash,
    };
  }
  if (opts.driverOnly) {
    return toDriverOnly(doc, { provider: opts.provider });
  }
  return doc;
}
