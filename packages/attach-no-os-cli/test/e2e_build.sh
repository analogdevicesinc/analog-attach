#!/bin/bash
# End-to-end test: create a workfile, configure adxl355 device, generate and build
# This test uses the real CLI and no-OS build system - nothing mocked

set -e  # Exit on any error

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$(dirname "$CLI_DIR")")"
NOOS_PATH="/home/andrei-fabian/adi/no-OS"
TEST_DIR=$(mktemp -d)
PROJECT_NAME="e2e_test_adxl355"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    rm -rf "$TEST_DIR"
    # Clean up generated project in no-OS if it exists
    rm -rf "$NOOS_PATH/projects/$PROJECT_NAME"
}
trap cleanup EXIT

echo -e "${YELLOW}=== E2E Build Test ===${NC}"
echo "Test directory: $TEST_DIR"
echo "no-OS path: $NOOS_PATH"
echo ""

# Build the CLI first
echo -e "${YELLOW}[1/8] Building CLI...${NC}"
cd "$CLI_DIR"
yarn build > /dev/null 2>&1
AA="node $CLI_DIR/dist/cli.js"

# Set up config
echo -e "${YELLOW}[2/8] Configuring paths...${NC}"
cd "$TEST_DIR"

# Point to the test schemas
export ATTACH_SCHEMAS_PATH="$REPO_ROOT/packages/attach-no-os-lib/test/bindings/schemas"
$AA config no_os_path "$NOOS_PATH"

# Create workfile for max32690
echo -e "${YELLOW}[3/8] Creating workfile for max32690...${NC}"
$AA create workfile --platform max32690

if [ ! -f "workfile.json" ]; then
    echo -e "${RED}FAIL: workfile.json not created${NC}"
    exit 1
fi
echo -e "${GREEN}OK: workfile.json created${NC}"

# Create nodes. A device is a descriptor node (adxl355_device) paired with its
# init_param struct (adxl355_ip); the init_param references the no-OS SPI init_param,
# which in turn references the platform (Maxim) SPI init_param.
echo -e "${YELLOW}[4/8] Creating ADXL355 device nodes...${NC}"
$AA create node max_spi_ip platforms/maxim/max32690/max_spi_init_param.yaml
$AA create node no_os_spi_ip no-os/spi/no_os_spi_init_param.yaml
$AA create node adxl355_ip devices/adxl355/adxl355_init_param.yaml
$AA create node adxl355_device devices/adxl355/adxl355.yaml

# Configure the Maxim SPI init_param
echo -e "${YELLOW}[5/8] Configuring SPI parameters...${NC}"
$AA update max_spi_ip vssel MXC_GPIO_VSSEL_VDDIOH
$AA update max_spi_ip polarity SPI_SS_POL_LOW

# Configure the no-OS SPI init_param (references the Maxim ops + extra)
$AA update no_os_spi_ip device_id 1
$AA update no_os_spi_ip max_speed_hz 1000000
$AA update no_os_spi_ip chip_select 0
$AA update no_os_spi_ip platform_ops max_spi_ops
$AA update no_os_spi_ip extra max_spi_ip

# Configure the ADXL355 init_param (comm_init is a union: <member> <value>)
$AA update adxl355_ip comm_type ADXL355_SPI_COMM
$AA update adxl355_ip dev_type ID_ADXL355
$AA update adxl355_ip comm_init spi_init no_os_spi_ip

# Point the descriptor at its init_param
$AA update adxl355_device init_param adxl355_ip

echo -e "${GREEN}OK: Device configured${NC}"

# Validate
echo -e "${YELLOW}[6/8] Validating workfile...${NC}"
VALIDATE_OUTPUT=$($AA validate --json 2>&1)
if echo "$VALIDATE_OUTPUT" | grep -q '"valid": true'; then
    echo -e "${GREEN}OK: Validation passed${NC}"
else
    echo -e "${RED}FAIL: Validation errors:${NC}"
    echo "$VALIDATE_OUTPUT"
    exit 1
fi

# Generate project
echo -e "${YELLOW}[7/8] Generating no-OS project...${NC}"
$AA generate "$PROJECT_NAME" --output "$NOOS_PATH/projects"

if [ ! -d "$NOOS_PATH/projects/$PROJECT_NAME" ]; then
    echo -e "${RED}FAIL: Project not generated${NC}"
    exit 1
fi
echo -e "${GREEN}OK: Project generated at $NOOS_PATH/projects/$PROJECT_NAME${NC}"

# List generated files
echo "Generated files:"
find "$NOOS_PATH/projects/$PROJECT_NAME" -type f | sort | while read -r f; do
    echo "  $f"
done

# Build the project using aa build
echo -e "${YELLOW}[8/8] Building project with aa build...${NC}"

# The build needs PLATFORM and TARGET set
export PLATFORM=maxim
export TARGET=max32690

if $AA build "$NOOS_PATH/projects/$PROJECT_NAME" 2>&1 | tee /tmp/build_output.log | tail -20; then
    echo -e "${GREEN}OK: Build successful${NC}"
else
    echo -e "${RED}FAIL: Build failed${NC}"
    echo "Last 50 lines of build output:"
    tail -50 /tmp/build_output.log
    exit 1
fi

echo ""
echo -e "${GREEN}=== ALL TESTS PASSED ===${NC}"
