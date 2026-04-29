import React from "react";
import { createComponent } from "@lit/react";
import { VscodeMultiSelect as WC } from "hds-components";

const VscodeMultiSelect = createComponent({
  tagName: "vscode-multi-select",
  elementClass: WC,
  react: React,
  displayName: "VscodeMultiSelect",
});

export default VscodeMultiSelect;

