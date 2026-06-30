# Schema Generator

Tool to generate device/platform YAML schemas from no-OS header files.

## Purpose

Schemas should be **fully explicit** with no hidden derivation rules. Instead of inferring values at runtime (init function names, descriptor types, parameter passing conventions), the generator extracts everything from the header once and outputs a complete schema.

## Device Detection

A schema is recognized as a device if it has ALL of these fields:
- `$init_function` - the init function name
- `$remove_function` - the remove/cleanup function name  
- `$descriptor` - the device descriptor type
- `$header` - path to the device header
- `$init_by_pointer` - whether init takes param by pointer or value

Helper structs (like `ad7124_channel_map`) don't have these fields and are not treated as devices.

## Planned Features

Given a no-OS header file, the generator will:

1. **Parse struct definitions** - extract `foo_init_param` fields, types, and comments
2. **Extract init function signature** - determine:
   - Function name (`foo_init` vs `foo_setup`)
   - Descriptor type (`foo_dev` vs `foo_desc`)
   - Parameter passing (`*init_param` pointer vs `init_param` value)
3. **Extract remove function** - find matching `foo_remove` signature
4. **Collect includes** - walk `#include` directives for dependencies
5. **Output complete YAML** - all fields explicit, ready for review/edit

## Example Usage (planned)

```bash
attach generate-schema drivers/accel/adxl355/adxl355.h --output devices/adi,adxl355.yaml
```

## Schema Fields

All device schemas should explicitly include:

```yaml
$id: "devices/adi,foo.yaml"
$type: struct
$symbol: foo_init_param
$header: "drivers/category/foo/foo.h"
$init_function: foo_init
$remove_function: foo_remove
$descriptor: foo_dev
$init_by_pointer: true   # or false for by-value
$sources:
  noos:
    - "drivers/category/foo/foo.c"
```

No field should be "guessed" at codegen time.
