import React from "react";
import { createComponent } from "@lit/react";
import { VscodeSingleSelect as WC } from "hds-components";

const VscodeSingleSelect = createComponent({
  tagName: "vscode-single-select",
  elementClass: WC,
  react: React,
  displayName: "VscodeSingleSelect",
  events: {
    onChange: "change",
    onInput: "input",
  },
});

export default VscodeSingleSelect;

