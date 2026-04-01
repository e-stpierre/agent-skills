<p align="center">
  <img src="agent-skills-banner.png" alt="Agent Skills" width="600">
</p>

<h1 align="center">Agent Skills</h1>

<p align="center">
  <a href="https://github.com/e-stpierre/agent-skills/releases"><img src="https://img.shields.io/github/v/release/e-stpierre/agent-skills?include_prereleases" alt="GitHub release"></a>
  <a href="https://github.com/e-stpierre/agent-skills/blob/main/LICENSE"><img src="https://img.shields.io/github/license/e-stpierre/agent-skills" alt="License"></a>
</p>

<p align="center">
  <strong>A collection of human-in-the-loop interactive prompts for AI coding agents, enabling structured, repeatable workflows across diverse tasks and domains</strong>
</p>

## Getting Started

### Prerequisites

- An AI coding agent that supports plugins (e.g., Claude Code)
- Basic familiarity with your agent's CLI

### Installation

1. Add this repository as a plugin marketplace:

   ```bash
   /plugin marketplace add e-stpierre/agent-skills
   ```

2. Install the plugin(s) you need and refer to their README for usage.

## Plugins

### Interactive-SDLC

Interactive SDLC commands for guided development through user questions and feedback.

**Best for**: Interactive development where you want to be involved in decisions.

#### Installation

1. Install the plugin:

   ```bash
   /plugin install interactive-sdlc@agent-skills
   ```

#### Examples

See [Interactive-SDLC README](plugins/interactive-sdlc/README.md) for all commands and options.

```bash
# Plan a feature with milestones and implementation steps
/sdlc-plan feature Add OAuth login

# Run analysis on your codebase (bugs, docs, debt, style, security)
/analyze security

# Full workflow from branch creation to PR with user interaction
/one-shot
```

## Contributing

Found a bug or have a suggestion? Please [open an issue](https://github.com/e-stpierre/agent-skills/issues) on GitHub.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
