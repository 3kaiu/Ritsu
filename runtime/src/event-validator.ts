/**
 * 事件校验器 — 使用 ajv + ctx-event-schema.json 校验事件写入
 */

import AjvModule from "ajv";
const Ajv = AjvModule.default ?? AjvModule;
import type { ValidateFunction } from "ajv";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED_DIR = resolve(__dirname, "../../../_shared");

let _validate: ValidateFunction<unknown> | null = null;
let _ajv: InstanceType<typeof AjvModule.default> | null = null;

export function getValidator(): {
  validate: ValidateFunction<unknown>;
  ajv: InstanceType<typeof AjvModule.default>;
} {
  if (_validate && _ajv) return { validate: _validate, ajv: _ajv };

  const schemaPath = resolve(SHARED_DIR, "ctx-event-schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

  _ajv = new Ajv({ allErrors: true });
  _validate = _ajv.compile(schema) as ValidateFunction<unknown>;
  return { validate: _validate, ajv: _ajv };
}

export function validateEvent(event: Record<string, unknown>): {
  valid: boolean;
  errors?: string[];
} {
  const { validate, ajv } = getValidator();
  const valid = validate(event) as boolean;
  if (!valid && validate.errors) {
    return {
      valid: false,
      errors: [ajv.errorsText(validate.errors)],
    };
  }
  return { valid: true };
}
