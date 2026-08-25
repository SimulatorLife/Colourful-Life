# Colourful-Life repository prompts

These Markdown files are the Colourful-Life-specific prompt catalog. They keep
simulation laws, organism evolution, DNA/neural behavior, rendering, and UI
interaction context in the repository that owns that domain.

Run them through AutoDev's shared prompt runner by selecting:

- `target_repository: SimulatorLife/Colourful-Life`
- `prompt_repository: SimulatorLife/Colourful-Life`
- `prompt_path: .agents/prompts/<name>.md`
- `base_branch: master`

The shared AutoDev workflows create the target PR and invoke the selected
provider. This repository retains only the two operational maintenance
workflows that are not agent prompts: scheduled lint/format repair and empty
stale-PR cleanup.
