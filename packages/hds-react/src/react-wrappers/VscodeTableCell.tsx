import React from "react";
import { createComponent } from "@lit/react";
import { VscodeTableCell as WC } from "hds-components";

const VscodeTableCell = createComponent({
  tagName: "vscode-table-cell",
  elementClass: WC,
  react: React,
  displayName: "VscodeTableCell",
});

export default VscodeTableCell;

