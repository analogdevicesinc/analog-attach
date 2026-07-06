import { run } from "@stricli/core";
import { app } from "../app";

// TODO: For the install process and maybe later to add an option to create the global settings file
run(app, process.argv.slice(2), { process });
