import { Option } from "../../option.js";
import { Token } from "./tokens.js";

export class TokenStream {
  private pos = 0;

  constructor(private readonly tokens: Token[]) { }

  public get current(): Token {
    if (this.pos >= this.tokens.length) {
      throw new Error("Out of bound index");
    }
    return this.tokens[this.pos];
  }

  public get_current_then_advance(): Token {
    if (this.pos >= this.tokens.length) {
      throw new Error("Out of bound index");
    }
    return this.tokens[this.pos++];
  }

  public get done(): boolean {
    return this.pos >= this.tokens.length;
  }

  public advance() {
    if (this.done) {
      return;
    }

    ++this.pos;
  }

  public lookahead(offset: number = 0): Option<Token> {
    if (offset < 0) {
      throw new Error(`Cannot pass negative number as offset: ${offset}`);
    }

    const current = this.tokens.at(this.pos + offset);
    return current === undefined ? Option.None() : Option.Some(current);
  }
}
