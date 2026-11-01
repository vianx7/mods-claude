# usage-band

Uma faixa de uma linha só, acima da caixa de texto do Claude Code que mostra o uso do seu plano:

```
5 h  ━━━━━───────  43%      Renova em 37 min      Semana  6%      ● Quente
```

- **5 h**: quanto da janela de 5 horas já foi usado. A barra fica azul no dia a dia, âmbar a partir de 75% e vermelha a partir de 90%.
- **Renova em**: quanto falta para a janela de 5 horas reiniciar. A contagem anda a cada minuto.
- **Semana**: a porcentagem do limite semanal.
- **● Quente / Morno / Frio**: se o cache da conversa ainda está vivo. O cache dura 1 hora depois da última resposta.
  - 🔴 **Quente** (menos de 45 min): mandar mensagem agora sai barato, o contexto é relido do cache.
  - 🟡 **Morno** (45 a 60 min): ainda está no cache, mas expira em breve.
  - 🔵 **Frio** (mais de 1 hora): a próxima mensagem relê o contexto inteiro sem desconto e gasta bem mais do limite.

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
