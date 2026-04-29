import React from "react";
import { createComponent } from "@lit/react";
import { VscodeTableBody as WC } from "hds-components";

const VscodeTableBody = createComponent({
  tagName: "vscode-table-body",
  elementClass: WC,
  react: React,
  displayName: "VscodeTableBody",
});

export default VscodeTableBody;

