function isIdentifierStart(character) {
  return character !== undefined && /[A-Za-z_$]/u.test(character);
}

function isIdentifierPart(character) {
  return character !== undefined && /[A-Za-z0-9_$]/u.test(character);
}

function skipTrivia(source, start) {
  let index = start;
  while (index < source.length) {
    const character = source[index];
    if (character !== undefined && /\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (source.startsWith("//", index)) {
      const lineEnd = source.indexOf("\n", index + 2);
      return lineEnd === -1 ? source.length : skipTrivia(source, lineEnd + 1);
    }
    if (source.startsWith("/*", index)) {
      const commentEnd = source.indexOf("*/", index + 2);
      return commentEnd === -1
        ? source.length
        : skipTrivia(source, commentEnd + 2);
    }
    break;
  }
  return index;
}

function readQuoted(source, start) {
  const quote = source[start];
  let index = start + 1;
  let value = "";
  while (index < source.length) {
    const character = source[index];
    if (character === quote) return { end: index + 1, value };
    if (character === "\\") {
      const escaped = source[index + 1];
      if (escaped === undefined) return { end: source.length, value };
      value += `\\${escaped}`;
      index += 2;
      continue;
    }
    value += character;
    index += 1;
  }
  return { end: source.length, value };
}

function findTemplateExpressionEnd(source, start) {
  let depth = 1;
  let index = start;
  while (index < source.length) {
    const character = source[index];
    if (character === '"' || character === "'") {
      index = readQuoted(source, index).end;
      continue;
    }
    if (character === "`") {
      index = readTemplate(source, index).end;
      continue;
    }
    if (source.startsWith("//", index) || source.startsWith("/*", index)) {
      index = skipTrivia(source, index);
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
    index += 1;
  }
  return source.length;
}

function readTemplate(source, start) {
  const expressions = [];
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "`") return { end: index + 1, expressions };
    if (source.startsWith("${", index)) {
      const expressionStart = index + 2;
      const expressionEnd = findTemplateExpressionEnd(source, expressionStart);
      expressions.push(source.slice(expressionStart, expressionEnd));
      index = expressionEnd + 1;
      continue;
    }
    index += 1;
  }
  return { end: source.length, expressions };
}

export function inspectJavaScriptImports(source) {
  if (typeof source !== "string")
    throw new TypeError("JavaScript source is required.");
  const staticSpecifiers = [];
  let dynamicImportCount = 0;
  let index = 0;

  while (index < source.length) {
    const character = source[index];
    if (character === '"' || character === "'") {
      index = readQuoted(source, index).end;
      continue;
    }
    if (character === "`") {
      const template = readTemplate(source, index);
      for (const expression of template.expressions) {
        const nested = inspectJavaScriptImports(expression);
        staticSpecifiers.push(...nested.staticSpecifiers);
        dynamicImportCount += nested.dynamicImportCount;
      }
      index = template.end;
      continue;
    }
    if (source.startsWith("//", index) || source.startsWith("/*", index)) {
      index = skipTrivia(source, index);
      continue;
    }
    if (!isIdentifierStart(character)) {
      index += 1;
      continue;
    }

    const tokenStart = index;
    index += 1;
    while (isIdentifierPart(source[index])) index += 1;
    const token = source.slice(tokenStart, index);
    if (token !== "import" && token !== "from") continue;

    const next = skipTrivia(source, index);
    if (token === "import" && source[next] === "(") {
      dynamicImportCount += 1;
      index = next + 1;
      continue;
    }
    if (token === "import" && source[next] === ".") {
      index = next + 1;
      continue;
    }
    if (source[next] === '"' || source[next] === "'") {
      const specifier = readQuoted(source, next);
      staticSpecifiers.push(specifier.value);
      index = specifier.end;
    }
  }

  if (dynamicImportCount > 0) {
    throw new Error("dynamic import is forbidden in generated entry code");
  }
  for (const specifier of staticSpecifiers) {
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
      throw new Error(`non-local static import ${specifier}`);
    }
  }
  return { staticSpecifiers, dynamicImportCount };
}
