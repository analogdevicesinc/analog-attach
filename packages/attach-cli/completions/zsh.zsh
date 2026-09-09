#compdef attach

_attach_suggest() {
    local -a results
    results=(${(f)"$(attach --json suggest "$@" 2>/dev/null | grep -o '"value":"[^"]*"' | sed 's/"value":"//;s/"$//')"})
    compadd -o nosort -- "${results[@]}"
}

_attach_device_keys() {
    _attach_suggest device-key "${words[CURRENT]}"
}

_attach_parents() {
    local key="" skip_next=false
    local w
    for w in "${words[@]}"; do
        if $skip_next; then
            skip_next=false
            continue
        fi
        case "$w" in
            attach|add|--json) ;;
            --name|--to|--label|--overlay|--context|--linux|--dt-schema)
                skip_next=true ;;
            --*) ;;
            *) [[ -n "$w" ]] && { key="$w"; break } ;;
        esac
    done
    [[ -z "$key" ]] && return
    _attach_suggest parent "$key"
}

_attach() {
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
                'add:Add a new node to an existing dtso'
                'read:Read a node subtree or property value'
                'update:Update a property value on a node'
                'delete:Delete a node or property from an existing dtso'
                'validate:Validate a device node against its binding'
                'move:Move an overlay-added node to a different parent'
                'rename:Rename an overlay-added node'
                'create-workfile:Create a new workfile (DTSO overlay)'
                'list-devices:List available devices from the compat index'
                'suggest:Provide suggestions for a given intelligence kind'
                'init:Create config.toml and compat-index.json'
                'create:Create dtso of the node with set compatible'
                'get-schema:Get the parsed binding schema for a device'
                'suggest-parents:Suggest valid parent nodes for a device'
                'get-prop:Get the value of a property from a DTSO'
                'set-prop:Set the value of a property in a dtso'
                'unset-prop:Remove a property set by the overlay'
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
                        ':device key / compatible string:_attach_device_keys' \
                        '--name[Node name (e.g. channel@0)]:name:' \
                        '--to[Parent node]:to:_attach_parents' \
                        '--label[Label to attach to the new node]:label:' \
                        '--overlay[Path to the dtso file]:overlay:_files' \
                        '--context[The target dts]:context:_files' \
                        '--linux[Path to Linux repo]:linux:_files -/' \
                        '--dt-schema[Path to dt-schema repo]:dt-schema:_files -/'
                    ;;
                create-workfile)
                    _arguments \
                        '--compatible[Compatible string]:compatible:_attach_device_keys' \
                        '--parent[Parent node]:parent:' \
                        '--label[Label for the new node]:label:' \
                        '--linux[Path to Linux repo]:linux:_files -/' \
                        '--dt-schema[Path to dt-schema repo]:dt-schema:_files -/'
                    ;;
                create)
                    _arguments \
                        '--compatible[Compatible string]:compatible:_attach_device_keys' \
                        '--parent[Parent node]:parent:' \
                        '--label[Label for the new node]:label:' \
                        '--output[Output file]:output:_files' \
                        '--linux[Path to Linux repo]:linux:_files -/' \
                        '--dt-schema[Path to dt-schema repo]:dt-schema:_files -/'
                    ;;
                validate)
                    _arguments \
                        '--overlay[Path to the dtso file]:overlay:_files' \
                        '--linux[Path to Linux repo]:linux:_files -/' \
                        '--dt-schema[Path to dt-schema repo]:dt-schema:_files -/' \
                        '--context[The target dts]:context:_files' \
                        '*:args:'
                    ;;
                set-prop)
                    _arguments \
                        '--node[Target node]:node:' \
                        '--property[Property name]:property:' \
                        '--value[Property value]:value:' \
                        '--overlay[Path to the dtso file]:overlay:_files' \
                        '--context[The target dts]:context:_files' \
                        '--linux[Path to Linux repo]:linux:_files -/' \
                        '--dt-schema[Path to dt-schema repo]:dt-schema:_files -/'
                    ;;
                get-prop)
                    _arguments \
                        '--node[Target node]:node:' \
                        '--property[Property name]:property:' \
                        '--overlay[Path to the dtso file]:overlay:_files'
                    ;;
                unset-prop)
                    _arguments \
                        '--node[Target node]:node:' \
                        '--property[Property name]:property:' \
                        '--overlay[Path to the dtso file]:overlay:_files' \
                        '--context[The target dts]:context:_files'
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
                        '*:args:'
                    ;;
                read)
                    _arguments \
                        '--overlay[Path to the dtso file]:overlay:_files' \
                        '--context[The target dts]:context:_files' \
                        '*:args:'
                    ;;
                update)
                    _arguments \
                        '--with[Value to set]:value:' \
                        '--overlay[Path to the dtso file]:overlay:_files' \
                        '--context[The target dts]:context:_files' \
                        '--linux[Path to Linux repo]:linux:_files -/' \
                        '--dt-schema[Path to dt-schema repo]:dt-schema:_files -/' \
                        '*:args:'
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
                get-schema|suggest-parents)
                    _arguments \
                        '--compatible[Compatible string]:compatible:_attach_device_keys' \
                        '--context[The target dts]:context:_files' \
                        '--linux[Path to Linux repo]:linux:_files -/' \
                        '--dt-schema[Path to dt-schema repo]:dt-schema:_files -/'
                    ;;
                init)
                    _arguments \
                        '--linux[Path to Linux repo]:linux:_files -/' \
                        '--dt-schema[Path to dt-schema repo]:dt-schema:_files -/' \
                        '--context[The target dts]:context:_files'
                    ;;
                list-devices)
                    _arguments \
                        '--includes-word[Filter word]:word:'
                    ;;
                suggest)
                    _arguments '*:args:'
                    ;;
                completion)
                    _arguments '1:shell:(bash zsh)'
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

_attach "$@"
