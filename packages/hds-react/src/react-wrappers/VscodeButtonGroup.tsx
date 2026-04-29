import React from "react";
import { createComponent } from "@lit/react";
import { VscodeButtonGroup as WC } from "hds-components";

const VscodeButtonGroup = createComponent({
  tagName: "vscode-button-group",
  elementClass: WC,
  react: React,
  displayName: "VscodeButtonGroup",
});

export default VscodeButtonGroup;

