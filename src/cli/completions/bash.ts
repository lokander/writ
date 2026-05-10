// Bash completion script. Static subcommand + flag completion only; dynamic
// completions (task id suffixes, tag names, column names) are a separate
// follow-up. Install with: `eval "$(writ completion bash)"` or pipe to
// `/etc/bash_completion.d/writ`.
export const BASH_COMPLETION = `# writ bash completion
_writ_completions() {
    local cur prev words cword
    cur="\${COMP_WORDS[COMP_CWORD]}"
    cword=$COMP_CWORD

    # Walk forward from the writ token to find the active sub / nested.
    local subcommand="" nested=""
    local i=1
    while [[ $i -lt $cword ]]; do
        case "\${COMP_WORDS[i]}" in
            init|task|project|mcp|completion)
                subcommand="\${COMP_WORDS[i]}"
                ((i++))
                if [[ $i -lt $cword ]]; then
                    case "\${COMP_WORDS[i]}" in
                        add|list|ls|move|mv|remove|rm|view|edit|show|rename|install|uninstall)
                            # Normalize aliases to their canonical name so the
                            # per-nested flag completion below has a single
                            # case to match.
                            case "\${COMP_WORDS[i]}" in
                                ls) nested="list" ;;
                                mv) nested="move" ;;
                                rm) nested="remove" ;;
                                *)  nested="\${COMP_WORDS[i]}" ;;
                            esac
                            ;;
                    esac
                fi
                break
                ;;
        esac
        ((i++))
    done

    if [[ -z "$subcommand" ]]; then
        COMPREPLY=( $(compgen -W "init task project mcp completion --help --version" -- "$cur") )
        return
    fi

    case "$subcommand" in
        task)
            if [[ -z "$nested" ]]; then
                COMPREPLY=( $(compgen -W "add list ls move mv remove rm view edit" -- "$cur") )
                return
            fi
            case "$nested" in
                list)
                    COMPREPLY=( $(compgen -W "--col --tag --any-tag --priority --grep --show-done --show-archived --ready --blocked --help" -- "$cur") )
                    ;;
                add)
                    COMPREPLY=( $(compgen -W "--priority --col --description --parent --tag --depends-on --help" -- "$cur") )
                    ;;
                edit)
                    COMPREPLY=( $(compgen -W "--tag --depends-on --help" -- "$cur") )
                    ;;
            esac
            ;;
        project)
            if [[ -z "$nested" ]]; then
                COMPREPLY=( $(compgen -W "show rename" -- "$cur") )
            elif [[ "$nested" == "rename" ]]; then
                COMPREPLY=( $(compgen -W "--clear --help" -- "$cur") )
            fi
            ;;
        mcp)
            if [[ -z "$nested" ]]; then
                COMPREPLY=( $(compgen -W "install uninstall" -- "$cur") )
            elif [[ "$nested" == "install" ]]; then
                COMPREPLY=( $(compgen -W "--command --yes --help" -- "$cur") )
            fi
            ;;
        completion)
            COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") )
            ;;
    esac
}

complete -F _writ_completions writ
`;
