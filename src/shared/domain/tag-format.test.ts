import { describe, expect, it } from "vitest";

import { normalizeColor, parseTagSpec, TagValidationError, validateTagName } from "./tag-format";

describe("validateTagName", () => {
  it("accepts alphanumeric, hyphen, and underscore", () => {
    expect(validateTagName("UI")).toBe("UI");
    expect(validateTagName("CLI")).toBe("CLI");
    expect(validateTagName("backend-core")).toBe("backend-core");
    expect(validateTagName("v1_0")).toBe("v1_0");
    expect(validateTagName("9_to_5")).toBe("9_to_5");
  });

  it("trims surrounding whitespace", () => {
    expect(validateTagName("  UI  ")).toBe("UI");
  });

  it("rejects names that start with - or _", () => {
    expect(() => validateTagName("-foo")).toThrow(TagValidationError);
    expect(() => validateTagName("_foo")).toThrow(TagValidationError);
  });

  it("rejects spaces, '=', and ':'", () => {
    expect(() => validateTagName("hello world")).toThrow(TagValidationError);
    expect(() => validateTagName("name=color")).toThrow(TagValidationError);
    expect(() => validateTagName("ns:tag")).toThrow(TagValidationError);
  });

  it("rejects empty string", () => {
    expect(() => validateTagName("")).toThrow(TagValidationError);
    expect(() => validateTagName("   ")).toThrow(TagValidationError);
  });
});

describe("normalizeColor", () => {
  it("accepts and lowercases 6-char hex", () => {
    expect(normalizeColor("#FF0000")).toBe("#ff0000");
    expect(normalizeColor("#abcdef")).toBe("#abcdef");
  });

  it("accepts 3-char hex", () => {
    expect(normalizeColor("#F00")).toBe("#f00");
  });

  it("accepts CSS named colors case-insensitively", () => {
    expect(normalizeColor("red")).toBe("red");
    expect(normalizeColor("RebeccaPurple")).toBe("rebeccapurple");
    expect(normalizeColor("CornflowerBlue")).toBe("cornflowerblue");
  });

  it("rejects unknown names", () => {
    expect(() => normalizeColor("blarg")).toThrow(TagValidationError);
  });

  it("rejects malformed hex", () => {
    expect(() => normalizeColor("#GGGGGG")).toThrow(TagValidationError);
    expect(() => normalizeColor("#1234")).toThrow(TagValidationError);
    expect(() => normalizeColor("ff0000")).toThrow(TagValidationError);
  });
});

describe("parseTagSpec", () => {
  it("returns name-only when no '=' is present", () => {
    expect(parseTagSpec("UI")).toEqual({ name: "UI" });
  });

  it("parses name=color and normalizes the color", () => {
    expect(parseTagSpec("UI=red")).toEqual({ name: "UI", color: "red" });
    expect(parseTagSpec("Core=#FF0000")).toEqual({ name: "Core", color: "#ff0000" });
  });

  it("rejects invalid name in spec", () => {
    expect(() => parseTagSpec("bad name=red")).toThrow(TagValidationError);
  });

  it("rejects invalid color in spec", () => {
    expect(() => parseTagSpec("UI=blarg")).toThrow(TagValidationError);
  });
});
