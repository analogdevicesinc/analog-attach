import React from "react";
import { createComponent } from "@lit/react";
import { VscodeTableRow as WC } from "hds-components";

const VscodeTableRow = createComponent({
  tagName: "vscode-table-row",
  elementClass: WC,
  react: React,
  displayName: "VscodeTableRow",
});

export default VscodeTableRow;

