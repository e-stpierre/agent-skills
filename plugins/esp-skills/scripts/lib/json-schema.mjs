// Minimal JSON Schema validator (draft 2020-12 subset) with no dependencies.
//
// Supported keywords: type, enum, const, properties, required,
// additionalProperties, patternProperties, propertyNames, items, minItems,
// maxItems, uniqueItems, minimum, maximum, minLength, maxLength, pattern,
// format (date-time, date only), anyOf, oneOf, allOf, not, $ref (local
// "#/..." pointers only).
// Annotation keywords ($schema, $id, $comment, title, description, default,
// examples, deprecated) are ignored.

const TYPE_CHECKS = {
  null: (v) => v === null,
  boolean: (v) => typeof v === "boolean",
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  number: (v) => typeof v === "number" && Number.isFinite(v),
  integer: (v) => Number.isInteger(v),
  string: (v) => typeof v === "string"
};

const FORMAT_CHECKS = {
  "date-time": (v) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(
      v
    ) && !Number.isNaN(Date.parse(v)),
  date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
};

/** Format a JSON value for error messages. */
export function describeValue(value) {
  if (value === undefined) return "undefined";
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/** Return the JSON type name of a value. */
export function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

/** Join a path array into a dotted key path (`a.b[0].c`). */
export function formatPath(path) {
  if (path.length === 0) return "(root)";
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out === "" ? part : `.${part}`;
  }
  return out;
}

function resolveRef(root, ref) {
  if (!ref.startsWith("#")) {
    throw new Error(`Unsupported $ref (only local refs are allowed): ${ref}`);
  }
  const pointer = ref.slice(1);
  if (pointer === "") return root;
  let node = root;
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    node = node?.[key];
    if (node === undefined) throw new Error(`Unresolvable $ref: ${ref}`);
  }
  return node;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function validateNode(schema, value, path, root, errors) {
  if (schema === true) return;
  if (schema === false) {
    errors.push({ path, message: "is not allowed" });
    return;
  }

  if (schema.$ref) {
    validateNode(resolveRef(root, schema.$ref), value, path, root, errors);
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => TYPE_CHECKS[t]?.(value))) {
      errors.push({
        path,
        message: `expected ${types.join(" or ")}, got ${typeOf(value)} ${describeValue(value)}`
      });
      return;
    }
  }

  if (schema.enum && !schema.enum.some((e) => deepEqual(e, value))) {
    errors.push({
      path,
      message: `expected one of ${schema.enum.map(describeValue).join(", ")}, got ${describeValue(value)}`
    });
  }

  if (schema.const !== undefined && !deepEqual(schema.const, value)) {
    errors.push({
      path,
      message: `expected ${describeValue(schema.const)}, got ${describeValue(value)}`
    });
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({
        path,
        message: `expected at least ${schema.minLength} characters`
      });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({
        path,
        message: `expected at most ${schema.maxLength} characters`
      });
    }
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) {
      errors.push({
        path,
        message: `expected a string matching ${schema.pattern}, got ${describeValue(value)}`
      });
    }
    if (
      schema.format &&
      FORMAT_CHECKS[schema.format] &&
      !FORMAT_CHECKS[schema.format](value)
    ) {
      errors.push({
        path,
        message: `expected a ${schema.format} string, got ${describeValue(value)}`
      });
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({
        path,
        message: `expected a number >= ${schema.minimum}, got ${value}`
      });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({
        path,
        message: `expected a number <= ${schema.maximum}, got ${value}`
      });
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({
        path,
        message: `expected at least ${schema.minItems} items`
      });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push({
        path,
        message: `expected at most ${schema.maxItems} items`
      });
    }
    if (schema.uniqueItems) {
      const seen = new Set(value.map((v) => JSON.stringify(v)));
      if (seen.size !== value.length)
        errors.push({ path, message: "expected unique items" });
    }
    if (schema.items !== undefined) {
      value.forEach((item, i) => {
        validateNode(schema.items, item, [...path, i], root, errors);
      });
    }
  }

  if (TYPE_CHECKS.object(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) {
        errors.push({ path: [...path, key], message: "is required" });
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (schema.propertyNames) {
        validateNode(schema.propertyNames, key, [...path, key], root, errors);
      }
      let matched = false;
      if (schema.properties && key in schema.properties) {
        matched = true;
        validateNode(
          schema.properties[key],
          child,
          [...path, key],
          root,
          errors
        );
      }
      for (const [pattern, sub] of Object.entries(
        schema.patternProperties ?? {}
      )) {
        if (new RegExp(pattern, "u").test(key)) {
          matched = true;
          validateNode(sub, child, [...path, key], root, errors);
        }
      }
      if (!matched && schema.additionalProperties !== undefined) {
        if (schema.additionalProperties === false) {
          errors.push({ path: [...path, key], message: "is not a known key" });
        } else {
          validateNode(
            schema.additionalProperties,
            child,
            [...path, key],
            root,
            errors
          );
        }
      }
    }
  }

  if (schema.allOf) {
    for (const sub of schema.allOf)
      validateNode(sub, value, path, root, errors);
  }

  if (schema.anyOf || schema.oneOf) {
    const branches = schema.anyOf ?? schema.oneOf;
    const results = branches.map((sub) => {
      const branchErrors = [];
      validateNode(sub, value, path, root, branchErrors);
      return branchErrors;
    });
    const passing = results.filter((r) => r.length === 0).length;
    if (schema.anyOf && passing === 0) {
      // Report the branch with the fewest errors, it is the most likely intent.
      const best = results.reduce((a, b) => (b.length < a.length ? b : a));
      errors.push(...best);
    }
    if (schema.oneOf && passing !== 1) {
      if (passing === 0) {
        const best = results.reduce((a, b) => (b.length < a.length ? b : a));
        errors.push(...best);
      } else {
        errors.push({
          path,
          message: `matches ${passing} schemas, expected exactly one`
        });
      }
    }
  }

  if (schema.not) {
    const notErrors = [];
    validateNode(schema.not, value, path, root, notErrors);
    if (notErrors.length === 0)
      errors.push({ path, message: "matches a disallowed schema" });
  }
}

/**
 * Validate a value against a schema.
 * @returns {{ valid: boolean, errors: { path: string, message: string }[] }}
 */
export function validate(schema, value) {
  const errors = [];
  validateNode(schema, value, [], schema, errors);
  return {
    valid: errors.length === 0,
    errors: errors.map((e) => ({
      path: formatPath(e.path),
      message: e.message
    }))
  };
}
