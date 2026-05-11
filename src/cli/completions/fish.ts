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
            case init task tags project mcp import-prompt completion
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
complete -c writ -n __writ_no_subcommand -a tags       -d "List, rename, recolor, and prune project tags"
complete -c writ -n __writ_no_subcommand -a project    -d "Inspect or configure the project"
complete -c writ -n __writ_no_subcommand -a mcp        -d "Run the MCP server or install it"
complete -c writ -n __writ_no_subcommand -a import-prompt -d "Print an agent prompt for migrating a TODO file"
complete -c writ -n __writ_no_subcommand -a completion -d "Print a shell completion script"

# task subcommands. Aliases listed alongside canonicals so users discover
# either form via tab-completion. The __writ_using_nested matchers below
# accept both alias and canonical so flag completion fires either way.
set -l task_subs add list ls move mv remove rm view edit
complete -c writ -n "__writ_using task; and not __fish_seen_subcommand_from $task_subs" -a add    -d "Add a new task"
complete -c writ -n "__writ_using task; and not __fish_seen_subcommand_from $task_subs" -a list   -d "List tasks grouped by column"
complete -c writ -n "__writ_using task; and not __fish_seen_subcommand_from $task_subs" -a ls     -d "Alias for list"
complete -c writ -n "__writ_using task; and not __fish_seen_subcommand_from $task_subs" -a move   -d "Move a task to a different column"
complete -c writ -n "__writ_using task; and not __fish_seen_subcommand_from $task_subs" -a mv     -d "Alias for move"
complete -c writ -n "__writ_using task; and not __fish_seen_subcommand_from $task_subs" -a remove -d "Delete a task and its subtasks"
complete -c writ -n "__writ_using task; and not __fish_seen_subcommand_from $task_subs" -a rm     -d "Alias for remove"
complete -c writ -n "__writ_using task; and not __fish_seen_subcommand_from $task_subs" -a view   -d "Show a task"
complete -c writ -n "__writ_using task; and not __fish_seen_subcommand_from $task_subs" -a edit   -d "Open a task in \\$EDITOR"

# task list / ls flags
for sub in list ls
    complete -c writ -n "__writ_using_nested task $sub" -l col           -d "Filter by column" -r
    complete -c writ -n "__writ_using_nested task $sub" -l tag           -d "Filter by tag (AND)" -r
    complete -c writ -n "__writ_using_nested task $sub" -l any-tag       -d "Filter by tag (OR)" -r
    complete -c writ -n "__writ_using_nested task $sub" -l priority      -d "Filter by priority" -r -a "urgent high normal low u h n l 0 1 2 3"
    complete -c writ -n "__writ_using_nested task $sub" -l grep          -d "Filter by title substring" -r
    complete -c writ -n "__writ_using_nested task $sub" -l show-done     -d "Include the Done column"
    complete -c writ -n "__writ_using_nested task $sub" -l show-archived -d "Include the Archived column"
    complete -c writ -n "__writ_using_nested task $sub" -l ready         -d "Only tasks with all blockers resolved"
    complete -c writ -n "__writ_using_nested task $sub" -l blocked       -d "Only tasks with open blockers"
    complete -c writ -n "__writ_using_nested task $sub" -l sort          -d "Sort sibling order" -r -a "position priority updated created"
end

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

# task remove flags
for sub in remove rm
    complete -c writ -n "__writ_using_nested task $sub" -s y -l yes -d "Skip the confirmation prompt"
end

# tags subcommands
set -l tags_subs list ls remove rm rename color prune
complete -c writ -n "__writ_using tags; and not __fish_seen_subcommand_from $tags_subs" -a list   -d "List every tag with its color"
complete -c writ -n "__writ_using tags; and not __fish_seen_subcommand_from $tags_subs" -a ls     -d "Alias for list"
complete -c writ -n "__writ_using tags; and not __fish_seen_subcommand_from $tags_subs" -a remove -d "Delete a tag globally"
complete -c writ -n "__writ_using tags; and not __fish_seen_subcommand_from $tags_subs" -a rm     -d "Alias for remove"
complete -c writ -n "__writ_using tags; and not __fish_seen_subcommand_from $tags_subs" -a rename -d "Rename a tag in place"
complete -c writ -n "__writ_using tags; and not __fish_seen_subcommand_from $tags_subs" -a color  -d "Set or clear a tag color"
complete -c writ -n "__writ_using tags; and not __fish_seen_subcommand_from $tags_subs" -a prune  -d "Remove every tag with zero task references"

# tags subcommand flags
for sub in list ls
    complete -c writ -n "__writ_using_nested tags $sub" -l with-counts -d "Include usage counts per tag"
end
for sub in remove rm
    complete -c writ -n "__writ_using_nested tags $sub" -s y -l yes -d "Skip the confirmation prompt"
end
complete -c writ -n "__writ_using_nested tags color" -l clear   -d "Remove the color override"
complete -c writ -n "__writ_using_nested tags prune" -s y -l yes -d "Skip the confirmation prompt"
complete -c writ -n "__writ_using_nested tags prune" -l dry-run -d "Preview without deleting"

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
complete -c writ -n "__writ_using_nested mcp install" -s y -l yes -d "Skip the overwrite confirmation prompt"
complete -c writ -n "__writ_using_nested mcp install" -l dry-run -d "Print what would be written without modifying .mcp.json"

# import-prompt flags
complete -c writ -n "__writ_using import-prompt" -l file -d "TODO file to inline into the prompt" -r -F

# completion arg
complete -c writ -n "__writ_using completion" -a "bash zsh fish"
`;
