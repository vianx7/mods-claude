# Changelog

## 1.0.1: a versão final

Uma linha só, acima da caixa de texto do Claude Code, com tudo o que importa sobre a janela de 5 horas:

```
5h ━━━━━━━━━━━━ 94% ↗      Renova em 1h46      (62)      ◉ Quente
```

### O que tem

- **Uso das 5 h:** barra animada e porcentagem. A barra fica azul, laranja a partir de 75% e vermelha a partir de 90%.
- **Ritmo de consumo** `→` `↗` `↑`: normal, elevado (laranja) ou muito elevado (vermelho). Tem uma margem que evita ficar trocando de estado à toa, e mostra "calculando" enquanto há pouco histórico.
- **Renovação:** o clique alterna entre *Renova em 1h46* e *Renova às 14:00*, no seu fuso. A escolha fica salva entre sessões.
- **Anel de contexto:** quanto da janela de contexto a conversa já ocupa, com o número dentro do anel.
- **Bolinha do cache:** ◉ quente, ◐ morno, ○ frio, ◌ sem registro. Ela pulsa enquanto o Claude trabalha.
- **Detalhes ao passar o mouse ou pelo foco do teclado,** num cartão que cobre a própria linha, sem empurrar nada.
- **Avisos de dado** só quando importa: `⟳` desatualizado, `⋯` atualizando, `⚠` falha, e `—` sem dado (nunca 0%).
- **Alertas** aos 90% e 100% das 5 h, e quando o ritmo fica muito elevado.
- **Cabe em qualquer tela,** do monitor grande à janela estreita do MacBook. Os rótulos e a barra encurtam aos poucos, sempre em uma linha.
- **Movimento reduzido:** as animações respeitam a preferência do sistema.

### O que mudou em relação às versões anteriores

- **O semanal saiu.** A faixa mostra só a janela de 5 horas.
- **Corrigido o texto cortado** ("9..") no app desktop. Os valores usam largura mínima em vez de fixa, e a faixa conta com o espaço extra dos botões nativos.
- **Voltaram** o anel de contexto, os detalhes no hover e no foco, e o botão de renovação, que a 1.0.0 tinha tirado.

### Do início até aqui

| Versão | O que trouxe |
| --- | --- |
| 0.1 | Primeira faixa: % das 5 h, contagem até renovar e % semanal |
| 0.2 | Visual estilo Apple |
| 0.3 | Bolinha de cache quente / morno / frio e uso do contexto |
| 0.4 | Tudo numa linha só |
| 0.5 | Bolinha viva, barra animada, ritmo, toque para alternar e alertas |
| 0.6 | Layout responsivo, ritmo em 3 estados, anel de contexto, avisos de dado, detalhes por hover e foco |
| 0.7 | Correção do texto cortado no MacBook |
| 0.8 / 1.0.0 | Testes de versão minimalista |
| **1.0.1** | **Versão final: tudo da 0.7, sem o semanal** |

### Instalar

```
/plugin install usage-band --marketplace vianx7/mods-claude
```

### Atualizar

```bash
claude plugin marketplace update mods-claude && claude plugin update usage-band@mods-claude
```

Depois, reinicie o Claude Code. Se preferir não rodar isso toda vez, ligue o auto-update em `/plugin` → Marketplaces → mods-claude.

## 1.0.0: a versão minimalista

Uma linha só, acima da caixa de texto do Claude Code, com o que importa:

```
━━━━━━━━━━━━ 5h 94% ↗ · renova em 1h46                    ◉ Quente
```

### O que há de novo nesta versão

- **Só a janela de 5 horas.** O uso semanal saiu de vez, junto com o anel de contexto, os separadores e os cartões de detalhe que cobriam a linha. A faixa ficou com dois elementos: o uso e o cache.
- **Clique minimalista.** Um clique no bloco troca só o texto da renovação, entre *renova em 1h46* e *renova às 14:00*. O resto da linha não se mexe, e a escolha fica salva entre sessões.
- **Sem texto cortado.** Os valores usam largura mínima em vez de fixa, então os botões nativos do app desktop não cortam mais "94%" em "9..". A faixa também reserva espaço extra no desktop antes de decidir o que mostrar.
- **Cabe em qualquer tela,** inclusive no MacBook:
  - **larga:** barra de 12 e "Quente" escrito;
  - **média:** barra de 6 e só a bolinha;
  - **estreita:** sem barra, `5h 94% ↗  1h46`.
- **Menos peças, menos bugs.** Um único botão na faixa e bem menos estado para dar errado.

### O que continua

- **Barra animada:** enche até o valor novo e fica azul, laranja a partir de 75% e vermelha a partir de 90%.
- **Ritmo de consumo** com três estados (`→` normal, `↗` elevado, `↑` muito elevado) e uma margem que evita ficar trocando de estado à toa.
- **Bolinha do cache:** ◉ quente, ◐ morno, ○ frio. Ela pulsa enquanto o Claude trabalha.
- **Avisos de dado:** `⟳` desatualizado, `⋯` atualizando, `⚠` falha, e `—` sem dado (nunca 0%).
- **Alertas só no que importa:** aos 90% e 100% das 5 h, e quando o ritmo fica muito elevado.
- **Movimento reduzido:** as animações respeitam a preferência do sistema.

### Do início até aqui

| Versão | O que trouxe |
| --- | --- |
| 0.1 | Primeira faixa: % das 5 h, contagem até renovar e % semanal |
| 0.2 | Visual estilo Apple: barra fina e cores do tema |
| 0.3 | Bolinha de cache quente / morno / frio e uso do contexto |
| 0.4 | Tudo numa linha só |
| 0.5 | Bolinha viva, barra que enche com animação, ritmo, toque para alternar e alertas |
| 0.6 | Layout responsivo, ritmo em 3 estados, avisos de dado desatualizado, detalhes por hover e foco |
| 0.7 | Ajustes para caber no MacBook |
| 0.8 | Primeira versão minimalista |
| **1.0** | **Só as 5 h, clique que troca só a renovação, sem texto cortado** |

### Instalar

```
/plugin install usage-band --marketplace vianx7/mods-claude
```

### Atualizar

Ligue o auto-update uma vez em `/plugin` → Marketplaces → mods-claude → *Enable auto-update*. Se preferir na mão:

```bash
claude plugin marketplace update mods-claude && claude plugin update usage-band@mods-claude
```

Depois de atualizar, reinicie o Claude Code.
