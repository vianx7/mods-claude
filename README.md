# mods-claude

Mods para o Claude Code.

| Mod | O que é |
| --- | --- |
| [usage-band](plugins/usage-band) | Uma linha acima do prompt: uso das 5 h com previsão de quando acaba, renovação, contexto, cache e o 🦀 Clawd, caranguejo observador que entende prompts ditados e economiza tokens. |

## Instalar

No chat do Claude Code:

```
/plugin install usage-band --marketplace vianx7/mods-claude
```

Ou pelo terminal:

```bash
claude plugin install usage-band --marketplace vianx7/mods-claude
```

Depois, reinicie o Claude Code.

## Atualizar

```bash
claude plugin marketplace update mods-claude && claude plugin update usage-band@mods-claude
```

Ou ligue o auto-update uma vez em `/plugin` → Marketplaces → mods-claude → *Enable auto-update*.

Quem tinha o `clawd` separado: ele agora vem dentro do usage-band.

```bash
claude plugin uninstall clawd@mods-claude
```
