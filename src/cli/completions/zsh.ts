// Zsh completion script. Static subcommand + flag completion only.
// Install with: `writ completion zsh > "$fpath[1]/_writ"` (one of the
// directories in $fpath), then `compinit`. Or eval inline in .zshrc.
export const ZSH_COMPLETION = `#compdef writ
# writ zsh completion

_writ() {
    local context state line
    local -a commands task_subs project_subs mcp_subs shells

    commands=(
        'init:Initialize a writ project'
        'task:Manage tasks'
        'project:Inspect or configure the project'
        'mcp:Run the MCP server or install it into a project'
        'completion:Print a shell completion script'
    )
    task_subs=(
        'add:Add a new task'
        'list:List tasks grouped by column'
        'move:Move a task to a different column'
        'rm:Delete a task and its subtasks'
        'view:Show a task'
        'edit:Open a task in $EDITOR'
    )
    project_subs=(
        'show:Print project id, name, and root'
        'rename:Set the project display name'
    )
    mcp_subs=(
        'install:Add writ to the project .mcp.json'
        'uninstall:Remove the writ entry from .mcp.json'
    )
    shells=(bash zsh fish)

    _arguments -C \\
        '1:command:->cmd' \\
        '*::arg:->args'

    case $state in
        cmd)
            _describe -t commands 'writ command' commands
            ;;
        args)
            case $line[1] in
                task)
                    _arguments -C '1:subcommand:->sub' '*::sub_arg:->sub_args'
                    case $state in
                        sub) _describe -t task_subs 'task subcommand' task_subs ;;
                        sub_args)
                            case $line[1] in
                                list)
                                    _arguments \\
                                        '--col[Filter by column]:column:' \\
                                        '*--tag[Filter by tag (AND)]:tag:' \\
                                        '*--any-tag[Filter by tag (OR)]:tag:' \\
                                        '*--priority[Filter by priority]:level:(urgent high normal low u h n l 0 1 2 3)' \\
                                        '--grep[Filter by title substring]:pattern:' \\
                                        '--show-done[Include the Done column]' \\
                                        '--show-archived[Include the Archived column]' \\
                                        '--ready[Only tasks with all blockers resolved]' \\
                                        '--blocked[Only tasks with open blockers]'
                                    ;;
                                add)
                                    _arguments \\
                                        '(-p --priority)'{-p,--priority}'[Priority level]:level:(urgent high normal low u h n l 0 1 2 3)' \\
                                        '(-c --col)'{-c,--col}'[Column name]:column:' \\
                                        '(-d --description)'{-d,--description}'[Markdown description]:text:' \\
                                        '--parent[Parent task id]:id:' \\
                                        '*--tag[Tag (repeatable)]:tag:' \\
                                        '*--depends-on[Blocker task id (repeatable)]:id:'
                                    ;;
                                edit)
                                    _arguments \\
                                        '*--tag[Replace the tag set (repeatable)]:tag:' \\
                                        '*--depends-on[Replace the dependency set (repeatable)]:id:'
                                    ;;
                            esac
                            ;;
                    esac
                    ;;
                project)
                    _arguments -C '1:subcommand:->sub' '*::sub_arg:->sub_args'
                    case $state in
                        sub) _describe -t project_subs 'project subcommand' project_subs ;;
                        sub_args)
                            if [[ $line[1] == rename ]]; then
                                _arguments '--clear[Remove the override and fall back to the default]'
                            fi
                            ;;
                    esac
                    ;;
                mcp)
                    _arguments -C '1:subcommand:->sub' '*::sub_arg:->sub_args'
                    case $state in
                        sub) _describe -t mcp_subs 'mcp subcommand' mcp_subs ;;
                        sub_args)
                            if [[ $line[1] == install ]]; then
                                _arguments \\
                                    '--command[Override the MCP command path]:command:' \\
                                    '(-y --yes)'{-y,--yes}'[Overwrite an existing entry without prompting]'
                            fi
                            ;;
                    esac
                    ;;
                completion)
                    _values 'shell' $shells
                    ;;
            esac
            ;;
    esac
}

_writ "$@"
`;
