# cc-cache-mods

Two Claude Code mods (hooks plugins) around the 5-minute prompt cache: one keeps it from expiring while you are away, the other tells you when it expired anyway.

> These mods use Claude Code's early-access plugin hooks API, which may change between releases.

## keep-warm

Claude Code caches the conversation for 5 minutes after each model request. Step away longer, or leave a question or permission prompt open, and the next request writes the whole conversation to the cache again, which is slow and expensive on a long session.

keep-warm sends a tiny "reply with ok" request over the cached conversation 4:50 after the last request, which resets the cache's 5-minute timer. It does this:

- after a turn ends, while you are idle, for up to 30 minutes;
- while the main loop waits inside a tool call: a question to you, a permission prompt, a long-running command or a subagent.

Above the prompt it shows a countdown until the cache expires and how long keep-warm keeps going. When a wait ends with pings sent, it logs one line: `keep-warm: kept the cache warm with 2 pings, 167k cached`.

Worth knowing:

- Each ping is a real API request. It mostly reads from the cache, so it is far cheaper than a full cache rewrite, but it is not free, and it runs for up to 30 minutes after every turn even if you have walked away.
- It does nothing useful if your requests use the 1-hour cache.

## context-meter

Toasts only, no status line:

- when the context passes 100k, 150k and 200k tokens;
- on a prompt-cache miss, partial or full, with how many tokens were cached again.

Pairs with keep-warm: a cache-miss toast after a pause means the cache expired despite it.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install keep-warm --marketplace hmSchuller/cc-cache-mods
/plugin install context-meter --marketplace hmSchuller/cc-cache-mods
```

From a shell:

```
claude plugin install keep-warm --marketplace hmSchuller/cc-cache-mods
claude plugin install context-meter --marketplace hmSchuller/cc-cache-mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `hmSchuller/cc-cache-mods`, then Add plugin.

## License

MIT
