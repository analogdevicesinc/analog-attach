import React from "react";
import { createComponent } from "@lit/react";
import { VscodeToolbarButton as WC } from "hds-components";

const VscodeToolbarButton = createComponent({
  tagName: "vscode-toolbar-button",
  elementClass: WC,
  react: React,
  displayName: "VscodeToolbarButton",
});

export default VscodeToolbarButton;

