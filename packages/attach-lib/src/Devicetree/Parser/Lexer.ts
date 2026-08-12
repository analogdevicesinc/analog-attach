import { WithRowAndCol, LexerInputStream } from "./LexerInputStream.js";
import { Option } from "../../option.js";
import { Result } from "../../result.js";
import { assert_never } from "../../utilities.js";
import { TokenStream } from "./TokenStream.js";
import { TokenKind, RawToken, Token, is_dt_directive, is_char_token } from "./Tokens.js";

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

export function lex(content: string): Result<LexerResult, LexerError> {
  const input_stream = new LexerInputStream(content);
  const tokens: Token[] = [];
  const comments: Token[] = [];

  while (!input_stream.done) {
    input_stream.skip_whitespaces();
    if (input_stream.done) {
      break;
    }

    const coordinates = input_stream.current_coordinates;

    const raw_token: Result<RawToken, LexerError> = (() => {

      for (const [kind, regex] of TOKEN_KIND_AND_REGEX_PAIRS) {
        const match = input_stream.try_consume(regex);

        if (Option.is_none(match)) {
          continue;
        }

        const value = match.value;

        switch (kind) {
          case TokenKind.CommentLine: {
            return Result.Ok({ kind, value: value.slice(2).trim() });
          }
          case TokenKind.CommentBlock: {
            return Result.Ok({ kind, value: value.slice(2, -2).trim() });
          }
          case TokenKind.Directive: {
            if (!is_dt_directive(value)) {
              return Result.Err({
                code: LexerErrorCode.UnknownDirective,
                message: "Unknown directive met while lexing",
                ...coordinates
              });
            }
            return Result.Ok({ kind, value });
          }
          case TokenKind.String: {
            return Result.Ok({ kind, value: value.slice(1, -1) });
          }
          case TokenKind.Number: {
            return Result.Ok({ kind, value });
          }
          case TokenKind.PathReference: {
            return Result.Ok({ kind, value: value.slice(2, -1) });
          }
          case TokenKind.LabelReference: {
            return Result.Ok({ kind, value: value.slice(1) });
          }
          case TokenKind.Label: {
            return Result.Ok({ kind, value: value.slice(0, -1) });
          }
          case TokenKind.Identifier: {
            return Result.Ok({ kind, value });
          }
          case TokenKind.Char: {
            if (!is_char_token(value)) {
              return Result.Err({
                code: LexerErrorCode.UnknownChar,
                message: `Unknown char '${value}' met while lexing`,
                ...coordinates
              });
            }

            return Result.Ok({ kind, value });
          }
          default: {
            assert_never(kind);
          }
        }
      }

      return Result.Err({
        code: LexerErrorCode.UnknownChar,
        message: `Unknown Char!`,
        ...coordinates
      });

    })();

    if (Result.is_err(raw_token)) {
      return raw_token;
    }

    // TODO: ugly to use slicing to create objects
    const token: Token = { ...raw_token.value, ...coordinates };

    if (token.kind === TokenKind.CommentBlock || token.kind === TokenKind.CommentLine) {
      comments.push(token);
    } else {
      tokens.push(token);
    }
  }

  return Result.Ok({
    tokens: new TokenStream(tokens),
    comments: new TokenStream(comments)
  });
}
