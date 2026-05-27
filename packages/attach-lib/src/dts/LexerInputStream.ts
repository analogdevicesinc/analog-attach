import { Option } from "../option";
import { is_white_space } from "../utilities";

export type CoordinatesIn2D = {
  row: number;
  col: number;
}

export class LexerInputStream {
  private row = 1;
  private col = 1;
  private pos = 0;

  private readonly content: string;

  constructor(content: string) {
	this.content = content.replaceAll(/^#\s+.*(\r?\n)?/gm, "\n");
  }

  public get current(): string {
    if (this.pos >= this.content.length) {
      throw new Error("Out of bound index");
    }
    return this.content[this.pos];
  }

  public get current_code(): number {
    const code = this.content.codePointAt(this.pos);
	if (code === undefined) {
		throw new Error("Out of bound index");
	}
	return code;
  }

  public get current_coordinates(): CoordinatesIn2D {
    return { row: this.row, col: this.col };
  }

  public get done(): boolean {
    return this.pos >= this.content.length;
  }

  private advance() {
    if (this.done) {
      return;
    }

    if (this.current_code === 10) {
      ++this.row;
      this.col = 1;
    } else {
      ++this.col;
    }

    ++this.pos;
  }

  public skip_whitespaces() {
    while (!this.done && is_white_space(this.current_code)) {
      this.advance();
    }
  }

  public try_consume(regex: RegExp): Option<string> {
    if (!regex.flags.includes("y")) {
      throw new Error("The regex must have the \'y\' flag set for performance");
    }

    regex.lastIndex = this.pos;
    const match = regex.exec(this.content);

    if (match === null) {
      return Option.none();
    }

    const text = match[0];
    for (let _ = 0; _ < text.length; ++_) {
      this.advance();
    }

    return Option.some(text.toString());
  }
}

