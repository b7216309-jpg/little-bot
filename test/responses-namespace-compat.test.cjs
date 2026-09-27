'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_LOCAL_TOOL_NAME, prepareNamespaceTools, restoreNamespaceCalls } = require('../src/responses-namespace-compat.cjs');

function fixture() {
  return {
    model: 'local',
    tools: [
      {
        type: 'function',
        name: 'plain_tool',
        description: 'Plain.',
        strict: false,
        parameters: { type: 'object', properties: {} },
      },
      {
        type: 'namespace',
        name: 'mcp__codex_apps__calendar',
        description: 'Calendar actions',
        tools: [
          {
            type: 'function',
            name: 'create_event',
            description: 'Create an event.',
            strict: false,
            defer_loading: true,
            parameters: { type: 'object', properties: { title: { type: 'string' } } },
          },
          {
            type: 'function',
            name: 'list_events',
            description: 'List events.',
            strict: false,
            parameters: { type: 'object', properties: {} },
          },
          {
            type: 'custom',
            name: 'unsupported_freeform',
            description: 'Cannot be represented as a llama function.',
          },
        ],
      },
    ],
    input: [
      {
        type: 'function_call',
        namespace: 'mcp__codex_apps__calendar',
        name: 'create_event',
        arguments: '{"title":"test"}',
        call_id: 'call-old',
      },
      {
        type: 'function_call_output',
        namespace: 'mcp__codex_apps__calendar',
        name: 'create_event',
        output: 'done',
      },
    ],
  };
}

test('namespace tools become llama-compatible top-level functions', () => {
  const body = fixture();
  const mapping = prepareNamespaceTools(body);

  assert.equal(body.tools.some(tool => tool.type === 'namespace'), false);
  assert.equal(body.tools[0].name, 'plain_tool');
  assert.equal(mapping.flattened, 2);
  assert.equal(mapping.dropped, 1);
  assert.equal(mapping.byAlias.size, 2);

  const aliases = body.tools.slice(1).map(tool => tool.name);
  assert.equal(new Set(aliases).size, 2);
  assert.ok(aliases.every(name => name.length <= MAX_LOCAL_TOOL_NAME));
  assert.ok(body.tools.slice(1).every(tool => tool.type === 'function'));
  assert.ok(body.tools.slice(1).every(tool => !Object.hasOwn(tool, 'defer_loading')));
  assert.match(body.tools[1].description, /Namespace mcp__codex_apps__calendar: Calendar actions/);
  assert.match(body.tools[1].description, /Create an event/);

  const createAlias = mapping.byOriginal.get(JSON.stringify(['mcp__codex_apps__calendar', 'create_event']));
  assert.equal(body.input[0].name, createAlias);
  assert.equal(Object.hasOwn(body.input[0], 'namespace'), false);
  assert.equal(body.input[1].name, createAlias);
  assert.equal(Object.hasOwn(body.input[1], 'namespace'), false);
});

test('aliases avoid collisions with existing top-level tools and stay bounded', () => {
  const namespace = 'very.long.namespace.' + 'x'.repeat(100);
  const child = 'create_' + 'y'.repeat(100);
  const body = {
    tools: [
      { type: 'function', name: 'calendar__create_event', parameters: { type: 'object' } },
      { type: 'namespace', name: 'calendar', description: '', tools: [
        { type: 'function', name: 'create_event', description: '', parameters: { type: 'object' } },
      ] },
      { type: 'namespace', name: namespace, description: '', tools: [
        { type: 'function', name: child, description: '', parameters: { type: 'object' } },
      ] },
    ],
  };
  const mapping = prepareNamespaceTools(body);
  const names = body.tools.map(tool => tool.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.every(name => name.length <= MAX_LOCAL_TOOL_NAME));
  assert.notEqual(mapping.byOriginal.get(JSON.stringify(['calendar', 'create_event'])), 'calendar__create_event');
});

test('restoration adds original namespace and child name throughout Responses events', () => {
  const body = fixture();
  const mapping = prepareNamespaceTools(body);
  const alias = mapping.byOriginal.get(JSON.stringify(['mcp__codex_apps__calendar', 'create_event']));
  const event = {
    type: 'response.completed',
    response: {
      output: [
        { type: 'function_call', name: alias, arguments: '{}', call_id: 'call-1' },
        { type: 'message', content: [] },
      ],
    },
    nested: {
      item: { type: 'function_call', name: alias, arguments: '', call_id: 'call-2' },
    },
  };
  assert.equal(restoreNamespaceCalls(event, mapping.byAlias), true);
  for (const item of [event.response.output[0], event.nested.item]) {
    assert.equal(item.name, 'create_event');
    assert.equal(item.namespace, 'mcp__codex_apps__calendar');
  }
  assert.equal(restoreNamespaceCalls({ type: 'function_call', name: 'plain_tool' }, mapping.byAlias), false);
});

test('invalid namespace entries are removed instead of reaching llama.cpp', () => {
  const body = {
    tools: [
      { type: 'namespace', name: '', tools: [] },
      { type: 'namespace', name: 'bad', tools: [{ type: 'custom', name: 'raw' }] },
      { type: 'function', name: 'ok', parameters: { type: 'object' } },
    ],
  };
  const mapping = prepareNamespaceTools(body);
  assert.deepEqual(body.tools.map(tool => tool.name), ['ok']);
  assert.equal(mapping.flattened, 0);
  assert.equal(mapping.dropped, 2);
});
