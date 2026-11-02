# usage-band

Uma faixa minimalista, de uma linha só, acima da caixa de texto do Claude Code:

```
━━━━━━━━━━━━ 5h 94% ↗ · renova em 1h46                    ◉ Quente
```

**Clique no bloco de uso** para trocar entre a janela de 5 h e a semana. Só esse bloco muda:

```
━━━━━━━━━━━━ Semana 20% · renova em 3d                    ◉ Quente
```

A escolha fica salva entre sessões.

## O que aparece

- **Barra + %**: quanto da janela já foi usado. Azul, laranja a partir de 75%, vermelha a partir de 90%. Quando o valor muda, ou quando você troca de visão, a barra anima até o valor novo.
- **Ritmo** (só na visão de 5 h): `→` normal, `↗` elevado (laranja), `↑` muito elevado (vermelho). Fica oculto enquanto há pouco histórico na janela.
- **renova em …**: tempo até a janela renovar.
- **Bolinha do cache** `◉ ◐ ○ ◌`: quente, morno, frio ou sem registro. Enquanto o Claude trabalha, ela pulsa.

### Ritmo

R = (% usado ÷ fração da janela de 5 h já passada) ÷ 100.

| Estado | Entra | Volta para o nível de baixo |
| --- | --- | --- |
| Normal `→` | R < 0,9 | — |
| Elevado `↗` | R ≥ 0,9 | R < 0,8 |
| Muito elevado `↑` | R ≥ 1,25 | R < 1,15 |

Nos primeiros 30 min da janela, o ritmo não aparece.

### Cache

O Claude Code guarda o histórico da conversa no cache de prompt por 1 hora depois da última resposta.

- **Quente**: menos de 45 min desde a última resposta.
- **Morno**: entre 45 e 60 min, o cache expira em breve.
- **Frio**: mais de 1 h, a próxima mensagem relê o histórico inteiro sem desconto.

Não tem relação com a qualidade do raciocínio.

### Avisos de dado

Os números vêm das respostas da API, então uma sessão ociosa não é atraso. Só quando o horário de renovação já passou sem leitura nova aparece:

- `⟳` desatualizado
- `⋯` atualizando
- `⚠` falha

Sem dado, aparece `—`, nunca 0%.

## Larguras

- **Larga** (≥ ~56 colunas): barra de 12 e o texto do cache.
- **Média**: barra de 6 e só a bolinha.
- **Estreita** (< ~43 colunas): sem barra, `7d` em vez de *Semana* e tempos curtos (`5h 94% ↗  1h46`).

No app desktop, a faixa reserva 12 colunas a mais por causa dos botões nativos.

## Alertas

Uma vez por janela de 5 h: aos 90%, aos 100% e quando o ritmo fica muito elevado a partir de 60% de uso.

## Instalação

No prompt do Claude Code:

```
/plugin install usage-band --marketplace vianx7/mods-claude
```

## Atualização

Ligue o auto-update uma vez em `/plugin` → Marketplaces → mods-claude → *Enable auto-update*. Depois disso, cada versão nova chega sozinha quando você abre o Claude Code.

Para atualizar na mão:

```bash
claude plugin marketplace update mods-claude && claude plugin update usage-band@mods-claude
```
