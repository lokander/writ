// Validation and parsing for tag specs used by the CLI, MCP tools, and the
// YAML editor. A spec is either `NAME` or `NAME=COLOR`. Names follow a strict
// alnum/-/_ pattern so the inline syntax stays unambiguous; colors must be
// hex (`#rgb` or `#rrggbb`) or one of the canonical CSS named colors.

export class TagValidationError extends Error {
  override readonly name = "TagValidationError";
}

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

const CSS_NAMED_COLORS = new Set<string>([
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "transparent",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
]);

export function validateTagName(name: string): string {
  const trimmed = name.trim();
  if (!NAME_RE.test(trimmed)) {
    throw new TagValidationError(
      `Invalid tag name '${name}'. Must match /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/ — letters, digits, '-', '_'; no spaces, '=', or ':'.`,
    );
  }
  return trimmed;
}

export function normalizeColor(color: string): string {
  const trimmed = color.trim().toLowerCase();
  if (HEX_RE.test(trimmed)) return trimmed;
  if (CSS_NAMED_COLORS.has(trimmed)) return trimmed;
  throw new TagValidationError(
    `Invalid color '${color}'. Use a hex value (#rgb or #rrggbb) or a CSS named color (red, cornflowerblue, ...).`,
  );
}

export interface ParsedTagSpec {
  name: string;
  /** Undefined when the spec is name-only (leave existing color alone).
   *  A value (always normalized lowercase) means upsert/overwrite the color. */
  color?: string;
}

export function parseTagSpec(spec: string): ParsedTagSpec {
  const eq = spec.indexOf("=");
  if (eq < 0) return { name: validateTagName(spec) };
  const name = validateTagName(spec.slice(0, eq));
  const color = normalizeColor(spec.slice(eq + 1));
  return { name, color };
}
