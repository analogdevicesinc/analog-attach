import React from "react";
import { createComponent } from "@lit/react";
import { VscodeTableHeader as WC } from "hds-components";

const VscodeTableHeader = createComponent({
  tagName: "vscode-table-header",
  elementClass: WC,
  react: React,
  displayName: "VscodeTableHeader",
});

export default VscodeTableHeader;

