import React from "react";
import { createComponent } from "@lit/react";
import { VscodeTabs as WC } from "hds-components";

const VscodeTabs = createComponent({
  tagName: "vscode-tabs",
  elementClass: WC,
  react: React,
  displayName: "VscodeTabs",
});

export default VscodeTabs;

