import React from "react";
import { createComponent } from "@lit/react";
import { VscodeTreeItem as WC } from "hds-components";

const VscodeTreeItem = createComponent({
  tagName: "vscode-tree-item",
  elementClass: WC,
  react: React,
  displayName: "VscodeTreeItem",
});

export default VscodeTreeItem;

