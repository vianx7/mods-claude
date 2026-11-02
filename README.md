# usage-band

Uma faixa de uma linha só, acima da caixa de texto do Claude Code, com o uso do seu plano:

```
Larga:    5h ━━━━━━━━━━━━ 94% ↗      Renova em 1h46      (62)      ◉ Quente
Média:    5h ━━━━━━ 94% ↗   1h46   (62)   ◉
Estreita: 5h 94% ↗  1h46  (62)  ◉
```

`(62)` é o anel de contexto. No app desktop ele é um anel de progresso com o número dentro; no terminal, um símbolo (`○ ◔ ◑ ◕ ●`) seguido do número.

## O que cada item mostra

| Item | O que é | Interação |
| --- | --- | --- |
| **5h** barra + % | Quanto da janela de 5 horas já foi usado. Barra azul, laranja a partir de 75%, vermelha a partir de 90%. | Clique ou foco: detalhes e hora da última atualização. |
| **Ritmo** `→ ↗ ↑` | Ritmo de consumo da janela de 5 h (critérios abaixo). | Hover ou foco: "Ritmo normal", "Ritmo elevado" ou "Ritmo muito elevado". |
| **Renovação das 5 h** | *Renova em 1h46* ou *Renova às 13:46* (fuso local). | Clique alterna entre as duas; a escolha fica salva. |
| **Anel de contexto** | Quanto da janela de contexto a conversa ocupa. | Hover ou foco: "Contexto: X% ocupado". |
| **Cache** `◉ ◐ ○ ◌` | Estado do cache de prompt: quente, morno, frio ou sem registro. | Hover ou foco: o que o estado significa. |

### Critérios do ritmo

O ritmo usa os dados que a fonte fornece: o percentual usado e o horário de renovação da janela de 5 h. A partir deles calcula **R = (% usado ÷ fração da janela já passada) ÷ 100**, que é o consumo projetado para o fim da janela, se o ritmo médio continuar.

| Estado | Símbolo | Cor | Entra quando | Sai quando |
| --- | --- | --- | --- | --- |
| Calculando | `…` | neutra | menos de 30 min da janela passados (10%) | — |
| Normal | `→` | neutra | R < 0,9 | — |
| Elevado | `↗` | laranja | R ≥ 0,9 | R < 0,8 (volta a normal) |
| Muito elevado | `↑` | vermelha | R ≥ 1,25 | R < 1,15 (volta a elevado) |

- **Contra oscilação:** para descer de nível, R precisa ficar 0,1 abaixo do limiar de subida. Além disso, a classificação só é refeita quando chega uma leitura nova. Como R é uma média desde o início da janela, ele já é naturalmente suavizado.
- **Sem histórico:** o ritmo aparece como "calculando", nunca como "normal".
- **O que não é mostrado:** nenhuma taxa numérica, previsão de esgotamento ou estimativa de mensagens.

### Estado do cache

O Claude Code guarda o histórico da conversa no cache de prompt por **1 hora** depois da última resposta.

- **◉ Quente** (menos de 45 min): o cache está ativo e a próxima mensagem relê o histórico com desconto.
- **◐ Morno** (45 a 60 min): ainda está no cache, mas expira em breve.
- **○ Frio** (mais de 1 h): o cache expirou e a próxima mensagem relê o histórico inteiro sem desconto.
- **◌ Novo / Cache —**: conversa sem histórico, ou sem registro da última resposta. Nesse caso o estado nunca é presumido como frio.

Os estados se distinguem pela forma (cheio, meio, contorno, tracejado), não só pela cor. O estado do cache **não** mede a qualidade do raciocínio.

### Dados desatualizados ou indisponíveis

Os números vêm dos cabeçalhos das respostas da API, então só mudam quando há uma resposta. Uma sessão ociosa não conta como atraso. O aviso aparece só no dado afetado, e só quando o horário de renovação conhecido já passou sem nenhuma leitura nova:

- `⟳` **desatualizado**: a janela renovou e a leitura nova chega com a próxima resposta. O consumo antigo continua visível, esmaecido, e nunca é zerado sem confirmação da fonte.
- `⋯` **atualizando**: há uma resposta em andamento.
- `⚠` **falha**: a última resposta terminou com erro e não trouxe leitura.
- `—` **sem dados**: por exemplo, antes da primeira resposta ou fora de um plano de assinatura. Nunca aparece como 0%.

Os detalhes de cada item mostram "Última atualização há X".

O uso semanal não é exibido.

## Larguras

A faixa escolhe o nível pela largura da **própria faixa** (`bodyColumns`), reservando espaço para a opção mais longa de cada botão. Assim, alternar a exibição nunca muda o layout.

| Nível | Precisa de | O que muda |
| --- | --- | --- |
| Larga | ~58 colunas | rótulos completos, barra de 12, texto do cache |
| Média | ~34 colunas | barra de 6, tempos curtos, só o símbolo do cache |
| Estreita | ~27 colunas | sem barra |
| Compacta | ~24 colunas | espaçamento mínimo |

No app desktop, os botões são nativos e ocupam mais que as células de texto, por isso a faixa reserva 12 colunas a mais antes de escolher o nível. Os valores usam largura **mínima**, nunca fixa, para nunca serem cortados.

Números com largura fixa (`tabular-nums` e larguras reservadas) evitam que a faixa "dance" quando um tempo passa de `1h00` para `59m`. As animações (barra enchendo e bolinha pulsando) respeitam a preferência de movimento reduzido do sistema.

## Alertas

Uma vez por janela de 5 h, e só no que importa: 90%, 100% e ritmo muito elevado a partir de 60% de uso.

## Instalação

No prompt de uma sessão do Claude Code:

```
/plugin install usage-band --marketplace vianx7/mods-claude
```

Pelo terminal:

```bash
claude plugin install usage-band --marketplace vianx7/mods-claude
```

## Atualização

Publicar no GitHub **não** atualiza as instalações sozinho:

- **Computador:** rode `claude plugin marketplace update mods-claude && claude plugin update usage-band@mods-claude` e reinicie o Claude Code. Outra opção é ligar o auto-update em `/plugin` → Marketplaces → mods-claude.
- **Nuvem:** sessões novas que instalam o mod pelo Setup script já pegam a versão mais recente.
