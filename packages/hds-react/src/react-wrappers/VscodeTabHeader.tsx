import React from "react";
import { createComponent } from "@lit/react";
import { VscodeTabHeader as WC } from "hds-components";

const VscodeTabHeader = createComponent({
  tagName: "vscode-tab-header",
  elementClass: WC,
  react: React,
  displayName: "VscodeTabHeader",
});

export default VscodeTabHeader;

