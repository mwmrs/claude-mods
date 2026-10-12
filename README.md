# claude-mods

Persönliche Mods für Claude Code. Der Ordner ist ein Marketplace (`.claude-plugin/marketplace.json`).

| Mod | Was er zeigt |
| --- | --- |
| `context-bar` | Zeile über dem Eingabefeld: Restzeit des Prompt-Caches mit Balken, Cache-Hit-Rate, Kontextfüllung mit Wetter-Emoji und Auto-Compact-Schwelle, Compact-Button. Nach einem Compact stehen Tokens vorher/nachher und die Zusammenfassung als Log-Zeilen im Chat. |
| `usage-bar` | Zeile über dem Eingabefeld: Plan-Nutzung im 5-Stunden- und Wochenfenster mit Balken, Prozent und Reset-Zeit; Hinweise bei 75 % und 90 %. |

## Installation

```bash
claude plugin marketplace add ~/claude-mods
claude plugin install context-bar@mwmrs-mods -s user
claude plugin install usage-bar@mwmrs-mods -s user
```

## Prüfen

```bash
claude plugin validate ./context-bar
claude plugin test ./context-bar
```
