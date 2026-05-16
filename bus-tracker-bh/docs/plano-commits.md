# Plano de commits sugerido

Use commits pequenos e claros para demonstrar a participação do grupo e a evolução real do projeto.

## Sequência recomendada

1. `chore: adiciona estrutura inicial do projeto`
   - index.html
   - pasta js
   - pasta data
   - README inicial

2. `feat: configura mapa com Leaflet`
   - inicialização do mapa
   - camada do OpenStreetMap
   - grupos de marcadores

3. `feat: carrega arquivos CSV com PapaParse`
   - leitura do CSV de pontos
   - leitura do CSV de linhas
   - criação do dicionário de linhas

4. `feat: converte coordenadas UTM para latitude e longitude`
   - função com Proj4
   - extração de coordenadas do campo GEOMETRIA

5. `feat: exibe ônibus em tempo real no mapa`
   - consumo da API da PBH
   - marcadores circulares dos ônibus
   - popup com linha e veículo

6. `feat: adiciona atualização automática a cada 20 segundos`
   - setInterval
   - botão de atualização manual
   - status de última atualização

7. `feat: implementa filtro por linha`
   - campo de busca
   - datalist com linhas
   - limpeza dos ônibus de outras linhas

8. `feat: exibe pontos de parada da linha selecionada`
   - filtro do CSV por COD_LINHA
   - marcadores dos pontos da linha
   - ajuste de zoom no mapa

9. `feat: destaca ponto de ônibus mais próximo do usuário`
   - uso de navigator.geolocation
   - cálculo de distância pela fórmula de Haversine
   - marcador especial para o ponto mais próximo

10. `style: melhora layout responsivo com Bootstrap`
    - header responsivo
    - painel de status
    - legenda visual

11. `docs: atualiza README com instruções de execução`
    - tecnologias usadas
    - como rodar com Live Server
    - checklist da entrega

## Como cada integrante pode contribuir

- Integrante 1: mapa Leaflet e API dos ônibus.
- Integrante 2: CSV, PapaParse e conversão de coordenadas.
- Integrante 3: filtro por linha e exibição dos pontos.
- Integrante 4: geolocalização e ponto mais próximo.
- Integrante 5: Bootstrap, responsividade, README e organização da apresentação.

O ideal é que cada integrante faça pelo menos 2 ou 3 commits reais no GitHub.
