# fish completion for attach-linux
#
# Enable with:  attach-linux completion fish | source
# or install to ~/.config/fish/completions/attach-linux.fish

function __attach_linux_suggest
    # Emit one candidate per line from the CLI's JSON `suggest` protocol.
    attach-linux --json suggest $argv 2>/dev/null | string match -rag '"value":"([^"]*)"'
end

# The compatible key `add` is operating on: first positional after `add`.
function __attach_linux_parents
    set -l tokens (commandline -opc)
    set -l key ""
    set -l skip 0
    for i in (seq 2 (count $tokens))
        set -l w $tokens[$i]
        if test $skip -eq 1
            set skip 0
            continue
        end
        switch $w
            case add --json
            case --name --to --label --overlay --context --linux --dt-schema
                set skip 1
            case '--*'
            case '*'
                set key $w
                break
        end
    end
    test -n "$key"; and __attach_linux_suggest parent $key
end

# The path segments already typed for read/update/delete, excluding the word
# currently being completed.
function __attach_linux_navigate
    set -l tokens (commandline -opc)
    set -l segments
    set -l skip 0
    for i in (seq 2 (count $tokens))
        set -l w $tokens[$i]
        if test $skip -eq 1
            set skip 0
            continue
        end
        switch $w
            case read update delete --json
            case --with --overlay --context --linux --dt-schema
                set skip 1
            case '--*'
            case '*'
                set segments $segments $w
        end
    end
    __attach_linux_suggest navigate $segments
end

# Global options.
complete -c attach-linux -l json -d 'Output as JSON'
complete -c attach-linux -s h -l help -d 'Print help information and exit'
complete -c attach-linux -s v -l version -d 'Print version information and exit'

# Subcommands.
complete -c attach-linux -f -n __fish_use_subcommand -a attach-manifest -d 'Write the attach-meta manifest and print its path'
complete -c attach-linux -f -n __fish_use_subcommand -a config-get -d 'Get tool configuration fields'
complete -c attach-linux -f -n __fish_use_subcommand -a config-set -d 'Set a tool configuration field'
complete -c attach-linux -f -n __fish_use_subcommand -a create-workfile -d 'Create a new workfile (DTSO overlay)'
complete -c attach-linux -f -n __fish_use_subcommand -a list-devices -d 'List available devices from the compat index'
complete -c attach-linux -f -n __fish_use_subcommand -a add -d 'Add a new node to an existing dtso'
complete -c attach-linux -f -n __fish_use_subcommand -a read -d 'Read a node subtree or property value'
complete -c attach-linux -f -n __fish_use_subcommand -a update -d 'Update a property value on a node'
complete -c attach-linux -f -n __fish_use_subcommand -a delete -d 'Delete a node or property from an existing dtso'
complete -c attach-linux -f -n __fish_use_subcommand -a validate -d 'Validate a device node against its binding'
complete -c attach-linux -f -n __fish_use_subcommand -a validate2 -d 'Validate a device node against its binding (alt)'
complete -c attach-linux -f -n __fish_use_subcommand -a move -d 'Move an overlay-added node to a different parent'
complete -c attach-linux -f -n __fish_use_subcommand -a rename -d 'Rename an overlay-added node'
complete -c attach-linux -f -n __fish_use_subcommand -a list-intelligence -d 'List available suggestion kinds'
complete -c attach-linux -f -n __fish_use_subcommand -a suggest -d 'Provide suggestions for a given intelligence kind'
complete -c attach-linux -f -n __fish_use_subcommand -a build -d 'Compile the overlay DTSO into a DTBO using dtc'
complete -c attach-linux -f -n __fish_use_subcommand -a deploy -d 'Copy the compiled DTBO to a remote device and reboot it'
complete -c attach-linux -f -n __fish_use_subcommand -a get-schema -d 'Get the parsed binding schema for a device'
complete -c attach-linux -f -n __fish_use_subcommand -a enable -d 'Enable a node by setting status = okay'
complete -c attach-linux -f -n __fish_use_subcommand -a disable -d 'Disable a node by setting status = disabled'
complete -c attach-linux -f -n __fish_use_subcommand -a install-skill -d 'Install the Attach skill for Claude Code'
complete -c attach-linux -f -n __fish_use_subcommand -a uninstall-skill -d 'Uninstall the Attach skill'
complete -c attach-linux -f -n __fish_use_subcommand -a completion -d 'Generate shell completion script'

# Option values shared across commands: files and directories.
complete -c attach-linux -n '__fish_seen_subcommand_from add read update delete validate validate2 move rename enable disable get-schema build create-workfile' -l overlay -r -F -d 'Path to the dtso file'
complete -c attach-linux -n '__fish_seen_subcommand_from add read update delete validate validate2 move rename enable disable get-schema' -l context -r -F -d 'The target dts'
complete -c attach-linux -n '__fish_seen_subcommand_from deploy' -l dtbo -r -F -d 'Path to the compiled DTBO to deploy'
complete -c attach-linux -x -n '__fish_seen_subcommand_from add update validate validate2 get-schema' -l linux -a '(__fish_complete_directories)' -d 'Path to Linux repo'
complete -c attach-linux -x -n '__fish_seen_subcommand_from add update validate validate2 get-schema' -l dt-schema -a '(__fish_complete_directories)' -d 'Path to dt-schema repo'

# add
complete -c attach-linux -x -n '__fish_seen_subcommand_from add' -l name -d 'Node name (e.g. channel@0)'
complete -c attach-linux -x -n '__fish_seen_subcommand_from add' -l to -a '(__attach_linux_parents)' -d 'Parent node'
complete -c attach-linux -x -n '__fish_seen_subcommand_from add' -l label -d 'Label to attach to the new node'
complete -c attach-linux -f -n '__fish_seen_subcommand_from add' -a '(__attach_linux_suggest device-key (commandline -ct))' -d 'Device key / compatible string'

# create-workfile
complete -c attach-linux -x -n '__fish_seen_subcommand_from create-workfile' -l name -d 'Output filename (default: overlay.dtso)'

# update
complete -c attach-linux -x -n '__fish_seen_subcommand_from update' -l with -d 'Value to set'

# delete
complete -c attach-linux -n '__fish_seen_subcommand_from delete' -l force -d 'Force deletion'

# move / rename
complete -c attach-linux -x -n '__fish_seen_subcommand_from move rename' -l to -d 'New parent node / new name'

# enable / disable
complete -c attach-linux -x -n '__fish_seen_subcommand_from enable disable' -l node -d 'Target node'

# get-schema
complete -c attach-linux -x -n '__fish_seen_subcommand_from get-schema' -l compatible -a '(__attach_linux_suggest device-key (commandline -ct))' -d 'Compatible string'

# build
complete -c attach-linux -x -n '__fish_seen_subcommand_from build' -l build-command -d 'dtc command template ({input}/{output} substituted)'

# deploy
complete -c attach-linux -x -n '__fish_seen_subcommand_from deploy' -l ip -d 'IP address or hostname of the remote device'
complete -c attach-linux -x -n '__fish_seen_subcommand_from deploy' -l user -d 'SSH username on the remote device'
complete -c attach-linux -x -n '__fish_seen_subcommand_from deploy' -l password -d 'SSH password on the remote device'

# list-devices
complete -c attach-linux -x -n '__fish_seen_subcommand_from list-devices' -l includes-word -d 'Filter word'

# Positional value suggestions.
complete -c attach-linux -f -n '__fish_seen_subcommand_from read update delete' -a '(__attach_linux_navigate)' -d 'Node/property path'
complete -c attach-linux -f -n '__fish_seen_subcommand_from completion' -a 'bash fish zsh' -d 'Shell'
complete -c attach-linux -n '__fish_seen_subcommand_from config-get' -a 'linux dt-schema context overlay' -d 'Config field'
complete -c attach-linux -n '__fish_seen_subcommand_from config-set' -a 'linux dt-schema context overlay' -d 'Config field'
