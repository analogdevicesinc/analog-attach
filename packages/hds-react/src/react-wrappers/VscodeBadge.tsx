import React from "react";
import { createComponent } from "@lit/react";
import { VscodeBadge as WC } from "hds-components";

const VscodeBadge = createComponent({
  tagName: "vscode-badge",
  elementClass: WC,
  react: React,
  displayName: "VscodeBadge",
});

export default VscodeBadge;

