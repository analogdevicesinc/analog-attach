import { WithRowAndCol, LexerInputStream } from "./LexerInputStream";
import { Option } from "../option";
import { Result } from "../result";
import { assert_never } from "../utilities";
import { TokenStream } from "./TokenStream";
import { TokenKind, RawToken, Token } from "./tokens";
import { is_dt_directive, is_char_token } from "./tokens";

const TOKEN_KIND_AND_REGEX_PAIRS = [
  // 1. Comments (Highest priority - they must consume slashes before anything else)
  [TokenKind.CommentLine, /\/\/.*/y],
  [TokenKind.CommentBlock, /\/\*[\s\S]*?\*\//y],

  // 2. Directives (e.g., /dts-v1/) - Must come before SingleChar '/'
  [TokenKind.Directive, /\/[a-z0-9-]+\//y],

  // 3. Literals
  [TokenKind.String, /"([^"\\]|\\.)*"/y],
  [TokenKind.Number, /\b(0[xX][0-9a-fA-F]+|[0-9]+\b)/y],

  // 4. References (Must come before SingleChar '&')
  [TokenKind.PathReference, /&\{[^\}]+\}/y],
  [TokenKind.LabelReference, /&[a-zA-Z_][a-zA-Z0-9_]*/y],

  // 5. Labels (Must come before Identifiers)
  [TokenKind.Label, /[a-zA-Z_][a-zA-Z0-9_]*:/y],

  // 6. Identifiers (The most "greedy" text match)
  [TokenKind.Identifier, /[_#a-zA-Z0-9][a-zA-Z0-9_#,\-\.@]*/y],

  // 7. Single Characters (Lowest priority - the safety net for symbols)
  [TokenKind.Char, /([?&{}<>[\]():;,/@=+\-*%^~!|])/y],
] as const;

export type LexerResult = {
  tokens: TokenStream;
  comments: TokenStream;
}

export enum LexerErrorCode {
  UnknownChar = "UnknownChar",
  UnknownDirective = "UnknownDirective",
}

export type LexerError = WithRowAndCol & {
  code: LexerErrorCode;
  message: string;
}

export class Lexer {
  private tokens: Token[] = [];
  private comments: Token[] = [];
  private input_stream: LexerInputStream;

  constructor(content: string) {
    this.input_stream = new LexerInputStream(content);
  }

  public lex(): Result<LexerResult, LexerError> {
    while (!this.input_stream.done) {
      this.input_stream.skip_whitespaces();
      if (this.input_stream.done) {
        break;
      }

      const coordinates = this.input_stream.current_coordinates;
      const match_result = this.try_match();
      if (Result.isError(match_result)) {
        return match_result;
      }

      const { value: token } = match_result;
      this.emit(token, coordinates);
    }

    return Result.ok({
      tokens: new TokenStream(this.tokens),
      comments: new TokenStream(this.comments)
    });
  }

  private try_match(): Result<RawToken, LexerError> {
    const current_coordinates = this.input_stream.current_coordinates;
    for (const [kind, regex] of TOKEN_KIND_AND_REGEX_PAIRS) {
      const match = this.input_stream.try_consume(regex);
      if (Option.is_none(match)) {
        continue;
      }

      const { value } = match;

      switch (kind) {
        case TokenKind.CommentLine: {
          return Result.ok({ kind, value: value.slice(2).trim() });
        }
        case TokenKind.CommentBlock: {
          return Result.ok({ kind, value: value.slice(2, -2).trim() });
        }
        case TokenKind.Directive: {
          return is_dt_directive(value)
            ? Result.ok({ kind, value })
            : Result.error({
              code: LexerErrorCode.UnknownDirective,
              message: "Unknown directive met while lexing",
              ...current_coordinates
            });
        }
        case TokenKind.String: {
          return Result.ok({ kind, value: value.slice(1, -1) });
        }
        case TokenKind.Number: {
          return Result.ok({ kind, value });
        }
        case TokenKind.PathReference: {
          return Result.ok({ kind, value: value.slice(2, -1) });
        }
        case TokenKind.LabelReference: {
          return Result.ok({ kind, value: value.slice(1) });
        }
        case TokenKind.Label: {
          return Result.ok({ kind, value: value.slice(0, -1) });
        }
        case TokenKind.Identifier: {
          return Result.ok({ kind, value });
        }
        case TokenKind.Char: {
          if (!is_char_token(value)) {
            throw new Error("It should be impossible to get here");
          }
          return Result.ok({ kind, value });
        }
        default: {
          assert_never(kind);
        }
      }
    }

    return Result.error({
      code: LexerErrorCode.UnknownChar,
      message: `Unknown char met while lexing`,
      ...current_coordinates
    });
  }

  private emit(raw_token: RawToken, coordinates: WithRowAndCol) {
    const token: Token = { ...raw_token, ...coordinates };
    if (token.kind === TokenKind.CommentBlock || token.kind === TokenKind.CommentLine) {
      this.comments.push(token);
    } else {
      this.tokens.push(token);
    }
  }
}
