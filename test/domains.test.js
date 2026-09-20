'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  CoderDomain,
  InstructorDomain,
  AssistantDomain,
  DomainFactory,
} = require('../runtime/src/domains.js');

describe('Domain-specific Micronaut adapters', () => {
  it('CoderDomain generates code', async () => {
    const coder = new CoderDomain({ languages: ['typescript'], frameworks: ['react'] });
    const result = await coder.generateCode({ name: 'App', description: 'main' }, 'typescript', 'react');
    assert.ok(result.output, 'code generation produced output');
    assert.ok(result.output.value, 'output node has value');
  });

  it('CoderDomain reviews code', async () => {
    const coder = new CoderDomain();
    const result = await coder.reviewCode('console.log("debug");\nfunction a() {}\n', 'javascript');
    assert.ok(result.output, 'review produced output');
  });

  it('CoderDomain optimizes code', async () => {
    const coder = new CoderDomain();
    const result = await coder.optimizeCode('for (let i = 0; i < 10; i++) {}', 'performance');
    assert.ok(result.output, 'optimization produced output');
  });

  it('InstructorDomain plans a lesson', async () => {
    const instructor = new InstructorDomain({ subjects: ['mathematics'], levels: ['intermediate'] });
    const result = await instructor.planLesson('Algebra', 'intermediate', 60);
    assert.ok(result.output, 'lesson plan produced output');
  });

  it('InstructorDomain assesses a response', async () => {
    const instructor = new InstructorDomain();
    const result = await instructor.assessResponse('the answer is five', 'the answer is five', 'mathematics');
    assert.ok(result.output, 'assessment produced output');
  });

  it('AssistantDomain searches', async () => {
    const assistant = new AssistantDomain();
    const result = await assistant.search('KUHUL', 3);
    assert.ok(result.output, 'search produced output');
  });

  it('AssistantDomain summarizes', async () => {
    const assistant = new AssistantDomain();
    const result = await assistant.summarize('One. Two. Three.', 100);
    assert.ok(result.output, 'summarize produced output');
  });

  it('AssistantDomain translates', async () => {
    const assistant = new AssistantDomain();
    const result = await assistant.translate('hello', 'en', 'es');
    assert.ok(result.output, 'translate produced output');
  });

  it('DomainFactory creates known domains', () => {
    assert.ok(DomainFactory.create('coder') instanceof CoderDomain);
    assert.ok(DomainFactory.create('instructor') instanceof InstructorDomain);
    assert.ok(DomainFactory.create('assistant') instanceof AssistantDomain);
  });

  it('DomainFactory rejects unknown domain', () => {
    assert.throws(() => DomainFactory.create('bogus'), /Unknown domain/);
  });
});
