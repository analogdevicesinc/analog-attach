type GenericError = {
    _t: 'generic',
    origin: string,
    msg?: string,
};

type MissingRequired = {
    _t: 'missing_required',
    missing_property: string,
    instance: string[],
    msg?: string,
};

type NumberLimit = {
    _t: 'number_limit',
    failed_property: string[],
    limit: number,
    comparison: "<=" | ">=" | "<" | ">",
    msg?: string
};

type FailedDependency = {
    _t: 'failed_dependency',
    dependent_property: string,
    // Assumption that only 1 to 1 dependencies are used
    // ajv8 treats multiple deps as a string encoding a list with comma separator => probable bug for company specific props
    missing_property: string,
}

// TODO: test how it behaves for pattern properties
export type BindingErrors = GenericError | MissingRequired | NumberLimit | FailedDependency;
