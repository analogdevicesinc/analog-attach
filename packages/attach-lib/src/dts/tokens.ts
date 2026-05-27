import { CoordinatesIn2D } from "./LexerInputStream";

export enum TokenKind {
  CommentLine = "CommentLine",
  CommentBlock = "CommentBlock",
  Directive = "Directive",
  String = "String",
  Number = "Number",
  PathReference = "PathReference",
  LabelReference = "LabelReference",
  Label = "Label",
  Identifier = "Identifier",
  Char = "Char",
}

export enum CharTokenKind {
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
  Equals = "=",
  Plus = "+",
  Minus = "-",
  Star = "*",
  Percent = "%",
  ExclusiveOr = "^",
  BitwiseNot = "~",
  LogicalNot = "!",
  Pipe = "|",
  QuestionMark = "?"
}
const _CHAR_TOKENS = new Set<string>(Object.values(CharTokenKind));
export function is_char_token(s: string): s is CharTokenKind {
  return _CHAR_TOKENS.has(s);
}

export enum DTDirective {
  DTSV1 = "/dts-v1/",
  Plugin = "/plugin/",
  MemReserve = "/memreserve/",
  DeleteProperty = "/delete-property/",
  DeleteNode = "/delete-node/",
  OmitIfNoReference = "/omit-if-no-ref/",
  Bits = "/bits/",
}
const _DT_DIRECTIVES = new Set<string>(Object.values(DTDirective));
export function is_dt_directive(s: string): s is DTDirective {
  return _DT_DIRECTIVES.has(s);
}

export type CommentLineToken = { kind: TokenKind.CommentLine; value: string }
export type CommentBlockToken = { kind: TokenKind.CommentBlock; value: string }
export type DirectiveToken = { kind: TokenKind.Directive; value: DTDirective }
export type StringToken = { kind: TokenKind.String; value: string }
export type NumberToken = { kind: TokenKind.Number; value: string }
export type PathReferenceToken = { kind: TokenKind.PathReference; value: string }
export type LabelReferenceToken = { kind: TokenKind.LabelReference; value: string }
export type LabelToken = { kind: TokenKind.Label; value: string }
export type IdentifierToken = { kind: TokenKind.Identifier; value: string }
export type CharToken = { kind: TokenKind.Char; value: CharTokenKind }

export type RawToken =
  | CommentLineToken
  | CommentBlockToken
  | DirectiveToken
  | StringToken
  | NumberToken
  | PathReferenceToken
  | LabelReferenceToken
  | LabelToken
  | IdentifierToken
  | CharToken

export type Token = RawToken & CoordinatesIn2D;
export function is_token_of_kind<K extends TokenKind>(
  t: Token,
  k: K
): t is Extract<Token, { kind: K }> {
  return t.kind === k;
}
