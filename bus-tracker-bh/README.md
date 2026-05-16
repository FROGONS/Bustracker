# Rastreador de Ônibus BH

Aplicação web responsiva para monitoramento dos ônibus de Belo Horizonte em tempo real, com mapa Leaflet, filtro por linha, pontos de parada e destaque do ponto mais próximo do usuário.

## Funcionalidades implementadas

- Exibição dos ônibus ativos no mapa.
- Atualização automática dos veículos a cada 20 segundos.
- Filtro por linha de ônibus.
- Exibição dos pontos de parada da linha filtrada.
- Conversão das coordenadas UTM do CSV para latitude/longitude usando Proj4.
- Leitura dos arquivos CSV com PapaParse.
- Destaque do ponto de ônibus mais próximo usando geolocalização do navegador.
- Layout responsivo com Bootstrap.

## Tecnologias usadas

- HTML5
- CSS3
- JavaScript
- Bootstrap
- Leaflet.js
- Proj4.js
- PapaParse
- API de tempo real da PBH via proxy CORS

## Estrutura do projeto

```text
rastreador-onibus-bh/
├── index.html
├── js/
│   └── sketch.js
├── data/
│   ├── 20260401_ponto_onibus.csv
│   └── bhtrans_bdlinha.csv
├── docs/
│   └── plano-commits.md
├── .gitignore
│   styles.css
├── data/
│   └── favicon.png
└── README.md
```

## Como executar

Como o projeto usa `fetch()` para ler arquivos CSV locais, é recomendado abrir com uma extensão como **Live Server** no VS Code.

1. Abra a pasta do projeto no VS Code.
2. Instale a extensão **Live Server**, caso ainda não tenha.
3. Clique com o botão direito no `index.html`.
4. Selecione **Open with Live Server**.
5. Digite uma linha no filtro, por exemplo: `8001A`, `3050` ou `3301A`.

> Observação: a função de ponto mais próximo depende da permissão de localização do navegador.

## Checklist de entrega

- [ ] Testar visão geral com todos os ônibus.
- [ ] Testar atualização manual pelo botão Atualizar.
- [ ] Testar atualização automática aguardando 20 segundos.
- [ ] Testar filtro por linha.
- [ ] Testar pontos de parada da linha.
- [ ] Permitir geolocalização e verificar destaque do ponto mais próximo.
- [ ] Testar responsividade no modo mobile do navegador.
- [ ] Gravar o vídeo de demonstração.
- [ ] Conferir lista de commits no GitHub.
