// Fish completion script. Static subcommand + flag completion only.
// Install with: `writ completion fish > ~/.config/fish/completions/writ.fish`
// (fish auto-loads completions from that directory).
export const FISH_COMPLETION = `# writ fish completion

# Disable file completion globally for writ — every position takes a known
# value (subcommand, flag, or already-typed argument). Individual completions
# below add file/arg completions where appropriate.
complete -c writ -f

# Helper: are we still picking the top-level subcommand?
function __writ_no_subcommand
    set -l cmd (commandline -opc)
    if test (count $cmd) -le 1
        return 0
    end
    for word in $cmd[2..-1]
        switch $word
            case init task project mcp completion
                return 1
        end
    end
    return 0
end

# Helper: are we inside a given top-level subcommand?
function __writ_using --argument-names subcommand
    set -l cmd (commandline -opc)
    if test (count $cmd) -lt 2
        return 1
    end
    test "$cmd[2]" = "$subcommand"
end

# Helper: are we inside a given subcommand and nested-subcommand pair?
function __writ_using_nested --argument-names subcommand nested
    set -l cmd (commandline -opc)
    if test (count $cmd) -lt 3
        return 1
    end
    test "$cmd[2]" = "$subcommand" -a "$cmd[3]" = "$nested"
end

# Top-level
complete -c writ -n __writ_no_subcommand -a init       -d "Initialize a writ project"
complete -c writ -n __writ_no_subcommand -a task       -d "Manage tasks"
complete -c writ -n __writ_no_subcommand -a project    -d "Inspect or configure the project"
complete -c writ -n __writ_no_subcommand -a mcp        -d "Run the MCP server or install it"
complete -c writ -n __writ_no_subcommand -a completion -d "Print a shell completion script"

# task subcommands
set -l task_subs add list move rm view edit
complete -c writ -n "__writ_using task; and not __fish_seen_subcommand_from $task_subs" -a add  -d "Add a new task"
complete -c writ -n "__writ_using task; and not __fish_seen_subcommand_from $task_subs" -a list -d "List tasks grouped by column"
complete -c writ -n "__writ_using task; and not __fish_seen_subcommand_from $task_subs" -a move -d "Move a task to a different column"
complete -c writ -n "__writ_using task; and not __fish_seen_subcommand_from $task_subs" -a rm   -d "Delete a task and its subtasks"
complete -c writ -n "__writ_using task; and not __fish_seen_subcommand_from $task_subs" -a view -d "Show a task"
complete -c writ -n "__writ_using task; and not __fish_seen_subcommand_from $task_subs" -a edit -d "Open a task in \\$EDITOR"

# task list flags
complete -c writ -n "__writ_using_nested task list" -l col           -d "Filter by column" -r
complete -c writ -n "__writ_using_nested task list" -l tag           -d "Filter by tag (AND)" -r
complete -c writ -n "__writ_using_nested task list" -l any-tag       -d "Filter by tag (OR)" -r
complete -c writ -n "__writ_using_nested task list" -l priority      -d "Filter by priority" -r -a "urgent high normal low u h n l 0 1 2 3"
complete -c writ -n "__writ_using_nested task list" -l grep          -d "Filter by title substring" -r
complete -c writ -n "__writ_using_nested task list" -l show-done     -d "Include the Done column"
complete -c writ -n "__writ_using_nested task list" -l show-archived -d "Include the Archived column"
complete -c writ -n "__writ_using_nested task list" -l ready         -d "Only tasks with all blockers resolved"
complete -c writ -n "__writ_using_nested task list" -l blocked       -d "Only tasks with open blockers"

# task add flags
complete -c writ -n "__writ_using_nested task add" -s p -l priority    -d "Priority level" -r -a "urgent high normal low u h n l 0 1 2 3"
complete -c writ -n "__writ_using_nested task add" -s c -l col         -d "Column name" -r
complete -c writ -n "__writ_using_nested task add" -s d -l description -d "Markdown description" -r
complete -c writ -n "__writ_using_nested task add"      -l parent      -d "Parent task id" -r
complete -c writ -n "__writ_using_nested task add"      -l tag         -d "Tag (repeatable)" -r
complete -c writ -n "__writ_using_nested task add"      -l depends-on  -d "Blocker task id (repeatable)" -r

# task edit flags
complete -c writ -n "__writ_using_nested task edit" -l tag        -d "Replace the tag set (repeatable)" -r
complete -c writ -n "__writ_using_nested task edit" -l depends-on -d "Replace the dependency set (repeatable)" -r

# project subcommands
set -l project_subs show rename
complete -c writ -n "__writ_using project; and not __fish_seen_subcommand_from $project_subs" -a show   -d "Print project id, name, and root"
complete -c writ -n "__writ_using project; and not __fish_seen_subcommand_from $project_subs" -a rename -d "Set the project display name"
complete -c writ -n "__writ_using_nested project rename" -l clear -d "Remove the override and fall back to the default"

# mcp subcommands
set -l mcp_subs install uninstall
complete -c writ -n "__writ_using mcp; and not __fish_seen_subcommand_from $mcp_subs" -a install   -d "Add writ to the project .mcp.json"
complete -c writ -n "__writ_using mcp; and not __fish_seen_subcommand_from $mcp_subs" -a uninstall -d "Remove the writ entry from .mcp.json"
complete -c writ -n "__writ_using_nested mcp install" -l command -d "Override the MCP command path" -r
complete -c writ -n "__writ_using_nested mcp install" -s y -l yes -d "Overwrite an existing entry without prompting"

# completion arg
complete -c writ -n "__writ_using completion" -a "bash zsh fish"
`;
