import React from "react";
import { createComponent } from "@lit/react";
import { VscodeSplitLayout as WC } from "hds-components";

const VscodeSplitLayout = createComponent({
  tagName: "vscode-split-layout",
  elementClass: WC,
  react: React,
  displayName: "VscodeSplitLayout",
});

export default VscodeSplitLayout;

