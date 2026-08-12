import { DTNode, DTProperty } from "./parser";
import { AddCallOnce } from "./TypeUtilities";

interface INodeNameBuilder {
    with_name: (name: string) => INodeBuilder;
}

export interface INodeBuilderBase {
    build: () => DTNode;
}

interface INodeBuilderCallOnce {
    with_label: (label: string | string[]) => void;
    with_unit_address: (unit_address: string | undefined) => void;
    with_properties: (properties: DTProperty | DTProperty[] | undefined) => void;
    with_children: (children: INodeBuilderBase | INodeBuilderBase[] | undefined) => void;
}

type INodeBuilder = AddCallOnce<INodeBuilderBase, INodeBuilderCallOnce>;

export class NodeBuilder implements INodeNameBuilder, INodeBuilder {

    private node: DTNode = {
        labels: [],
        name: "",
        unit_addr: undefined,
        properties: [],
        children: [],
    };

    private constructor() { }

    static new(): INodeNameBuilder {
        return new NodeBuilder;
    }

    build(): DTNode {
        return this.node;
    }

    with_label(label: string | string[]): INodeBuilder {
        this.node.labels = Array.isArray(label) ? label : [label];
        return this;
    }

    with_name(name: string): INodeBuilder {
        this.node.name = name;
        return this;
    }

    with_unit_address(unit_address: string | undefined): INodeBuilder {
        if (unit_address !== undefined) {
            this.node.unit_addr = unit_address;
        }
        return this;
    }

    with_properties(properties: DTProperty | DTProperty[] | undefined): INodeBuilder {
        if (properties === undefined) {
            return this;
        }

        this.node.properties = Array.isArray(properties) ? properties : [properties];
        return this;
    }

    with_children(children: INodeBuilderBase | INodeBuilderBase[] | undefined): INodeBuilder {
        if (children === undefined) {
            return this;
        }

        const childArray = Array.isArray(children) ? children : [children];
        this.node.children = childArray.map(child => child.build());
        return this;
    }
}