# Salesforce for Zed

A [Zed](https://zed.dev) extension adding language support for Salesforce development, including **Apex** and **Lightning Web Components (LWC)**.

## Features

- **Apex** — syntax highlighting, code completion, diagnostics, and go-to-definition via the [Apex Language Server](https://github.com/forcedotcom/salesforcedx-vscode) (`apex-jorje-lsp.jar`) provided by Salesforce
- **LWC** — HTML language support for Lightning Web Components via the [`@salesforce/lwc-language-server`](https://www.npmjs.com/package/@salesforce/lwc-language-server) npm package provided by Salesforce
- **Tree-sitter grammar** — fast, accurate Apex parsing using the [tree-sitter-sfapex](https://github.com/aheber/tree-sitter-sfapex) grammar

## Requirements

- **Java 11+** must be available on your `PATH` (required by the Apex Language Server)
- **Node.js** is managed automatically by Zed (required by the LWC Language Server)

## Installation

Install the extension from the Zed extension marketplace:

1. Open the command palette (`Cmd+Shift+P`)
2. Run `zed: install extension`
3. Search for **Salesforce** and install

The Apex Language Server JAR and the LWC Language Server npm package are downloaded automatically on first use.

## Supported file types

| Language | Extensions |
|----------|------------|
| Apex     | `.cls`, `.trigger`, `.apex` |
| LWC      | `.html` (inside LWC component folders) |

## Credits

- [Apex Language Server](https://github.com/forcedotcom/salesforcedx-vscode) — Salesforce
- [LWC Language Server](https://github.com/salesforce/lwc) — Salesforce
- [tree-sitter-sfapex](https://github.com/aheber/tree-sitter-sfapex) — Alex Heber
