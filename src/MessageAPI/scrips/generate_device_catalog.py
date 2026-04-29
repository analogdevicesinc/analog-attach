#!/usr/bin/env python3
"""
Device Catalog Generator for Analog Attach Extension

This script generates a JSON device catalog by scanning the Linux kernel repository
for IIO (Industrial I/O) device tree bindings.

Usage:
    python generate_device_catalog.py /path/to/linux/repo [output_file.json]

The script:
1. Scans /Documentation/devicetree/bindings/iio for device tree bindings (YAML only)
2. Generates a JSON catalog following the Analog Attach Message API format

Author: Generated for Analog Attach Extension
"""

import os
import sys
import json
import re
import argparse
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict


@dataclass
class Device:
    """Represents a device in the catalog"""
    deviceId: str
    name: str
    description: str
    group: str


def get_iio_categories(bindings_path: Path) -> List[str]:
    """
    Get all IIO category directories from the bindings/iio path.

    Args:
        bindings_path: Path to bindings/iio directory

    Returns:
        List of category directory names in sorted order (e.g., ['accel', 'adc', 'gyro', ...])
    """
    categories = []
    if bindings_path.exists() and bindings_path.is_dir():
        for item in sorted(bindings_path.iterdir()):  # Sort directory listing
            if item.is_dir() and not item.name.startswith('.'):
                categories.append(item.name)
    return categories




def scan_bindings_in_category(bindings_category_path: Path) -> List[Dict[str, str]]:
    """
    Scan for device tree binding files in a specific category directory.

    Args:
        bindings_category_path: Path to bindings category (e.g., Documentation/devicetree/bindings/iio/accel)

    Returns:
        List of dictionaries containing binding information in sorted order
    """
    bindings = []

    if not bindings_category_path.exists():
        return bindings

    # Look for .yaml binding files only, sorted by filename
    for binding_file in sorted(bindings_category_path.glob("*.yaml")):
        binding_info = extract_device_info_from_binding(binding_file)
        if binding_info:
            binding_info['filename'] = binding_file.stem
            binding_info['filepath'] = str(binding_file)
            bindings.append(binding_info)

    return bindings


def extract_device_info_from_binding(binding_file_path: Path) -> Optional[Dict[str, str]]:
    """
    Extract device information from a device tree binding file.

    Args:
        binding_file_path: Path to the YAML binding file

    Returns:
        Dictionary with device info or None if parsing fails
    """
    try:
        with open(binding_file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        device_info = {}

        # Extract title from YAML files
        title_match = re.search(r'^title:\s*(.+)$', content, re.MULTILINE)
        if title_match:
            device_info['title'] = title_match.group(1).strip()

        # Look for description
        desc_match = re.search(r'^description:\s*(.+)$', content, re.MULTILINE)
        if desc_match:
            device_info['description'] = desc_match.group(1).strip()

        # Look for compatible strings - extract ALL of them
        compatible_strings = extract_all_compatible_strings(content)
        if compatible_strings:
            device_info['compatible_strings'] = compatible_strings

        return device_info if device_info else None

    except Exception as e:
        print(f"Warning: Could not parse binding file {binding_file_path}: {e}")
        return None


def extract_all_compatible_strings(content: str) -> List[str]:
    """
    Extract all compatible strings from a device tree binding YAML file.

    This handles multiple formats:
    1. YAML enum format:
       compatible:
         enum:
           - vendor,device-variant1
           - vendor,device-variant2

    2. Quoted strings in text (legacy format):
       "vendor,device-variant"

    Args:
        content: The YAML file content as a string

    Returns:
        List of all compatible strings found
    """
    compatible_strings = []

    # Method 1: Extract from YAML enum format (most common in modern bindings)
    # Look for the compatible property followed by enum section
    enum_pattern = r'compatible:\s*\n\s*enum:\s*\n((?:\s*-\s*[^\n]+\n)*)'
    enum_match = re.search(enum_pattern, content, re.MULTILINE)

    if enum_match:
        enum_content = enum_match.group(1)
        # Extract each enum item (lines starting with -)
        enum_items = re.findall(r'^\s*-\s*([^\s\n]+)', enum_content, re.MULTILINE)
        compatible_strings.extend(enum_items)

    # Method 2: Look for const format (single compatible string)
    const_pattern = r'compatible:\s*\n\s*const:\s*([^\s\n]+)'
    const_match = re.search(const_pattern, content, re.MULTILINE)

    if const_match:
        compatible_strings.append(const_match.group(1))

    # Method 3: Look for quoted strings (legacy format)
    quoted_matches = re.findall(r'["\']([\w,\-]+,[\w\-]+)["\']', content)
    compatible_strings.extend(quoted_matches)

    # Method 4: Look for oneOf format (alternative listing)
    oneof_pattern = r'compatible:\s*\n\s*oneOf:\s*\n((?:\s*-\s*const:\s*[^\n]+\n)*)'
    oneof_match = re.search(oneof_pattern, content, re.MULTILINE)

    if oneof_match:
        oneof_content = oneof_match.group(1)
        # Extract each const item
        oneof_items = re.findall(r'^\s*-\s*const:\s*([^\s\n]+)', oneof_content, re.MULTILINE)
        compatible_strings.extend(oneof_items)

    # Remove duplicates while preserving order
    seen = set()
    result = []
    for item in compatible_strings:
        if item not in seen:
            seen.add(item)
            result.append(item)

    return result


def generate_device_id(binding_info: Dict[str, str]) -> str:
    """
    Generate a device ID for the catalog.

    Args:
        binding_info: Information extracted from binding file

    Returns:
        Device ID string
    """
    if 'compatible' in binding_info:
        return binding_info['compatible']
    else:
        # Fallback to filename with a generic vendor prefix
        filename = binding_info.get('filename', 'unknown')
        return f"generic,{filename}"


def generate_device_name(binding_info: Dict[str, str]) -> str:
    """
    Generate a human-readable device name.

    Args:
        binding_info: Information extracted from binding file

    Returns:
        Human-readable device name
    """
    if 'title' in binding_info:
        return binding_info['title']
    else:
        # Convert filename to a more readable format
        # Remove common prefixes and convert underscores/hyphens to spaces
        filename = binding_info.get('filename', 'unknown')
        name = filename
        name = re.sub(r'^(ad|adi|ltc|max|bmi|mpu|lsm|hmc|ak)', '', name, flags=re.IGNORECASE)
        name = name.replace('_', ' ').replace('-', ' ')
        name = ' '.join(word.capitalize() for word in name.split() if word)
        return name if name else filename.upper()


def generate_device_name_for_compatible(binding_info: Dict[str, str], compatible_string: str) -> str:
    """
    Generate a human-readable device name for a specific compatible string.

    Args:
        binding_info: Information extracted from binding file
        compatible_string: The specific compatible string (e.g., "adi,ad7124-4")

    Returns:
        Human-readable device name (e.g., "AD7124-4")
    """
    # Extract device part from compatible string (after the comma)
    if ',' in compatible_string:
        _, device_part = compatible_string.split(',', 1)

        # Convert to uppercase while preserving hyphens and underscores
        # This converts "ad7124-4" to "AD7124-4"
        return device_part.upper()
    else:
        # Fallback to original method if no comma found
        return generate_device_name(binding_info)


def generate_device_description(category: str, binding_info: Dict[str, str]) -> str:
    """
    Generate a device description.

    Args:
        category: Device category (e.g., 'adc', 'accel')
        binding_info: Information extracted from binding file

    Returns:
        Device description string
    """
    if 'description' in binding_info:
        return binding_info['description']

    # Generate a basic description based on category
    category_descriptions = {
        'accel': 'Accelerometer sensor',
        'adc': 'Analog-to-Digital Converter',
        'gyro': 'Gyroscope sensor',
        'magnetometer': 'Magnetometer sensor',
        'imu': 'Inertial Measurement Unit',
        'dac': 'Digital-to-Analog Converter',
        'proximity': 'Proximity sensor',
        'light': 'Light/Ambient light sensor',
        'pressure': 'Pressure sensor',
        'temperature': 'Temperature sensor',
        'humidity': 'Humidity sensor',
    }

    filename = binding_info.get('filename', 'unknown')
    base_desc = category_descriptions.get(category, f'{category.upper()} device')
    return f"{filename.upper()} - {base_desc}"


def generate_device_description_for_compatible(category: str, binding_info: Dict[str, str], compatible_string: str) -> str:
    """
    Generate a device description for a specific compatible string.

    Args:
        category: Device category (e.g., 'adc', 'accel')
        binding_info: Information extracted from binding file
        compatible_string: The specific compatible string (e.g., "adi,ad7124-4")

    Returns:
        Device description string
    """
    # Priority 1: Use title from binding file (this was the old name)
    if 'title' in binding_info:
        return binding_info['title']

    # Priority 2: Use description from binding file
    if 'description' in binding_info:
        return binding_info['description']

    # Priority 3: Generate a basic description based on category
    category_descriptions = {
        'accel': 'Accelerometer sensor',
        'adc': 'Analog-to-Digital Converter',
        'gyro': 'Gyroscope sensor',
        'magnetometer': 'Magnetometer sensor',
        'imu': 'Inertial Measurement Unit',
        'dac': 'Digital-to-Analog Converter',
        'proximity': 'Proximity sensor',
        'light': 'Light/Ambient light sensor',
        'pressure': 'Pressure sensor',
        'temperature': 'Temperature sensor',
        'humidity': 'Humidity sensor',
    }

    # Extract device part from compatible string for fallback description
    if ',' in compatible_string:
        _, device_part = compatible_string.split(',', 1)
        device_name = device_part.upper()
        base_description = category_descriptions.get(category, f'{category.upper()} device')
        return f"{device_name} - {base_description}"
    else:
        return category_descriptions.get(category, f'{category.upper()} device')


def main():
    parser = argparse.ArgumentParser(description='Generate device catalog for Analog Attach Extension')
    parser.add_argument('linux_repo_path', help='Path to Linux kernel repository')
    parser.add_argument('output_file', nargs='?', default='device_catalog.json',
                       help='Output JSON file (default: device_catalog.json)')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')
    parser.add_argument('--include-prefixes', '-p', nargs='*', default=['adi'],
                       help='Device ID prefixes to include (default: adi). Examples: --include-prefixes adi generic maxim')
    parser.add_argument('--include-all', '-a', action='store_true',
                       help='Include all devices regardless of prefix (overrides --include-prefixes)')

    args = parser.parse_args()

    linux_repo = Path(args.linux_repo_path)
    output_file = Path(args.output_file)

    # Validate paths
    bindings_iio_path = linux_repo / 'Documentation' / 'devicetree' / 'bindings' / 'iio'

    if not bindings_iio_path.exists():
        print(f"Error: Bindings path does not exist: {bindings_iio_path}")
        sys.exit(1)

    print(f"Scanning Linux repository: {linux_repo}")
    print(f"Bindings path: {bindings_iio_path}")

    # Configure filtering
    if args.include_all:
        print("Including all devices (no prefix filtering)")
        include_prefixes = None
    else:
        include_prefixes = [prefix.lower() for prefix in args.include_prefixes]
        print(f"Including devices with prefixes: {', '.join(include_prefixes)}")

    devices = []
    categories = get_iio_categories(bindings_iio_path)

    print(f"Found {len(categories)} IIO categories: {', '.join(categories)}")

    for category in categories:
        if args.verbose:
            print(f"\nProcessing category: {category}")

        # Scan bindings in this category
        category_bindings_path = bindings_iio_path / category
        bindings = scan_bindings_in_category(category_bindings_path)

        if args.verbose:
            print(f"  Found {len(bindings)} bindings")

        # Process each binding file
        for binding_info in bindings:
            # Get all compatible strings from this binding file
            compatible_strings = binding_info.get('compatible_strings', [])

            if not compatible_strings:
                # No compatible strings found, create a fallback device
                device_id = generate_device_id(binding_info)
                device_name = generate_device_name(binding_info)
                device_desc = generate_device_description(category, binding_info)

                device = Device(
                    deviceId=device_id,
                    name=device_name,
                    description=device_desc,
                    group=category
                )

                # Apply prefix filtering
                should_include = False
                if include_prefixes is None:
                    should_include = True
                else:
                    for prefix in include_prefixes:
                        if device_id.lower().startswith(prefix + ','):
                            should_include = True
                            break

                if should_include:
                    devices.append(device)
                    if args.verbose:
                        print(f"    ✓ {binding_info.get('filename', 'unknown')} -> {device_id}")
                else:
                    if args.verbose:
                        print(f"    ✗ {binding_info.get('filename', 'unknown')} -> {device_id} (filtered out by prefix)")
            else:
                # Create a device entry for each compatible string
                for compatible_string in compatible_strings:
                    device_id = compatible_string
                    device_name = generate_device_name_for_compatible(binding_info, compatible_string)
                    device_desc = generate_device_description_for_compatible(category, binding_info, compatible_string)

                    device = Device(
                        deviceId=device_id,
                        name=device_name,
                        description=device_desc,
                        group=category
                    )

                    # Apply prefix filtering
                    should_include = False
                    if include_prefixes is None:
                        should_include = True
                    else:
                        for prefix in include_prefixes:
                            if device_id.lower().startswith(prefix + ','):
                                should_include = True
                                break

                    if should_include:
                        devices.append(device)
                        if args.verbose:
                            print(f"    ✓ {binding_info.get('filename', 'unknown')} -> {device_id}")
                    else:
                        if args.verbose:
                            print(f"    ✗ {binding_info.get('filename', 'unknown')} -> {device_id} (filtered out by prefix)")

    print(f"\nGenerated catalog with {len(devices)} devices")

    # Create the catalog structure according to the API format
    catalog = {
        "devices": [asdict(device) for device in devices]
    }

    # Get git information from the Linux repository
    git_branch = "unknown"
    git_commit = "unknown"
    try:
        # Get current branch
        import subprocess
        branch_result = subprocess.run(['git', 'branch', '--show-current'],
                                     cwd=linux_repo, capture_output=True, text=True, timeout=5)
        if branch_result.returncode == 0:
            git_branch = branch_result.stdout.strip()

        # Get current commit SHA
        commit_result = subprocess.run(['git', 'rev-parse', 'HEAD'],
                                     cwd=linux_repo, capture_output=True, text=True, timeout=5)
        if commit_result.returncode == 0:
            git_commit = commit_result.stdout.strip()[:12]  # Short SHA
    except Exception:
        # If git commands fail, keep default values
        pass

    # Write the JSON file with header
    with open(output_file, 'w', encoding='utf-8') as f:
        # Write header comment
        f.write('/*\n')
        f.write(' * AUTO-GENERATED FILE - DO NOT EDIT MANUALLY\n')
        f.write(' * \n')
        f.write(' * This device catalog was automatically generated by generate_device_catalog.py\n')
        f.write(' * from Linux kernel device tree bindings.\n')
        f.write(' * \n')
        f.write(f' * Generated on: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}\n')
        f.write(f' * Source: {linux_repo}\n')
        f.write(f' * Git branch: {git_branch}\n')
        f.write(f' * Git commit: {git_commit}\n')
        f.write(f' * Bindings path: {bindings_iio_path}\n')
        if include_prefixes:
            f.write(f' * Included prefixes: {", ".join(include_prefixes)}\n')
        else:
            f.write(' * Included: All devices (no prefix filtering)\n')
        f.write(f' * Total devices: {len(devices)}\n')
        f.write(' * \n')
        f.write(' * To regenerate this file, run:\n')
        if include_prefixes:
            f.write(f' *   python3 generate_device_catalog.py {linux_repo} {output_file} --include-prefixes {" ".join(args.include_prefixes)}\n')
        elif args.include_all:
            f.write(f' *   python3 generate_device_catalog.py {linux_repo} {output_file} --include-all\n')
        else:
            f.write(f' *   python3 generate_device_catalog.py {linux_repo} {output_file}\n')
        f.write(' */\n')

        # Write the JSON content
        json.dump(catalog, f, indent=2, ensure_ascii=False)

    print(f"Device catalog written to: {output_file}")

    # Print summary statistics
    category_counts = {}
    for device in devices:
        category = device.group
        category_counts[category] = category_counts.get(category, 0) + 1

    print("\nCategory breakdown:")
    for category, count in sorted(category_counts.items()):
        print(f"  {category}: {count} devices")


if __name__ == "__main__":
    main()