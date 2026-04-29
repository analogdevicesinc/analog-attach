import React from "react";
import { createComponent } from "@lit/react";
import { VscodeOption as WC } from "hds-components";

const VscodeOption = createComponent({
  tagName: "vscode-option",
  elementClass: WC,
  react: React,
  displayName: "VscodeOption",
});

export default VscodeOption;

