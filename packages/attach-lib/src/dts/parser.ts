import { Lexer, TokKind, Token } from "./lexer.js";
import {
  merge_document,
  merge_node,
  find_node_by_label,
  find_node_by_path,
  delete_node_by_label,
  delete_node_by_key
} from "./merge.js";
import {
  type CellArrayElement,
  type CellArrayNumber,
  type CellArrayU64,
  type Bits,
  type DtsCellArray,
  type DtsByteArray,
  type DtsDocument,
  type DtsNode,
  type DtsProperty,
  type DtsReference,
  type DtsValue,
  type DtsValueComponent,
  type Memreserve,
  type UnresolvedOverlay,
  type DtsMetadata,
  isDtsMetadata,
} from "./ast";

import { get_node_key } from './utilities.js';

import { parse as parse_yaml_string } from "yaml";
import { DtsMetadataHeader } from "./constants.js";

/** 
* Parser error enriched with line/column from the triggering token. 
*/
class ParseError extends Error {
  constructor(message: string, readonly tok?: Token) {
    super(tok ? `${message} at ${tok.line}:${tok.col}` : message);
  }
}

/**
 * Parse a DTS source string into a DtsDocument.
 *
 * Notes:
 * - The parser accepts a broad subset of DTS used in Linux/Zephyr.
 * - Includes/macros should be expanded externally 
 */
export function parse_dts(text: string, is_dtso: boolean = false): DtsDocument {
  const lx = new Lexer(text);
  const tokens = lx.lex();
  const p = new Parser(tokens);

  return p.parse_document(is_dtso);
}

/** 
* Parse a DTS string and return both the document and a label-to-path map 
*/
export function parse_dts_and_label_map(
  text: string,
  is_dtso: boolean,
): {
  document: DtsDocument,
  label_map: Map<string, string>
} {
  const lx = new Lexer(text);
  const tokens = lx.lex();
  const p = new Parser(tokens);
  const document = p.parse_document(is_dtso);
  const label_map = p.get_label_map();

  return {
    document: document,
    label_map: label_map
  };
}

/**
 * Concrete syntax parser from token stream to AST with overlay semantics and
 * directive application.
 */
class Parser {
  // Current token index
  private i = 0;
  // Map of labels to their absolute paths
  private label_to_path = new Map<string, string>();
  private comments = new Array<Token>();

  constructor(private readonly tokens: Token[]) { }

  /** 
  * Get the label-to-path map collected during parsing 
  */
  public get_label_map(): Map<string, string> {
    return structuredClone(this.label_to_path);
  }

  /** 
  * Track a node's labels and path 
  */
  private track_nodes_labels(node: DtsNode, path: string) {
    if (node.labels) {
      for (const label of node.labels) {
        this.label_to_path.set(label, path);
      }
    }
  }

  /** 
  * Build label map for the entire document tree 
  */
  private build_label_map(root: DtsNode, path: string = '') {
    const nodePath = root.name === '/' ? '/' : `${path}${path.endsWith('/') ? '' : '/'}${get_node_key(root)}`;
    this.track_nodes_labels(root, nodePath);

    for (const child of root.children) {
      this.build_label_map(child, nodePath);
    }
  }

  private get tok(): Token {
    return this.tokens[this.i];
  }

  private advance(): Token {
    const previous = this.tok;
    while([TokKind.CommentBlock, TokKind.CommentLine].includes(this.tokens[++this.i].kind)) {
      this.comments.push(this.tok);
    }
    return previous;
  }

  private lookahead(offset: number): Token {
    if (offset <= 0) {
      throw new ParseError("offset must be > 0");
    }

    let count = 0;
    for (let index = this.i + 1; index < this.tokens.length; ++index) {
      const token = this.tokens[index];
      
      if (token.kind === TokKind.CommentLine || token.kind === TokKind.CommentBlock) {
        continue;
      }

      count++;

      if (count === offset || token.kind === TokKind.EOF) {
        return token;
      }
    }

    return this.tokens.at(-1)!;
  }

  private consume(kind: TokKind): boolean {
    if (this.tok.kind === kind) {
      this.advance();
      return true;
    }

    return false;
  }

  private expect(kind: TokKind, message?: string): Token {
    if (this.tok.kind !== kind) {
      throw new ParseError(message ?? `Expected ${kind}, got ${this.tok.kind}`, this.tok);
    }

    return this.advance();
  }

  /** 
  * Parse the entire token stream into a DtsDocument.
  */
  parse_document(is_dtso: boolean): DtsDocument {
    const memreserves: Array<Memreserve> = [];
    // TODO: this is for overlays => think about splitting dts and dtso
    const unresolved_overlays: Array<UnresolvedOverlay> = [];

    if (this.tok.kind === TokKind.CommentLine
        || this.tok.kind === TokKind.CommentBlock
    ) {
      this.advance();
    }

    const version_tag = this.consume_slash_word();

    if (version_tag === "/dts-v1/") {
      this.expect(TokKind.Semicolon, "Missing ';' after /dts-v1/");
    } else {
      throw new ParseError('Missing version specifier (e.g. "/dts-v1/;")');
    }

    // Zero or more /memreserve/ <addr> <len>;
    while (this.tok.kind === TokKind.Slash && this.lookahead(1)?.kind === TokKind.Ident) {
      const word = this.consume_slash_word();

      if (word === '/dts-v1/') {
        // Preprocessing may double the version tag so we just consume it 
        this.expect(TokKind.Semicolon), "Missing ';' after /dts-v1/";
        continue;
      }

      if (word === '/include/') {
        throw new ParseError("Can't resolve /include/ directives", this.tok);
      }

      if (word === '/plugin/') {
        // TODO: we are in an overlay
        this.expect(TokKind.Semicolon, "Expected ';' after /plugin/ tag");
        continue;
      }

      if (word !== "/memreserve/") {
        throw new ParseError(`Expected /memreserves/ after version specifier but got ${word}`, this.tok);
      }

      const address_tok = this.expect(TokKind.Number, "Expected address number in /memreserve/");
      const length_tok = this.expect(TokKind.Number, "Expected length number in /memreserve/");

      memreserves.push(
        {
          address: BigInt(address_tok.value!),
          length: BigInt(length_tok.value!)
        }
      );

      this.expect(TokKind.Semicolon, "Missing ';' after /memreserve/");
    }

    // TODO: could be technically determined already if we have /plugin/ or not
    // At least one root or overlay fragment
    let base_document: DtsDocument;
    if (this.tok.kind === TokKind.Slash && this.lookahead(1)?.kind === TokKind.LBrace) {
      // Traditional root node starting with '/'
      const root = this.parse_node();
      base_document = { memreserves: memreserves, root: root, unresolved_overlays: [], metadata: undefined };
    } else {
      // Document starts with overlay fragments - create empty root
      let root: DtsNode = {
        _uuid: crypto.randomUUID(),
        labels: [],
        name: "/",
        properties: [],
        children: [],
        deleted: false
      };

      base_document = { memreserves: memreserves, root: root, unresolved_overlays: [], metadata: undefined };
    }

    // Additional roots and/or directives
    while (this.tok.kind !== TokKind.EOF) {
      // Additional root blocks
      if (this.tok.kind === TokKind.Slash && this.lookahead(1)?.kind === TokKind.LBrace) {
        const next_root = this.parse_node(base_document.root);
        const incoming: DtsDocument = {
          memreserves: [],
          root: next_root,
          unresolved_overlays: [],
          metadata: undefined
        };

        merge_document(base_document, incoming);
        continue;
      }

      // Top-level overlay: optional label then &ref { ... }
      const labels: string[] = this.consume_present_labels();

      if (this.tok.kind === TokKind.Ampersand) {
        const target_reference = this.parse_reference();
        let target = this.resolve_reference(base_document.root, target_reference);

        if (target === undefined && target_reference.ref.kind === 'path') {
          target = ensure_node_by_path(base_document.root, target_reference.ref.path, { mark_modified: is_dtso });
        }

        this.expect(TokKind.LBrace, "Expected '{' to start overlay body");

        // TODO: consider not using __overlay__ as it could conflict with Overlay specs
        const overlay_node: DtsNode = {
          _uuid: crypto.randomUUID(),
          labels: labels,
          name: "__overlay__",
          properties: [],
          children: [],
          deleted: false
        };

        this.parse_node_body(overlay_node, base_document.root, target);

        if (target === undefined) {

          unresolved_overlays.push(
            {
              overlay_target_ref: target_reference,
              overlay_node: overlay_node,
            }
          );
        } else {

          merge_node(target, overlay_node, { mark_created_nodes: is_dtso });
        }
        continue;
      }

      // Top-level directives 
      if (this.tok.kind === TokKind.Slash && this.lookahead(1)?.kind === TokKind.Ident) {
        this.parse_and_apply_directive(base_document.root);
        continue;
      }

      throw new ParseError("Unexpected token", this.tok);
    }

    // Build label map for the entire document
    this.build_label_map(base_document.root);

    base_document.unresolved_overlays = unresolved_overlays;

    prune_soft_delete(base_document);

    base_document.metadata = this.parse_dts_metadata();

    return base_document;
  }

  /** 
  * Resolve a reference (label or absolute path) to a node in the current tree.
  */
  private resolve_reference(root: DtsNode, reference: DtsReference): DtsNode | undefined {
    if (reference.ref.kind === "label") {
      return find_node_by_label(root, reference.ref.name);
    }

    return find_node_by_path(root, reference.ref.path);
  }


  /** 
  * Parse a directive: e.g. returns `/dts-v1/` or `/delete-property/`. 
  */
  private consume_slash_word(): string {
    // Expect forms like /dts-v1/ or /memreserve/
    this.expect(TokKind.Slash);
    const ident = this.expect(TokKind.Ident, "Expected directive name after '/'").value!;
    this.expect(TokKind.Slash, "Expected trailing '/' after directive name");

    return `/${ident}/`;
  }

  /**
   * Entrypoint for parsing and merging the 3 distinct cases of nodes =>
   *  1. parsing the first root (special case) => it becomes the base root for the merge operation
   *  2. parsing sequential roots (special case) => keep track so we know how to operate slash directives
   *  3. parsing nodes (general case)
   * @param {DtsNode | undefined} base_root - where the merged devicetree is getting built
   * @param {DtsNode | undefined} current_root - tree that's currently parsed
   */
  private parse_node(base_root?: DtsNode, current_root?: DtsNode): DtsNode {

    if (this.consume(TokKind.Slash)) {
      this.expect(TokKind.LBrace, "Expected '{' after '/'");

      const root: DtsNode = {
        _uuid: crypto.randomUUID(),
        labels: [],
        name: "/",
        properties: [],
        children: [],
        deleted: false
      };

      // Sequential roots get merged into the first one 
      this.parse_node_body(root, base_root ?? root, current_root);

      return root;
    }

    const { name, unit_addr } = this.parse_node_key();

    this.expect(TokKind.LBrace, "Expected '{' to start node body");

    // Labels are assigned when parsing the body
    const node: DtsNode = {
      _uuid: crypto.randomUUID(),
      labels: [],
      name: name,
      unit_addr: unit_addr,
      properties: [],
      children: [],
      deleted: false
    };

    if (base_root === undefined) {
      throw new ParseError(`Expected node ${name}@${unit_addr} to be in a root node!`);
    }

    this.parse_node_body(node, base_root, current_root);

    return node;
  }

  /**
   * Entrypoint for parsing the body of a node consisting of properties, nodes or slash directives.
   * Slash directives execution tries the local scope first and on failure then tries the global scope,
   * if present.
   * @param {DtsNode} node - what's currently being parsed
   * @param {DtsNode} base_root - there's always a base root, even when working on the base root
   * @param {DtsNode | undefined} current_root - exists only when multiple roots are being parsed
   */
  private parse_node_body(node: DtsNode, base_root: DtsNode, current_root?: DtsNode) {
    while (this.tok.kind !== TokKind.RBrace && this.tok.kind !== TokKind.EOF) {
      const labels: string[] = this.consume_present_labels();

      // Node
      if (this.tok.kind === TokKind.Ident && this.peek_node_start()) {
        const child = this.parse_node(base_root, current_root);

        // parse_node() doesn't assign labels as it's assumed that roots can't have labels
        child.labels = labels;

        node.children.push(child);
      } else {
        switch (this.tok.kind) {
          case TokKind.Ampersand:
            {
              const target_reference = this.parse_reference();
              let target = this.resolve_reference(base_root, target_reference);

              if (target === undefined && target_reference.ref.kind === 'path') {
                target = ensure_node_by_path(base_root, target_reference.ref.path, { mark_modified: true });
              }

              this.expect(TokKind.LBrace, "Expected '{' to start overlay body");

              const overlay_node: DtsNode = {
                _uuid: crypto.randomUUID(),
                labels: [],
                name: "__overlay__",
                properties: [],
                children: [],
                deleted: false
              };

              this.parse_node_body(overlay_node, base_root, target);

              if (target !== undefined) {

                merge_node(
                  target,
                  overlay_node,
                  { mark_created_nodes: false }
                );
              }

              break;
            }
          // Property
          case TokKind.Ident:
            {
              const property_name = this.advance().value!;

              // Flag
              if (this.consume(TokKind.Semicolon)) {
                const property: DtsProperty = {
                  labels: labels,
                  name: property_name,
                  deleted: false
                };

                node.properties.push(property);
                break;
              }

              this.expect(TokKind.Equals, "Expected '=' or ';' after property name");

              const value = this.parse_value();

              this.expect(TokKind.Semicolon, "Missing ';' after property value");

              const property: DtsProperty = {
                labels: labels,
                name: property_name,
                value: value,
                deleted: false
              };

              node.properties.push(property);

              break;
            }
          case TokKind.Slash:
            {
              this.parse_and_apply_directive(base_root, node, current_root);

              break;
            }
          default:
            {
              throw new ParseError("Unknown token inside node", this.tok);
            }
        }
      }
    }

    this.expect(TokKind.RBrace, "Expected '}' to end node");
    this.expect(TokKind.Semicolon, "Expected ';' after node block");
  }

  /**
   * Parse a `/delete-property/` or `/delete-node/` directive and apply it to
   * the current tree. When inside (local) overlays (not dtso), operations are relative to 
   * the current root when provided.
   * @param {DtsNode} base_root - working base root on which to fallback directive target
   * @param {DtsNode | undefined} current_node - is optional because `/delete-node/` doesn't need to be in a node
   * @param {DtsNode | undefined} current_root - is optional because `/delete-node` doesn't need to be in a node 
   */
  private parse_and_apply_directive(base_root: DtsNode, current_node?: DtsNode, current_root?: DtsNode) {
    const directive = this.consume_slash_word();

    if (directive === '/include/') {
      throw new ParseError("Can't resolve /include/ directives", this.tok);
    }

    if (directive === '/delete-property/') {
      // Can't delete a property if we are not in a node 
      if (current_node === undefined) {
        throw new ParseError("Can't delete property if not in a node!", this.tok);
      }

      // Next token should be an identifier (property name)
      const property_tok = this.expect(TokKind.Ident, "Expected property name after /delete-property/");
      const name = property_tok.value!;
      // Remove from the current context and also from the corresponding node in the accumulated document tree
      current_node.properties = current_node.properties.filter((p) => p.name !== name);

      const scope_root = current_root ?? base_root;
      const target: DtsNode | undefined = (current_root !== undefined && current_node.name === '__overlay__')
        ? current_root
        : find_by_key(scope_root, get_node_key(current_node));

      if (target !== undefined) {
        const to_delete = target.properties.find((p) => p.name === name);

        if (to_delete !== undefined) {
          to_delete.deleted = true;
          to_delete.labels = [];
        }
      }

      this.expect(TokKind.Semicolon, "Missing ';' after /delete-property/");
      return;
    }

    if (directive === '/delete-node/') {
      // Argument can be &label, &{path}, or a node key like name@unit[,unit]

      if (this.tok.kind === TokKind.Ampersand) {
        const reference = this.parse_reference();

        if (reference.ref.kind === 'label') {
          delete_node_by_label(base_root, reference.ref.name);
        }
        else {
          const target = find_node_by_path(base_root, reference.ref.path);

          if (target !== undefined) {
            delete_node_by_key(base_root, get_node_key(target));
          }
        }

        this.expect(TokKind.Semicolon, "Missing ';' after /delete-node/");
        return;
      }

      const { name, unit_addr } = this.parse_node_key();
      this.expect(TokKind.Semicolon, "Missing ';' after /delete-node/");

      const key = unit_addr === undefined ? `${name}` : `${name}@${unit_addr}`;

      if (current_node === undefined) {
        delete_node_by_key(base_root, key);
      } else {
        // When inside an overlay, delete strictly relative to the overlay target.
        if (current_root === undefined) {
          if (!delete_node_by_key(current_node, key)) {
            delete_node_by_key(base_root, key);
          }
        } else {
          const root = current_root;
          delete_node_by_key(root, key);
        }
      }

      return;
    }
    // Unknown directive: consume to semicolon
    // TODO: maybe accumulate warnings and emit them to show we ignore certain directives
    while (this.tok.kind !== TokKind.Semicolon && this.tok.kind !== TokKind.EOF) {
      if (this.tok.kind === TokKind.Ampersand) {
        this.parse_reference();
        continue;
      }

      this.advance();
    }

    this.expect(TokKind.Semicolon, "Unknown directive expected to end with ';' !");
  }

  /**
  * Parse a node-key like `name@unit[,unit]`
  */
  private parse_node_key(): { name: string, unit_addr?: string } {
    const name = this.expect(TokKind.Ident, "Expected node name").value!;
    const unit_addr: string | undefined = (() => {
      let accumulator: string = "";

      if (this.consume(TokKind.At)) {

        while (this.tok.kind === TokKind.Ident || this.tok.kind === TokKind.Number || this.tok.kind === TokKind.Comma) {
          const t = this.advance();
          accumulator += t.kind === TokKind.Comma ? "," : (t.value ?? "");
        }

        return accumulator;
      }

      return;
    })();

    if (unit_addr !== undefined && unit_addr.length === 0) {
      throw new ParseError("Expected unit address after '@'", this.tok);
    }

    return { name: name, unit_addr: unit_addr };
  }

  /**
  * Parse a property value composed of one or more comma-separated components. 
  */
  private parse_value(): DtsValue {
    const components: DtsValueComponent[] = [];

    while (true) {
      const labels: string[] = this.consume_present_labels();

      // Component kinds
      switch (this.tok.kind) {
        case TokKind.String:
          {
            const t = this.advance();
            components.push(
              {
                kind: "string",
                value: t.value!,
                labels: structuredClone(labels)
              }
            );

            break;
          }
        case TokKind.LBracket:
          {
            components.push(this.parse_byte_array(structuredClone(labels)));
            break;
          }
        case TokKind.Bits:
        case TokKind.LAngle:
          {
            components.push(this.parse_cell_array(structuredClone(labels)));
            break;
          }
        case TokKind.Ampersand:
          {
            const reference = this.parse_reference();
            reference.labels = structuredClone(labels);
            components.push(reference);
            break;
          }
        default:
          {
            throw new ParseError("Unexpected token in value", this.tok);
          }
      }

      if (this.consume(TokKind.Comma)) {
        continue;
      }

      break;
    }

    return { components: components };
  }

  /**
   * Parse a byte string strictly as hex digit pairs per dtc semantics.
   *
   * Rules:
   * - Enclosed in '[' ... ']'.
   * - Each byte is exactly two hexadecimal digits (0-9, a-f, A-F).
   * - Spaces between bytes are optional; compact forms like [0001ff] are valid.
   * - Hex nibbles can span multiple tokens (e.g., Number('1') + Ident('b')).
   * - If the closing bracket arrives with a dangling single nibble, it's an error.
   */
  private parse_byte_array(labels: string[]): DtsByteArray {
    this.expect(TokKind.LBracket);

    const bytes_array: DtsByteArray = { kind: "bytes", bytes: [], labels: labels };

    // Accumulate hex nibbles across tokens to tolerate splits like '1' 'b'
    let hex_buffer = "";

    while (this.tok.kind !== TokKind.RBracket && this.tok.kind !== TokKind.EOF) {

      const labels: string[] = this.consume_present_labels();

      if (this.tok.kind === TokKind.Number) {
        const t = this.advance();
        let raw = t.value!;

        if (/^0[xX]/.test(raw)) {
          throw new ParseError("Unexpected hex prefix in bytestring!", t);
        }

        if (!/^[0-9a-fA-F]+$/.test(raw)) {
          throw new ParseError("Expected hex digits in bytestring", t);
        }

        hex_buffer += raw;

        while (hex_buffer.length >= 2) {
          const b = Number.parseInt(hex_buffer.slice(0, 2), 16);
          bytes_array.bytes.push(
            {
              value: b,
              labels: structuredClone(labels)
            }
          );

          hex_buffer = hex_buffer.slice(2);
        }

        continue;
      }

      if (this.tok.kind === TokKind.Ident) {
        const t = this.advance();
        const raw = t.value!;
        // Identifiers must consist solely of hex digits; spaces are handled by tokenization.
        if (!/^[0-9a-fA-F]+$/.test(raw)) {
          throw new ParseError("Expected hex digits in bytestring", t);
        }

        hex_buffer += raw;

        while (hex_buffer.length >= 2) {
          const b = Number.parseInt(hex_buffer.slice(0, 2), 16);
          bytes_array.bytes.push(
            {
              value: b,
              labels: structuredClone(labels)
            }
          );

          hex_buffer = hex_buffer.slice(2);
        }

        continue;
      }

      throw new ParseError("Unexpected token in bytestring", this.tok);
    }

    this.expect(TokKind.RBracket);

    if (hex_buffer.length > 0) {
      throw new ParseError("Expected hex digit pairs in bytestring");
    }

    return bytes_array;
  }

  /** 
  * Parse an array with optional `/bits/ N` prefix. 
  */
  private parse_cell_array(labels: string[]): DtsCellArray {
    let bit_width: Bits | undefined;

    // NOTE: admittedly don't know if we can label /bits/ or the value of /bits/; didn't find any examples
    if (this.consume(TokKind.Bits)) {
      const number_tok = this.expect(TokKind.Number, "Expected number after /bits/");
      const bw = Number.parseInt(number_tok.value!, 10) as Bits;

      if (![8, 16, 32, 64].includes(bw)) {
        throw new ParseError("Invalid /bits/ width", number_tok);
      }

      bit_width = bw;
    }

    this.expect(TokKind.LAngle, "Expected '<' to start array");

    const elements: CellArrayElement[] = [];

    while (this.tok.kind !== TokKind.RAngle && this.tok.kind !== TokKind.EOF) {

      const labels: string[] = this.consume_present_labels();

      switch (this.tok.kind) {
        case TokKind.Ampersand:
          {
            const reference = this.parse_reference();
            reference.labels = labels;
            elements.push(
              {
                item: reference
              }
            );

            break;
          }
        case TokKind.Number:
          {
            const number_tok = this.advance();
            // NOTE: using stupid behavior where BigInt() does parse just the numbers in a string
            const raw = number_tok.value!;
            const number_ = BigInt(raw);
            const repr = raw.toLowerCase().startsWith('0x') ? 'hex' : 'dec';

            if (bit_width === 64) {
              const u64: CellArrayU64 = {
                kind: "u64",
                value: BigInt.asUintN(64, number_),
                repr: repr,
                labels: structuredClone(labels),
              };

              elements.push({ item: u64 });
            } else {
              const item: CellArrayNumber = {
                kind: "number",
                value: number_,
                repr: repr,
                labels: structuredClone(labels),
              };

              elements.push({ item: item });
            }

            break;
          }
        // TODO: ConstExpr can start with LParen or number, probably?
        case TokKind.LParen:
        case TokKind.Minus:
        case TokKind.Plus:
        case TokKind.Ident:
        case TokKind.Pipe:
          {
            // Evaluate constant expression until comma or closing '>'
            const value = this.parse_const_expression(this.tok.kind === TokKind.LParen);

            // TODO: doesn't matter for now but will probably come up later
            if (bit_width === 64) {
              elements.push(
                {
                  item: {
                    kind: "expression",
                    value: value,
                    labels: structuredClone(labels),
                  }
                }
              );
            } else {
              elements.push(
                {
                  item: {
                    kind: "expression",
                    value: value,
                    labels: labels
                  }
                }
              );
            }

            break;
          }
        default:
          {
            throw new ParseError("Unexpected token in array", this.tok);
          }
      }
    }

    this.expect(TokKind.RAngle, "Expected '>' to end array");

    return {
      kind: "array",
      bit_width: bit_width,
      labels: labels,
      elements: elements
    };
  }

  /**
   * TODO: review this 
   */
  private parse_const_expression(started_with_parenthesis: boolean): string {
    let depth = 0;

    let expr = "";
    const push = (s: string) => { expr += s; };

    let expect_operand = true; // track boundaries between elements
    const start_index = this.i;

    // Parse until we reach a comma or closing '>' at depth 0
    while (true) {
      const k = this.tok.kind;

      if (k === TokKind.Comma || k === TokKind.EOF) {
        break;
      }

      if (k === TokKind.RAngle) {
        // Possible end of array or shift-right; check if it's a shift '>>'
        if (this.lookahead(1)?.kind === TokKind.RAngle) {
          this.advance();
          this.advance();
          push(">>");
          expect_operand = true;
          continue;
        }

        if (depth === 0) {
          break;
        }
        // Otherwise treat as literal '>' inside expression (shouldn't occur, but it's legal)
        break;
      }

      if (k === TokKind.LParen) {
        depth++;
        this.advance();
        push("(");
        expect_operand = true;
        continue;
      }

      if (k === TokKind.RParen) {
        depth = Math.max(0, depth - 1);
        this.advance();
        push(")");
        expect_operand = false;

        if (started_with_parenthesis && depth === 0) {
          break;
        }

        continue;
      }

      if (k === TokKind.Number) {
        if (!expect_operand) {
          break;
        } // new array element starting

        const t = this.advance();
        const v = t.value!;
        push(`${v}`);
        expect_operand = false;

        continue;
      }

      // Without this case, the whole vscode crashes (infinite loop)
      if (k === TokKind.Ident) {
        if (!expect_operand) {
          break;
        } // new array element starting

        const t = this.advance();
        push(t.value!);
        expect_operand = false;

        continue;
      }
      // TODO: add logical operators; relational operators; ternary operators
      if (k === TokKind.Plus) { this.advance(); push("+"); expect_operand = true; continue; }
      if (k === TokKind.Minus) { this.advance(); push("-"); expect_operand = true; continue; }
      if (k === TokKind.Star) { this.advance(); push("*"); expect_operand = true; continue; }
      if (k === TokKind.Pipe) { this.advance(); push("|"); expect_operand = true; continue; }
      if (k === TokKind.Slash) { this.advance(); push("/"); expect_operand = true; continue; }
      if (k === TokKind.Percent) { this.advance(); push("%"); expect_operand = true; continue; }
      if (k === TokKind.ExclusiveOr) { this.advance(); push("^"); expect_operand = true; continue; }
      if (k === TokKind.BitwiseNot) { this.advance(); push("~"); expect_operand = true; continue; }
      if (k === TokKind.LAngle) {
        // Must be '<<'
        if (this.lookahead(1)?.kind === TokKind.LAngle) {
          this.advance();
          this.advance();
          push("<<");
          expect_operand = true;
          continue;
        }

        throw new ParseError("Unexpected '<' in expression", this.tok);
      }
      // If we encounter an unexpected token where an operator would be, end expr
      break;
    }
    try {
      // TODO: we don't really wanna evaluate these probably idk
      // const function_ = new Function(`return (${expr});`);
      // const out = function_();
      // if (typeof out !== 'bigint') { throw new TypeError('expression did not evaluate to bigint'); }
      return expr;
    } catch (error: any) {
      // Reset index to starting point for clearer context if thrown by caller
      this.i = start_index;
      throw new ParseError(`Failed to evaluate expression: ${String(error.message || error)}. expr="${expr}"`);
    }
  }

  /** 
  * Parse a label (`&foo`) or absolute path (`&{/soc/...}`) reference. 
  */
  private parse_reference(): DtsReference {
    this.expect(TokKind.Ampersand);

    // &{/path}
    if (this.consume(TokKind.LBrace)) {
      let path = "";

      while (this.tok.kind !== TokKind.RBrace && this.tok.kind !== TokKind.EOF) {
        const t = this.advance();

        switch (t.kind) {
          case TokKind.Ident: { path += t.value; break; }
          case TokKind.Slash: { path += "/"; break; }
          case TokKind.At: { path += "@"; break; }
          case TokKind.Comma: { path += ","; break; }
          case TokKind.Number: { path += t.value; break; }
          default: {
            throw new ParseError("Unexpected token in path reference", t);
          }
        }
      }

      this.expect(TokKind.RBrace, "Expected '}' in path reference");

      return {
        kind: "ref",
        ref: {
          kind: "path",
          path: path
        },
        labels: []
      };
    }

    const ident = this.expect(TokKind.Ident, "Expected label after '&'").value!;

    return {
      kind: "ref",
      ref: {
        kind: "label",
        name: ident
      },
      labels: []
    };
  }

  /** 
  * True if an identifier (or identifier + unit address) is followed by `{` 
  */
  private peek_node_start(): boolean {
    if (this.lookahead(1)?.kind === TokKind.LBrace) {
      return true;
    }

    if (this.lookahead(1)?.kind === TokKind.At) {
      let lookahead = 2;
      while (lookahead++) {
        switch (this.lookahead(lookahead).kind) {
          case TokKind.Ident:
          case TokKind.Number:
          case TokKind.Comma: {
            continue;
          }
          case TokKind.LBrace: {
            return true;
          }
          default: {
            return false;
          }
        }
      }
    }

    return false;
  }

  private consume_present_labels(): string[] {
    const labels: string[] = [];

    while (this.tok.kind === TokKind.Ident && this.lookahead(1)?.kind === TokKind.Colon) {
      labels.push(this.advance().value!);
      this.expect(TokKind.Colon);
    }

    return labels;
  }

  private parse_dts_metadata(): DtsMetadata | undefined {
    const metadata_token = this.comments.find(c => (
      c.kind === TokKind.CommentBlock
      && c.value?.includes(DtsMetadataHeader)
    ));

    if (metadata_token === undefined) {
      return undefined;
    }

    try {
      const metadata = parse_yaml_string(metadata_token.value as string);      
      return isDtsMetadata(metadata) ? metadata : undefined;
    } catch {
      return undefined;
    }
  }
}

/**
* Ensure a node exists for an absolute path like /soc/mmc@7e300000 by creating
* any missing intermediate nodes. Assign first-seen order to created nodes to
* match dtc's ordering where an overlay's first touch determines placement.
*/
export function ensure_node_by_path(
  root: DtsNode,
  absolute_path: string,
  options?: { mark_modified?: boolean }
): DtsNode {
  if (absolute_path[0] !== '/') {
    return root;
  }

  const segments: string[] = absolute_path.split('/').slice(1); // drop leading empty

  let current = root;

  for (const segment of segments) {
    const at = segment.indexOf('@');
    const name = at === -1 ? segment : segment.slice(0, at);
    const unit = at === -1 ? undefined : segment.slice(at + 1);

    let next: DtsNode | undefined = current.children.find(
      (n) => n.name === name && (unit === undefined ? (n.unit_addr === undefined) : (n.unit_addr === unit))
    );

    if (next === undefined) {
      next = {
        _uuid: crypto.randomUUID(),
        name: name,
        unit_addr: unit,
        properties: [],
        children: [],
        labels: [],
        deleted: false
      };

      current.children.push(next);
    }

    if (options?.mark_modified) {
      next.modified_by_user = true;
    }

    current = next;
  }

  return current;
}

function find_by_key(root: DtsNode, key: string): DtsNode | undefined {
  if (get_node_key(root) === key) {
    return root;
  }

  for (const c of root.children) {
    const found = find_by_key(c, key);

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}
function prune_soft_delete(base_document: DtsDocument) {

  prune_soft_delete_impl(base_document.root);

}

function prune_soft_delete_impl(root: DtsNode) {

  root.properties = root.properties.filter((property) => property.deleted !== true);
  root.children = root.children.filter((child) => child.deleted !== true);

  for (const child of root.children) {
    prune_soft_delete_impl(child);
  }
}