'use strict';

const { createHash } = require('node:crypto');

const MAX_LOCAL_TOOL_NAME = 64;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const originalKey = (namespace, name) => JSON.stringify([namespace, name]);
const safePart = value => String(value || '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'tool';
const shortHash = value => createHash('sha256').update(value).digest('hex').slice(0, 10);

function namespaceTail(namespace) {
  const parts = String(namespace || '').split(/__+|[./:]+/).filter(Boolean);
  return safePart(parts.at(-1) || namespace || 'namespace');
}

function localAlias(namespace, name, used) {
  const child = safePart(name);
  const base = `${namespaceTail(namespace)}__${child}`;
  if (base.length <= MAX_LOCAL_TOOL_NAME && !used.has(base)) {
    used.add(base);
    return base;
  }
  const hash = shortHash(`${namespace}\0${name}`);
  const room = MAX_LOCAL_TOOL_NAME - hash.length - 2;
  const prefix = base.slice(0, Math.max(1, room));
  let alias = `${prefix}__${hash}`;
  let salt = 0;
  while (used.has(alias)) {
    const collision = shortHash(`${namespace}\0${name}\0${++salt}`);
    alias = `${base.slice(0, Math.max(1, MAX_LOCAL_TOOL_NAME - collision.length - 2))}__${collision}`;
  }
  used.add(alias);
  return alias;
}

function namespaceDescription(namespace) {
  const name = typeof namespace.name === 'string' ? namespace.name : 'namespace';
  const description = typeof namespace.description === 'string' ? namespace.description.trim() : '';
  return description ? `Namespace ${name}: ${description}` : `Namespace ${name}.`;
}

function rewriteHistoryItem(item, byOriginal) {
  if (!object(item) || !['function_call', 'function_call_output'].includes(item.type)
    || typeof item.namespace !== 'string' || typeof item.name !== 'string') return;
  const alias = byOriginal.get(originalKey(item.namespace, item.name));
  if (!alias) return;
  item.name = alias;
  delete item.namespace;
}

function prepareNamespaceTools(body) {
  const byAlias = new Map(), byOriginal = new Map();
  let flattened = 0, dropped = 0;
  if (!object(body) || !Array.isArray(body.tools)) {
    return { byAlias, byOriginal, flattened, dropped };
  }

  const used = new Set(body.tools.filter(tool => object(tool) && tool.type === 'function' && typeof tool.name === 'string')
    .map(tool => tool.name));
  const tools = [];
  for (const tool of body.tools) {
    if (!object(tool) || tool.type !== 'namespace') {
      tools.push(tool);
      continue;
    }
    if (typeof tool.name !== 'string' || !tool.name || !Array.isArray(tool.tools)) {
      dropped += 1;
      continue;
    }
    const namespaceNote = namespaceDescription(tool);
    for (const child of tool.tools) {
      if (!object(child) || child.type !== 'function' || typeof child.name !== 'string' || !child.name) {
        dropped += 1;
        continue;
      }
      const alias = localAlias(tool.name, child.name, used);
      const key = originalKey(tool.name, child.name);
      byAlias.set(alias, { namespace: tool.name, name: child.name });
      byOriginal.set(key, alias);
      const flat = { ...child, type: 'function', name: alias };
      delete flat.defer_loading;
      const childDescription = typeof flat.description === 'string' ? flat.description.trim() : '';
      flat.description = childDescription ? `${namespaceNote}\n${childDescription}` : namespaceNote;
      tools.push(flat);
      flattened += 1;
    }
  }
  body.tools = tools;

  if (Array.isArray(body.input) && byOriginal.size) {
    for (const item of body.input) rewriteHistoryItem(item, byOriginal);
  }
  return { byAlias, byOriginal, flattened, dropped };
}

function restoreNamespaceCalls(value, byAlias) {
  if (!value || !byAlias?.size) return false;
  let changed = false;
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node.type === 'function_call' && typeof node.name === 'string') {
      const original = byAlias.get(node.name);
      if (original) {
        node.name = original.name;
        node.namespace = original.namespace;
        changed = true;
      }
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return changed;
}

module.exports = { MAX_LOCAL_TOOL_NAME, prepareNamespaceTools, restoreNamespaceCalls };
