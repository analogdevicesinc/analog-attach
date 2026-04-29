const vscode = acquireVsCodeApi();

vscode.postMessage({ command: "loadSession" });

window.addEventListener('message', event => {

    const commands = {
        loadSession: 'loadSession',
        loadDrivers: 'loadDrivers',
        populateDriver: 'populateDriver',
    };

    const message = event.data;
    console.log(`Received ${JSON.stringify(message)}`);

    switch (message.command) {
        case commands.loadSession:
            {
                const platform_select = document.getElementById("selectPlatform");
                const driver_type_select = document.getElementById("selectDriverType");
                const driver_select = document.getElementById("selectDriver");
                const attach_document = document.getElementById("attachDriverButton");
                const attached_drivers = document.getElementById("attachedDrivers");

                for (let i = 0; i < message.platforms.length; i++) {
                    const opt = message.platforms[i];
                    const el = document.createElement("option");
                    el.textContent = opt;
                    el.value = opt;
                    platform_select.appendChild(el);
                }

                for (let i = 0; i < message.driver_types.length; i++) {
                    const opt = message.driver_types[i];
                    const el = document.createElement("option");
                    el.textContent = opt;
                    el.value = opt;
                    driver_type_select.appendChild(el);
                }

                if (message.selected_platform === "") {
                    return;
                }

                platform_select.value = message.selected_platform;

                if (message.selected_driver_type === "") {
                    return;
                }

                driver_type_select.value = message.selected_driver_type;

                for (let i = 0; i < message.current_drivers.length; i++) {
                    const opt = message.current_drivers[i];
                    const el = document.createElement("option");
                    el.textContent = opt;
                    el.value = opt;
                    driver_select.appendChild(el);
                }

                driver_select.value = message.selected_driver;
                attach_document.disabled = false;

                for (let i = 0; i < message.added_drivers.length; i++) {
                    const driver = message.added_drivers[i];
                    const driver_container = create_driver_container(driver.name, driver.uuid, driver.data);
                    attached_drivers.appendChild(driver_container);
                }

            }
            break;
        case commands.loadDrivers:
            {
                const driver_select = document.getElementById("selectDriver");

                driver_select.innerHTML = '<option value="" selected disabled hidden>Choose Driver</option>';

                for (let i = 0; i < message.data.length; i++) {
                    const opt = message.data[i];
                    const el = document.createElement("option");
                    el.textContent = opt;
                    el.value = opt;
                    driver_select.appendChild(el);
                }
            }
            break;
        case commands.populateDriver:
            {
                const driver_container = create_driver_container(message.driver_name, message.uuid, message.data);

                const attached_drivers = document.getElementById("attachedDrivers");

                attached_drivers.appendChild(driver_container);
            }
    }
});

document.getElementById("selectPlatform").addEventListener("change", function () {

    const message = {
        command: 'changedPlatform',
        new_platform: this.value

    };

    if (this.value) {
        vscode.postMessage(message);
        console.log(`Sent ${JSON.stringify(message)}`);
    }

});

document.getElementById("selectDriverType").addEventListener("change", function () {

    const message = {
        command: 'changedDriverType',
        new_driver_type: this.value
    };

    if (this.value) {
        vscode.postMessage(message);
        console.log(`Sent ${JSON.stringify(message)}`);
    }

});

document.getElementById("selectDriver").addEventListener("change", function () {

    const message = {
        command: 'changedDriver',
        new_driver: this.value
    };

    if (this.value) {
        vscode.postMessage(message);

        const attach_document = document.getElementById("attachDriverButton");
        attach_document.disabled = false;

        console.log(`Sent ${JSON.stringify(message)}`);
    }

});

document.getElementById("attachDriverButton").addEventListener("click", function () {

    const message = {
        command: 'validateDriver',
    };

    vscode.postMessage(message);

    console.log(`Sent ${JSON.stringify(message)}`);

});

function create_driver_container(driver_name, driver_uuid, driver_data) {
    const container = document.createElement("div");
    container.id = driver_uuid;

    const text = document.createElement("div");
    text.textContent = driver_name;

    container.appendChild(text);

    render_children(container, driver_data.children, driver_uuid, [driver_data.type.type_name]);

    const delete_button = document.createElement("button");
    delete_button.textContent = "Delete";

    delete_button.addEventListener("click", () => {
        const to_delete = document.getElementById(driver_uuid);
        to_delete.remove();

        const message = {
            command: 'removedDriver',
            removed_driver: driver_name,
            uuid: driver_uuid
        };

        vscode.postMessage(message);

        console.log(`Sent ${JSON.stringify(message)}`);
    });

    container.appendChild(delete_button);

    return container;
}

function render_children(parent_container, children, uuid, member_path) {

    for (const child of children) {

        const element = child.type;

        switch (element.type) {
            case "union":
                {
                    const union_container = document.createElement("div");
                    union_container.textContent = element.name;
                    union_container.style.border = "1px solid black";

                    const pick_variant = document.createElement("select");
                    pick_variant.id = element.name;

                    const variant_container = document.createElement("div");
                    variant_container.id = element.name + ".variant";

                    const render_variants = (value) => {

                        variant_container.innerHTML = '';

                        const variant = child.children.find((child) => { return child.type.type_name === value; });

                        const new_member_path = member_path.concat(element.name);

                        render_children(variant_container, [variant], uuid, new_member_path);
                    };

                    pick_variant.innerHTML = '<option value="" selected disabled hidden>Choose Variant</option>';

                    for (const pick of element.possible_values) {
                        const option = document.createElement("option");
                        option.value = pick;
                        option.text = pick;
                        pick_variant.appendChild(option);
                    }

                    if (element.selected_value !== '') {
                        pick_variant.value = element.selected_value;
                        render_variants(element.selected_value);
                    }

                    const updateBackend = () => {

                        const new_member_path = member_path.concat(element.name);

                        const message = {
                            command: "driverConfigUpdate",
                            uuid: uuid,
                            member_path: new_member_path,
                            new_value: pick_variant.value
                        };

                        vscode.postMessage(message);

                        console.log(`Sent ${JSON.stringify(message)}`);

                        render_variants(pick_variant.value);
                    };

                    pick_variant.addEventListener("change", updateBackend);

                    union_container.appendChild(document.createElement("br"));
                    union_container.appendChild(pick_variant);
                    union_container.appendChild(variant_container);
                    parent_container.appendChild(union_container);
                }
                break;
            case "struct":
                {
                    const struct_container = document.createElement("div");
                    struct_container.textContent = element.name;
                    struct_container.style.border = "1px solid black";

                    const new_member_path = member_path.concat(element.name);

                    render_children(struct_container, child.children, uuid, new_member_path);

                    parent_container.appendChild(struct_container);
                }
                break;
            case "enum":
                {
                    const enum_container = document.createElement("div");
                    enum_container.textContent = element.name;
                    enum_container.style.border = "1px solid black";

                    const pick_variant = document.createElement("select");
                    pick_variant.id = element.name;

                    pick_variant.innerHTML = '<option value="" selected disabled hidden>Choose Variant</option>';

                    for (const possible_variant of element.possible_values) {
                        const option = document.createElement("option");
                        option.value = possible_variant;
                        option.text = possible_variant;
                        pick_variant.appendChild(option);
                    }

                    if (element.selected_value !== "") {
                        pick_variant.value = element.selected_value;
                    }

                    const updateBackend = () => {
                        const command = "driverConfigUpdate";

                        const new_member_path = member_path.concat(element.name);

                        const message = {
                            command: command,
                            uuid: uuid,
                            member_path: new_member_path,
                            new_value: pick_variant.value
                        };

                        vscode.postMessage(message);

                        console.log(`Sent ${JSON.stringify(message)}`);
                    };

                    pick_variant.addEventListener("change", updateBackend);

                    enum_container.appendChild(document.createElement("br"));
                    enum_container.appendChild(pick_variant);
                    parent_container.appendChild(enum_container);
                }
                break;
            case "pointer":
                {
                    const pointer_container = document.createElement("div");
                    pointer_container.textContent = element.name;

                    pointer_container.style.border = "1px solid black";
                    pointer_container.style.padding = "20px";

                    const pick_variant = document.createElement("select");

                    const option = document.createElement("option");
                    option.value = element.value;
                    option.text = element.value;
                    pick_variant.appendChild(option);

                    pointer_container.appendChild(document.createElement("br"));
                    pointer_container.appendChild(pick_variant);
                    parent_container.appendChild(pointer_container);
                }
                break;
            case "integral":
                {
                    const integral_container = document.createElement("div");
                    integral_container.textContent = element.name;
                    integral_container.style.border = "1px solid black";
                    integral_container.style.padding = "20px";

                    const input = document.createElement("input");
                    input.id = element.name;
                    input.pattern = "\\d*";
                    input.value = element.value;

                    switch (element.type_name) {
                        default:
                            {
                                input.min = 0;
                                input.max = 255;
                            }
                            break;
                    }

                    const updateBackend = () => {
                        const min = parseInt(input.min, 10);
                        const max = parseInt(input.max, 10);
                        const value = parseInt(input.value, 10);

                        if (isNaN(value)) {
                            input.value = 0;
                            value = 0;
                        } else if (value < min) {
                            input.value = min;
                            value = min;
                        } else if (value > max) {
                            input.value = max;
                            value = max;
                        }

                        const command = "driverConfigUpdate";

                        const new_member_path = member_path.concat(element.name);

                        const message = {
                            command: command,
                            uuid: uuid,
                            member_path: new_member_path,
                            new_value: value
                        };

                        vscode.postMessage(message);

                        console.log(`Sent ${JSON.stringify(message)}`);
                    };

                    input.addEventListener("input", updateBackend);

                    integral_container.appendChild(input);
                    integral_container.appendChild(document.createElement("br"));
                    parent_container.appendChild(integral_container);
                }
                break;
        }
    }
}