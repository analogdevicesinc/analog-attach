# The entry point of the bundled dt-mk-schema (scripts/bundle-dt-schema.sh).
#
# dt-schema processes each binding on its own (load, meta-schema check,
# fixup) and one after another, which is nearly all of its run time. This
# runs that step for every file on a process pool first, then lets the
# upstream loop take each result in its usual order, so the duplicate '$id'
# warnings, the core schemas and the generated types are dt-schema's own.

import glob
import multiprocessing
import os
import sys

import dtschema.validator as validator
from dtschema.mk_schema import main


def schema_files(schema_paths, core_schema=True):
    """The files dt-schema's process_schemas reads, in its order."""
    files = [path for path in schema_paths if os.path.isfile(path)]
    directories = list(schema_paths)
    if core_schema:
        directories.append(os.path.join(validator.schema_basedir, 'schemas/'))
    for directory in directories:
        if os.path.isdir(directory):
            files += glob.glob(os.path.join(os.path.abspath(directory), "**/*.yaml"), recursive=True)
    return [os.path.abspath(path) for path in files]


def jobs():
    if hasattr(os, "process_cpu_count"):
        return os.process_cpu_count() or 1
    return os.cpu_count() or 1


def process_in_parallel(upstream_process_schemas):
    def process_schemas(schema_paths, core_schema=True):
        files = schema_files(schema_paths, core_schema)
        # fork shares the loaded dtschema with the workers; elsewhere the default start method.
        context = multiprocessing.get_context("fork" if sys.platform == "linux" else None)
        with context.Pool(jobs()) as pool:
            processed = dict(zip(files, pool.map(validator.process_schema, files, chunksize=16)))
        upstream_process_schema = validator.process_schema
        validator.process_schema = lambda filename: processed[filename] if filename in processed else upstream_process_schema(filename)
        try:
            return upstream_process_schemas(schema_paths, core_schema)
        finally:
            validator.process_schema = upstream_process_schema
    return process_schemas


if __name__ == "__main__":
    multiprocessing.freeze_support()
    validator.process_schemas = process_in_parallel(validator.process_schemas)
    sys.exit(main())
