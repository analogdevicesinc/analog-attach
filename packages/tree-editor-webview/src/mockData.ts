import { FormObjectElement } from "extension-protocol";

export const mockNodeTemplates = [
  {
    id: 'custom-empty',
    name: 'Custom',
    description: 'Add an empty child node template.',
  },
  {
    id: 'arc-perf-counters',
    name: 'ARC Performance Counters',
    description: 'The ARC700 can be configured with a pipeline performance monitor for counting CPU and cache events like misses and hits. Like conventional PCT there are 100+ hardware conditions dynamically mapped to up to 32 counters. The ARC700 can also be configured with a bus performance monitor for counting bus events like transfers and wait states. This node adds support for both types of performance monitors.',
    showMore: true,
  },
  {
    id: 'child-node-2',
    name: 'Child Node 2',
    description: 'Show 2 to 3 lines of description and give the opportunity to link out to the website to view more information.',
  },
  {
    id: 'child-node-3',
    name: 'Child Node 3',
    description: 'Show 2 to 3 lines of description and give the opportunity to link out to the website to view more information.',
  },
];

export const mockData: FormObjectElement = {
  "type": "FormObject",
  "key": "root",
  "required": false,
  "description": "Device tree node: root",
  "config": [
    {
      "type": "Generic",
      "key": "model",
      "inputType": "text",
      "required": false,
      "setValue": "Analog Devices MAX32690EVKIT"
    },
    {
      "type": "Generic",
      "key": "compatible",
      "inputType": "text",
      "required": true,
      "setValue": "adi,max32690evkit"
    },
    {
      "type": "FormArray",
      "key": "#address-cells",
      "required": false,
      "setValue": [1],
      "defaultValue": []
    },
    {
      "type": "FormArray",
      "key": "#size-cells",
      "required": false,
      "setValue": [1],
      "defaultValue": []
    },
    {
      "type": "FormObject",
      "key": "chosen",
      "required": false,
      "description": "Device tree node: chosen",
      "config": [
        {
          "type": "Generic",
          "key": "zephyr,console",
          "inputType": "text",
          "required": false,
          "setValue": "uart2"
        },
        {
          "type": "Generic",
          "key": "zephyr,flash",
          "inputType": "text",
          "required": false,
          "setValue": "flash0"
        }
      ],
      "alias": ""
    },
    {
      "type": "FormObject",
      "key": "soc",
      "required": false,
      "description": "Device tree node: soc",
      "config": [
        {
          "type": "Generic",
          "key": "compatible",
          "inputType": "text",
          "required": true,
          "setValue": "simple-bus"
        },
        {
          "type": "Flag",
          "key": "ranges",
          "required": false,
          "setValue": true,
          "defaultValue": false
        },
        {
          "type": "FormObject",
          "key": "memory@20000000",
          "required": false,
          "description": "Device tree node: memory@20000000",
          "config": [
            {
              "type": "Generic",
              "key": "compatible",
              "inputType": "text",
              "required": true,
              "setValue": "mmio-sram"
            },
            {
              "type": "FormArray",
              "key": "reg",
              "required": true,
              "setValue": [536870912, 131072],
              "defaultValue": []
            }
          ],
          "alias": "sram0"
        },
        {
          "type": "FormObject",
          "key": "serial@40044000",
          "required": false,
          "description": "Device tree node: serial@40044000",
          "config": [
            {
              "type": "Generic",
              "key": "compatible",
              "inputType": "text",
              "required": true,
              "setValue": "adi,max32-uart"
            },
            {
              "type": "FormArray",
              "key": "current-speed",
              "required": false,
              "setValue": [115200],
              "defaultValue": []
            }
          ],
          "alias": "uart2"
        }
      ],
      "alias": ""
    },
    {
      "type": "FormObject",
      "key": "leds",
      "required": false,
      "description": "Device tree node: leds",
      "config": [
        {
          "type": "Generic",
          "key": "compatible",
          "inputType": "text",
          "required": true,
          "setValue": "gpio-leds"
        },
        {
          "type": "FormObject",
          "key": "led_0",
          "required": false,
          "description": "Device tree node: led_0",
          "config": [
            {
              "type": "FormArray",
              "key": "gpios",
              "required": false,
              "setValue": ["gpio0", 14, 1],
              "defaultValue": []
            },
            {
              "type": "Generic",
              "key": "label",
              "inputType": "text",
              "required": false,
              "setValue": "LED0"
            }
          ],
          "alias": "red_led"
        }
      ],
      "alias": ""
    }
  ],
  "alias": ""
};