/**
 * 事件校验器 — 使用 ajv + ctx-event-schema.json 校验事件写入
 */

import Ajv2020Module from "ajv/dist/2020.js";
const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
import type { ValidateFunction } from "ajv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSharedDir } from "../shared.js";

let _validate: ValidateFunction<unknown> | null = null;
let _ajv: InstanceType<typeof Ajv2020> | null = null;

export function getValidator(): {
  validate: ValidateFunction<unknown>;
  ajv: InstanceType<typeof Ajv2020>;
} {
  if (_validate && _ajv) return { validate: _validate, ajv: _ajv };

  const schemaPath = resolve(getSharedDir(), "ctx-event-schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));

  _ajv = new Ajv2020({ allErrors: true, strict: false });
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
