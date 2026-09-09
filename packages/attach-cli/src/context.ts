export interface LocalContext {
    readonly json: boolean;
}

export function buildContext(json: boolean): LocalContext {
    return { json };
}
