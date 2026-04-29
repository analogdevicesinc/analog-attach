import React from "react";
import { createComponent } from "@lit/react";
import { VscodeFormGroup as WC } from "hds-components";

const VscodeFormGroup = createComponent({
  tagName: "vscode-form-group",
  elementClass: WC,
  react: React,
  displayName: "VscodeFormGroup",
});

export default VscodeFormGroup;

