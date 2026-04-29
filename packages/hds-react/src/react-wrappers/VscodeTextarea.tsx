import React from "react";
import { createComponent } from "@lit/react";
import { VscodeTextarea as WC } from "hds-components";

const VscodeTextarea = createComponent({
  tagName: "vscode-textarea",
  elementClass: WC,
  react: React,
  displayName: "VscodeTextarea",
});

export default VscodeTextarea;

