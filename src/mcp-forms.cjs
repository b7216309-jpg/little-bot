'use strict';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const enumValues = schema => schema.enum || schema.oneOf?.map(option => option.const);

function mcpQuestions(params) {
  if (params.mode === 'url') {
    const url = new URL(params.url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('The MCP server requested an unsupported URL.');
    return { questions: [], url: url.href };
  }
  if (!['form', 'openai/form'].includes(params.mode)) throw new Error('This MCP request type is not supported.');
  const schema = params.requestedSchema;
  if (!object(schema) || schema.type !== 'object' || !object(schema.properties) || Object.keys(schema.properties).length > 20) throw new Error('The MCP form is not supported.');
  const questions = Object.entries(schema.properties).map(([id, property]) => {
    if (!id || id.length > 100 || ['__proto__', 'constructor', 'prototype'].includes(id) || !object(property)) throw new Error('The MCP form contains an invalid field.');
    if (!['string', 'integer', 'number', 'boolean', 'array'].includes(property.type)) throw new Error('The MCP form contains an unsupported field type.');
    const values = enumValues(property);
    if (values && (!Array.isArray(values) || values.length > 50 || values.some(value => typeof value !== 'string'))) throw new Error('The MCP form contains an unsupported choice.');
    if (property.type === 'array' && (!object(property.items) || !(property.items.type === 'string' || property.items.anyOf))) throw new Error('Only lists of text are supported in MCP forms.');
    return { id, question: [property.title || id, property.description, property.type === 'array' ? 'Enter a JSON array of text values.' : ''].filter(Boolean).join(' — ').slice(0, 1500),
      optional: !(schema.required || []).includes(id),
      options: (property.type === 'boolean' ? ['true', 'false'] : values)?.map(value => ({ label: value })),
      isSecret: /password|secret|token|api.?key/i.test(id) };
  });
  return { questions };
}

function mcpContent(params, answers) {
  if (params.mode === 'url') return null;
  mcpQuestions(params);
  const schema = params.requestedSchema;
  const content = Object.create(null);
  for (const [name, property] of Object.entries(schema.properties)) {
    const raw = own(answers, name) ? answers[name]?.answers?.[0] : undefined;
    if (raw === undefined || raw === '') {
      if ((schema.required || []).includes(name)) throw new Error(`Answer ${property.title || name} before continuing.`);
      continue;
    }
    if (typeof raw !== 'string' || raw.length > 8000) throw new Error('An MCP answer is too long.');
    let value = raw;
    if (property.type === 'boolean') {
      if (!['true', 'false'].includes(raw)) throw new Error(`${name} must be true or false.`);
      value = raw === 'true';
    } else if (property.type === 'number' || property.type === 'integer') {
      if (!raw.trim()) throw new Error(`${name} must be a number.`);
      value = Number(raw);
      if (!Number.isFinite(value) || (property.type === 'integer' && !Number.isInteger(value)) || (property.minimum != null && value < property.minimum) || (property.maximum != null && value > property.maximum)) throw new Error(`${name} is outside the allowed numeric range.`);
    } else if (property.type === 'array') {
      try { value = JSON.parse(raw); } catch { throw new Error(`${name} must be a JSON array.`); }
      const choices = property.items.enum || property.items.anyOf?.map(item => item.const);
      if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || item.length > 8000 || (choices && !choices.includes(item))) || (property.minItems != null && value.length < property.minItems) || (property.maxItems != null && value.length > property.maxItems)) throw new Error(`${name} contains invalid list values.`);
    } else {
      const choices = enumValues(property);
      if ((choices && !choices.includes(value)) || (property.minLength != null && value.length < property.minLength) || (property.maxLength != null && value.length > property.maxLength)) throw new Error(`${name} does not match the requested format.`);
    }
    content[name] = value;
  }
  return content;
}

module.exports = { mcpQuestions, mcpContent };
