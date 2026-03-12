# AnalogAttach Message API Documentation

## Overview

This document defines the message API for communication between the Analog Attach Visual Studio Code Extension frontend and backend. The API is used by both the Plug and Play editor and the Advanced Device Tree Editor.

## Table of Contents

- [Overview](#overview)
- [Message Structure](#message-structure)
- [Error Handling](#error-handling)
  - [Configuration Item Errors](#configuration-item-errors)
- [API Commands](#api-commands)
  - [1. Session Management](#1-session-management)
    - [Get Attached Devices State](#get-attached-devices-state)
  - [2. Device Catalog Management](#2-device-catalog-management)
    - [Get Available Devices](#get-available-devices)
  - [3. Device Management](#3-device-management)
    - [Get Potential Parent Nodes](#get-potential-parent-nodes)
    - [Set Parent Node](#set-parent-node)
    - [Set Node Active](#set-node-active)
    - [Delete Device](#delete-device)
  - [4. Configuration Management](#4-configuration-management)
    - [Get Device Configuration](#get-device-configuration)
    - [Update Device Configuration](#update-device-configuration)
  - [5. Tree View](#5-tree-view)
    - [Get Device Tree](#get-device-tree)
  - [6. Settings Management](#6-settings-management)
    - [Get Setting](#get-setting)
    - [Update Setting](#update-setting)
  - [7. Event Notifications](#7-event-notifications)
    - [File Changed Notification](#file-changed-notification)
  - [8. Navigation Notifications](#8-navigation-notifications)
    - [Navigate Back](#navigate-back)
    - [Navigate Forward](#navigate-forward)
- [Data Types](#data-types)
  - [Device](#device)
  - [ParentNode](#parentnode)
  - [Attached Device](#attached-device)
  - [Device Channel Summary](#device-channel-summary)
  - [Validation Types](#validation-types)
    - [Numeric Range Validation](#numeric-range-validation)
    - [Dropdown Validation](#dropdown-validation)
    - [Array Validation](#array-validation)
      - [Array Number Validation](#array-number-validation)
      - [Array String Validation](#array-string-validation)
      - [Array Hyperlink Validation](#array-hyperlink-validation)
      - [Array Mixed Type Validation](#array-mixed-type-validation)
    - [Matrix Validation](#matrix-validation)
  - [FormElement Types](#formelement-types)
    - [Flag](#flag)
    - [FormArray](#formarray)
    - [FormMatrix](#formmatrix)
    - [Generic](#generic)
    - [FormObject](#formobject)
    - [Custom Properties](#custom-properties)
  - [Device Configuration Form Object](#device-configuration-form-object)
  - [Error (Configuration Item)](#error-configuration-item)

## Message Structure

All messages follow a standardized JSON structure for consistent communication:

```json
{
    "id": "string",           // Unique message identifier for request-response correlation
    "type": "request|response|notification",
    "timestamp": "ISO8601",   // When the message was created
    "command": "string",      // Command/response type identifier
    "payload": {}             // Command-specific data
}
```

## Error Handling

All response messages include a `status` field indicating the operation result:
- `success`: Operation completed successfully
- `error`: Operation failed
 
Error responses include an `error` object with:
- `code`: Machine-readable error code from the ErrorCodes enum
- `message`: Human-readable error message
- `details`: Optional additional error context

Example error structure:
```json
{
    "error": {
        "code": "INVALID_DEVICE_ID",
        "message": "The provided device ID does not exist.",
        "details": "Make sure you are using the official devices catalog."
    }
}
```

### Configuration Item Errors

In addition to top-level message errors, individual configuration items (form elements) can expose validation errors.

Each form element object MAY include an `error` field:

```json
{
    "key": "clock-names",
    "validationType":
    {
        "list": ["mclk", "adc_clk", "sync_clk"]
    },
    "error": {
        "code": "UNSET_PROPERTY",
        "message": "This is a required property that needs to be set.",
    }
}
```

Rules:
- If `error` is absent the property is considered valid.

## API Commands

### 1. Session Management

#### Get Attached Devices State
Retrieves the current state of all attached devices in the session.

**Frontend Request:**
- **Command:** `session.getAttachedDevicesState`
- **Payload:** `{}` (empty)

**Backend Response:**
- **Status:** `success | error`
- **Payload:**
```json
{
    "data": [
        {
            "type": "AttachedDeviceState",
            "compatible": "string",         // e.g., "adi,ad7124-8"
            "deviceUID": "string",          // UUID of the device instance
            "name": "string",               // Device name
            "alias": "string",              // [OPTIONAL] Custom alias for the device
            "active": "boolean",            // [OPTIONAL] Whether the device is active
            "isExpanded": "boolean",        // [OPTIONAL] UI state for tree expansion
            "hasErrors": "boolean",         // Whether the device configuration has errors
            "hasChannels": "boolean",       // Whether the device has channel support
            "parentNode": {
                "uuid": "string",           // UUID of the parent node
                "name": "string"            // Parent node name
            },
            "maxChannels": "number",        // [OPTIONAL] Maximum number of channels supported
            "channels": [
                {
                    "name": "string",       // Channel name
                    "alias": "string",      // Channel alias
                    "hasErrors": "boolean"  // Whether the channel has errors
                }
            ]
        }
    ]
}
```

### 2. Device Catalog Management

#### Get Available Devices
Retrieves the list of all available devices from the catalog.

**Frontend Request:**
- **Command:** `catalog.getDevices`
- **Payload:** `{}` (empty)

**Backend Response:**
- **Status:** `success | error`
- **Payload:**
```json
{
    "devices": [
        {
            "deviceId": "string",      // e.g., "adi,ad7124-8"
            "name": "string",          // e.g., "AD7124-8 ADC"
            "description": "string",   // e.g., "24-bit Sigma-Delta ADC with 8 channels"
            "group": "string"          // Optional; e.g., "adc" when categorized
        }
    ]
}
```

### 3. Device Management

#### Get Potential Parent Nodes
Retrieves the list of potential parent nodes where a specific device can be attached.

**Frontend Request:**
- **Command:** `device.getPotentialParentNodes`
- **Payload:**
```json
{
    "deviceId": "string"       // Device identifier (e.g., "adi,ad7124-8")
}
```

**Backend Response:**
- **Status:** `success | error`
- **Payload:**
```json
{
    "potentialParentNodes": [
        {
            "uuid": "string",    // UUID of the parent node
            "name": "string"     // Parent node name (e.g., "spi0")
        }
    ]
}
```

#### Set Parent Node
Attaches a device to a specified parent node.

**Frontend Request:**
- **Command:** `device.setParentNode`
- **Payload:**
```json
{
    "deviceId": "string",      // Device identifier (e.g., "adi,ad7124-8")
    "parentNode": {            // Parent node object
        "uuid": "string",      // UUID of the parent node
        "name": "string"       // Parent node name
    }
}
```

**Backend Response:**
- **Status:** `success | error`
- **Payload:**
```json
{
    "deviceUID": "string"      // Unique identifier for the attached device instance (UUID)
}
```

#### Set Node Active
Sets the active state of a device node.

**Frontend Request:**
- **Command:** `device.setNodeActive`
- **Payload:**
```json
{
    "uuid": "string",          // Device UID (UUID)
    "active": "boolean"        // New active state
}
```

**Backend Response:**
- **Status:** `success | error`
- **Payload:**
```json
{
    "uuid": "string",          // Device UID (UUID)
    "active": "boolean"        // Confirmed active state
}
```

#### Delete Device
Removes an attached device from the device tree.

**Frontend Request:**
- **Command:** `device.delete`
- **Payload:**
```json
{
    "deviceUID": "string"      // Unique identifier of the device instance to delete
}
```

**Backend Response:**
- **Status:** `success | error`
- **Payload:**
```json
{
    "deviceUID": "string"      // Confirmation of the deleted device UID
}
```

### 4. Configuration Management

#### Get Device Configuration

Retrieves the configuration template for an attached device, including available options, validation rules, and current configuration state.

**Device Configuration Structure Overview:**

The device configuration uses a unified FormElement discriminated union approach where all configuration elements (including channels) are treated as form elements with specific types.

```
deviceConfiguration
├── Device-Specific Properties
│   ├── alias (optional)
│   ├── active (optional)
│   └── maxChannels (optional)
│
└── config (FormObject)
    └── channelRegexes (array, optional)
    └── FormElement[] (Array of form elements)
        ├── Flag (for boolean properties)
        │   ├── key (property identifier)
        │   ├── required
        │   ├── setValue (current boolean value)
        │   ├── defaultValue (optional)
        │   └── error (optional)
        │
        ├── FormArray (for array properties)
        │   ├── key (property identifier)
        │   ├── required
        │   ├── setValue (current array value)
        │   ├── defaultValue (optional)
        │   ├── validationType (array validation)
        │   └── error (optional)
        │
        ├── FormMatrix (for matrix properties - array of arrays)
        │   ├── key (property identifier)
        │   ├── required
        │   ├── setValue (current matrix value)
        │   ├── defaultValue (optional)
        │   ├── validationType (matrix validation)
        │   └── error (optional)
        │
        ├── Generic (for basic input elements)
        │   ├── key (property identifier)
        │   ├── inputType (text, number, dropdown, custom, custom-flag)
        │   ├── required
        │   ├── setValue (current value)
        │   ├── defaultValue (optional)
        │   ├── validationType (optional)
        │   └── error (optional)
        │
        └── FormObject
            ├── key (object identifier, e.g., "channel@0")
            ├── required
            └── config
                └── FormElement[] (Array of form elements)
```

**Frontend Request:**

- **Command:** `device.getConfiguration`
- **Payload:**

```json
{
    "deviceUID": "string"      // Unique identifier of the device instance
}
```

**Backend Response:**

- **Status:** `success | error`
- **Payload:**

```json
{
    "deviceConfiguration": {
        "config": {                                   // DeviceConfigurationFormObject
            "type": "DeviceConfigurationFormObject",
            "alias": "",                              // [OPTIONAL] Device alias
            "active": true,                           // [OPTIONAL] Device active state (used for initial read only)
            "parentNode": {                           // Parent node information (NOTE: if different from current parent, backend will move the node first)
                "uuid": "041a0470-bf3d-4596-aca9-fb5b62e94174",  // UUID of the parent node
                "name": "spi"                         // Parent node name
            },
            "channelRegexes": ["^channel@([0-9]|1[0-5])$"],  // [OPTIONAL] Regex patterns for channel names
            "generatedChannelRegexEntries": [         // [OPTIONAL] Pre-generated channel name options for dropdown
                "channel@0", "channel@1", "channel@2", "channel@3",
                "channel@4", "channel@5", "channel@6", "channel@7"
            ],
            "genericErrors": [],                      // [OPTIONAL] Global configuration errors not tied to specific form elements
            "config": [                               // Array of FormElement discriminated union
                {
                    "type": "FormArray",              // Note: 'compatible' is FormArray, not Generic
                    "key": "compatible",
                    "required": true,
                    "setValue": ["adi,ad7124-8"],
                    "validationType": {
                        "type": "ArrayStringValidation",
                        "minLength": 1,
                        "maxLength": 1,
                        "enum": ["adi,ad7124-4", "adi,ad7124-8"],
                        "enumType": "string"
                    }
                },
                {
                    "type": "FormMatrix",             // Note: 'reg' is FormMatrix (array of arrays)
                    "key": "reg",
                    "required": true,
                    "description": "SPI chip select number for the device",
                    "setValue": [["0"]],              // Matrix format: [[value]]
                    "validationType": {
                        "minRows": 1,
                        "maxRows": 1,
                        "definition": {
                            "type": "ArrayNumberValidation",
                            "minLength": 1,
                            "maxLength": 1,
                            "minValue": 0,
                            "maxValue": 256
                        }
                    }
                },
                {
                    "type": "FormMatrix",
                    "key": "clocks",
                    "required": true,
                    "validationType": {
                        "minRows": 1,
                        "maxRows": 1,
                        "definition": {
                            "type": "ArrayMixedTypeValidation",
                            "minPrefixItems": 1,
                            "maxPrefixItems": 1,
                            "prefixItems": [
                                {
                                    "type": "StringList",
                                    "enum": ["clk_osc", "clk_usb", "clk_27MHz", "clk_108MHz", "cam1_clk", "cam0_clk"],
                                    "enumType": "phandle"
                                }
                            ]
                        }
                    },
                    "error": {                        // Example of validation error
                        "code": "missing_required",
                        "message": "must have required property 'clocks'",
                        "details": "Missing required property clocks"
                    }
                },
                {
                    "type": "FormArray",
                    "key": "clock-names",
                    "required": true,
                    "defaultValue": ["mclk"],
                    "validationType": {
                        "type": "ArrayStringValidation",
                        "minLength": 1,
                        "maxLength": 1,
                        "enum": ["mclk"],
                        "enumType": "string"
                    },
                    "error": {
                        "code": "missing_required",
                        "message": "must have required property 'clock-names'",
                        "details": "Missing required property clock-names"
                    }
                },
                {
                    "type": "FormArray",
                    "key": "interrupts",
                    "required": true,
                    "description": "IRQ line for the ADC",
                    "validationType": {
                        "type": "ArrayStringValidation",
                        "minLength": 1,
                        "maxLength": 1
                    },
                    "error": {
                        "code": "missing_required",
                        "message": "must have required property 'interrupts'",
                        "details": "Missing required property interrupts"
                    }
                },
                {
                    "type": "FormArray",
                    "key": "interrupt-parent",
                    "required": false,
                    "validationType": {
                        "type": "ArrayHyperlinkValidation",
                        "minLength": 1,
                        "maxLength": 1,
                        "enum": [
                            {"type": "HyperlinkItem", "name": "gpio", "gotoUID": "d2c2cee1-9125-400b-aa4b-8f80341d6c91"},
                            {"type": "HyperlinkItem", "name": "gicv2", "gotoUID": "65ae6687-90f0-475b-b39e-214fdeb2e202"},
                            {"type": "HyperlinkItem", "name": "aon_intr", "gotoUID": "ed523353-643b-43e6-a1b0-cb6e6fda392c"}
                        ]
                    }
                },
                {
                    "type": "Generic",
                    "key": "#address-cells",
                    "inputType": "dropdown",
                    "required": false,
                    "validationType": {
                        "type": "DropdownValidation",
                        "list": [1]
                    }
                },
                {
                    "type": "FormArray",
                    "key": "refin1-supply",
                    "required": false,
                    "validationType": {
                        "type": "ArrayHyperlinkValidation",
                        "minLength": 1,
                        "maxLength": 1,
                        "enum": [
                            {"type": "HyperlinkItem", "name": "sd_vcc_reg", "gotoUID": "413be033-616e-44c3-a75e-0d88d0ccbc26"},
                            {"type": "HyperlinkItem", "name": "vdd_3v3_reg", "gotoUID": "66f42821-104c-4e96-a2b3-7bfaf03ff455"}
                        ]
                    }
                },
                {
                    "type": "Flag",
                    "key": "spi-cs-high",
                    "required": false,
                    "defaultValue": false,
                    "description": "The device requires the chip select active high."
                },
                {
                    "type": "Generic",
                    "key": "spi-max-frequency",
                    "inputType": "number",
                    "required": false,
                    "description": "Maximum SPI clocking speed of the device in Hz.",
                    "defaultValue": null,
                    "validationType": {
                        "type": "NumericRangeValidation",
                        "minValue": 0,
                        "maxValue": 4294967295
                    }
                },
                {
                    "type": "FormArray",
                    "key": "spi-cs-setup-delay-ns",
                    "required": false,
                    "description": "Delay in nanoseconds to be introduced by the controller after CS is asserted.",
                    "validationType": {
                        "type": "ArrayNumberValidation",
                        "minLength": 1,
                        "maxLength": 1,
                        "minValue": "0",              // Note: Large value as string
                        "maxValue": "4294967295"      // Note: Large value as string
                    }
                },
                {
                    "type": "Generic",
                    "key": "spi-rx-bus-width",
                    "inputType": "dropdown",
                    "required": false,
                    "description": "Bus width to the SPI bus used for read transfers.",
                    "defaultValue": 1,
                    "validationType": {
                        "type": "DropdownValidation",
                        "list": [0, 1, 2, 4, 8]
                    }
                },
                {
                    "type": "FormObject",
                    "key": "controller-data",
                    "required": false,
                    "config": [
                        {
                            "type": "Generic",
                            "key": "samsung,spi-feedback-delay",
                            "inputType": "dropdown",
                            "required": false,
                            "description": "The sampling phase shift to be applied on the miso line",
                            "defaultValue": 0,
                            "validationType": {
                                "type": "DropdownValidation",
                                "list": [0, 1, 2, 3]
                            }
                        }
                    ]
                },
                {
                    "type": "FormObject",
                    "key": "channel@0",
                    "required": false,
                    "channelName": "channel0",        // [OPTIONAL] Channel name matching a regex from channelRegexes
                    "alias": "MyChannel",             // [OPTIONAL] Channel alias
                    "config": [
                        {
                            "type": "Flag",
                            "key": "bipolar",
                            "required": false,
                            "setValue": false,
                            "defaultValue": true
                        },
                        {
                            "type": "Generic",
                            "key": "adi,reference-select",
                            "inputType": "dropdown",
                            "required": false,
                            "setValue": 0,
                            "defaultValue": 0,
                            "validationType": {
                                "type": "DropdownValidation",
                                "list": [0, 1, 3]
                            }
                        }
                    ]
                }
            ]
        }
    }
}
```

#### Update Device Configuration

Updates the configuration of an attached device with new property values. The frontend is responsible for sending all properties and their values back to the backend.

**Frontend Request:**

- **Command:** `device.updateConfiguration`
- **Payload:**

```json
{
    "deviceUID": "string",                    // Unique identifier of the device instance (UUID)
    "config": {                               // DeviceConfigurationFormObject with updated values
        "type": "DeviceConfigurationFormObject",
        "alias": "string",                    // [OPTIONAL] Updated device alias
        "active": true,                       // [OPTIONAL] Updated device active state
        "maxChannels": 8,                     // [OPTIONAL] Maximum channels
        "parentNode": {                       // Parent node (if different, backend will move the node)
            "uuid": "string",
            "name": "string"
        },
        "channelRegexes": ["channel@[0-7]"], // [OPTIONAL]
        "config": [                           // Array of FormElement updates
            {
                "type": "Flag",
                "key": "active",
                "setValue": true
            },
            {
                "type": "Generic",
                "key": "compatible",
                "setValue": "adi,ad7124-8"
            },
            {
                "type": "FormArray",
                "key": "reg",
                "setValue": [0]
            },
            {
                "type": "FormMatrix",
                "key": "interrupts",
                "setValue": [
                    [57, "IRQ_TYPE_EDGE_FALLING"],
                    [58, "IRQ_TYPE_EDGE_FALLING"],
                    [59, "IRQ_TYPE_LEVEL_HIGH"]
                ]
            },
            {
                "type": "FormObject",
                "key": "channel@0",
                "channelName": "channel0",
                "alias": "MyChannel",
                "config": [
                    {
                        "type": "Flag",
                        "key": "deviceAttached",
                        "setValue": true
                    },
                    {
                        "type": "Flag",
                        "key": "bipolar",
                        "setValue": false
                    },
                    {
                        "type": "Generic",
                        "key": "adi,reference-select",
                        "setValue": 1
                    }
                ]
            }
        ]
    }
}
```

**Backend Response:**

- **Status:** `success | error`
- **Payload:**

```json
{
    "deviceConfiguration": {
        // Same structure as Get Device Configuration response
        // Returns updated configuration with new values applied
    },
    "deviceUID": "string"      // [OPTIONAL] Device UID confirmation
}
```

### 5. Tree View

#### Get Device Tree

Retrieves the complete device tree structure for the tree view editor.

**Frontend Request:**
- **Command:** `tree.getDeviceTree`
- **Payload:** `{}` (empty)

**Backend Response:**
- **Status:** `success | error`
- **Payload:**
```json
{
    "deviceTree": {
        // FormElement representing the root of the device tree
        // Typically a FormObject with nested device configurations
        "type": "FormObject",
        "key": "root",
        "required": false,
        "deviceUID": "string",   // [OPTIONAL] UUID for tree view elements
        "config": [
            // Nested FormElement array representing the tree structure
        ]
    },
    "isReadOnly": "boolean",     // Whether the tree is read-only
    "isDtso": "boolean"          // Whether this is a device tree overlay (.dtso)
}
```

### 6. Settings Management

#### Get Setting

Retrieves a specific setting value.

**Frontend Request:**
- **Command:** `settings.get`
- **Payload:**
```json
{
    "key": "string"              // Setting key identifier
}
```

**Backend Response:**
- **Status:** `success | error`
- **Payload:**
```json
{
    "key": "string",             // Setting key
    "value": "unknown"           // Setting value (can be any JSON type)
}
```

#### Update Setting

Updates a specific setting value.

**Frontend Request:**
- **Command:** `settings.update`
- **Payload:**
```json
{
    "key": "string",             // Setting key identifier
    "value": "unknown"           // New setting value (can be any JSON type)
}
```

**Backend Response:**
- **Status:** `success | error`
- **Payload:**
```json
{
    "key": "string",             // Setting key
    "value": "unknown"           // Confirmed setting value
}
```

### 7. Event Notifications

#### File Changed Notification

Backend notification sent when the device tree file is modified.

**Backend Notification:**

- **Command:** `event.fileChanged`
- **Payload:**

```json
{
    "filePath": "string",                     // Path to the changed file
    "changeSource": "external | extension"    // Source of the change
}
```

**Change Source Values:**
- `external`: File was modified outside the extension (e.g., direct file edit)
- `extension`: File was modified by the extension itself

### 8. Navigation Notifications

#### Navigate Back

Backend notification sent when the user requests navigation backward.

**Backend Notification:**

- **Command:** `navigation.back`
- **Payload:** `{}` (empty)

#### Navigate Forward

Backend notification sent when the user requests navigation forward.

**Backend Notification:**

- **Command:** `navigation.forward`
- **Payload:** `{}` (empty)

## Data Types

### Device

Represents a device from the catalog:

```json
{
    "deviceId": "string",      // Unique device identifier
    "name": "string",          // Human-readable device name
    "description": "string",   // Device description
    "group": "string"          // Optional device category/group
}
```

### ParentNode

Represents a parent node in the device tree:

```json
{
    "uuid": "string",         // Unique node identifier (UUID)
    "name": "string"          // Node name
}
```

### Attached Device

Represents an attached device instance (AttachedDeviceState):

```json
{
    "type": "AttachedDeviceState",
    "compatible": "string",       // Device compatible string (e.g., "adi,ad7124-8")
    "deviceUID": "string",        // Device unique ID (UUID) generated by backend
    "name": "string",             // Device name
    "alias": "string",            // [OPTIONAL] Custom alias for the device
    "active": "boolean",          // [OPTIONAL] Whether the device is currently active
    "isExpanded": "boolean",      // [OPTIONAL] UI state for tree expansion
    "hasErrors": "boolean",       // Whether the device configuration has errors
    "hasChannels": "boolean",     // Whether the device has channel support
    "parentNode": {
        "uuid": "string",         // Parent node UUID
        "name": "string"          // Parent node name
    },
    "maxChannels": "number",      // [OPTIONAL] Maximum number of channels supported
    "channels": [
        {
            "name": "string",     // Channel name
            "alias": "string",    // Channel alias
            "hasErrors": "boolean" // Whether the channel has errors
        }
    ]
}
```

### Device Channel Summary

Represents a summary of a device channel:

```json
{
    "name": "string",             // Channel name
    "alias": "string",            // Channel alias
    "hasErrors": "boolean"        // Whether the channel configuration has errors
}
```

### Validation Types

These validations are type-specific constraints that can ensure proper user input validation. Each property can include a `validationType` object with type-specific validation rules. All validation types use a discriminated union pattern with a `type` field.

#### Numeric Range Validation

Used for properties that accept numeric input within a specific range (e.g., GPIO numbers, register addresses, frequency values).

**Structure:**
```json
{
    "type": "NumericRangeValidation",
    "minValue": "number | string",  // [OPTIONAL] Minimum allowed value
    "maxValue": "number | string"   // [OPTIONAL] Maximum allowed value
}
```

**Examples:**
- SPI register address: `{"type": "NumericRangeValidation", "minValue": 0}`
- Clock cells: `{"type": "NumericRangeValidation", "minValue": 0, "maxValue": 0}`
- SPI frequency: `{"type": "NumericRangeValidation", "minValue": 1}`
- Large values: `{"type": "NumericRangeValidation", "minValue": 0, "maxValue": "4294967295"}`

**JSON Serialization Notes:**
- Values are internally represented as JavaScript bigint types to support large device tree values (up to 64-bit integers)
- In JSON messages, values are serialized as:
  - **number**: For small values that fit in JavaScript's safe integer range (≤ 2^53-1)
  - **string**: For large values that exceed JavaScript's safe integer range
- Frontend implementations should handle both number and string representations

#### Dropdown Validation

Used for properties where users must select from a predefined set of valid options (e.g., interrupt types, clock sources, compatible strings).

**Structure:**
```json
{
    "type": "DropdownValidation",
    "list": ["item1", "item2"]     // Array of valid options (strings, numbers, or booleans)
}
```

**Examples:**
- Interrupt types: `{"type": "DropdownValidation", "list": ["IRQ_TYPE_NONE", "IRQ_TYPE_EDGE_RISING", "IRQ_TYPE_EDGE_FALLING"]}`
- Reference selection: `{"type": "DropdownValidation", "list": [0, 1, 3]}`
- Compatible strings: `{"type": "DropdownValidation", "list": ["adi,ad7124-8", "adi,ad7124-4"]}`

**Note:** While internally list items may be bigints, they are serialized in JSON as numbers (for small values) or strings (for large values).

#### Array Validation

Array validation types are used for FormArray elements and provide constraints on array length and element values. There are multiple types of array validation based on the element types.

##### Array Number Validation

Used for arrays containing only numeric values.

**Structure:**
```json
{
    "type": "ArrayNumberValidation",
    "minLength": "number",         // [OPTIONAL] Minimum number of array elements
    "maxLength": "number",         // [OPTIONAL] Maximum number of array elements
    "minValue": "number | string", // [OPTIONAL] Minimum value for numeric elements
    "maxValue": "number | string"  // [OPTIONAL] Maximum value for numeric elements
}
```

**Examples:**
- Register address: `{"type": "ArrayNumberValidation", "minLength": 1, "maxLength": 1, "minValue": 0}`
- GPIO pins: `{"type": "ArrayNumberValidation", "minLength": 1, "maxLength": 4, "minValue": 0, "maxValue": 255}`
- Large values: `{"type": "ArrayNumberValidation", "minLength": 1, "maxLength": 1, "minValue": "0", "maxValue": "4294967295"}`

**Note:** Like NumericRangeValidation, `minValue`/`maxValue` are serialized as number for small values and string for large values that exceed JavaScript's safe integer range.

##### Array String Validation

Used for arrays containing string values, optionally with enumerated choices.

**Structure:**
```json
{
    "type": "ArrayStringValidation",
    "minLength": "number",              // [OPTIONAL] Minimum number of array elements
    "maxLength": "number",              // [OPTIONAL] Maximum number of array elements
    "enum": "Array<string | string[]>", // [OPTIONAL] Array of valid string choices (can be nested arrays)
    "enumType": "string"                // [OPTIONAL] Type of enum values: "macro" | "string" | "phandle" | "number"
}
```

**Examples:**
- Clock names: `{"type": "ArrayStringValidation", "minLength": 1, "maxLength": 3, "enum": ["mclk", "adc_clk", "sync_clk"], "enumType": "string"}`
- Phandle references: `{"type": "ArrayStringValidation", "enum": ["&gpio0", "&gpio1"], "enumType": "phandle"}`

**Enum Type Values:**
- `"macro"`: Device tree macro constants (e.g., IRQ_TYPE_EDGE_FALLING)
- `"string"`: Regular string values
- `"phandle"`: Device tree phandle references (e.g., &gpio0)
- `"number"`: Numeric values represented as strings

##### Array Hyperlink Validation

Used for arrays containing phandle references that can be navigated to in the UI.

**Structure:**
```json
{
    "type": "ArrayHyperlinkValidation",
    "minLength": "number",         // [OPTIONAL] Minimum number of array elements
    "maxLength": "number",         // [OPTIONAL] Maximum number of array elements
    "enum": [                      // [OPTIONAL] Array of HyperlinkItem objects
        {
            "type": "HyperlinkItem",
            "name": "string",      // Display name for the hyperlink
            "gotoUID": "string"    // [OPTIONAL] UUID to navigate to (undefined if unresolvable)
        }
    ]
}
```

**Examples:**
- GPIO references: `{"type": "ArrayHyperlinkValidation", "enum": [{"type": "HyperlinkItem", "name": "&gpio0", "gotoUID": "uuid-1234"}]}`

##### Array Mixed Type Validation

Used for arrays that contain elements of different types in a specific order (e.g., clock specifiers with phandle + numeric parameters).

**Structure:**
```json
{
    "type": "ArrayMixedTypeValidation",
    "minPrefixItems": "number",    // Minimum number of prefix items required
    "maxPrefixItems": "number",    // Maximum number of prefix items allowed
    "prefixItems": [               // Array of MixedTypeValidation defining each position
        {
            "type": "Number",
            "minValue": "bigint",  // [OPTIONAL]
            "maxValue": "bigint"   // [OPTIONAL]
        },
        {
            "type": "StringList",
            "enum": ["string[]"],
            "enumType": "string"   // [OPTIONAL] "macro" | "string" | "phandle" | "number"
        },
        {
            "type": "NumberList",
            "enum": ["number[]"]
        }
    ]
}
```

**MixedTypeValidation Types:**
- `MixedArrayNumber`: `{"type": "Number", "minValue"?: number | string, "maxValue"?: number | string}`
- `MixedArrayStringList`: `{"type": "StringList", "enum": string[], "enumType"?: EnumValueType}`
- `MixedArrayNumberList`: `{"type": "NumberList", "enum": number[]}`

**Note:** Number min/max values follow the same serialization rules as NumericRangeValidation (number for small values, string for large values).

**Examples:**
- Clock specifier (phandle + index): `{"type": "ArrayMixedTypeValidation", "minPrefixItems": 2, "maxPrefixItems": 2, "prefixItems": [{"type": "StringList", "enum": ["&clk0"], "enumType": "phandle"}, {"type": "Number", "minValue": 0, "maxValue": 7}]}`

#### Matrix Validation

Used for FormMatrix elements that accept matrices (array of arrays) with specific row constraints and row-level validation. The new structure validates each row using an ArrayValidation or ArrayMixedTypeValidation.

**Structure:**
```json
{
    "minRows": "number",           // [OPTIONAL] Minimum number of rows
    "maxRows": "number",           // [OPTIONAL] Maximum number of rows
    "definition": {}               // ArrayValidation or ArrayMixedTypeValidation for each row
}
```

The `definition` field can be any of:
- `ArrayNumberValidation`: All rows contain numbers
- `ArrayStringValidation`: All rows contain strings
- `ArrayHyperlinkValidation`: All rows contain hyperlink references
- `ArrayMixedTypeValidation`: Rows contain mixed types in a specific order

**Examples:**

**Numeric matrix (e.g., GPIO pins):**
```json
{
    "minRows": 1,
    "maxRows": 4,
    "definition": {
        "type": "ArrayNumberValidation",
        "minLength": 3,
        "maxLength": 3,
        "minValue": 0,
        "maxValue": 255
    }
}
```

**Mixed-type matrix (e.g., interrupts with number + macro):**
```json
{
    "minRows": 1,
    "maxRows": 8,
    "definition": {
        "type": "ArrayMixedTypeValidation",
        "minPrefixItems": 2,
        "maxPrefixItems": 2,
        "prefixItems": [
            {
                "type": "Number",
                "minValue": 0,
                "maxValue": 255
            },
            {
                "type": "StringList",
                "enum": ["IRQ_TYPE_NONE", "IRQ_TYPE_EDGE_RISING", "IRQ_TYPE_EDGE_FALLING", "IRQ_TYPE_LEVEL_HIGH", "IRQ_TYPE_LEVEL_LOW"],
                "enumType": "macro"
            }
        ]
    }
}
```

### FormElement Types

The FormElement is a discriminated union that represents different types of form elements in the device configuration. Each FormElement has a `type` field that determines its structure and behavior.

#### Flag

Represents a boolean configuration property with checkbox or toggle interface.

```json
{
    "type": "Flag",
    "key": "string",              // Property identifier (e.g., "active", "bipolar")
    "required": "boolean",        // Whether this property is required
    "setValue": "boolean",        // [OPTIONAL] Current configured value
    "defaultValue": "boolean",    // [OPTIONAL] Default value if not configured
    "description": "string",      // [OPTIONAL] Help text for UI
    "deprecated": "boolean",      // [OPTIONAL] Indicates deprecated property
    "error": {                    // [OPTIONAL] Present only when property is invalid
        "code": "string",
        "message": "string",
        "details": "string"
    }
}
```

#### FormArray

Represents an array-based configuration property with list interface.

```json
{
    "type": "FormArray",
    "key": "string",              // Property identifier (e.g., "reg", "clocks")
    "required": "boolean",        // Whether this property is required
    "setValue": "array",          // [OPTIONAL] Current configured array value
    "defaultValue": "array",      // [OPTIONAL] Default array value if not configured
    "description": "string",      // [OPTIONAL] Help text for UI
    "deprecated": "boolean",      // [OPTIONAL] Indicates deprecated property
    "validationType": {},         // [OPTIONAL] ArrayValidation or ArrayMixedTypeValidation
    "error": {                    // [OPTIONAL] Present only when property is invalid
        "code": "string",
        "message": "string",
        "details": "string"
    }
}
```

**Validation Type Options:**
- `ArrayNumberValidation`: For numeric arrays
- `ArrayStringValidation`: For string arrays
- `ArrayHyperlinkValidation`: For phandle reference arrays
- `ArrayMixedTypeValidation`: For arrays with mixed element types

#### FormMatrix

Represents a matrix-based configuration property (array of arrays) with table/grid interface. This is used for device tree properties that contain multiple rows of structured data, such as interrupts with their flags, or GPIO configurations.

```json
{
    "type": "FormMatrix",
    "key": "string",              // Property identifier (e.g., "interrupts", "gpios")
    "required": "boolean",        // Whether this property is required
    "setValue": "array[]",        // [OPTIONAL] Current configured matrix value (array of arrays)
    "defaultValue": "array[]",    // [OPTIONAL] Default matrix value if not configured
    "description": "string",      // [OPTIONAL] Help text for UI
    "deprecated": "boolean",      // [OPTIONAL] Indicates deprecated property
    "validationType": {},         // [OPTIONAL] MatrixValidation with row/definition constraints
    "error": {                    // [OPTIONAL] Present only when property is invalid
        "code": "string",
        "message": "string",
        "details": "string"
    }
}
```

**Example - Interrupts with mixed types:**
```json
{
    "type": "FormMatrix",
    "key": "interrupts",
    "required": true,
    "setValue": [
        [57, "IRQ_TYPE_EDGE_FALLING"],
        [58, "IRQ_TYPE_EDGE_FALLING"]
    ],
    "validationType": {
        "minRows": 1,
        "maxRows": 8,
        "definition": {
            "type": "ArrayMixedTypeValidation",
            "minPrefixItems": 2,
            "maxPrefixItems": 2,
            "prefixItems": [
                {
                    "type": "Number",
                    "minValue": 0,
                    "maxValue": 255
                },
                {
                    "type": "StringList",
                    "enum": ["IRQ_TYPE_NONE", "IRQ_TYPE_EDGE_RISING", "IRQ_TYPE_EDGE_FALLING", "IRQ_TYPE_LEVEL_HIGH", "IRQ_TYPE_LEVEL_LOW"],
                    "enumType": "macro"
                }
            ]
        }
    }
}
```

#### Generic

Represents a general input element (text, number, dropdown, custom properties, etc.).

```json
{
    "type": "Generic",
    "key": "string",              // Property identifier (e.g., "compatible", "clock-frequency")
    "inputType": "string",        // Input type: "text" | "number" | "dropdown" | "custom" | "custom-flag"
    "required": "boolean",        // Whether this property is required
    "setValue": "any",            // [OPTIONAL] Current configured value
    "defaultValue": "any",        // [OPTIONAL] Default value if not configured
    "description": "string",      // [OPTIONAL] Help text for UI
    "deprecated": "boolean",      // [OPTIONAL] Indicates deprecated property
    "validationType": {},         // [OPTIONAL] Validation rules (NumericRangeValidation or DropdownValidation)
    "error": {                    // [OPTIONAL] Present only when property is invalid
        "code": "string",
        "message": "string",
        "details": "string"
    }
}
```

**Input Type Values:**
- `"text"`: Text input field
- `"number"`: Numeric input field
- `"dropdown"`: Dropdown/select with predefined options (requires DropdownValidation)
- `"custom"`: User-defined custom property (text-based) - see [Custom Properties](#custom-properties)
- `"custom-flag"`: User-defined custom property (boolean flag) - see [Custom Properties](#custom-properties)

**Validation Type Options:**
- `NumericRangeValidation`: For numeric inputs with min/max constraints
- `DropdownValidation`: For dropdown inputs with predefined list of options

#### FormObject

Represents a nested object structure containing other FormElements (e.g., channels, complex configurations, device tree nodes).

```json
{
    "type": "FormObject",
    "key": "string",              // Object identifier (e.g., "channel@0", "root")
    "required": "boolean",        // Whether this object is required
    "description": "string",      // [OPTIONAL] Help text for UI
    "alias": "string",            // [OPTIONAL] Alias for the object
    "active": "boolean",          // [OPTIONAL] Active state of the object
    "channelName": "string",      // [OPTIONAL] Channel name matching a regex from channelRegexes
    "deviceUID": "string",        // [OPTIONAL] Device UUID for tree view elements
    "config": [],                 // Array of FormElement objects
    "error": {                    // [OPTIONAL] Present only when object is invalid
        "code": "string",
        "message": "string",
        "details": "string"
    }
}
```

**Usage Notes:**
- `channelName`: Used when the FormObject represents a device channel. Must match one of the regex patterns in the parent DeviceConfigurationFormObject's `channelRegexes` array.
- `deviceUID`: Used in tree view contexts to identify device tree nodes.
- `alias` and `active`: Used for device/channel configuration state.

#### Custom Properties

Custom properties allow users to add arbitrary device tree properties that are not defined in the device bindings. They are implemented as `Generic` FormElements with special `inputType` values.

**Text-based Custom Property:**
```json
{
    "type": "Generic",
    "key": "my-custom-property",  // User-defined property name
    "inputType": "custom",        // Identifies this as a custom text property
    "required": false,
    "setValue": "custom-value",   // User-entered string value
    "error": {                    // [OPTIONAL]
        "code": "string",
        "message": "string",
        "details": "string"
    }
}
```

**Boolean Custom Property (Flag):**
```json
{
    "type": "Generic",
    "key": "my-custom-flag",      // User-defined property name
    "inputType": "custom-flag",   // Identifies this as a custom boolean property
    "required": false,
    "setValue": true,             // User-selected boolean value
    "error": {                    // [OPTIONAL]
        "code": "string",
        "message": "string",
        "details": "string"
    }
}
```

**Usage Notes:**
- Custom properties use `inputType: "custom"` for text values and `inputType: "custom-flag"` for boolean flags
- The `key` field contains the user-defined property name
- No `validationType` is applied to custom properties
- Custom properties do not have `defaultValue` fields

### Device Configuration Form Object

The DeviceConfigurationFormObject is a special container type that wraps the device configuration and provides metadata about the device, channels, and parent node.

```json
{
    "type": "DeviceConfigurationFormObject",
    "alias": "string",                        // [OPTIONAL] Device alias
    "active": "boolean",                      // [OPTIONAL] Device active state (used for initial read only)
    "maxChannels": "number",                  // [OPTIONAL] Maximum number of channels supported
    "parentNode": {                           // Parent node information
        "uuid": "string",                     // UUID of the parent node
        "name": "string"                      // Parent node name
    },
    "channelRegexes": ["string"],            // [OPTIONAL] Array of regex patterns for valid channel names
    "generatedChannelRegexEntries": ["string"], // [OPTIONAL] Regex patterns to display as dropdown options
    "genericErrors": [                        // [OPTIONAL] Errors not tied to specific form elements
        {
            "code": "string",
            "message": "string",
            "details": "string"               // [OPTIONAL]
        }
    ],
    "config": []                              // Array of FormElement objects
}
```

**Field Descriptions:**
- `alias`: Custom name for the device instance
- `active`: Whether the device is currently active in the device tree
- `maxChannels`: Maximum number of channels this device supports (used for devices with channel support)
- `parentNode`: The parent device tree node where this device is attached. **Note:** If the parentNode differs from the current parent during an update, the backend will move the node first.
- `channelRegexes`: Regex patterns that define valid channel names (e.g., `["channel@[0-7]"]`). Channel FormObjects must have a `channelName` that matches one of these patterns.
- `generatedChannelRegexEntries`: Pre-generated channel names that match the `channelRegexes`, displayed as dropdown options in the UI
- `genericErrors`: Validation errors that apply to the device configuration as a whole, not tied to a specific form element
- `config`: Array of FormElement objects representing the device properties and channels

**Usage in API:**
- `device.getConfiguration`: Returns a DeviceConfiguration with `config: DeviceConfigurationFormObject`
- `device.updateConfiguration`: Accepts a DeviceConfigurationFormObject in the request payload

### Error (Configuration Item)

Represents a validation error for a property or configuration item:

```json
{
  "code": "string",    // Machine-readable error code (e.g., "UNSET_PROPERTY", "INVALID_VALUE")
  "message": "string", // Human-readable error message for UI display
  "details": "string"  // [OPTIONAL] Additional error context or debugging information
}
```

**Usage Notes:**
- Absence of the `error` field in a FormElement means the property is valid
- Errors can appear on individual FormElements or in the `genericErrors` array of DeviceConfigurationFormObject
- The `code` field enables programmatic error handling
- The `message` field should be displayed to users
- The `details` field provides additional context for debugging
