import { InvalidArgumentError } from "commander";
import type { Priority } from "../../../shared/types";

const PRIORITY_INPUT: Record<string, Priority> = {
  u: 0,
  urgent: 0,
  "0": 0,
  h: 1,
  high: 1,
  "1": 1,
  n: 2,
  normal: 2,
  "2": 2,
  l: 3,
  low: 3,
  "3": 3,
};

export function parsePriority(input: string): Priority {
  const p = PRIORITY_INPUT[input.toLowerCase()];
  if (p === undefined) {
    throw new InvalidArgumentError("Priority must be u(rgent), h(igh), n(ormal), l(ow), or 0-3");
  }
  return p;
}

// commander repeatable-option collector. Default is `undefined` so callers can
// distinguish "user passed no --tag" from "user passed --tag ''" (which we
// reject anyway via tag-format validation).
export function collectString(value: string, prev: string[] | undefined): string[] {
  return prev ? [...prev, value] : [value];
}

export function collectPriority(value: string, prev: Priority[] | undefined): Priority[] {
  const p = parsePriority(value);
  return prev ? [...prev, p] : [p];
}
