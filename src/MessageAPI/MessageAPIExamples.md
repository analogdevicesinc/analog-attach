# AnalogAttach Message API Examples

This document provides concrete examples of the AnalogAttach Message API in action, showing the JSON messages exchanged between the frontend and backend.

## Example 1: Get Attached Devices State

### Request
```json
{
  "id": "req-001",
  "type": "request",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "command": "session.getAttachedDevicesState",
  "payload": {}
}
```

### Response
```json
{
  "id": "req-001",
  "type": "response",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "command": "session.getAttachedDevicesState",
  "status": "success",
  "payload": {
    "data": [
      {
        "device": {
          "id": "analog,ad7124-8",
          "name": "AD7124-8 ADC",
          "alias": "Main ADC",
          "active": true,
          "hasErrors": false,
          "parentNode": {
            "ID": "spi0-0",
            "name": "spi0"
          },
          "maxChannels": 8,
          "channels": [
            {
              "name": "AIN0",
              "alias": "Voltage Input 1",
              "hasErrors": false
            },
            {
              "name": "AIN1",
              "alias": "Voltage Input 2",
              "hasErrors": false
            },
            {
              "name": "AIN2",
              "alias": "",
              "hasErrors": true
            }
          ]
        }
      },
      {
        "device": {
          "id": "analog,ad7606",
          "name": "AD7606",
          "alias": "Secondary ADC",
          "active": true,
          "hasErrors": false,
          "parentNode": {
            "ID": "spi1-0",
            "name": "spi1"
          },
          "maxChannels": 8,
          "channels": [
            {
              "name": "V1",
              "alias": "Channel 1",
              "hasErrors": false
            },
            {
              "name": "V2",
              "alias": "Channel 2",
              "hasErrors": false
            }
          ]
        }
      }
    ]
  }
}
```

## Example 2: Get Available Devices from Catalog

### Request
```json
{
  "id": "req-002",
  "type": "request",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "command": "catalog.getDevices",
  "payload": {}
}
```

### Response
```json
{
  "id": "req-002",
  "type": "response",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "command": "catalog.getDevices",
  "status": "success",
  "payload": {
    "devices": [
      {
        "deviceId": "analog,ad7124-8",
        "name": "AD7124-8",
        "description": "24-bit Sigma-Delta ADC with 8 channels",
        "group": "adc"
      },
      {
        "deviceId": "analog,ad7606",
        "name": "AD7606",
        "description": "16-bit DAS with 8-Channel Simultaneous Sampling ADC",
        "group": "adc"
      }
    ]
  }
}
```

## Example 3: Get Potential Parent Nodes

### Request
```json
{
  "id": "req-003",
  "type": "request",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "command": "device.getPotentialParentNodes",
  "payload": {
    "deviceId": "analog,ad7124-8"
  }
}
```

### Response
```json
{
  "id": "req-003",
  "type": "response",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "command": "device.getPotentialParentNodes",
  "status": "success",
  "payload": {
    "potentialParentNodes": [
      {
        "name": "spi0",
        "ID": "spi0-0"
      },
      {
        "name": "i2c0",
        "ID": "i2c0-0"
      }
    ]
  }
}
```

## Example 4: Set Parent Node (Attach Device)

### Request
```json
{
  "id": "req-004",
  "type": "request",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "command": "device.setParentNode",
  "payload": {
    "deviceId": "analog,ad7124-8",
    "parentNodeId": "spi0-0"
  }
}
```

### Response
```json
{
  "id": "req-004",
  "type": "response",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "command": "device.setParentNode",
  "status": "success",
  "payload": {
    "deviceUID": "uid12345678"
  }
}
```

## Example 5: Delete Device

### Request
```json
{
  "id": "req-005",
  "type": "request",
  "timestamp": "2024-01-01T00:00:01.000Z",
  "command": "device.delete",
  "payload": {
    "deviceUID": "uid12345678"
  }
}
```

### Response
```json
{
  "id": "req-005",
  "type": "response",
  "timestamp": "2024-01-01T00:00:01.100Z",
  "command": "device.delete",
  "status": "success",
  "payload": {
    "deviceUID": "uid12345678"
  }
}
```

## Example 6: File Changed Notification

### Backend Notification
```json
{
  "id": "notif-001",
  "type": "notification",
  "timestamp": "2024-01-01T00:05:00.000Z",
  "command": "event.fileChanged",
  "payload": {
    "filePath": "/path/to/device.dts",
    "changeSource": "external"
  }
}
```

## Example 7: Error Response

### Request
```json
{
  "id": "req-006",
  "type": "request",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "command": "device.setParentNode",
  "payload": {
    "deviceId": "invalid,device-id",
    "parentNodeId": "spi0-0"
  }
}
```

### Error Response
```json
{
  "id": "req-006",
  "type": "response",
  "timestamp": "2024-01-01T00:00:00.100Z",
  "command": "device.setParentNode",
  "status": "error",
  "error": {
    "code": "DEVICE_NOT_FOUND",
    "message": "The specified device was not found in the catalog.",
    "details": "Device ID 'invalid,device-id' does not exist in the available devices catalog."
  }
}
```

## Message Flow Examples

### Typical Device Attachment Workflow

1. **Get available devices**
   ```
   Frontend → Backend: catalog.getDevices
   Backend → Frontend: List of available devices
   ```

2. **User selects a device and gets potential parent nodes**
   ```
   Frontend → Backend: device.getPotentialParentNodes (with deviceId)
   Backend → Frontend: List of compatible parent nodes
   ```

3. **User selects a parent node and attaches the device**
   ```
   Frontend → Backend: device.setParentNode (with deviceId and parentNodeId)
   Backend → Frontend: Success response with deviceUID
   ```

4. **Get updated session state**
   ```
   Frontend → Backend: session.getAttachedDevicesState
   Backend → Frontend: Updated list of attached devices
   ```

### External File Change Notification

1. **External tool modifies device tree file**
   ```
   Backend → Frontend: event.fileChanged notification
   ```

2. **Frontend refreshes the session state**
   ```
   Frontend → Backend: session.getAttachedDevicesState
   Backend → Frontend: Updated attached devices state
   ```
