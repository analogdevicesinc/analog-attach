import React from "react";
import { createComponent } from "@lit/react";
import { VscodeContextMenu as WC } from "hds-components";

const VscodeContextMenu = createComponent({
  tagName: "vscode-context-menu",
  elementClass: WC,
  react: React,
  displayName: "VscodeContextMenu",
});

export default VscodeContextMenu;

