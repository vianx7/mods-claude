# mods-claude

Mods para o Claude Code.

| Mod | O que é |
| --- | --- |
| [usage-band](plugins/usage-band) | Faixa de uma linha acima do prompt com o uso da janela de 5 h, renovação, contexto e estado do cache. |
| [clawd](plugins/clawd) | 🦀 Caranguejo observador: entende prompts ditados por voz e só aparece nas horas cruciais. |

## Outras ferramentas

- [💻 MacBook Checker](https://github.com/vianx7/macbook-checker): testa um MacBook usado antes de comprar (teclado, tela, trackpad, áudio, câmera, bateria, iCloud). Roda com um comando no Terminal do Mac.

## Instalar

No chat do Claude Code:

```
/plugin install usage-band --marketplace vianx7/mods-claude
/plugin install clawd --marketplace vianx7/mods-claude
```

Ou pelo terminal:

```bash
claude plugin install usage-band --marketplace vianx7/mods-claude
```

```bash
claude plugin install clawd --marketplace vianx7/mods-claude
```

Depois, reinicie o Claude Code.

## Atualizar

```bash
claude plugin marketplace update mods-claude && claude plugin update usage-band@mods-claude && claude plugin update clawd@mods-claude
```

Ou ligue o auto-update uma vez em `/plugin` → Marketplaces → mods-claude → *Enable auto-update*.
