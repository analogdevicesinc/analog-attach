import type { CommonResponse } from "./types";
import { bigIntReplacer } from "../utilities";

export function respond(response: object): void {
    console.log(JSON.stringify(response, bigIntReplacer));
    process.exitCode = 0;
}

export function respond_fail(response: CommonResponse): void {
    console.log(JSON.stringify(response, bigIntReplacer));
    process.exitCode = 0;
}

export function input_error(message: string): void {
    console.error(message);
    process.exitCode = 2;
}

export function diagnostic(message: string): void {
    console.error(message);
}
