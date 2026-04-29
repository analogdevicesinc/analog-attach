import React from "react";
import { createComponent } from "@lit/react";
import { VscodeTextfield as WC } from "hds-components";

const VscodeTextfield = createComponent({
  tagName: "vscode-textfield",
  elementClass: WC,
  react: React,
  displayName: "VscodeTextfield",
});

export default VscodeTextfield;

