import React from "react";
import { createComponent } from "@lit/react";
import { VscodeScrollable as WC } from "hds-components";

const VscodeScrollable = createComponent({
  tagName: "vscode-scrollable",
  elementClass: WC,
  react: React,
  displayName: "VscodeScrollable",
});

export default VscodeScrollable;

