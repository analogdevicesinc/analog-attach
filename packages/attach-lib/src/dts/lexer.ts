/**
 * Minimal DTS lexer supporting comments, identifiers, numbers, strings,
 * byte-strings, angle-bracket arrays, labels, references, and punctuation.
 *
 * The lexer is intentionally small: it does not attempt to expand includes or
 * preprocess macros. Preprocessor line markers that start with `#` at the
 * beginning of a line are skipped as single lines for better ergonomics with
 * preprocessed inputs.
 */

/** Token kinds produced by the lexer. */
export enum TokKind {
  Ident = "Ident",
  Number = "Number",
  String = "String",
  Ampersand = "&",
  LBrace = "{",
  RBrace = "}",
  LAngle = "<",
  RAngle = ">",
  LBracket = "[",
  RBracket = "]",
  LParen = "(",
  RParen = ")",
  Colon = ":",
  Semicolon = ";",
  Comma = ",",
  Slash = "/",
  Bits = "BITS", // /bits/
  At = "@",
  Equals = "=",
  Plus = "+",
  Minus = "-",
  Star = "*",
  Percent = "%",
  ExclusiveOr = "^",
  BitwiseNot = "~",
  LogicalNot = "!",
  Pipe = "|",
  EOF = "EOF",
}

/** Single token with position for error reporting. */
export interface Token {
  kind: TokKind;
  /** Optional raw text (for numbers, idents, strings). */
  value?: string;
  line: number;
  col: number;
}

/** Simple single-pass tokenizer over a DTS source string. */
export class Lexer {
  private i = 0;
  private line = 1;
  private col = 1;
  private tokens: Token[] = [];

  constructor(private readonly source: string) { }

  /** Tokenize the entire source into a flat array of tokens. */
  public lex(): Token[] {
    while (!this.eof()) {
      this.skipWhitespaceAndComments();
      if (this.eof()) { break; }

      const ch = this.peek();
      const start = this.pos();
      // Symbols
      switch (ch) {
        case "+": {
          this.advance();
          this.tokens.push({ kind: TokKind.Plus, line: start.line, col: start.col });
          continue;
        }
        case "-": {
          this.advance();
          this.tokens.push({ kind: TokKind.Minus, line: start.line, col: start.col });
          continue;
        }
        case "*": {
          this.advance();
          this.tokens.push({ kind: TokKind.Star, line: start.line, col: start.col });
          continue;
        }
        case "|": {
          this.advance();
          this.tokens.push({ kind: TokKind.Pipe, line: start.line, col: start.col });
          continue;
        }
        case "{": {
          this.advance();
          this.tokens.push({ kind: TokKind.LBrace, line: start.line, col: start.col });
          continue;
        }
        case "}": {
          this.advance();
          this.tokens.push({ kind: TokKind.RBrace, line: start.line, col: start.col });
          continue;
        }
        case "<": {
          this.advance();
          this.tokens.push({ kind: TokKind.LAngle, line: start.line, col: start.col });
          continue;
        }
        case ">": {
          this.advance();
          this.tokens.push({ kind: TokKind.RAngle, line: start.line, col: start.col });
          continue;
        }
        // TODO: if we are in bytestring we can only have hexadecimals in pairs of two, each representing a byte 
        // => everywhere else a hex numbers must be denoted by `0x`
        case "[": {
          this.advance();
          this.tokens.push({ kind: TokKind.LBracket, line: start.line, col: start.col });
          continue;
        }
        case "]": {
          this.advance();
          this.tokens.push({ kind: TokKind.RBracket, line: start.line, col: start.col });
          continue;
        }
        case "(": {
          this.advance();
          this.tokens.push({ kind: TokKind.LParen, line: start.line, col: start.col });
          continue;
        }
        case ")": {
          this.advance();
          this.tokens.push({ kind: TokKind.RParen, line: start.line, col: start.col });
          continue;
        }
        case ":": {
          this.advance();
          this.tokens.push({ kind: TokKind.Colon, line: start.line, col: start.col });
          continue;
        }
        case ";": {
          this.advance();
          this.tokens.push({ kind: TokKind.Semicolon, line: start.line, col: start.col });
          continue;
        }
        case ",": {
          this.advance();
          this.tokens.push({ kind: TokKind.Comma, line: start.line, col: start.col });
          continue;
        }
        case "@": {
          this.advance();
          this.tokens.push({ kind: TokKind.At, line: start.line, col: start.col });
          continue;
        }
        case "=": {
          this.advance();
          this.tokens.push({ kind: TokKind.Equals, line: start.line, col: start.col });
          continue;
        }
        case "&": {
          this.advance();
          this.tokens.push({ kind: TokKind.Ampersand, line: start.line, col: start.col });
          continue;
        }
        case "/": {
          if (this.matchWord("/bits/")) {
            this.tokens.push({ kind: TokKind.Bits, value: "/bits/", line: start.line, col: start.col });
            continue;
          }
          // otherwise treat as slash token for directives like /dts-v1/; and /memreserve/
          this.advance();
          this.tokens.push({ kind: TokKind.Slash, line: start.line, col: start.col });
          continue;
        }
        case '"': {
          this.tokens.push(this.readString());
          continue;
        }
      }

      // Number
      if (this.isDigit(ch) || (ch === '0' && (this.peek(1) === 'x' || this.peek(1) === 'X'))) {
        this.tokens.push(this.readNumber());
        continue;
      }

      // Identifier
      if (this.isIdentStart(ch)) {
        // TODO: maybe some refactoring in the reading
        this.tokens.push(this.readIdent());
        continue;
      }

      // Unknown character; skip to avoid infinite loop TODO: do we really skip or should we break?
      throw new Error(`Bad character ${ch}`);
    }
    this.tokens.push({ kind: TokKind.EOF, line: this.line, col: this.col });
    return this.tokens;
  }

  /** Read a double-quoted string, handling common escapes. */
  private readString(): Token {
    const start = this.pos();
    this.advance(); // opening quote
    let out = "";
    while (!this.eof()) {
      const ch = this.peek();
      if (ch === '"') { this.advance(); break; }
      // TODO: AFAIK no escaping to be done in strings
      if (ch === "\\") {
        this.advance();
        const nxt = this.peek();
        switch (nxt) {
          case "n": { out += "\n"; this.advance(); break; }
          case "r": { out += "\r"; this.advance(); break; }
          case "t": { out += "\t"; this.advance(); break; }
          case '"': { out += '"'; this.advance(); break; }
          case "\\": { out += "\\"; this.advance(); break; }
          default: { out += nxt ?? ""; this.advance(); }
        }
      } else {
        out += ch;
        this.advance();
      }
    }
    return { kind: TokKind.String, value: out, line: start.line, col: start.col };
  }

  /**
   * Read a character literal like `'a'` and emit as a numeric token with the
   * code point value encoded in hexadecimal (e.g., 0x61 for 'a').
   *
   * Notes:
   * - This unifies downstream handling so that arrays and other numeric
   *   contexts can treat character literals as numbers.
   * - For byte strings (`[...]`), the parser enforces two-hex-digit bytes; it
   *   will strip the `0x` prefix and validate the remaining hex nibbles.
   */
  private readCharLiteral(): Token {
    const start = this.pos();
    this.advance(); // '
    let ch = this.peek();
    let value: number;
    if (ch === "\\") {
      this.advance();
      const nxtRaw = this.peek();
      const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", "\\": "\\", '"': '"', "'": "'" };
      const nxt = nxtRaw ?? '';
      const s = map[nxt] ?? nxt;
      value = s.codePointAt(0) ?? 0;
      this.advance();
    } else {
      if (ch === undefined) { ch = "\0"; }
      value = ch.codePointAt(0) ?? 0;
      this.advance();
    }
    if (this.peek() === "'") { this.advance(); }
    // Emit as hexadecimal numeric token so downstream byte-string parsing
    // that treats numbers as hex pairs yields the expected ASCII code value
    // (e.g., 'a' -> 0x61).
    const text = `0x${value.toString(16)}`;
    return { kind: TokKind.Number, value: text, line: start.line, col: start.col };
  }

  /** Read a decimal or hexadecimal integer token. */
  private readNumber(): Token {
    const start = this.pos();
    let s = "";
    if (this.peek() === '0' && (this.peek(1) === 'x' || this.peek(1) === 'X')) {
      s += "0" + this.peek(1);
      this.advance(); this.advance();
      while (this.isHex(this.peek())) { s += this.peek(); this.advance(); }
      return { kind: TokKind.Number, value: s, line: start.line, col: start.col };
    }
    while (this.isDigit(this.peek())) { s += this.peek(); this.advance(); }
    return { kind: TokKind.Number, value: s, line: start.line, col: start.col };
  }

  /** Read an identifier using dtc-friendly character set. */
  private readIdent(): Token {
    const start = this.pos();
    let s = "";
    while (this.isIdentPart(this.peek())) { s += this.peek(); this.advance(); }
    return { kind: TokKind.Ident, value: s, line: start.line, col: start.col };
  }

  /** Skip whitespace, comments, and preprocessor line markers. */
  private skipWhitespaceAndComments() {
    while (!this.eof()) {
      const ch = this.peek();
      // whitespace
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\f') { this.advance(); continue; }
      // Preprocessor line markers (e.g., '# 1 "file"') — only if '#' is at true line start
      if (ch === '#' && (this.i === 0 || this.source[this.i - 1] === '\n')) {
        while (!this.eof() && this.peek() !== '\n') { this.advance(); }
        continue;
      }
      // C++ comment
      if (ch === '/' && this.peek(1) === '/') {
        this.advance(); this.advance();
        while (!this.eof() && this.peek() !== '\n') { this.advance(); }
        continue;
      }
      // C comment
      if (ch === '/' && this.peek(1) === '*') {
        this.advance(); this.advance();
        while (!this.eof()) {
          if (this.peek() === '*' && this.peek(1) === '/') { this.advance(); this.advance(); break; }
          this.advance();
        }
        continue;
      }
      break;
    }
  }

  /** Try to consume the exact string `w` from the current position. */
  private matchWord(w: string): boolean {
    for (const [index, ch2] of [...w].entries()) {
      if (this.peek(index) !== ch2) { return false; }
    }
    for (let index = 0; index < w.length; index++) { this.advance(); }
    return true;
  }

  private isDigit(ch?: string): ch is string { return !!ch && ch >= '0' && ch <= '9'; }
  private isHex(ch?: string): ch is string {
    return !!ch && ((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F'));
  }
  /**
   * dtc-friendly identifier characters: letters, digits and `.,_+-?#*`.
   * We accept digits at start to accommodate common device tree idents.
   * TODO: research if the extra characters are really valid
   */
  private isIdentStart(ch?: string): ch is string {
    if (!ch) { return false; }
    const code = ch.codePointAt(0) ?? 0;
    // Allow dtc-friendly set: A-Za-z0-9,._+\-?#*
    return (
      (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || // letters
      (code >= 48 && code <= 57) || // digits
      ",._+-?#*".includes(ch)
    );
  }
  private isIdentPart(ch?: string): ch is string { return this.isIdentStart(ch); }

  private peek(ahead = 0): string | undefined { return this.source[this.i + ahead]; }
  private advance() { const ch = this.source[this.i++]; if (ch === '\n') { this.line++; this.col = 1; } else { this.col++; } }
  private eof(): boolean { return this.i >= this.source.length; }
  private pos() { return { line: this.line, col: this.col }; }
}
