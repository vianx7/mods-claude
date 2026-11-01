# usage-band

Uma faixa discreta acima da caixa de texto do Claude Code que mostra o uso do seu plano:

```
5 h  ━━━━━─────────  34%   Renova em 2 h 17 min   Semana  12%
```

- **5 h**: quanto da janela de 5 horas já foi usado. A barra fica azul no dia a dia, âmbar a partir de 75% e vermelha a partir de 90%.
- **Renova em**: quanto falta para a janela de 5 horas reiniciar. A contagem anda a cada minuto.
- **Semana**: a porcentagem do limite semanal.

Os números são os mesmos da linha de status e se atualizam a cada resposta. Só aparecem em contas com assinatura (Pro/Max), que têm esses limites.

## Instalação

No prompt de uma sessão do Claude Code:

```
/plugin install usage-band --marketplace vianx7/mods-claude
```

Responda `y` para adicionar o marketplace e escolha o escopo (user, para valer em todos os projetos).

Pelo terminal:

```bash
claude plugin install usage-band --marketplace vianx7/mods-claude
```
