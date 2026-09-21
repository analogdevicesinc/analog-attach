#compdef attach-linux

_attach_linux_suggest() {
    local -a results
    results=(${(f)"$(attach-linux --json suggest "$@" 2>/dev/null | grep -o '"value":"[^"]*"' | sed 's/"value":"//;s/"$//')"})
    compadd -o nosort -- "${results[@]}"
}

_attach_linux_device_keys() {
    _attach_linux_suggest device-key "${words[CURRENT]}"
}

_attach_linux_parents() {
    local key="" skip_next=false
    local w
    for w in "${words[@]}"; do
        if $skip_next; then
            skip_next=false
            continue
        fi
        case "$w" in
            attach-linux|add|--json) ;;
            --name|--to|--label|--overlay|--context|--linux|--dt-schema)
                skip_next=true ;;
            --*) ;;
            *) [[ -n "$w" ]] && { key="$w"; break } ;;
        esac
    done
    [[ -z "$key" ]] && return
    _attach_linux_suggest parent "$key"
}

_attach_linux_navigate() {
    local -a segments
    local skip_next=false w i
    for (( i = 1; i < CURRENT; i++ )); do
        w="${(Q)words[i]}"
        if $skip_next; then
            skip_next=false
            continue
        fi
        case "$w" in
            attach-linux|update|read|delete|--json) ;;
            --with|--overlay|--context|--linux|--dt-schema)
                skip_next=true ;;
            --*) ;;
            *) [[ -n "$w" ]] && segments+=("$w") ;;
        esac
    done
    _attach_linux_suggest navigate "${segments[@]}"
}

_attach_linux() {
    local curcontext="$curcontext" state line
    typeset -A opt_args

    _arguments -C \
        '(-h --help)'{-h,--help}'[Print help information and exit]' \
        '(-v --version)'{-v,--version}'[Print version information and exit]' \
        '--json[Output as JSON]' \
        '1:command:->commands' \
        '*::arg:->args'

    case $state in
        commands)
            local -a commands=(
                'attach-manifest:Write the attach-meta manifest and print its path'
                'config-get:Get tool configuration fields'
                'config-set:Set a tool configuration field'
                'create-workfile:Create a new workfile (DTSO overlay)'
                'list-devices:List available devices from the compat index'
                'add:Add a new node to an existing dtso'
                'read:Read a node subtree or property value'
                'update:Update a property value on a node'
                'delete:Delete a node or property from an existing dtso'
                'validate:Validate a device node against its binding'
                'validate2:Validate a device node against its binding (alt)'
                'move:Move an overlay-added node to a different parent'
                'rename:Rename an overlay-added node'
                'list-intelligence:List available suggestion kinds'
                'suggest:Provide suggestions for a given intelligence kind'
                'build:Compile the overlay DTSO into a DTBO using dtc'
                'deploy:Copy the compiled DTBO to a remote device and reboot it'
                'get-schema:Get the parsed binding schema for a device'
                'enable:Enable a node by setting status = okay'
                'disable:Disable a node by setting status = disabled'
                'install-skill:Install the Attach skill for Claude Code'
                'uninstall-skill:Uninstall the Attach skill'
                'completion:Generate shell completion script'
            )
            _describe 'command' commands
            ;;
        args)
            case $line[1] in
                add)
                    _arguments \
                        ':device key / compatible string:_attach_linux_device_keys' \
                        '--name[Node name (e.g. channel@0)]:name:' \
                        '--to[Parent node]:to:_attach_linux_parents' \
                        '--label[Label to attach to the new node]:label:' \
                        '--overlay[Path to the dtso file]:overlay:_files' \
                        '--context[The target dts]:context:_files' \
                        '--linux[Path to Linux repo]:linux:_files -/' \
                        '--dt-schema[Path to dt-schema repo]:dt-schema:_files -/'
                    ;;
                create-workfile)
                    _arguments \
                        '--name[Output filename (default: overlay.dtso)]:name:'
                    ;;
                validate)
                    _arguments \
                        '--overlay[Path to the dtso file]:overlay:_files' \
                        '--linux[Path to Linux repo]:linux:_files -/' \
                        '--dt-schema[Path to dt-schema repo]:dt-schema:_files -/' \
                        '--context[The target dts]:context:_files' \
                        '*:args:'
                    ;;
                enable|disable)
                    _arguments \
                        '--node[Target node]:node:' \
                        '--overlay[Path to the dtso file]:overlay:_files' \
                        '--context[The target dts]:context:_files'
                    ;;
                delete)
                    _arguments \
                        '--overlay[Path to the dtso file]:overlay:_files' \
                        '--context[The target dts]:context:_files' \
                        '--force[Force deletion]' \
                        '*:path:_attach_linux_navigate'
                    ;;
                read)
                    _arguments \
                        '--overlay[Path to the dtso file]:overlay:_files' \
                        '--context[The target dts]:context:_files' \
                        '*:path:_attach_linux_navigate'
                    ;;
                update)
                    _arguments \
                        '--with[Value to set]:value:' \
                        '--overlay[Path to the dtso file]:overlay:_files' \
                        '--context[The target dts]:context:_files' \
                        '--linux[Path to Linux repo]:linux:_files -/' \
                        '--dt-schema[Path to dt-schema repo]:dt-schema:_files -/' \
                        '*:path:_attach_linux_navigate'
                    ;;
                move)
                    _arguments \
                        '--to[New parent node]:to:' \
                        '--overlay[Path to the dtso file]:overlay:_files' \
                        '--context[The target dts]:context:_files' \
                        '*:args:'
                    ;;
                rename)
                    _arguments \
                        '--to[New name]:to:' \
                        '--overlay[Path to the dtso file]:overlay:_files' \
                        '--context[The target dts]:context:_files' \
                        '*:args:'
                    ;;
                get-schema)
                    _arguments \
                        '--compatible[Compatible string]:compatible:_attach_linux_device_keys' \
                        '--context[The target dts]:context:_files' \
                        '--linux[Path to Linux repo]:linux:_files -/' \
                        '--dt-schema[Path to dt-schema repo]:dt-schema:_files -/'
                    ;;
                validate2)
                    _arguments \
                        '--overlay[Path to the dtso file]:overlay:_files' \
                        '--linux[Path to Linux repo]:linux:_files -/' \
                        '--dt-schema[Path to dt-schema repo]:dt-schema:_files -/' \
                        '--context[The target dts]:context:_files' \
                        '*:args:'
                    ;;
                build)
                    _arguments \
                        '--overlay[Path to the DTSO overlay to compile]:overlay:_files' \
                        '--build-command[dtc command template ({input}/{output} substituted)]:build-command:'
                    ;;
                deploy)
                    _arguments \
                        '--dtbo[Path to the compiled DTBO to deploy]:dtbo:_files' \
                        '--ip[IP address or hostname of the remote device]:ip:' \
                        '--user[SSH username on the remote device]:user:' \
                        '--password[SSH password on the remote device]:password:'
                    ;;
                attach-manifest|list-intelligence)
                    _arguments
                    ;;
                list-devices)
                    _arguments \
                        '--includes-word[Filter word]:word:'
                    ;;
                suggest)
                    _arguments '*:args:'
                    ;;
                completion)
                    _arguments '1:shell:(bash fish zsh)'
                    ;;
                config-get)
                    _arguments '*:field:(linux dt-schema context overlay)'
                    ;;
                config-set)
                    _arguments \
                        '1:field:(linux dt-schema context overlay)' \
                        '2:value:_files'
                    ;;
            esac
            ;;
    esac
}

_attach_linux "$@"
