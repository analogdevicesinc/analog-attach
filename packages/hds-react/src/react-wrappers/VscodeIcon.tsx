import React from "react";
import { createComponent } from "@lit/react";
import { VscodeIcon as WC } from "hds-components";

const VscodeIcon = createComponent({
  tagName: "vscode-icon",
  elementClass: WC,
  react: React,
  displayName: "VscodeIcon",
});

export default VscodeIcon;

