# claude-mods

Persönliche Mods für Claude Code. Das Repo ist ein Marketplace (`.claude-plugin/marketplace.json`).

| Mod | Was er zeigt |
| --- | --- |
| `context-bar` | Zeile über dem Eingabefeld: Restzeit des Prompt-Caches mit Balken, Cache-Hit-Rate, Kontextfüllung mit Wetter-Emoji und Auto-Compact-Schwelle, Compact-Button. Nach einem Compact stehen Tokens vorher/nachher und die Zusammenfassung als Log-Zeilen im Chat. |
| `usage-bar` | Zeile über dem Eingabefeld: Plan-Nutzung im 5-Stunden- und Wochenfenster mit Balken, Prozent und Reset-Zeit; Hinweise bei 75 % und 90 %. |

## Installation

Den Marketplace direkt aus GitHub einbinden, damit er nicht von einem lokalen Ordner abhängt:

```bash
claude plugin marketplace add mwmrs/claude-mods
claude plugin install context-bar@mwmrs-mods -s user
claude plugin install usage-bar@mwmrs-mods -s user
```

Bei einem privaten Repo braucht Git Zugriff darauf (z. B. über `gh auth login`). Neue Versionen holen:

```bash
claude plugin marketplace update mwmrs-mods
```

### Lokal entwickeln

Zum Arbeiten an den Mods stattdessen einen festen Klon als Marketplace eintragen. Wird der Ordner verschoben oder gelöscht, verschwinden die Mods aus Claude Code.

```bash
git clone https://github.com/mwmrs/claude-mods.git ~/claude-mods
claude plugin marketplace add ~/claude-mods
```

Wechsel zwischen beiden Varianten: vorher `claude plugin marketplace remove mwmrs-mods`.

## Prüfen

```bash
claude plugin validate ./context-bar
claude plugin test ./context-bar
```

## Lizenz

[MIT](LICENSE) © 2026 Meinolf Wiemers

Die Mods enthalten keinen fremden Code und bündeln keine Abhängigkeiten. Sie nutzen zur Laufzeit nur die Plugin-API von Claude Code (`claude-code`, `claude-code/testing`); deren Typen erzeugt Claude Code beim Laden und sie bleiben per `.gitignore` außerhalb des Repos. Claude Code selbst steht unter den Bedingungen von Anthropic, nicht unter dieser Lizenz.

Kein offizielles Projekt von Anthropic. „Claude“ und „Claude Code“ sind Marken von Anthropic, PBC.
