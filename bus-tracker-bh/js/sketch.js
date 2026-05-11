let mapaLeaflet;
let dadosPontos;
let mapaLinhas = {}; // { idLinha: nomeLinha }
let grupoVeiculos;
let grupoPontos;

const utmFormat = "+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";
const urlAPI = "https://corsproxy.io/?url=https://temporeal.pbh.gov.br/?param=D";

function preload() {
    // Carrega o CSV de pontos de ônibus
    dadosPontos = loadStrings("../data/20260401_ponto_onibus.csv");
}

function setup() {
    noCanvas();

    // --- Parseia CSV de pontos ---
    let csvString = dadosPontos.join('\n');
    let resultado = Papa.parse(csvString, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true
    });
    dadosPontos = resultado.data;

    // --- Carrega CSV de linhas via fetch (substitui o require/fs) ---
    fetch("../data/bhtrans_bdlinha.csv")
        .then(response => response.text())
        .then(text => {
            mapaLinhas = parsearLinhas(text);
            console.log("Linhas carregadas:", Object.keys(mapaLinhas).length);
        }).catch(err => console.log("Erro ao carregar os arquvisos das linhas"));

    inicializarMapa();
    atualizarOnibus();
    setInterval(atualizarOnibus, 20000);
}

// Substitui carregarLinhas() — mesma lógica, mas sem require/fs
function parsearLinhas(conteudo) {
    const linhas = conteudo.split('\n');
    const mapa = {};

    for (let i = 1; i < linhas.length; i++) {
        const colunas = linhas[i].split(';');
        if (colunas.length >= 3) {
            const idLinha = colunas[1].trim();
            const nomeLinha = colunas[2].trim();
            mapa[idLinha] = nomeLinha;
        }
    }
    return mapa;
}

function inicializarMapa() {
    mapaLeaflet = L.map('map').setView([-19.9167, -43.9345], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(mapaLeaflet);

    grupoVeiculos = L.layerGroup().addTo(mapaLeaflet);
    grupoPontos = L.layerGroup();

    dadosPontos.forEach(element => {
        if (!element.GEOMETRIA) return;

        let textoLimpo = element.GEOMETRIA.replace('(', '').replace(')', '');
        let partes = textoLimpo.trim().split(/\s+/);

        if (partes.length >= 2) {
            let coordenadas = converterParaLatLng(parseFloat(partes[0]), parseFloat(partes[1]));
            element.lat = coordenadas[0];
            element.lng = coordenadas[1];
            L.marker([element.lat, element.lng]).addTo(grupoPontos);
        }
    });
}

function converterParaLatLng(x, y) {
    const coords = proj4(utmFormat, "EPSG:4326", [x, y]);
    return [coords[1], coords[0]];
}

function atualizarOnibus() {
    fetch(urlAPI)
        .then(response => response.json())
        .then(data => {
            grupoVeiculos.clearLayers(); // Remove marcadores antigos

            data.forEach(veiculo => {
                if (!veiculo.latitude || !veiculo.longitude) return;

                const nome = mapaLinhas[veiculo.linha] || veiculo.linha;
                const marcador = L.circleMarker(
                    [veiculo.latitude, veiculo.longitude],
                    { radius: 6, color: '#e63946', fillOpacity: 0.9 }
                );
                marcador.bindPopup(`<b>Linha ${veiculo.linha}</b><br>${nome}`);
                marcador.addTo(grupoVeiculos);
            });

            console.log(`Ônibus atualizados: ${data.length} veículos`);
        })
        .catch(err => console.error("Erro ao buscar ônibus:", err));
}

function draw() {
    // Sem canvas — tudo é feito pelo Leaflet
}