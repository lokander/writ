export interface Tag {
  id: string;
  name: string;
  /** Hex (`#rgb` or `#rrggbb`) or one of the 147 CSS named colors, lowercased.
   *  NULL means "no explicit color" — UI should derive one from the name. */
  color: string | null;
}
