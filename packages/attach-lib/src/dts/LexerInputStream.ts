import { Option } from "../option";

const WHITE_SPACE_CODES = new Set([
  9,  // tab
  10, // \n
  13, // \r
  32  // space
]);

export type WithRowAndCol = {
  row: number;
  col: number;
}

export class LexerInputStream {
  private coords: WithRowAndCol = { row: 1, col: 1 };
  private pos = 0;

  private readonly content: string;

  constructor(content: string) {
    // Remove the lines starting with # and (at least) a space after it
    // Purpose: in case of preprocessed dts or dtso files
    this.content = content.replaceAll(/^#\s+.*(\r?\n)?/gm, "\n");
  }

  get current(): string {
    return String.fromCodePoint(this.current_code);
  }

  get current_code(): number {
    const code = this.content.codePointAt(this.pos);
    if (code === undefined) {
      throw new Error("Out of bound index");
    }
    return code;
  }

  public get current_coordinates(): WithRowAndCol {
    return this.coords;
  }

  public get done(): boolean {
    return this.pos >= this.content.length;
  }

  private advance() {
    if (this.done) {
      return;
    }

    if (this.current_code === 10) {
      ++this.coords.row;
      this.coords.col = 1;
    } else {
      ++this.coords.col;
    }

    ++this.pos;
  }

  public skip_whitespaces() {
    while (!this.done && WHITE_SPACE_CODES.has(this.current_code)) {
      this.advance();
    }
  }

  public try_consume(regex: RegExp): Option<string> {
    if (!regex.flags.includes("y")) {
      throw new Error("The regex must have the \'y\' flag set for performance");
    }

    regex.lastIndex = this.pos;
    const match = this.content.match(regex);

    if (match === null) {
      return Option.None();
    }

    const text = match[0];

    // We must loop over the actual characters of the matched text,
    // not its UTF-16 .length, to advance the pointer by the correct amount.
    for (const _ of text) {
      this.advance();
    }

    return Option.Some(text);
  }
}