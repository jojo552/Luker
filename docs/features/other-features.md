# Other Features

This page lists other user-facing features unique to Luker. While smaller in scope, these features significantly improve the day-to-day experience.

## World Info Activation Trace

Luker records the complete chain from matching to injection for World Info entries, helping you debug complex World Info configurations. See [World Info Activation Trace](/features/world-info-trace) for details.

## Card-Bound Personas

Luker lets a Character Card carry recommended personas and export them with the card itself. When you open the card, Luker switches to the recommended persona if you have not chosen one; if the current persona differs from the card's recommendation, Luker asks whether to switch. See [Card-Bound Presets & Personas](/improvements/card-bound-presets) for details.

## Chat Tools Panel

The Current Chat Tools Panel is a non-blocking tools panel that provides quick access to tools related to the current chat within the chat interface. The panel does not obscure chat content, allowing you to use tool features at any time during conversation.

## Popup Updater

The Popup Updater provides an in-app update flow. When a new version is available, a popup guides you through the update process. The updater has Docker environment awareness and provides corresponding update instructions based on your deployment method (Docker or local installation).

## Image Generation Enhancements

Luker enhances image generation with ComfyUI WebSocket connection support — WebSocket communication with ComfyUI replaces frequent HTTP polling endpoints, improving generation efficiency and real-time responsiveness, with smart fallback and reconnection retry support.

## Plugin Regex Provider

Plugins can dynamically register regex rules into the regex processing system. See [Plugin Regex Provider](/features/regex-provider) for details.

## Onboarding Config Import

Onboarding Config Import optimizes the first-use onboarding flow. During initial setup, you can directly import existing configuration files, including:

- Complete application settings
- Extension configurations

This is particularly useful for migrating from other instances or quickly restoring your working environment on a new device, avoiding the tedious process of configuring from scratch.

## Related Features

- [User Settings Additions](/features/user-settings-additions) — the Luker-only controls inside User Settings, plus backup, migration and storage tools
- [Search Tools](/features/search-tools) — AI web search capabilities
- [Character Card Editor Assistant](/features/card-editor/) — Enhanced character card editing experience
- [Memory Graph](/features/memory-graph) — Knowledge graph-based memory system
