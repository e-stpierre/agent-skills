<p align="center">
  <img src="clauding-banner.png" alt="Clauding" width="600">
</p>

<h1 align="center">Clauding</h1>

<p align="center">
  <a href="https://claude.ai/code"><img src="https://img.shields.io/badge/Built%20for-Claude%20Code-orange" alt="Built for Claude Code"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
</p>

<p align="center">
  <strong>A collection of human-in-the-loop interactive prompts for Claude Code, enabling structured, repeatable workflows across diverse tasks and domains</strong>
</p>

## Getting Started

### Prerequisites

- Claude Code CLI installed and configured
- Basic familiarity with Claude Code

### Installation

1. Add this repository as a plugin marketplace in Claude Code:

   ```bash
   /plugin marketplace add e-stpierre/clauding
   ```

2. Install the plugin(s) you need and refer to their README for usage.

## Plugins

### Interactive-SDLC

Interactive SDLC commands for guided development within Claude Code sessions through user questions and feedback.

**Best for**: Interactive development where you want to be involved in decisions.

#### Installation

1. Install the plugin in Claude Code:

   ```bash
   /plugin install interactive-sdlc@clauding
   ```

#### Examples

See [Interactive-SDLC README](plugins/interactive-sdlc/README.md) for all commands and options.

```bash
# Plan a feature with milestones and implementation steps
/interactive-sdlc:plan-feature

# Run analysis on your codebase (bugs, docs, debt, style, security)
/interactive-sdlc:analyse-security

# Full workflow from branch creation to PR with user interaction
/interactive-sdlc:one-shot
```

## Contributing

Found a bug or have a suggestion? Please [open an issue](https://github.com/e-stpierre/clauding/issues) on GitHub.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
