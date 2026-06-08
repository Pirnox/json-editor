(function () {
  "use strict";

  // ---- Data model -------------------------------------------------------
  // The whole document is a single root "value" node. A value is one of:
  //   {type:'object', entries:[{key:'', value: <value>}, ...]}
  //   {type:'array',  items:[<value>, ...]}
  //   {type:'string', value: ''}
  //   {type:'number', value: 0}
  //   {type:'boolean', value: true}
  //   {type:'null'}
  //
  // This removes the need for the user to ever type braces, brackets,
  // commas, colons or manage indentation — the UI builds valid JSON.

  let root = { type: 'object', entries: [] };

  const treeRoot = document.getElementById('tree-root');
  const preview = document.getElementById('preview');
  const statusEl = document.getElementById('status');

  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = kind || '';
  }

  function valueToJS(node) {
    switch (node.type) {
      case 'object': {
        const obj = {};
        for (const e of node.entries) obj[e.key] = valueToJS(e.value);
        return obj;
      }
      case 'array':
        return node.items.map(valueToJS);
      case 'string': return node.value;
      case 'number': return node.value;
      case 'boolean': return node.value;
      case 'null': return null;
    }
  }

  function jsToValue(js) {
    if (js === null) return { type: 'null' };
    if (Array.isArray(js)) return { type: 'array', items: js.map(jsToValue) };
    switch (typeof js) {
      case 'object':
        return { type: 'object', entries: Object.keys(js).map(k => ({ key: k, value: jsToValue(js[k]) })) };
      case 'string': return { type: 'string', value: js };
      case 'number': return { type: 'number', value: js };
      case 'boolean': return { type: 'boolean', value: js };
      default: return { type: 'null' };
    }
  }

  function newValueOfType(type) {
    switch (type) {
      case 'object': return { type: 'object', entries: [] };
      case 'array': return { type: 'array', items: [] };
      case 'string': return { type: 'string', value: '' };
      case 'number': return { type: 'number', value: 0 };
      case 'boolean': return { type: 'boolean', value: true };
      case 'null': return { type: 'null' };
    }
  }

  // ---- Multi-format support: JSON / YAML / TOML --------------------------
  // The editor's internal model is format-agnostic (plain JS values). These
  // helpers convert that model to/from text in whichever format the user
  // picked, so the same tree can be exported as JSON, YAML or TOML and raw
  // text in any of the three can be imported and turned into the tree.

  const FORMAT_INFO = {
    json: { label: 'JSON', ext: 'json', mime: 'application/json' },
    yaml: { label: 'YAML', ext: 'yaml', mime: 'application/x-yaml' },
    toml: { label: 'TOML', ext: 'toml', mime: 'application/toml' }
  };

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function containsNull(v) {
    if (v === null) return true;
    if (Array.isArray(v)) return v.some(containsNull);
    if (isPlainObject(v)) return Object.keys(v).some(k => containsNull(v[k]));
    return false;
  }

  function stringifyAs(js, format) {
    if (format === 'json') {
      return { text: JSON.stringify(js, null, 2), warnings: [] };
    }
    if (format === 'yaml') {
      const text = (js === null || (isPlainObject(js) && Object.keys(js).length === 0))
        ? (js === null ? 'null\n' : '{}\n')
        : yamlBlock(js, 0) + '\n';
      return { text, warnings: [] };
    }
    if (format === 'toml') {
      if (!isPlainObject(js)) {
        throw new Error('Format TOML wymaga, aby cały dokument był obiektem (mapą klucz → wartość), a nie listą ani pojedynczą wartością.');
      }
      const lines = [];
      emitTomlTable(js, [], lines, false);
      const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
      const warnings = containsNull(js)
        ? ['TOML nie obsługuje wartości null — zapisano je jako puste teksty "".']
        : [];
      return { text, warnings };
    }
    throw new Error('Nieznany format: ' + format);
  }

  function parseAs(text, format) {
    if (format === 'json') return JSON.parse(text);
    if (format === 'yaml') return parseYAML(text);
    if (format === 'toml') return parseTOML(text);
    throw new Error('Nieznany format: ' + format);
  }

  // Guess which formats are most likely, in order of likelihood, so "auto"
  // import can try the most plausible parser first.
  function detectFormatOrder(text) {
    const trimmed = text.trim();
    if (trimmed === '') return ['json', 'yaml', 'toml'];
    if (trimmed[0] === '{' || trimmed[0] === '[') return ['json', 'yaml', 'toml'];
    const firstLine = (trimmed.split('\n').find(l => l.trim() && !l.trim().startsWith('#')) || '').trim();
    if (/^\[\[?[^\]]+\]\]?\s*$/.test(firstLine) || /^[A-Za-z0-9_."'-]+\s*=\s*\S/.test(firstLine)) {
      return ['toml', 'yaml', 'json'];
    }
    return ['yaml', 'json', 'toml'];
  }

  // ---- YAML: serialize ----------------------------------------------------

  function yamlIndent(n) { return '  '.repeat(n); }

  function yamlBlock(value, indent) {
    if (Array.isArray(value)) {
      if (value.length === 0) return yamlIndent(indent) + '[]';
      return value.map(item => {
        const prefix = yamlIndent(indent) + '- ';
        if (isPlainObject(item) && Object.keys(item).length > 0) {
          const inner = yamlBlock(item, indent + 1);
          const innerLines = inner.split('\n');
          const stripLen = (indent + 1) * 2;
          const firstLine = innerLines[0].slice(stripLen);
          const rest = innerLines.slice(1).join('\n');
          return prefix + firstLine + (rest ? '\n' + rest : '');
        }
        if (Array.isArray(item) && item.length > 0) {
          return prefix.replace(/\s+$/, '') + '\n' + yamlBlock(item, indent + 1);
        }
        return prefix + yamlScalar(item);
      }).join('\n');
    }
    if (isPlainObject(value)) {
      const keys = Object.keys(value);
      if (keys.length === 0) return yamlIndent(indent) + '{}';
      return keys.map(k => {
        const v = value[k];
        const keyPart = yamlIndent(indent) + yamlScalarString(k) + ':';
        if (isPlainObject(v) && Object.keys(v).length > 0) return keyPart + '\n' + yamlBlock(v, indent + 1);
        if (Array.isArray(v) && v.length > 0) return keyPart + '\n' + yamlBlock(v, indent);
        if (isPlainObject(v)) return keyPart + ' {}';
        if (Array.isArray(v)) return keyPart + ' []';
        return keyPart + ' ' + yamlScalar(v);
      }).join('\n');
    }
    return yamlIndent(indent) + yamlScalar(value);
  }

  function yamlScalar(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return String(v);
    return yamlScalarString(String(v));
  }

  function yamlScalarString(s) {
    if (s === '') return "''";
    const needsQuote =
      /^[\s]|[\s]$/.test(s) ||
      /^[-?:,\[\]{}#&*!|>'"%@`]/.test(s) ||
      /: |:$/.test(s) ||
      /^(true|false|null|yes|no|on|off|~)$/i.test(s) ||
      /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ||
      /[\n\t]/.test(s);
    if (needsQuote) {
      return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
    }
    return s;
  }

  // ---- YAML: parse (common block-style subset) ---------------------------

  function parseYAML(text) {
    const rawLines = text.replace(/\r\n/g, '\n').split('\n');
    const lines = [];
    for (const raw of rawLines) {
      const noComment = stripYamlComment(raw);
      const trimmedLine = noComment.trim();
      if (trimmedLine === '' || trimmedLine === '---' || trimmedLine === '...') continue;
      const leading = noComment.match(/^[ \t]*/)[0];
      if (leading.indexOf('\t') !== -1) {
        throw new Error('YAML nie pozwala używać tabulatorów do wcięć (linia: "' + trimmedLine + '"). Zamień je na spacje.');
      }
      lines.push({ indent: leading.length, content: noComment.slice(leading.length) });
    }
    if (lines.length === 0) return null;
    const cursor = { i: 0 };
    return parseYamlNode(lines, cursor, lines[0].indent);
  }

  function stripYamlComment(line) {
    let inStr = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inStr) {
        if (c === inStr && line[i - 1] !== '\\') inStr = null;
      } else if (c === '"' || c === "'") {
        inStr = c;
      } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
        return line.slice(0, i).replace(/\s+$/, '');
      }
    }
    return line;
  }

  function parseYamlNode(lines, cursor, indent) {
    if (cursor.i >= lines.length) return null;
    const line = lines[cursor.i];
    if (line.indent < indent) return null;
    if (line.content === '-' || line.content.startsWith('- ')) {
      return parseYamlSequence(lines, cursor, line.indent);
    }
    if (matchYamlKeyValue(line.content)) {
      return parseYamlMapping(lines, cursor, line.indent);
    }
    cursor.i++;
    return parseYamlScalar(line.content);
  }

  function matchYamlKeyValue(content) {
    let m = content.match(/^"((?:[^"\\]|\\.)*)"\s*:(?:\s+(.*))?$/);
    if (m) return { key: unescapeYamlDouble(m[1]), value: m[2] !== undefined ? m[2] : '' };
    m = content.match(/^'((?:[^']|'')*)'\s*:(?:\s+(.*))?$/);
    if (m) return { key: m[1].replace(/''/g, "'"), value: m[2] !== undefined ? m[2] : '' };
    m = content.match(/^([^:\s][^:]*?):(?:\s+(.*))?$/);
    if (m && !/^[-?]\s/.test(m[1]) && m[1].indexOf('#') === -1) {
      return { key: m[1].trim(), value: m[2] !== undefined ? m[2] : '' };
    }
    return null;
  }

  function parseYamlMapping(lines, cursor, indent) {
    const obj = {};
    while (cursor.i < lines.length) {
      const line = lines[cursor.i];
      if (line.indent < indent) break;
      if (line.indent !== indent) {
        throw new Error('Niespójne wcięcie w YAML w linii: "' + line.content + '"');
      }
      const kv = matchYamlKeyValue(line.content);
      if (!kv) throw new Error('Nie rozpoznano wpisu mapy YAML w linii: "' + line.content + '"');
      cursor.i++;
      if (kv.value === '' || kv.value === undefined) {
        if (cursor.i < lines.length && lines[cursor.i].indent > indent) {
          obj[kv.key] = parseYamlNode(lines, cursor, lines[cursor.i].indent);
        } else if (cursor.i < lines.length && lines[cursor.i].indent === indent &&
                   (lines[cursor.i].content === '-' || lines[cursor.i].content.startsWith('- '))) {
          obj[kv.key] = parseYamlSequence(lines, cursor, indent);
        } else {
          obj[kv.key] = null;
        }
      } else {
        obj[kv.key] = parseYamlInlineValue(kv.value);
      }
    }
    return obj;
  }

  function parseYamlSequence(lines, cursor, indent) {
    const arr = [];
    while (cursor.i < lines.length) {
      const line = lines[cursor.i];
      if (line.indent < indent) break;
      if (line.indent !== indent) throw new Error('Niespójne wcięcie w liście YAML w linii: "' + line.content + '"');
      if (!(line.content === '-' || line.content.startsWith('- '))) break;
      const rest = line.content === '-' ? '' : line.content.slice(2);
      cursor.i++;
      if (rest.trim() === '') {
        if (cursor.i < lines.length && lines[cursor.i].indent > indent) {
          arr.push(parseYamlNode(lines, cursor, lines[cursor.i].indent));
        } else {
          arr.push(null);
        }
        continue;
      }
      const kv = matchYamlKeyValue(rest);
      if (kv) {
        const mapIndent = indent + 2;
        const fakeLines = [{ indent: mapIndent, content: rest }];
        let j = cursor.i;
        while (j < lines.length && lines[j].indent > indent) {
          fakeLines.push({ indent: lines[j].indent, content: lines[j].content });
          j++;
        }
        const subCursor = { i: 0 };
        arr.push(parseYamlMapping(fakeLines, subCursor, mapIndent));
        cursor.i = j;
      } else {
        arr.push(parseYamlInlineValue(rest));
      }
    }
    return arr;
  }

  function parseYamlInlineValue(s) {
    s = s.trim();
    if (s === '') return null;
    if (s[0] === '[' && s[s.length - 1] === ']') return parseYamlFlowSequence(s);
    if (s[0] === '{' && s[s.length - 1] === '}') return parseYamlFlowMapping(s);
    return parseYamlScalar(s);
  }

  function splitFlowItems(s) {
    const parts = [];
    let depth = 0, inStr = null, cur = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        cur += c;
        if (c === inStr && s[i - 1] !== '\\') inStr = null;
      } else if (c === '"' || c === "'") { inStr = c; cur += c; }
      else if (c === '[' || c === '{') { depth++; cur += c; }
      else if (c === ']' || c === '}') { depth--; cur += c; }
      else if (c === ',' && depth === 0) { parts.push(cur); cur = ''; }
      else cur += c;
    }
    if (cur.trim() !== '') parts.push(cur);
    return parts.map(p => p.trim()).filter(p => p !== '');
  }

  function parseYamlFlowSequence(s) {
    const inner = s.slice(1, -1).trim();
    if (inner === '') return [];
    return splitFlowItems(inner).map(parseYamlInlineValue);
  }

  function parseYamlFlowMapping(s) {
    const inner = s.slice(1, -1).trim();
    const obj = {};
    if (inner === '') return obj;
    for (const part of splitFlowItems(inner)) {
      const kv = matchYamlKeyValue(part) || { key: part.trim(), value: '' };
      obj[kv.key] = (kv.value === '' || kv.value === undefined) ? null : parseYamlInlineValue(kv.value);
    }
    return obj;
  }

  function parseYamlScalar(s) {
    s = s.trim();
    if (s === '' || s === '~' || /^(null|Null|NULL)$/.test(s)) return null;
    if (/^(true|True|TRUE)$/.test(s)) return true;
    if (/^(false|False|FALSE)$/.test(s)) return false;
    if (/^"((?:[^"\\]|\\.)*)"$/.test(s)) return unescapeYamlDouble(s.slice(1, -1));
    if (/^'((?:[^']|'')*)'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
    if (/^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(s) && !/^[+-]?0\d/.test(s)) return parseFloat(s);
    return s;
  }

  function unescapeYamlDouble(s) {
    return s.replace(/\\(.)/g, (m, c) => ({ n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' }[c] || c));
  }

  // ---- TOML: serialize ----------------------------------------------------

  function emitTomlTable(obj, path, lines, asArrayItem) {
    if (path.length > 0) {
      const header = path.map(tomlKey).join('.');
      lines.push(asArrayItem ? '[[' + header + ']]' : '[' + header + ']');
    }
    const simple = [], subTables = [], subArrayTables = [];
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (Array.isArray(v) && v.length > 0 && v.every(isPlainObject)) subArrayTables.push(key);
      else if (isPlainObject(v)) subTables.push(key);
      else simple.push(key);
    }
    for (const k of simple) lines.push(tomlKey(k) + ' = ' + tomlValue(obj[k]));
    if (path.length > 0 || simple.length > 0) lines.push('');
    for (const k of subTables) emitTomlTable(obj[k], path.concat(k), lines, false);
    for (const k of subArrayTables) {
      for (const item of obj[k]) emitTomlTable(item, path.concat(k), lines, true);
    }
  }

  function tomlValue(v) {
    if (v === null || v === undefined) return '""';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return tomlString(v);
    if (Array.isArray(v)) return '[' + v.map(tomlValue).join(', ') + ']';
    if (isPlainObject(v)) return '{ ' + Object.keys(v).map(k => tomlKey(k) + ' = ' + tomlValue(v[k])).join(', ') + ' }';
    return '""';
  }

  function tomlString(s) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
  }

  function tomlKey(k) {
    return /^[A-Za-z0-9_-]+$/.test(k) ? k : tomlString(k);
  }

  // ---- TOML: parse (common subset: tables, arrays of tables, basic types) -

  function parseTOML(text) {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const root = {};
    let current = root;
    for (const rawLine of lines) {
      const line = stripTomlComment(rawLine).trim();
      if (line === '') continue;
      if (line.startsWith('[[') && line.endsWith(']]')) {
        const path = parseTomlKeyPath(line.slice(2, -2).trim());
        current = navigateTomlArrayTable(root, path);
      } else if (line.startsWith('[') && line.endsWith(']')) {
        const path = parseTomlKeyPath(line.slice(1, -1).trim());
        current = navigateTomlTable(root, path);
      } else {
        const eq = findUnquotedChar(line, '=');
        if (eq === -1) throw new Error('Nie rozpoznano linii TOML (brak "="): "' + line + '"');
        const path = parseTomlKeyPath(line.slice(0, eq).trim());
        setTomlValue(current, path, parseTomlValue(line.slice(eq + 1).trim()));
      }
    }
    return root;
  }

  function stripTomlComment(line) {
    let inStr = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inStr) {
        if (c === inStr && line[i - 1] !== '\\') inStr = null;
      } else if (c === '"' || c === "'") inStr = c;
      else if (c === '#') return line.slice(0, i);
    }
    return line;
  }

  function findUnquotedChar(line, target) {
    let inStr = null, depth = 0;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inStr) {
        if (c === inStr && line[i - 1] !== '\\') inStr = null;
      } else if (c === '"' || c === "'") inStr = c;
      else if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth--;
      else if (c === target && depth === 0) return i;
    }
    return -1;
  }

  function parseTomlKeyPath(s) {
    const parts = [];
    let cur = '', inStr = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        cur += c;
        if (c === inStr && s[i - 1] !== '\\') inStr = null;
      } else if (c === '"' || c === "'") { inStr = c; cur += c; }
      else if (c === '.') { parts.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    if (cur.trim() !== '') parts.push(cur.trim());
    return parts.map(unquoteTomlKey);
  }

  function unquoteTomlKey(k) {
    k = k.trim();
    if (/^"(.*)"$/.test(k)) return unescapeTomlBasic(k.slice(1, -1));
    if (/^'(.*)'$/.test(k)) return k.slice(1, -1);
    return k;
  }

  function navigateTomlTable(root, path) {
    let node = root;
    for (const key of path) {
      if (!(key in node)) node[key] = {};
      node = Array.isArray(node[key]) ? node[key][node[key].length - 1] : node[key];
    }
    return node;
  }

  function navigateTomlArrayTable(root, path) {
    let node = root;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (!(key in node)) node[key] = {};
      node = Array.isArray(node[key]) ? node[key][node[key].length - 1] : node[key];
    }
    const lastKey = path[path.length - 1];
    if (!Array.isArray(node[lastKey])) node[lastKey] = [];
    const item = {};
    node[lastKey].push(item);
    return item;
  }

  function setTomlValue(table, path, value) {
    let node = table;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (!(key in node)) node[key] = {};
      node = node[key];
    }
    node[path[path.length - 1]] = value;
  }

  function parseTomlValue(s) {
    s = s.trim();
    if (s === '') throw new Error('Brak wartości po znaku "="');
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s[0] === '[') return parseTomlArray(s);
    if (s[0] === '{') return parseTomlInlineTable(s);
    if (/^"""[\s\S]*"""$/.test(s)) return s.slice(3, -3).replace(/^\n/, '');
    if (/^'''[\s\S]*'''$/.test(s)) return s.slice(3, -3).replace(/^\n/, '');
    if (/^"((?:[^"\\]|\\.)*)"$/.test(s)) return unescapeTomlBasic(s.slice(1, -1));
    if (/^'(.*)'$/.test(s)) return s.slice(1, -1);
    if (/^[+-]?\d[\d_]*$/.test(s)) return parseInt(s.replace(/_/g, ''), 10);
    if (/^[+-]?(\d[\d_]*\.\d[\d_]*|\d[\d_]*)([eE][+-]?\d+)?$/.test(s)) return parseFloat(s.replace(/_/g, ''));
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.replace(/^"|"$/g, '');
    return s;
  }

  function unescapeTomlBasic(s) {
    return s.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (m, g) => {
      if (g[0] === 'u' || g[0] === 'U') return String.fromCodePoint(parseInt(g.slice(1), 16));
      return ({ n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' })[g] || g;
    });
  }

  function parseTomlArray(s) {
    const inner = s.slice(1, -1).trim();
    if (inner === '') return [];
    return splitFlowItems(inner).map(parseTomlValue);
  }

  function parseTomlInlineTable(s) {
    const inner = s.slice(1, -1).trim();
    const obj = {};
    if (inner === '') return obj;
    for (const part of splitFlowItems(inner)) {
      const eq = findUnquotedChar(part, '=');
      if (eq === -1) throw new Error('Nieprawidłowy wpis w tabeli inline TOML: "' + part + '"');
      const path = parseTomlKeyPath(part.slice(0, eq).trim());
      setTomlValue(obj, path, parseTomlValue(part.slice(eq + 1).trim()));
    }
    return obj;
  }

  // ---- JSON auto-repair ----------------------------------------------------
  // Tries a series of safe, well-known fixes for JSON that was pasted from
  // sources that don't produce strict JSON (JS object literals, Python dicts,
  // JSON with comments or trailing commas, etc.) and reports each fix made.

  function autoFixJSON(text) {
    const fixes = [];
    let fixed = text;

    if (fixed.charCodeAt(0) === 0xFEFF) {
      fixed = fixed.slice(1);
      fixes.push('Usunięto niewidoczny znak BOM na początku pliku.');
    }
    let step = stripJsonComments(fixed);
    if (step !== fixed) { fixed = step; fixes.push('Usunięto komentarze (// … lub /* … */) — JSON ich nie obsługuje.'); }

    step = convertSingleToDoubleQuotes(fixed);
    if (step !== fixed) { fixed = step; fixes.push('Zamieniono pojedyncze cudzysłowy (\') na podwójne (") wokół tekstów.'); }

    step = quoteUnquotedKeys(fixed);
    if (step !== fixed) { fixed = step; fixes.push('Dodano cudzysłowy wokół nazw kluczy zapisanych bez nich.'); }

    step = fixed.replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null');
    if (step !== fixed) { fixed = step; fixes.push('Zamieniono True/False/None (zapis pythonowy) na true/false/null.'); }

    step = fixed.replace(/,(\s*[}\]])/g, '$1');
    if (step !== fixed) { fixed = step; fixes.push('Usunięto zbędne przecinki przed zamykającym } lub ].'); }

    return { fixed, fixes };
  }

  function stripJsonComments(text) {
    let out = '', inStr = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i], n = text[i + 1];
      if (inStr) {
        out += c;
        if (c === '\\') { out += n; i++; }
        else if (c === inStr) inStr = null;
        continue;
      }
      if (c === '"' || c === "'") { inStr = c; out += c; continue; }
      if (c === '/' && n === '/') {
        while (i < text.length && text[i] !== '\n') i++;
        i--;
        continue;
      }
      if (c === '/' && n === '*') {
        i += 2;
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
        i++;
        continue;
      }
      out += c;
    }
    return out;
  }

  function convertSingleToDoubleQuotes(text) {
    let out = '', i = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') {
        out += c; i++;
        while (i < text.length) {
          out += text[i];
          if (text[i] === '\\') { i++; out += text[i]; }
          else if (text[i] === '"') { i++; break; }
          i++;
        }
        continue;
      }
      if (c === "'") {
        let s = '';
        i++;
        while (i < text.length && text[i] !== "'") {
          if (text[i] === '\\') { s += text[i] + (text[i + 1] || ''); i += 2; }
          else { s += text[i]; i++; }
        }
        i++;
        const content = s.replace(/\\'/g, "'").replace(/(?<!\\)"/g, '\\"');
        out += '"' + content + '"';
        continue;
      }
      out += c; i++;
    }
    return out;
  }

  function quoteUnquotedKeys(text) {
    let out = '', i = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === '"' || c === "'") {
        const quote = c;
        out += c; i++;
        while (i < text.length) {
          out += text[i];
          if (text[i] === '\\') { i++; out += text[i]; }
          else if (text[i] === quote) { i++; break; }
          i++;
        }
        continue;
      }
      if (c === '{' || c === ',') {
        out += c; i++;
        let j = i;
        while (j < text.length && /\s/.test(text[j])) j++;
        const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(j));
        if (m) {
          let k = j + m[0].length;
          while (k < text.length && /\s/.test(text[k])) k++;
          if (text[k] === ':') {
            out += text.slice(i, j) + '"' + m[0] + '"';
            i = j + m[0].length;
            continue;
          }
        }
        continue;
      }
      out += c; i++;
    }
    return out;
  }

  // ---- Rendering: tree editor -------------------------------------------

  function render() {
    treeRoot.innerHTML = '';
    treeRoot.appendChild(renderValueEditor(root, null, null, true));
    renderPreview();
  }

  // Renders the *content controls* for editing a value in-place
  // (type selector + the value-specific inputs/children), used both
  // for the root and for nested values.
  function renderValueEditor(node, onReplace, label, isRoot) {
    const wrap = document.createElement('div');

    const row = document.createElement('div');
    row.className = 'node-row';

    if (label !== null && label !== undefined) {
      // label is a DOM node (key input or index badge) supplied by caller
      row.appendChild(label);
    }

    const typeSelect = document.createElement('select');
    typeSelect.className = 'type-select';
    ['object', 'array', 'string', 'number', 'boolean', 'null'].forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = {
        object: 'obiekt {}', array: 'lista []', string: 'tekst',
        number: 'liczba', boolean: 'prawda/fałsz', null: 'null'
      }[t];
      if (t === node.type) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    typeSelect.addEventListener('change', () => {
      const replacement = newValueOfType(typeSelect.value);
      if (onReplace) onReplace(replacement);
      else { root = replacement; }
      render();
    });
    row.appendChild(typeSelect);

    // value-specific controls appended to the row
    appendValueControls(row, node);

    wrap.appendChild(row);

    // children container for object/array
    if (node.type === 'object' || node.type === 'array') {
      const childContainer = document.createElement('div');
      childContainer.className = 'node';
      wrap.appendChild(childContainer);

      if (node.type === 'object') {
        if (node.entries.length === 0) {
          childContainer.appendChild(hint('Brak pól — kliknij "+ dodaj pole"'));
        }
        node.entries.forEach((entry, idx) => {
          childContainer.appendChild(renderObjectEntry(node, entry, idx));
        });
        const addBtn = document.createElement('button');
        addBtn.className = 'icon-btn add';
        addBtn.textContent = '+ dodaj pole';
        addBtn.addEventListener('click', () => {
          node.entries.push({ key: uniqueKey(node), value: { type: 'string', value: '' } });
          render();
        });
        childContainer.appendChild(addBtn);
      } else {
        if (node.items.length === 0) {
          childContainer.appendChild(hint('Lista pusta — kliknij "+ dodaj element"'));
        }
        node.items.forEach((item, idx) => {
          childContainer.appendChild(renderArrayItem(node, idx));
        });
        const addBtn = document.createElement('button');
        addBtn.className = 'icon-btn add';
        addBtn.textContent = '+ dodaj element';
        addBtn.addEventListener('click', () => {
          node.items.push({ type: 'string', value: '' });
          render();
        });
        childContainer.appendChild(addBtn);
      }
    }

    return wrap;
  }

  function uniqueKey(objNode) {
    let i = objNode.entries.length + 1;
    let k = 'pole' + i;
    const existing = new Set(objNode.entries.map(e => e.key));
    while (existing.has(k)) { i++; k = 'pole' + i; }
    return k;
  }

  function hint(text) {
    const d = document.createElement('div');
    d.className = 'empty-hint';
    d.style.padding = '4px 0';
    d.textContent = text;
    return d;
  }

  function appendValueControls(row, node) {
    if (node.type === 'string') {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'val-input string';
      input.value = node.value;
      input.placeholder = 'wpisz tekst…';
      input.addEventListener('input', () => { node.value = input.value; renderPreview(); });
      row.appendChild(input);
    } else if (node.type === 'number') {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'val-input number';
      input.value = node.value;
      input.addEventListener('input', () => {
        const n = parseFloat(input.value);
        node.value = isNaN(n) ? 0 : n;
        renderPreview();
      });
      row.appendChild(input);
    } else if (node.type === 'boolean') {
      const select = document.createElement('select');
      select.className = 'type-select';
      [['true', 'prawda'], ['false', 'fałsz']].forEach(([v, label]) => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = label;
        if ((v === 'true') === node.value) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', () => {
        node.value = select.value === 'true';
        renderPreview();
      });
      row.appendChild(select);
    } else if (node.type === 'null') {
      const span = document.createElement('span');
      span.className = 'null-label';
      span.textContent = 'null (brak wartości)';
      row.appendChild(span);
    } else if (node.type === 'object') {
      const span = document.createElement('span');
      span.className = 'badge';
      span.textContent = node.entries.length + ' pól';
      row.appendChild(span);
    } else if (node.type === 'array') {
      const span = document.createElement('span');
      span.className = 'badge';
      span.textContent = node.items.length + ' elementów';
      row.appendChild(span);
    }
  }

  function renderObjectEntry(parentNode, entry, idx) {
    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.className = 'key-input';
    keyInput.value = entry.key;
    keyInput.placeholder = 'nazwa klucza';
    keyInput.addEventListener('input', () => { entry.key = keyInput.value; renderPreview(); });

    const labelWrap = document.createElement('span');
    labelWrap.style.display = 'flex';
    labelWrap.style.alignItems = 'center';
    labelWrap.style.gap = '4px';
    labelWrap.appendChild(keyInput);
    const colon = document.createElement('span');
    colon.className = 'tok-punct';
    colon.textContent = ':';
    labelWrap.appendChild(colon);

    const editor = renderValueEditor(entry.value, (replacement) => { entry.value = replacement; }, labelWrap);

    // attach remove/move buttons to the first row of the editor
    const firstRow = editor.querySelector('.node-row');
    addEntryControls(firstRow, parentNode.entries, idx);

    return editor;
  }

  function renderArrayItem(parentNode, idx) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = '#' + (idx + 1);

    const item = parentNode.items[idx];
    const editor = renderValueEditor(item, (replacement) => { parentNode.items[idx] = replacement; }, badge);

    const firstRow = editor.querySelector('.node-row');
    addEntryControls(firstRow, parentNode.items, idx);

    return editor;
  }

  // Adds ↑ ↓ and 🗑 buttons that operate on a generic array (entries or items)
  function addEntryControls(row, list, idx) {
    const up = document.createElement('button');
    up.className = 'icon-btn';
    up.textContent = '↑';
    up.title = 'Przesuń w górę';
    up.disabled = idx === 0;
    up.addEventListener('click', () => {
      if (idx > 0) { [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]]; render(); }
    });

    const down = document.createElement('button');
    down.className = 'icon-btn';
    down.textContent = '↓';
    down.title = 'Przesuń w dół';
    down.disabled = idx === list.length - 1;
    down.addEventListener('click', () => {
      if (idx < list.length - 1) { [list[idx + 1], list[idx]] = [list[idx], list[idx + 1]]; render(); }
    });

    const remove = document.createElement('button');
    remove.className = 'icon-btn remove';
    remove.textContent = '🗑';
    remove.title = 'Usuń';
    remove.addEventListener('click', () => {
      list.splice(idx, 1);
      render();
    });

    row.appendChild(up);
    row.appendChild(down);
    row.appendChild(remove);
  }

  // ---- Rendering: live formatted & syntax-highlighted preview -----------

  let outputFormat = 'json';

  function renderPreview() {
    try {
      const js = valueToJS(root);
      const { text, warnings } = stringifyAs(js, outputFormat);
      if (outputFormat === 'json') {
        preview.innerHTML = highlight(text);
      } else {
        preview.textContent = text;
      }
      const label = FORMAT_INFO[outputFormat].label;
      if (warnings.length) {
        setStatus(label + ' wygenerowany — ⚠️ ' + warnings.join(' '), 'warn');
      } else {
        setStatus(label + ' jest poprawny — gotowy do skopiowania lub pobrania.', 'ok');
      }
    } catch (err) {
      preview.textContent = '';
      setStatus('Nie można wygenerować ' + FORMAT_INFO[outputFormat].label + ': ' + err.message, 'error');
    }
  }

  function highlight(jsonText) {
    return jsonText.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        let cls = 'tok-number';
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? 'tok-key' : 'tok-string';
        } else if (/true|false/.test(match)) {
          cls = 'tok-bool';
        } else if (/null/.test(match)) {
          cls = 'tok-null';
        }
        return '<span class="' + cls + '">' + escapeHtml(match) + '</span>';
      }
    ).replace(/([{}\[\],])/g, '<span class="tok-punct">$1</span>');
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- Toolbar actions ---------------------------------------------------

  document.getElementById('btn-clear').addEventListener('click', () => {
    if (confirm('Wyczyścić cały dokument i zacząć od nowa?')) {
      root = { type: 'object', entries: [] };
      render();
    }
  });

  const formatSelect = document.getElementById('format-select');
  formatSelect.addEventListener('change', () => {
    outputFormat = formatSelect.value;
    renderPreview();
  });

  document.getElementById('btn-copy').addEventListener('click', async () => {
    try {
      const { text } = stringifyAs(valueToJS(root), outputFormat);
      await navigator.clipboard.writeText(text);
      setStatus('Skopiowano dane w formacie ' + FORMAT_INFO[outputFormat].label + ' do schowka.', 'ok');
    } catch (e) {
      setStatus('Nie udało się skopiować: ' + e.message, 'error');
    }
  });

  document.getElementById('btn-download').addEventListener('click', () => {
    try {
      const { text } = stringifyAs(valueToJS(root), outputFormat);
      const info = FORMAT_INFO[outputFormat];
      const blob = new Blob([text], { type: info.mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dane.' + info.ext;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('Plik dane.' + info.ext + ' został pobrany.', 'ok');
    } catch (e) {
      setStatus('Nie udało się przygotować pliku: ' + e.message, 'error');
    }
  });

  document.getElementById('file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const fmt = (ext === 'yaml' || ext === 'yml') ? 'yaml' : (ext === 'toml') ? 'toml' : (ext === 'json') ? 'json' : 'auto';
    const reader = new FileReader();
    reader.onload = () => loadRawText(reader.result, fmt);
    reader.readAsText(file);
    e.target.value = '';
  });

  // Paste / type modal
  const modal = document.getElementById('paste-modal');
  const rawInput = document.getElementById('raw-input');
  const inputFormatSelect = document.getElementById('input-format-select');
  const fixSuggestion = document.getElementById('fix-suggestion');
  const fixList = document.getElementById('fix-list');
  const fixApplyBtn = document.getElementById('fix-apply');
  let pendingFix = null;

  document.getElementById('btn-paste').addEventListener('click', () => {
    rawInput.value = '';
    hideFixSuggestion();
    modal.classList.add('show');
    rawInput.focus();
  });
  document.getElementById('paste-cancel').addEventListener('click', () => {
    modal.classList.remove('show');
    hideFixSuggestion();
  });
  document.getElementById('paste-load').addEventListener('click', () => {
    if (loadRawText(rawInput.value, inputFormatSelect.value)) modal.classList.remove('show');
  });
  fixApplyBtn.addEventListener('click', () => {
    if (pendingFix === null) return;
    rawInput.value = pendingFix;
    if (loadRawText(pendingFix, 'json')) modal.classList.remove('show');
  });

  function hideFixSuggestion() {
    fixSuggestion.classList.remove('show');
    fixList.innerHTML = '';
    pendingFix = null;
  }

  function offerJSONAutoFix(text) {
    const { fixed, fixes } = autoFixJSON(text);
    if (fixes.length === 0 || fixed === text) { hideFixSuggestion(); return; }
    try { JSON.parse(fixed); } catch (e) { hideFixSuggestion(); return; }
    pendingFix = fixed;
    fixList.innerHTML = '';
    fixes.forEach(f => {
      const li = document.createElement('li');
      li.textContent = f;
      fixList.appendChild(li);
    });
    fixSuggestion.classList.add('show');
  }

  // Loads raw text in the given format ('json' | 'yaml' | 'toml' | 'auto').
  // On success: builds the editor tree from it. On failure: shows a clear
  // notification and, for JSON, offers an automatic-repair suggestion.
  function loadRawText(text, requestedFormat) {
    const order = requestedFormat === 'auto' ? detectFormatOrder(text) : [requestedFormat];
    let lastError = null;
    for (const fmt of order) {
      try {
        const js = parseAs(text, fmt);
        root = jsToValue(js === undefined ? null : js);
        render();
        hideFixSuggestion();
        const fmtLabel = FORMAT_INFO[fmt].label;
        setStatus((requestedFormat === 'auto' ? 'Wykryto format ' + fmtLabel + '. ' : '') +
          'Wczytano dane — możesz teraz wygodnie edytować pola.', 'ok');
        return true;
      } catch (err) {
        lastError = { fmt, err };
      }
    }
    const primaryFmt = order[0];
    setStatus('Nie udało się wczytać jako ' + FORMAT_INFO[primaryFmt].label + ': ' + lastError.err.message +
      '. Sprawdź składnię albo wybierz inny format wejścia.', 'error');
    if (primaryFmt === 'json') {
      offerJSONAutoFix(text);
    } else {
      hideFixSuggestion();
    }
    return false;
  }

  // ---- Init ---------------------------------------------------------------
  root = {
    type: 'object',
    entries: [
      { key: 'imię', value: { type: 'string', value: 'Jan' } },
      { key: 'wiek', value: { type: 'number', value: 30 } },
      { key: 'aktywny', value: { type: 'boolean', value: true } },
      { key: 'tagi', value: { type: 'array', items: [
        { type: 'string', value: 'pierwszy' },
        { type: 'string', value: 'drugi' }
      ] } }
    ]
  };
  render();
})();
