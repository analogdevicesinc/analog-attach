import React from "react";
import { createComponent } from "@lit/react";
import { VscodeRadioGroup as WC } from "hds-components";

const VscodeRadioGroup = createComponent({
  tagName: "vscode-radio-group",
  elementClass: WC,
  react: React,
  displayName: "VscodeRadioGroup",
});

export default VscodeRadioGroup;

