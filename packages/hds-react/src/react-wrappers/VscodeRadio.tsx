import React from "react";
import { createComponent } from "@lit/react";
import { VscodeRadio as WC } from "hds-components";

const VscodeRadio = createComponent({
  tagName: "vscode-radio",
  elementClass: WC,
  react: React,
  displayName: "VscodeRadio",
});

export default VscodeRadio;

