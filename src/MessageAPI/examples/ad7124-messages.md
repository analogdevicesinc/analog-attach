# AD7124 Device Configuration Message Flow

This document describes the user flow and message exchange between Frontend (FE) and Backend (BE) when configuring an AD7124 ADC device.

## Table of Contents

- [Overview](#overview)
- [User Flow Scenarios](#user-flow-scenarios)
    - [1. Get Attached Devices State](#1-get-attached-devices-state)
    - [1b. Get Attached Devices State (With Existing Devices)](#1b-get-attached-devices-state-with-existing-devices)
    - [2. Get Available Devices](#2-get-available-devices)
    - [3. Get Potential Parent Nodes](#3-get-potential-parent-nodes)
    - [4. Set Parent Node](#4-set-parent-node)
    - [5. Initial Device Configuration Request](#5-initial-device-configuration-request)
    - [6. Setting Reg Property](#6-setting-reg-property)
    - [7. Setting Voltage Reference](#7-setting-voltage-reference)
    - [8. Channel Configuration](#8-channel-configuration)
    - [9. Delete Channel](#9-delete-channel)
    - [10. Delete Device](#10-delete-device)

## Overview

The AD7124 is a 24-bit Sigma-Delta ADC available in two variants:

- **AD7124-4**: Up to 8 channels
- **AD7124-8**: Up to 16 channels

---

## User Flow Scenarios

### 1. Get Attached Devices State

**Scenario**: Frontend loads the workspace and wants to populate the UI with currently attached devices. At this early point no devices have been attached yet.

**Frontend Request**:

```json
{
    "id": "req-001",
    "type": "request",
    "timestamp": "2023-10-01T10:00:00Z",
    "command": "session.getAttachedDevicesState",
    "payload": {}
}
```

**Backend Response (empty state)**:

```json
{
    "id": "req-001",
    "type": "response",
    "timestamp": "2023-10-01T10:00:01Z",
    "command": "session.getAttachedDevicesState",
    "status": "success",
    "payload": {
        "data": []
    }
}
```

### 1b. Get Attached Devices State (With Existing Devices)

**Scenario**: Frontend loads the workspace and wants to populate the UI with currently attached devices. In this variation, there are already two devices attached: an AD7124-4 and an ADIS16475.

**Frontend Request**:

```json
{
    "id": "req-002",
    "type": "request",
    "timestamp": "2023-10-01T10:05:00Z",
    "command": "session.getAttachedDevicesState",
    "payload": {}
}
```

**Backend Response (existing devices state)**:

```json
{
    "id": "req-002",
    "type": "response",
    "timestamp": "2023-10-01T10:05:01Z",
    "command": "session.getAttachedDevicesState",
    "status": "success",
    "payload": {
        "data": [
            {
                "device": {
                    "id": "adi,ad7124-4",
                    "name": "AD7124-4",
                    "deviceUID": "ad7124-789012",
                    "alias": "Temperature Sensor",
                    "active": true,
                    "hasErrors": false,
                    "parentNode": {
                        "ID": "spi0-0",
                        "name": "spi0"
                    },
                    "maxChannels": 8,
                    "channels": [
                        {
                            "name": "channel@0",
                            "alias": "Thermocouple",
                            "hasErrors": false
                        }
                    ]
                }
            },
            {
                "device": {
                    "id": "adi,adis16475",
                    "name": "ADIS16475",
                    "deviceUID": "adis16475-345678",
                    "alias": "Motion Sensor",
                    "active": true,
                    "hasErrors": false,
                    "parentNode": {
                        "ID": "spi1-0",
                        "name": "spi1"
                    },
                    "maxChannels": 0,
                    "channels": []
                }
            }
        ]
    }
}
```

---

### 2. Get Available Devices

**Scenario**: User opens the catalog panel to choose a device to attach. Only three devices are exposed in the mocked catalog: the two variants of AD7124 and ADIS16475.

**Frontend Request**:

```json
{
    "id": "req-003",
    "type": "request",
    "timestamp": "2023-10-01T10:10:00Z",
    "command": "catalog.getDevices",
    "payload": {}
}
```

**Backend Response (mocked catalog)**:

```json
{
    "id": "req-003",
    "type": "response",
    "timestamp": "2023-10-01T10:10:01Z",
    "command": "catalog.getDevices",
    "status": "success",
    "payload": {
        "devices": [
            {
                "deviceId": "adi,ad7124-4",
                "name": "AD7124-4",
                "description": "24-bit Sigma-Delta ADC (8/16 differential input mux)",
                "group": "adc"
            },
            {
                "deviceId": "adi,ad7124-8",
                "name": "AD7124-8",
                "description": "24-bit Sigma-Delta ADC (8/16 differential input mux)",
                "group": "adc"
            },
            {
                "deviceId": "adi,adis16475",
                "name": "ADIS16475",
                "description": "High-performance IMU (triple-axis gyro + accel + inclinometer)",
                "group": "imu"
            }
        ]
    }
}
```

---

### 3. Get Potential Parent Nodes

**Scenario**: User selects the AD7124-4 device and the frontend needs to know where it can be attached. For this mock only a single SPI controller is available.

**Frontend Request**:

```json
{
    "id": "req-004",
    "type": "request",
    "timestamp": "2023-10-01T10:15:00Z",
    "command": "device.getPotentialParentNodes",
    "payload": {
        "deviceId": "adi,ad7124-4"
    }
}
```

**Backend Response (single SPI parent)**:

```json
{
    "id": "req-004",
    "type": "response",
    "timestamp": "2023-10-01T10:15:01Z",
    "command": "device.getPotentialParentNodes",
    "status": "success",
    "payload": {
        "potentialParentNodes": [
            {
                "name": "spi0",
                "ID": "spi0-0"
            }
        ]
    }
}
```

---

### 4. Set Parent Node

**Scenario**: User chooses to attach the AD7124-4 device to the `spi0` node.

**Frontend Request**:

```json
{
    "id": "req-005",
    "type": "request",
    "timestamp": "2023-10-01T10:20:00Z",
    "command": "device.setParentNode",
    "payload": {
        "deviceId": "adi,ad7124-4",
        "parentNodeId": "spi0-0"
    }
}
```

**Backend Response (device instance created)**:

```json
{
    "id": "req-005",
    "type": "response",
    "timestamp": "2023-10-01T10:20:01Z",
    "command": "device.setParentNode",
    "status": "success",
    "payload": {
        "deviceUID": "ad7124-123456"
    }
}
```

---

### 5. Initial Device Configuration Request

**Scenario**: Frontend requests device configuration for the first time after device identification.

**Context**:

- Frontend knows the device type and has received a unique device ID from Backend
- Frontend needs to know what UI elements to render in the configuration panel

**Frontend Request**:

```json
{
    "id": "req-006",
    "type": "request",
    "timestamp": "2023-10-01T10:25:00Z",
    "command": "device.getConfiguration",
    "payload": {
        "deviceUID": "ad7124-123456"
    }
}
```

**Backend Response**:

```json
{
    "id": "req-006",
    "type": "response",
    "timestamp": "2023-10-01T10:25:01Z",
    "command": "device.getConfiguration",
    "status": "success",
    "payload": {
        "deviceConfiguration": {
            "config": [
                {
                    "type": "Generic",
                    "key": "compatible",
                    "inputType": "dropdown",
                    "required": true,
                    "setValue": "adi,ad7124-4",
                    "defaultValue": "adi,ad7124-4",
                    "validationType": {
                        "list": ["adi,ad7124-4"]
                    },
                    "description": "Specifies the device programming model and driver compatibility"
                },
                {
                    "type": "FormArray",
                    "key": "reg",
                    "required": true,
                    "defaultValue": [0],
                    "validationType": {
                        "minLength": 1,
                        "maxLength": 1,
                        "minValue": 0
                    },
                    "error": {
                        "code": "UNSET_PROPERTY",
                        "message": "This is a required property that needs to be set."
                    },
                    "description": "SPI chip select number for the device"
                },
                {
                    "type": "FormArray",
                    "key": "interrupts",
                    "required": false,
                    "defaultValue": [],
                    "validationType": {
                        "minLength": 2,
                        "maxLength": 2,
                        "minValue": 0
                    },
                    "description": "IRQ line for the ADC [GPIO number, trigger type]"
                },
                {
                    "type": "Generic",
                    "key": "interrupt-parent",
                    "inputType": "dropdown",
                    "required": false,
                    "validationType": {
                        "list": ["gpio", "gicv2", "aon_intr"]
                    },
                    "description": "Interrupt controller reference"
                },
                {
                    "type": "Generic",
                    "key": "clocks",
                    "inputType": "dropdown",
                    "required": false,
                    "validationType": {
                        "list": ["clk_osc", "ad7124_clk", "clk_usb", "clk_27MHz", "clk_108MHz"]
                    },
                    "description": "External clock connected to the CLK pin"
                },
                {
                    "type": "Generic",
                    "key": "clock-names",
                    "inputType": "dropdown",
                    "required": false,
                    "deprecated": true,
                    "validationType": {
                        "list": ["mclk", "adc_clk", "sync_clk"]
                    },
                    "description": "MCLK is an internal counter in the ADC. Do not use this property"
                },
                {
                    "type": "Generic",
                    "key": "#clock-cells",
                    "inputType": "number",
                    "required": false,
                    "defaultValue": 0,
                    "validationType": {
                        "minValue": 0,
                        "maxValue": 0
                    },
                    "description": "The CLK pin can be used as an output. When that is the case, include this property"
                },
                {
                    "type": "Generic",
                    "key": "rdy-gpios",
                    "inputType": "number",
                    "required": false,
                    "validationType": {
                        "minValue": 0
                    },
                    "description": "GPIO reading the R̅D̅Y̅ line. Highly recommended for proper interrupt handling"
                },
                {
                    "type": "ChooseOne",
                    "key": "voltage-reference",
                    "required": false,
                    "description": "Select voltage reference source for the device",
                    "config": [
                        {
                            "type": "Generic",
                            "key": "refin1-supply",
                            "inputType": "dropdown",
                            "required": false,
                            "validationType": {
                                "list": ["vref", "sd_vcc_reg"]
                            },
                            "description": "refin1 supply can be used as reference for conversion"
                        },
                        {
                            "type": "Generic",
                            "key": "refin2-supply",
                            "inputType": "dropdown",
                            "required": false,
                            "validationType": {
                                "list": ["vref", "sd_vcc_reg"]
                            },
                            "description": "refin2 supply can be used as reference for conversion"
                        },
                        {
                            "type": "Generic",
                            "key": "avdd-supply",
                            "inputType": "dropdown",
                            "required": false,
                            "validationType": {
                                "list": ["vref", "sd_vcc_reg"]
                            },
                            "description": "avdd supply can be used as reference for conversion"
                        }
                    ]
                },
                {
                    "type": "Generic",
                    "key": "spi-max-frequency",
                    "inputType": "number",
                    "required": false,
                    "validationType": {
                        "minValue": 1
                    },
                    "description": "Maximum SPI clocking speed of the device in Hz"
                }
            ]
        }
    }
}
```

---

### 6. Setting Reg Property

**Scenario**: User sets the SPI chip select number to 1.

**Frontend Request**:

```json
{
    "id": "req-007",
    "type": "request",
    "timestamp": "2023-10-01T10:30:00Z",
    "command": "device.updateConfiguration",
    "payload": {
        "deviceUID": "ad7124-123456",
        "config": {
            "config": [
                {
                    "type": "Generic",
                    "key": "compatible",
                    "setValue": "adi,ad7124-4"
                },
                {
                    "type": "FormArray",
                    "key": "reg",
                    "setValue": [1]
                }
            ]
        },
        "parentNode": {
            "ID": "spi0-0",
            "name": "spi0"
        }
    }
}
```

**Backend Response**:

**Key Changes**:

- `setValue` for `reg` property updated to `[1]`
- The device now has a valid chip select number configured
- Error on `reg` property is cleared

```json
{
    "id": "req-007",
    "type": "response",
    "timestamp": "2023-10-01T10:30:01Z",
    "command": "device.updateConfiguration",
    "status": "success",
    "payload": {
        "deviceConfiguration": {
            "config": [
                {
                    "type": "Generic",
                    "key": "compatible",
                    "inputType": "dropdown",
                    "required": true,
                    "setValue": "adi,ad7124-4",
                    "defaultValue": "adi,ad7124-4",
                    "validationType": {
                        "list": ["adi,ad7124-4"]
                    },
                    "description": "Specifies the device programming model and driver compatibility"
                },
                {
                    "type": "FormArray",
                    "key": "reg",
                    "required": true,
                    "setValue": [1],
                    "defaultValue": [0],
                    "validationType": {
                        "minLength": 1,
                        "maxLength": 1,
                        "minValue": 0
                    },
                    "description": "SPI chip select number for the device"
                }
            ]
        }
    }
}
```

---

### 7. Setting Voltage Reference

**Scenario**: User selects a voltage reference for the device.

**Frontend Request**:

```json
{
    "id": "req-008",
    "type": "request",
    "timestamp": "2023-10-01T10:35:00Z",
    "command": "device.updateConfiguration",
    "payload": {
        "deviceUID": "ad7124-123456",
        "config": {
            "config": [
                {
                    "type": "Generic",
                    "key": "compatible",
                    "setValue": "adi,ad7124-4"
                },
                {
                    "type": "ChooseOne",
                    "key": "voltage-reference",
                    "setValue": "refin1-supply",
                    "config": [
                        {
                            "type": "Generic",
                            "key": "refin1-supply",
                            "setValue": "vref"
                        }
                    ]
                }
            ]
        },
        "parentNode": {
            "ID": "spi0-0",
            "name": "spi0"
        }
    }
}
```

**Backend Response**:

**Key Changes**:

- Voltage reference is configured
- Channels become available as FormObjects

```json
{
    "id": "req-008",
    "type": "response",
    "timestamp": "2023-10-01T10:35:01Z",
    "command": "device.updateConfiguration",
    "status": "success",
    "payload": {
        "deviceConfiguration": {
            "alias": "Temperature Sensor ADC",
            "active": true,
            "maxChannels": 8,
            "config": [
                {
                    "type": "Generic",
                    "key": "compatible",
                    "inputType": "dropdown",
                    "required": true,
                    "setValue": "adi,ad7124-4",
                    "defaultValue": "adi,ad7124-4",
                    "validationType": {
                        "list": ["adi,ad7124-4"]
                    },
                    "description": "Specifies the device programming model and driver compatibility"
                },
                {
                    "type": "FormArray",
                    "key": "reg",
                    "required": true,
                    "setValue": [1],
                    "defaultValue": [0],
                    "validationType": {
                        "minLength": 1,
                        "maxLength": 1,
                        "minValue": 0
                    },
                    "description": "SPI chip select number for the device"
                },
                {
                    "type": "ChooseOne",
                    "key": "voltage-reference",
                    "required": false,
                    "setValue": "refin1-supply",
                    "description": "Select voltage reference source for the device",
                    "config": [
                        {
                            "type": "Generic",
                            "key": "refin1-supply",
                            "inputType": "dropdown",
                            "required": false,
                            "setValue": "vref",
                            "validationType": {
                                "list": ["vref", "sd_vcc_reg"]
                            },
                            "description": "refin1 supply can be used as reference for conversion"
                        },
                        {
                            "type": "Generic",
                            "key": "refin2-supply",
                            "inputType": "dropdown",
                            "required": false,
                            "validationType": {
                                "list": ["vref", "sd_vcc_reg"]
                            },
                            "description": "refin2 supply can be used as reference for conversion"
                        },
                        {
                            "type": "Generic",
                            "key": "avdd-supply",
                            "inputType": "dropdown",
                            "required": false,
                            "validationType": {
                                "list": ["vref", "sd_vcc_reg"]
                            },
                            "description": "avdd supply can be used as reference for conversion"
                        }
                    ]
                },
                {
                    "type": "FormObject",
                    "key": "channel@0",
                    "required": false,
                    "description": "Channel configuration for channel 0",
                    "config": [
                        {
                            "type": "Flag",
                            "key": "deviceAttached",
                            "required": false,
                            "setValue": false,
                            "defaultValue": false,
                            "description": "Whether this channel is attached/enabled"
                        },
                        {
                            "type": "FormArray",
                            "key": "diff-channels",
                            "required": true,
                            "defaultValue": [],
                            "validationType": {
                                "minLength": 2,
                                "maxLength": 2,
                                "minValue": 0,
                                "maxValue": 15
                            },
                            "error": {
                                "code": "UNSET_PROPERTY",
                                "message": "This is a required property that needs to be set."
                            },
                            "description": "Differential channel pair [positive, negative]"
                        },
                        {
                            "type": "Flag",
                            "key": "bipolar",
                            "required": false,
                            "defaultValue": true,
                            "description": "Enable bipolar mode for this channel"
                        },
                        {
                            "type": "Generic",
                            "key": "adi,reference-select",
                            "inputType": "dropdown",
                            "required": false,
                            "defaultValue": 0,
                            "validationType": {
                                "list": [0, 1, 3]
                            },
                            "description": "Reference source: 0=REFIN1, 1=REFIN2, 3=AVDD"
                        }
                    ]
                }
            ]
        }
    }
}
```

---

### 8. Channel Configuration

**Scenario**: User configures individual channels with required properties.

**Frontend Request**:

```json
{
    "id": "req-009",
    "type": "request",
    "timestamp": "2023-10-01T10:40:00Z",
    "command": "device.updateConfiguration",
    "payload": {
        "deviceUID": "ad7124-123456",
        "config": {
            "config": [
                {
                    "type": "Generic",
                    "key": "compatible",
                    "setValue": "adi,ad7124-4"
                },
                {
                    "type": "FormObject",
                    "key": "channel@0",
                    "config": [
                        {
                            "type": "Flag",
                            "key": "deviceAttached",
                            "setValue": true
                        },
                        {
                            "type": "FormArray",
                            "key": "diff-channels",
                            "setValue": [0, 1]
                        },
                        {
                            "type": "Flag",
                            "key": "bipolar",
                            "setValue": true
                        },
                        {
                            "type": "Generic",
                            "key": "adi,reference-select",
                            "setValue": 0
                        }
                    ]
                }
            ]
        },
        "parentNode": {
            "ID": "spi0-0",
            "name": "spi0"
        }
    }
}
```

**Backend Response**:

**Key Changes**:

- Channel@0 is now configured with differential channels [0, 1], bipolar mode enabled, and reference select set to REFIN1
- The `deviceAttached` flag is set to true, enabling the channel

```json
{
    "id": "req-009",
    "type": "response",
    "timestamp": "2023-10-01T10:40:01Z",
    "command": "device.updateConfiguration",
    "status": "success",
    "payload": {
        "deviceConfiguration": {
            "config": [
                {
                    "type": "FormObject",
                    "key": "channel@0",
                    "required": false,
                    "description": "Channel configuration for channel 0",
                    "config": [
                        {
                            "type": "Flag",
                            "key": "deviceAttached",
                            "required": false,
                            "setValue": true,
                            "defaultValue": false,
                            "description": "Whether this channel is attached/enabled"
                        },
                        {
                            "type": "FormArray",
                            "key": "diff-channels",
                            "required": true,
                            "setValue": [0, 1],
                            "defaultValue": [],
                            "validationType": {
                                "minLength": 2,
                                "maxLength": 2,
                                "minValue": 0,
                                "maxValue": 15
                            },
                            "description": "Differential channel pair [positive, negative]"
                        },
                        {
                            "type": "Flag",
                            "key": "bipolar",
                            "required": false,
                            "setValue": true,
                            "defaultValue": true,
                            "description": "Enable bipolar mode for this channel"
                        },
                        {
                            "type": "Generic",
                            "key": "adi,reference-select",
                            "inputType": "dropdown",
                            "required": false,
                            "setValue": 0,
                            "defaultValue": 0,
                            "validationType": {
                                "list": [0, 1, 3]
                            },
                            "description": "Reference source: 0=REFIN1, 1=REFIN2, 3=AVDD"
                        }
                    ]
                }
            ]
        }
    }
}
```

---

### 9. Delete Channel

**Scenario**: User decides to delete a previously configured channel. Channel deletion is signaled by omitting the channel FormObject from the configuration update.

**Frontend Request**:

```json
{
    "id": "req-010",
    "type": "request",
    "timestamp": "2023-10-01T10:45:00Z",
    "command": "device.updateConfiguration",
    "payload": {
        "deviceUID": "ad7124-123456",
        "config": {
            "config": [
                {
                    "type": "Generic",
                    "key": "compatible",
                    "setValue": "adi,ad7124-4"
                }
            ]
        },
        "parentNode": {
            "ID": "spi0-0",
            "name": "spi0"
        }
    }
}
```

**Backend Response**:

**Key Changes**:

- Channel@0 FormObject is no longer present in the configuration
- The channel has been effectively deleted by omitting it from the config array
- Only device-level properties remain in the configuration

```json
{
    "id": "req-010",
    "type": "response",
    "timestamp": "2023-10-01T10:45:01Z",
    "command": "device.updateConfiguration",
    "status": "success",
    "payload": {
        "deviceConfiguration": {
            "alias": "Temperature Sensor ADC",
            "active": true,
            "maxChannels": 8,
            "config": [
                {
                    "type": "Generic",
                    "key": "compatible",
                    "inputType": "dropdown",
                    "required": true,
                    "setValue": "adi,ad7124-4",
                    "defaultValue": "adi,ad7124-4",
                    "validationType": {
                        "list": ["adi,ad7124-4"]
                    },
                    "description": "Specifies the device programming model and driver compatibility"
                },
                {
                    "type": "FormArray",
                    "key": "reg",
                    "required": true,
                    "setValue": [1],
                    "defaultValue": [0],
                    "validationType": {
                        "minLength": 1,
                        "maxLength": 1,
                        "minValue": 0
                    },
                    "description": "SPI chip select number for the device"
                },
                {
                    "type": "ChooseOne",
                    "key": "voltage-reference",
                    "required": false,
                    "setValue": "refin1-supply",
                    "description": "Select voltage reference source for the device",
                    "config": [
                        {
                            "type": "Generic",
                            "key": "refin1-supply",
                            "inputType": "dropdown",
                            "required": false,
                            "setValue": "vref",
                            "validationType": {
                                "list": ["vref", "sd_vcc_reg"]
                            },
                            "description": "refin1 supply can be used as reference for conversion"
                        },
                        {
                            "type": "Generic",
                            "key": "refin2-supply",
                            "inputType": "dropdown",
                            "required": false,
                            "validationType": {
                                "list": ["vref", "sd_vcc_reg"]
                            },
                            "description": "refin2 supply can be used as reference for conversion"
                        },
                        {
                            "type": "Generic",
                            "key": "avdd-supply",
                            "inputType": "dropdown",
                            "required": false,
                            "validationType": {
                                "list": ["vref", "sd_vcc_reg"]
                            },
                            "description": "avdd supply can be used as reference for conversion"
                        }
                    ]
                }
            ]
        }
    }
}
```

---

### 10. Delete Device

**Scenario**: User decides to remove the previously attached AD7124 device either before configuration is complete or after having configured properties/channels.

**Frontend Request**:

```json
{
    "id": "req-011",
    "type": "request",
    "timestamp": "2023-10-01T10:50:00Z",
    "command": "device.delete",
    "payload": {
        "deviceUID": "ad7124-123456"
    }
}
```

**Backend Response (confirmation)**:

```json
{
    "id": "req-011",
    "type": "response",
    "timestamp": "2023-10-01T10:50:01Z",
    "command": "device.delete",
    "status": "success",
    "payload": {
        "deviceUID": "ad7124-123456"
    }
}
```
