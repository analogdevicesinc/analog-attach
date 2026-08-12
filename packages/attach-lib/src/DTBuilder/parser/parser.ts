import {
  type CellArrayElement,
  Bits,
  type DTValue,
  type DTS,
  type DTO,
  type DTNode,
  type DTProperty,
  type Memreserve,
  is_bits,
  DTCellArray,
  DTMetadata,
  isDTMetadata
} from "./ast.js";

import { TokenStream } from "./TokenStream.js";
import {
  CharToken, CharTokenKind, DirectiveToken,
  DTDirective, RawToken, Token, TokenKind
} from "./tokens.js";
import { Option } from "../../option.js";
import { Result } from "../../result.js";
import { WithRowAndCol } from "./LexerInputStream.js";
import { lex } from "./Lexer.js";
import { parse as parse_yaml_string } from "yaml";

import { DTS_METADATA_HEADER } from "./constants.js";

type Deletable<T> = T & {
  deleted: boolean;
}

type DeletableProperty = Deletable<DTProperty>;
type DeletableNode = Deletable<DTNode<DeletableProperty>>;

export type ParseError = {
  message: string;
  found?: Token;
  expected?: RawToken;
}

export type DTSParseResult = {
  dts: DTS;
  metadata: DTMetadata | undefined;
}

export type DTOParseResult = {
  dto: DTO;
  metadata: DTMetadata | undefined;
}

export class Parser {
  constructor(
    private readonly token_stream: TokenStream,
    private readonly comments_stream: TokenStream,
  ) { }

  public parse_dts(): Result<DTSParseResult, ParseError> {
    const r_v1 = this.consume_directive_token_then_advance(DTDirective.DTSV1);
    if (Result.is_err(r_v1)) { return r_v1; }

    const r_semi = this.consume_char_token_then_advance(CharTokenKind.Semicolon);
    if (Result.is_err(r_semi)) { return r_semi; }

    while (
      !this.token_stream.done &&
      this.token_stream.current.kind === TokenKind.Directive &&
      (this.token_stream.current as DirectiveToken).value === DTDirective.DTSV1
    ) {
      this.token_stream.advance();
      const r_extra_semi = this.consume_char_token_then_advance(CharTokenKind.Semicolon);
      if (Result.is_err(r_extra_semi)) { return r_extra_semi; }
    }

    const r_memreserves = this.parse_memreserve_statements();
    if (Result.is_err(r_memreserves)) { return r_memreserves; }

    const labels = this.parse_labels();
    const r_root = this.parse_node_statement(labels);
    if (Result.is_err(r_root)) { return r_root; }
    const root = r_root.value;

    // Remaining Overlays & Delete Node Directives

    while (!this.token_stream.done) {
      const current = this.token_stream.current;

      // /delete-node/ reference;
      if (current.kind === TokenKind.Directive) {
        const r_del = this.consume_directive_token_then_advance(DTDirective.DeleteNode);
        if (Result.is_err(r_del)) { return r_del; }

        const r_target = this.find_node_by_current_reference(root);
        if (Result.is_err(r_target)) { return r_target; }
        this.token_stream.advance();

        r_target.value.deleted = true;

        const r_end = this.consume_char_token_then_advance(CharTokenKind.Semicolon);
        if (Result.is_err(r_end)) { return r_end; }

        continue;
      }

      // Overlay

      const overlay_labels = this.parse_labels();

      const r_target = this.find_node_by_current_reference(root);
      if (Result.is_err(r_target)) { return r_target; }
      this.token_stream.advance();

      const r_overlay = this.parse_and_apply_overlay_statement(overlay_labels, r_target.value);
      if (Result.is_err(r_overlay)) { return r_overlay; }
    }

    const r_metadata = this.parse_metadata();
    if (Result.is_err(r_metadata)) { return r_metadata; }

    return Result.Ok({
      dts: { memreserves: r_memreserves.value, root: strip_node(root) },
      metadata: r_metadata.value
    });
  }

  public parse_dto(): Result<DTOParseResult, ParseError> {
    const r_v1 = this.consume_directive_token_then_advance(DTDirective.DTSV1);
    if (Result.is_err(r_v1)) { return r_v1; }

    const r_semi1 = this.consume_char_token_then_advance(CharTokenKind.Semicolon);
    if (Result.is_err(r_semi1)) { return r_semi1; }

    while (
      !this.token_stream.done &&
      this.token_stream.current.kind === TokenKind.Directive &&
      (this.token_stream.current as DirectiveToken).value === DTDirective.DTSV1
    ) {
      this.token_stream.advance();
      const r_extra_semi = this.consume_char_token_then_advance(CharTokenKind.Semicolon);
      if (Result.is_err(r_extra_semi)) { return r_extra_semi; }
    }

    const r_plugin = this.consume_directive_token_then_advance(DTDirective.Plugin);
    if (Result.is_err(r_plugin)) { return r_plugin; }

    const r_semi2 = this.consume_char_token_then_advance(CharTokenKind.Semicolon);
    if (Result.is_err(r_semi2)) { return r_semi2; }

    const children_map = new Map<string, DeletableNode>();

    if (this.token_stream.done) {
      return Result.Err({ message: "Unexpected end of tokens after /plugin/;" });
    }
    const current = this.token_stream.current;

    if (current.kind === TokenKind.Char) {

      // Parsing roots

      while (!this.token_stream.done) {
        const r_slash = this.consume_char_token_then_advance(CharTokenKind.Slash);
        if (Result.is_err(r_slash)) { return r_slash; }

        const r_lbrace = this.consume_char_token_then_advance(CharTokenKind.LBrace);
        if (Result.is_err(r_lbrace)) { return r_lbrace; }

        // Parsing fragments / new nodes

        while (!this.token_stream.done && this.token_stream.current.kind !== TokenKind.Char) {

          const labels = this.parse_labels();

          const node_identifier_token = this.token_stream.current;
          if (node_identifier_token.kind !== TokenKind.Identifier) {
            return Result.Err({
              message: "Expected node/fragment identifier",
              found: node_identifier_token
            });
          }

          if (children_map.has(node_identifier_token.value)) {
            return Result.Err({
              message: "Previously defined node with this identifier might conflict",
              found: node_identifier_token
            });
          }

          const r_node = this.parse_node_statement(labels);
          if (Result.is_err(r_node)) { return r_node; }
          children_map.set(node_identifier_token.value, r_node.value);
        }

        const r_rbrace = this.consume_char_token_then_advance(CharTokenKind.RBrace);
        if (Result.is_err(r_rbrace)) { return r_rbrace; }

        const r_semi = this.consume_char_token_then_advance(CharTokenKind.Semicolon);
        if (Result.is_err(r_semi)) { return r_semi; }
      }
    } else {

      // Parsing overlays and transform them into fragments

      let current_number_of_fragments = 0;

      while (!this.token_stream.done) {

        const labels = this.parse_labels();

        const current = this.token_stream.current;

        let target_property: DeletableProperty;
        if (current.kind === TokenKind.LabelReference) {
          this.token_stream.advance();

          target_property = {
            labels: [],
            name: "target",
            value: [{
              labels: [],
              kind: "array",
              bit_width: Bits.b32,
              elements: [{
                labels: [],
                kind: "label",
                name: `&${current.value}`
              }]
            }],
            deleted: false
          };

        } else if (current.kind === TokenKind.PathReference) {
          this.token_stream.advance();

          target_property = {
            labels: [],
            name: "target-path",
            value: [{
              labels: [],
              kind: "string",
              value: current.value
            }],
            deleted: false
          };
        } else {
          return Result.Err({
            message: "Expected reference (path or label)",
            found: current
          });
        }

        const overlay_properties_map = new Map<string, DeletableProperty>();
        const overlay_children_map = new Map<string, DeletableNode>();

        const r_lbrace = this.consume_char_token_then_advance(CharTokenKind.LBrace);
        if (Result.is_err(r_lbrace)) { return r_lbrace; }

        while (!this.token_stream.done && this.token_stream.current.kind !== TokenKind.Char) {

          const labels = this.parse_labels();

          const current = this.token_stream.current;

          // Ignoring /delete-*/ identifier;

          if (current.kind === TokenKind.Directive) {
            if (current.value === DTDirective.DeleteNode || current.value === DTDirective.DeleteProperty) {
              this.token_stream.advance();

              const r_ident = this.consume_identifier_token_then_advance();
              if (Result.is_err(r_ident)) { return r_ident; }

              const r_semi = this.consume_char_token_then_advance(CharTokenKind.Semicolon);
              if (Result.is_err(r_semi)) { return r_semi; }
              continue;
            }
            return Result.Err({
              message: "Unexpected directive within node",
              found: current
            });
          }

          if (current.kind !== TokenKind.Identifier) {
            return Result.Err({
              message: "Looking for identifier that represents property/child name",
              found: current
            });
          }

          const next_opt = this.token_stream.lookahead(1);
          if (Option.is_none(next_opt)) {
            return Result.Err({ message: "Unexpected end of tokens after property/child identifier" });
          }
          const next = next_opt.value;
          if (next.kind !== TokenKind.Char) {
            return Result.Err({
              message: "Property/Child name must be followed by '=', '{', or ';'",
              found: next
            });
          }

          // Properties

          if (next.value === CharTokenKind.Equals || next.value === CharTokenKind.Semicolon) {
            if (overlay_children_map.size > 0) {
              return Result.Err({ message: "Properties must be defined before children" });
            }

            const property_name = current.value;

            if (overlay_properties_map.has(property_name)) {
              return Result.Err({
                message: "Property name will conflict with another previously defined property",
                found: current
              });
            }

            const r_property = this.parse_property_statement(labels);
            if (Result.is_err(r_property)) { return r_property; }
            overlay_properties_map.set(r_property.value.name, r_property.value);
            continue;
          }

          // Children

          if (next.value === CharTokenKind.LBrace) {
            const node_identifier = current.value;

            if (overlay_properties_map.has(node_identifier)) {
              return Result.Err({
                message: "Node name will conflict with previous defined property name",
                found: current
              });
            }

            if (overlay_children_map.has(node_identifier)) {
              return Result.Err({
                message: "Node name will conflict with another previously defined node name",
                found: current
              });
            }

            const r_node = this.parse_node_statement(labels);
            if (Result.is_err(r_node)) { return r_node; }
            overlay_children_map.set(node_identifier, r_node.value);
            continue;
          }

          return Result.Err({
            message: "Expected '{','=' or ';' after property/child identifier",
            found: next
          });
        }

        const r_rbrace = this.consume_char_token_then_advance(CharTokenKind.RBrace);
        if (Result.is_err(r_rbrace)) { return r_rbrace; }

        const r_semi = this.consume_char_token_then_advance(CharTokenKind.Semicolon);
        if (Result.is_err(r_semi)) { return r_semi; }

        children_map.set(`fragment@${current_number_of_fragments}`, {
          labels,
          name: "fragment",
          unit_addr: current_number_of_fragments.toString(),
          properties: [target_property],
          children: [{
            labels: [],
            name: "__overlay__",
            unit_addr: undefined,
            properties: [...overlay_properties_map.values()],
            children: [...overlay_children_map.values()],
            deleted: false
          }],
          deleted: false
        });

        ++current_number_of_fragments;
      }
    }

    const r_metadata = this.parse_metadata();
    if (Result.is_err(r_metadata)) { return r_metadata; }

    return Result.Ok({
      dto: {
        root: strip_node({
          labels: [],
          name: "/",
          unit_addr: undefined,
          properties: [],
          children: [...children_map.values()],
          deleted: false
        })
      },
      metadata: r_metadata.value
    });
  }

  private parse_and_apply_overlay_statement(
    labels: Array<string>,
    target_node: DeletableNode
  ): Result<undefined, ParseError> {
    target_node.labels = [...new Set([...labels, ...target_node.labels])];

    const r_lbrace = this.consume_char_token_then_advance(CharTokenKind.LBrace);
    if (Result.is_err(r_lbrace)) { return r_lbrace; }

    let defined_at_least_one_child = false;
    while (!this.token_stream.done && this.token_stream.current.kind !== TokenKind.Char) {

      const labels = this.parse_labels();

      const current = this.token_stream.current;

      // Delete Directive

      if (current.kind === TokenKind.Directive) {
        if (current.value === DTDirective.DeleteNode) {
          this.token_stream.advance();

          const r_ident = this.consume_identifier_token_then_advance();
          if (Result.is_err(r_ident)) { return r_ident; }

          const [name, unit_addr] = split_node_identifier(r_ident.value);
          for (const child of target_node.children) {
            if (child.name === name && child.unit_addr === unit_addr) {
              child.deleted = true;
              child.labels = [];
              child.properties = [];
              child.children = [];
              break;
            }
          }

          const r_semi = this.consume_char_token_then_advance(CharTokenKind.Semicolon);
          if (Result.is_err(r_semi)) { return r_semi; }
          continue;
        }

        if (current.value === DTDirective.DeleteProperty) {
          this.token_stream.advance();

          const r_ident = this.consume_identifier_token_then_advance();
          if (Result.is_err(r_ident)) { return r_ident; }

          for (const property of target_node.properties) {
            if (property.name === r_ident.value) {
              property.deleted = true;
              break;
            }
          }

          const r_semi = this.consume_char_token_then_advance(CharTokenKind.Semicolon);
          if (Result.is_err(r_semi)) { return r_semi; }
          continue;
        }

        return Result.Err({
          message: "Unexpected directive within overlay",
          found: current
        });
      }

      if (current.kind !== TokenKind.Identifier) {
        return Result.Err({
          message: "Expected child/property name identifier",
          found: current
        });
      }

      const next_opt = this.token_stream.lookahead(1);
      if (Option.is_none(next_opt)) {
        return Result.Err({ message: "Unexpected end of tokens after property/child identifier" });
      }
      const next = next_opt.value;
      if (next.kind !== TokenKind.Char) {
        return Result.Err({
          message: "Property/Child name must be followed by '=', '{', or ';'",
          found: next
        });
      }

      // Property Override

      if (next.value === CharTokenKind.Equals || next.value === CharTokenKind.Semicolon) {
        if (defined_at_least_one_child) {
          return Result.Err({ message: "Properties must be defined before children" });
        }

        const r_property = this.parse_property_statement(labels);
        if (Result.is_err(r_property)) { return r_property; }
        const property = r_property.value;

        const existing_index = target_node.properties
          .findIndex(p => p.name === property.name);

        if (existing_index === -1) {
          target_node.properties.push(property);
        } else {
          target_node.properties[existing_index] = {
            ...property,
            labels: [...new Set([
              ...property.labels,
              ...target_node.properties[existing_index].labels
            ])],
          };
        }

        continue;
      }

      // Child Override

      if (next.value === CharTokenKind.LBrace) {
        defined_at_least_one_child = true;

        const [name, unit_addr] = split_node_identifier(current.value);
        const existing_live_child = target_node.children
          .find(c => c.name === name && c.unit_addr === unit_addr && !c.deleted);

        // A deleted node may be re-defined under a different node name (same label):
        // match by name first, then fall back to any shared label.
        let deleted_child_index = target_node.children
          .findIndex(c => c.name === name && c.unit_addr === unit_addr && c.deleted);
        if (deleted_child_index === -1 && labels.length > 0) {
          deleted_child_index = target_node.children
            .findIndex(c => c.deleted && c.labels.some(l => labels.includes(l)));
        }

        if (existing_live_child) {
          this.token_stream.advance();
          const r_overlay = this.parse_and_apply_overlay_statement(labels, existing_live_child);
          if (Result.is_err(r_overlay)) { return r_overlay; }
        } else if (deleted_child_index === -1) {
          const r_node = this.parse_node_statement(labels);
          if (Result.is_err(r_node)) { return r_node; }
          target_node.children.push(r_node.value);
        } else {
          // Re-definition of a deleted node: replace in-place to preserve ordering/phandle assignment.
          const r_node = this.parse_node_statement(labels);
          if (Result.is_err(r_node)) { return r_node; }
          // TODO: can't say why it's needed to be reversed, need to investigate
          r_node.value.labels.reverse();
          target_node.children[deleted_child_index] = structuredClone(r_node.value);
        }

        continue;
      }

      return Result.Err({
        message: "Expected '{','=' or ';' after property/child identifier",
        found: next
      });
    }

    const r_rbrace = this.consume_char_token_then_advance(CharTokenKind.RBrace);
    if (Result.is_err(r_rbrace)) { return r_rbrace; }

    const r_semi = this.consume_char_token_then_advance(CharTokenKind.Semicolon);
    if (Result.is_err(r_semi)) { return r_semi; }

    // eslint-disable-next-line unicorn/no-useless-undefined
    return Result.Ok(undefined);
  }

  private parse_memreserve_statements(): Result<Array<Memreserve>, ParseError> {
    const memreserves: Array<Memreserve> = [];
    while (!this.token_stream.done
      && this.token_stream.current.kind === TokenKind.Directive
      && this.token_stream.current.value === DTDirective.MemReserve
    ) {

      this.token_stream.advance();

      const r_address = this.consume_number_token_then_advance();
      if (Result.is_err(r_address)) { return r_address; }

      const r_length = this.consume_number_token_then_advance();
      if (Result.is_err(r_length)) { return r_length; }

      memreserves.push({
        address: BigInt(r_address.value),
        length: BigInt(r_length.value),
      });

      const r_semi = this.consume_char_token_then_advance(CharTokenKind.Semicolon);
      if (Result.is_err(r_semi)) { return r_semi; }
    }
    return Result.Ok(memreserves);
  }

  private parse_node_statement(labels: Array<string>): Result<DeletableNode, ParseError> {

    // Node Name & Unit Address

    let name: string;
    let unit_addr: string | undefined;

    if (!this.token_stream.done
      && this.token_stream.current.kind === TokenKind.Char
      && this.token_stream.current.value === CharTokenKind.Slash
    ) {
      this.token_stream.advance();
      name = "/";
      unit_addr = undefined;
    } else {
      const r_ident = this.consume_identifier_token_then_advance();
      if (Result.is_err(r_ident)) { return r_ident; }
      [name, unit_addr] = split_node_identifier(r_ident.value);
    }

    if (name === "/" && labels.length > 0) {
      return Result.Err({ message: "Root node cannot have labels" });
    }

    if (name === "/" && unit_addr !== undefined) {
      return Result.Err({ message: "Root node cannot have a unit address" });
    }

    // Node Body Start {

    const r_lbrace = this.consume_char_token_then_advance(CharTokenKind.LBrace);
    if (Result.is_err(r_lbrace)) { return r_lbrace; }

    // Node Body Content

    const properties_map = new Map<string, DeletableProperty>();
    const children_map = new Map<string, DeletableNode>();

    while (!this.token_stream.done && this.token_stream.current.kind !== TokenKind.Char) {

      const labels = this.parse_labels();

      const current = this.token_stream.current;

      // Ignoring /delete-*/ identifier;

      if (current.kind === TokenKind.Directive) {
        if (current.value === DTDirective.DeleteNode || current.value === DTDirective.DeleteProperty) {
          this.token_stream.advance();

          const r_ident = this.consume_identifier_token_then_advance();
          if (Result.is_err(r_ident)) { return r_ident; }

          const r_semi = this.consume_char_token_then_advance(CharTokenKind.Semicolon);
          if (Result.is_err(r_semi)) { return r_semi; }
          continue;
        }
        return Result.Err({
          message: "Unexpected directive within node",
          found: current
        });
      }

      if (current.kind !== TokenKind.Identifier) {
        return Result.Err({
          message: "Looking for identifier that represents property/child name",
          found: current
        });
      }

      const next_opt = this.token_stream.lookahead(1);
      if (Option.is_none(next_opt)) {
        return Result.Err({ message: "Unexpected end of tokens after property/child identifier" });
      }
      const next = next_opt.value;
      if (next.kind !== TokenKind.Char) {
        return Result.Err({
          message: "Property/Child name must be followed by '=', '{', or ';'",
          found: next
        });
      }

      // Properties

      if (next.value === CharTokenKind.Equals || next.value === CharTokenKind.Semicolon) {
        if (children_map.size > 0) {
          return Result.Err({ message: "Properties must be defined before children" });
        }

        const property_name = current.value;

        if (properties_map.has(property_name)) {
          return Result.Err({
            message: "Property name will conflict with another previously defined property",
            found: current
          });
        }

        const r_property = this.parse_property_statement(labels);
        if (Result.is_err(r_property)) { return r_property; }
        properties_map.set(r_property.value.name, r_property.value);
        continue;
      }

      // Children

      if (next.value === CharTokenKind.LBrace) {
        const node_identifier = current.value;

        if (properties_map.has(node_identifier)) {
          return Result.Err({
            message: "Node name will conflict with previous defined property name",
            found: current
          });
        }

        if (children_map.has(node_identifier)) {
          return Result.Err({
            message: "Node name will conflict with another previously defined node name",
            found: current
          });
        }

        const r_node = this.parse_node_statement(labels);
        if (Result.is_err(r_node)) { return r_node; }
        children_map.set(node_identifier, r_node.value);
        continue;
      }

      return Result.Err({
        message: "Expected '{','=' or ';' after property/child identifier",
        found: next
      });
    }

    // Node Body End };

    const r_rbrace = this.consume_char_token_then_advance(CharTokenKind.RBrace);
    if (Result.is_err(r_rbrace)) { return r_rbrace; }

    const r_semi = this.consume_char_token_then_advance(CharTokenKind.Semicolon);
    if (Result.is_err(r_semi)) { return r_semi; }

    return Result.Ok({
      labels,
      name,
      unit_addr,
      properties: [...properties_map.values()],
      children: [...children_map.values()],
      deleted: false
    });
  }

  private parse_property_statement(labels: Array<string>): Result<DeletableProperty, ParseError> {

    // Property's name

    const r_name = this.consume_identifier_token_then_advance();
    if (Result.is_err(r_name)) { return r_name; }
    const name = r_name.value;

    // Empty property case (e.g. prop-name;)

    if (!this.token_stream.done
      && this.token_stream.current.kind === TokenKind.Char
      && this.token_stream.current.value === CharTokenKind.Semicolon
    ) {
      this.token_stream.advance();
      return Result.Ok({ labels, name, value: { kind: "flag" }, deleted: false });
    }

    // Property with value(s) case

    const r_equals = this.consume_char_token_then_advance(CharTokenKind.Equals);
    if (Result.is_err(r_equals)) { return r_equals; }

    const property_value_components = new Array<DTValue>();
    while (!this.token_stream.done && (this.token_stream.current.kind !== TokenKind.Char
      || this.token_stream.current.value !== CharTokenKind.Semicolon)
    ) {

      if (property_value_components.length > 0) {
        const r_comma = this.consume_char_token_then_advance(CharTokenKind.Comma);
        if (Result.is_err(r_comma)) { return r_comma; }
      }

      const labels = this.parse_labels();

      const current = this.token_stream.current;

      // string

      if (current.kind === TokenKind.String) {
        property_value_components.push({ labels, kind: "string", value: current.value });
        this.token_stream.advance();
        continue;
      }

      // cell array (specified bit width)

      if (current.kind === TokenKind.Directive) {
        const r_bits_directive = this.consume_directive_token_then_advance(DTDirective.Bits);
        if (Result.is_err(r_bits_directive)) { return r_bits_directive; }

        const r_bits_number = this.consume_number_token_then_advance();
        if (Result.is_err(r_bits_number)) { return r_bits_number; }

        const bits = Number.parseInt(r_bits_number.value);
        if (!is_bits(bits)) {
          return Result.Err({ message: `Invalid bits value. Expected 8, 16, 32 or 64. Got: ${bits}` });
        }

        const r_cell_array = this.parse_cell_array(labels, bits);
        if (Result.is_err(r_cell_array)) { return r_cell_array; }
        property_value_components.push(r_cell_array.value);
        continue;
      }

      // cell array

      if (current.kind === TokenKind.Char && current.value === CharTokenKind.LAngle) {
        const r_cell_array = this.parse_cell_array(labels);
        if (Result.is_err(r_cell_array)) { return r_cell_array; }
        property_value_components.push(r_cell_array.value);
        continue;
      }

      // bytestring

      if (current.kind === TokenKind.Char && current.value === CharTokenKind.LBracket) {
        const r_bytestring = this.parse_bytestring(labels);
        if (Result.is_err(r_bytestring)) { return r_bytestring; }
        property_value_components.push(r_bytestring.value);
        continue;
      }

      // label reference

      if (current.kind === TokenKind.LabelReference) {
        property_value_components.push({ labels, kind: "label", name: current.value });
        this.token_stream.advance();
        continue;
      }

      // path reference

      if (current.kind === TokenKind.PathReference) {
        property_value_components.push({ labels, kind: "path", path: current.value });
        this.token_stream.advance();
        continue;
      }

      // unknown

      return Result.Err({
        message: "Failed to parse property value. Met unknown token",
        found: current
      });
    }

    const r_semi = this.consume_char_token_then_advance(CharTokenKind.Semicolon);
    if (Result.is_err(r_semi)) { return r_semi; }

    return Result.Ok({ labels, name, value: property_value_components, deleted: false });
  }

  private consume_identifier_token_then_advance(): Result<string, ParseError> {
    if (this.token_stream.done) {
      return Result.Err({ message: "Unexpected end of tokens, expected identifier" });
    }
    const current = this.token_stream.current;
    if (current.kind !== TokenKind.Identifier) {
      return Result.Err({
        message: "Tried to consume identifier, but met other kind of token",
        found: current
      });
    }
    this.token_stream.advance();
    return Result.Ok(current.value);
  }

  private parse_bytestring(labels: Array<string>): Result<DTCellArray, ParseError> {
    const r_lbracket = this.consume_char_token_then_advance(CharTokenKind.LBracket);
    if (Result.is_err(r_lbracket)) { return r_lbracket; }

    const elements = new Array<CellArrayElement>;
    while (!this.token_stream.done && (this.token_stream.current.kind !== TokenKind.Char
      || this.token_stream.current.value !== CharTokenKind.RBracket)
    ) {

      const element_labels = this.parse_labels();

      const current = this.token_stream.current;
      if (current.kind !== TokenKind.Identifier && current.kind !== TokenKind.Number) {
        return Result.Err({
          message: "Unexpected token within bytestring",
          found: current
        });
      }

      if (current.value.startsWith("0x") || current.value.startsWith("0X")) {
        return Result.Err({
          message: "Hex-prefixed numbers (0x...) are not valid in bytestrings; write bare hex digits without the 0x prefix",
          found: current
        });
      }

      if (current.value.length % 2 !== 0) {
        return Result.Err({
          message: "Bytes can be represented without space, but the number of hex digits must be even",
          found: current
        });
      }

      const bytes = current.value.match(/.{1,2}/g) || [];
      elements.push({ labels: element_labels, kind: "number", value: BigInt("0x" + bytes[0]), repr: "hex" });
      for (let index = 1; index < bytes.length; ++index) {
        elements.push({ labels: [], kind: "number", value: BigInt("0x" + bytes[index]), repr: "hex" });
      }

      this.token_stream.advance();
    }

    const r_rbracket = this.consume_char_token_then_advance(CharTokenKind.RBracket);
    if (Result.is_err(r_rbracket)) { return r_rbracket; }

    return Result.Ok({ labels, kind: "array", bit_width: Bits.b8, elements });
  }

  private parse_cell_array(labels: Array<string>, bit_width: Bits = Bits.b32): Result<DTCellArray, ParseError> {
    const r_langle = this.consume_char_token_then_advance(CharTokenKind.LAngle);
    if (Result.is_err(r_langle)) { return r_langle; }

    const elements = new Array<CellArrayElement>;
    while (!this.token_stream.done && (this.token_stream.current.kind !== TokenKind.Char
      || this.token_stream.current.value !== CharTokenKind.RAngle)
    ) {

      const labels = this.parse_labels();

      const current = this.token_stream.current;

      if (current.kind === TokenKind.LabelReference) {
        elements.push({ labels, kind: "label", name: current.value });
        this.token_stream.advance();
        continue;
      }

      if (current.kind === TokenKind.PathReference) {
        elements.push({ labels, kind: "path", path: current.value });
        this.token_stream.advance();
        continue;
      }

      if (current.kind === TokenKind.Number) {
        elements.push({
          labels, kind: "number", value: BigInt(current.value),
          repr: current.value.startsWith("0x") ? "hex" : "dec"
        });
        this.token_stream.advance();
        continue;
      }

      if (current.kind === TokenKind.Char && current.value === CharTokenKind.LParen) {
        const r_expr = this.parse_expression();
        if (Result.is_err(r_expr)) { return r_expr; }
        elements.push({ labels, kind: "expression", value: r_expr.value });
        continue;
      }

      return Result.Err({
        message: "Failed to parse cell array component. Expecting a reference, number or expression",
        found: current
      });
    }

    const r_rangle = this.consume_char_token_then_advance(CharTokenKind.RAngle);
    if (Result.is_err(r_rangle)) { return r_rangle; }

    return Result.Ok({ labels, kind: "array", bit_width, elements });
  }

  private parse_expression(): Result<string, ParseError> {
    let expression = "";
    let open_parentheses = 0;

    do {
      const current = this.token_stream.current;
      if (current.kind === TokenKind.Char) {
        if (current.value === CharTokenKind.LParen) {
          ++open_parentheses;
        } else if (current.value === CharTokenKind.RParen) {
          --open_parentheses;
        }
      }
      expression += current.value;
      this.token_stream.advance();
    } while (!this.token_stream.done && open_parentheses > 0);

    if (open_parentheses !== 0) {
      return Result.Err({ message: "Expression's open parentheses number doesn't match close ones" });
    }

    return Result.Ok(expression);
  }

  private parse_labels(): Array<string> {
    const labels = [];
    while (!this.token_stream.done && this.token_stream.current.kind === TokenKind.Label) {
      labels.push(this.token_stream.current.value);
      this.token_stream.advance();
    }
    return labels;
  }

  private consume_directive_token_then_advance(directive: DTDirective): Result<DirectiveToken & WithRowAndCol, ParseError> {
    if (this.token_stream.done) {
      return Result.Err({
        message: "Unexpected end of tokens, expected directive",
        expected: { kind: TokenKind.Directive, value: directive }
      });
    }
    const current = this.token_stream.current;
    if (current.kind !== TokenKind.Directive) {
      return Result.Err({
        message: "Failed to consume directive token",
        found: current,
        expected: { kind: TokenKind.Directive, value: directive }
      });
    }

    if (current.value !== directive) {
      return Result.Err({
        message: "Failed to consume specific directive token",
        found: current,
        expected: { kind: TokenKind.Directive, value: directive }
      });
    }

    this.token_stream.advance();
    return Result.Ok(current);
  }

  private consume_char_token_then_advance(char_kind: CharTokenKind): Result<CharToken & WithRowAndCol, ParseError> {
    if (this.token_stream.done) {
      return Result.Err({
        message: "Unexpected end of tokens, expected char token",
        expected: { kind: TokenKind.Char, value: char_kind }
      });
    }
    const current = this.token_stream.current;
    if (current.kind !== TokenKind.Char) {
      return Result.Err({
        message: "Failed to consume char token",
        found: current,
        expected: { kind: TokenKind.Char, value: char_kind }
      });
    }

    if (current.value !== char_kind) {
      return Result.Err({
        message: "Failed to consume specific char token",
        found: current,
        expected: { kind: TokenKind.Char, value: char_kind }
      });
    }

    this.token_stream.advance();
    return Result.Ok(current);
  }

  private consume_number_token_then_advance(): Result<string, ParseError> {
    if (this.token_stream.done) {
      return Result.Err({ message: "Unexpected end of tokens, expected number" });
    }
    const current = this.token_stream.current;
    if (current.kind !== TokenKind.Number) {
      return Result.Err({
        message: "Failed to consume number token",
        found: current
      });
    }

    this.token_stream.advance();
    return Result.Ok(current.value);
  }

  private find_node_by_current_reference(root: DeletableNode): Result<DeletableNode, ParseError> {
    if (this.token_stream.done) {
      return Result.Err({ message: "Unexpected end of tokens, expected node reference" });
    }
    const current = this.token_stream.current;
    if (current.kind === TokenKind.Char) {
      if (current.value === CharTokenKind.Slash) {
        return Result.Ok(root);
      }
      return Result.Err({ message: "Expected / or label/path reference" });
    }

    if (current.kind !== TokenKind.LabelReference && current.kind !== TokenKind.PathReference) {
      return Result.Err({
        message: "Invalid token, expected label or path reference",
        found: current
      });
    }

    if (current.kind === TokenKind.LabelReference) {
      const search_result = find_node_by_label(root, current.value);
      if (Option.is_none(search_result)) {
        return Result.Err({ message: `Invalid reference`, found: current });
      }
      return Result.Ok(search_result.value);
    }

    const r_path = find_node_by_path(root, current.value);
    if (Result.is_err(r_path)) { return r_path; }

    if (Option.is_none(r_path.value)) {
      return Result.Err({ message: `Invalid reference`, found: current });
    }
    return Result.Ok(r_path.value.value);
  }

  private parse_metadata(): Result<DTMetadata | undefined, ParseError> {
    while (!this.comments_stream.done) {
      const current = this.comments_stream.current;
      if (current.kind === TokenKind.CommentBlock && current.value.startsWith(DTS_METADATA_HEADER)) {
        try {
          const metadata = parse_yaml_string(current.value.replace(DTS_METADATA_HEADER, ""));
          return Result.Ok(isDTMetadata(metadata) ? metadata : undefined);
        } catch (error) {
          return Result.Err({ message: `Failed to parse metadata, unexpected error: ${error}` });
        }
      }
      this.comments_stream.advance();
    }

    // eslint-disable-next-line unicorn/no-useless-undefined
    return Result.Ok(undefined);
  }
}

// Public utilities

export function parse_dts(raw: string): Result<DTSParseResult, ParseError> {
  const lexing_result = lex(raw);
  if (Result.is_err(lexing_result)) {
    return Result.Err({ message: `Lexing failed with: ${lexing_result.error.message}` });
  }

  const { tokens, comments } = lexing_result.value;
  const parser = new Parser(tokens, comments);

  return parser.parse_dts();
}

export function parse_dto(raw: string): Result<DTOParseResult, ParseError> {
  const lexing_result = lex(raw);
  if (Result.is_err(lexing_result)) {
    return Result.Err({ message: `Lexing failed with: ${lexing_result.error.message}` });
  }

  const { tokens, comments } = lexing_result.value;
  const parser = new Parser(tokens, comments);

  return parser.parse_dto();
}

// Private utilities

function find_node_by_label(root: DeletableNode, label: string): Option<DeletableNode> {
  if (root.labels.includes(label)) {
    return Option.Some(root);
  }

  return root.children
    .map(child => find_node_by_label(child, label))
    // eslint-disable-next-line unicorn/no-array-callback-reference
    .find(Option.is_some) ?? Option.None();
}

function find_node_by_path(root: DeletableNode, path: string): Result<Option<DeletableNode>, ParseError> {
  if (path.length === 0 || !path.startsWith("/")) {
    return Result.Err({ message: `Invalid path reference: ${path}` });
  }

  if (path === "/") {
    return Result.Ok(Option.Some(root));
  }

  const search_result = path
    .split("/")
    .slice(1)
    // eslint-disable-next-line unicorn/no-array-reduce
    .reduce<DeletableNode | undefined>((node, part) => {
      const [name, unit_addr] = split_node_identifier(part);
      return node?.children.find(c => c.name === name && c.unit_addr === unit_addr);
    }, root);

  return Result.Ok(search_result
    ? Option.Some(search_result)
    : Option.None());
}

function strip_node({ deleted, properties, children, ...rest }: DeletableNode): DTNode {
  return {
    ...rest,
    properties: properties
      .filter(p => p.deleted === false)
      .map(p => strip_property(p)),
    children: children
      .filter(c => c.deleted === false)
      .map(c => strip_node(c)),
  };
}

function strip_property({ deleted, ...rest }: DeletableProperty): DTProperty {
  return rest;
};

function split_node_identifier(identifier: string): [string, string | undefined] {
  const [name, unit_addr] = identifier.split("@");
  return [name, unit_addr];
}
