<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <img src="banner.png" alt="ESP Skills" width="600">
</p>

<h1 align="center">ESP Skills</h1>

<p align="center">
  <a href="https://github.com/e-stpierre/skills/releases"><img src="https://img.shields.io/github/v/release/e-stpierre/skills?include_prereleases" alt="GitHub release"></a>
  <a href="https://github.com/e-stpierre/skills/blob/main/LICENSE"><img src="https://img.shields.io/github/license/e-stpierre/skills" alt="License"></a>
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
   /plugin marketplace add e-stpierre/skills
   ```

2. Install the `esp-skills` plugin:

   ```bash
   /plugin install esp-skills@esp
   ```

## Usage

All skills ship in a single plugin and are invoked as `/esp-skills:<skill>`. See the [ESP Skills README](plugins/esp-skills/README.md) for every skill and its arguments.

```bash
# Create a branch, commit, and open a pull request
/esp-skills:git-branch feature add-oauth 123
/esp-skills:git-commit
/esp-skills:git-pr

# Plan a feature with milestones and implementation steps
/esp-skills:sdlc-plan feature Add OAuth login

# Review a pull request for high-signal issues
/esp-skills:code-review PR 123
```

## Contributing

Found a bug or have a suggestion? Please [open an issue](https://github.com/e-stpierre/skills/issues) on GitHub.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
