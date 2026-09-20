// examples/kuhul-e-demo.js
//
// Demonstrates the KUHUL-E domain-specific response engine with research
// plugins, fold-based responses, and feedback-driven learning.

'use strict';

const { KUHULEngine } = require('../runtime/src/kuhul-e.js');

async function main() {
  const engine = new KUHULEngine({
    foldOpts: { maxDepth: 10 },
    cacheTTL: 60000,
  });

  // Register an external research plugin.
  engine.registerResearch('wikipedia', async (query) => ({
    source: 'wikipedia',
    content: `Found Wikipedia article about "${query}"`,
    type: 'fact',
    confidence: 0.7,
  }));

  // Tech support domain.
  engine.switchDomain('tech');
  const tech = await engine.query('My computer is running slow', { researchDepth: 1 });
  console.log('Tech response:', tech.response);
  console.log('Tech confidence:', tech.metadata.confidence);
  console.log('Tech research count:', tech.research.length);

  // Medical domain.
  const medical = await engine.query('What are the symptoms of a cold?', { domain: 'medical' });
  console.log('Medical response:', medical.response);

  // Creative domain.
  const creative = await engine.query('Write a short poem about technology', { domain: 'creative' });
  console.log('Creative response:', creative.response);

  // Learn from feedback.
  engine.learn('My computer is running slow', tech.metadata.foldId, 0.8);

  // Export knowledge.
  const knowledge = engine.exportKnowledge();
  console.log('Exported domains:', knowledge.domains.length);
  console.log('Exported patterns:', knowledge.patterns.length);
  console.log('Folds protocol:', knowledge.folds.protocol);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
