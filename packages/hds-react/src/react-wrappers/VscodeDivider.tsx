import React from "react";
import { createComponent } from "@lit/react";
import { VscodeDivider as WC } from "hds-components";

const VscodeDivider = createComponent({
  tagName: "vscode-divider",
  elementClass: WC,
  react: React,
  displayName: "VscodeDivider",
});

export default VscodeDivider;

