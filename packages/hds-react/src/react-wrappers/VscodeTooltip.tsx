import React from "react";
import { createComponent } from "@lit/react";
import { VscodeTooltip as WC } from "hds-components";

const VscodeTooltip = createComponent({
  tagName: "vscode-tooltip",
  elementClass: WC,
  react: React,
  displayName: "VscodeTooltip",
});

export default VscodeTooltip;

