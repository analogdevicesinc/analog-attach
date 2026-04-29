import React from "react";
import { createComponent } from "@lit/react";
import { VscodeTree as WC } from "hds-components";

const VscodeTree = createComponent({
  tagName: "vscode-tree",
  elementClass: WC,
  react: React,
  displayName: "VscodeTree",
});

export default VscodeTree;

