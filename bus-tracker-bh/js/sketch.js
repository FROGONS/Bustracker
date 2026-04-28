
let mapaLeaflet;
let dadosPontos;
let grupoVeiculos;
let grupoPontos;

const utmFormat = "+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";
const urlAPI = "https://corsproxy.io/?url=https://temporeal.pbh.gov.br/?param=D";

function preload() {
    dadosPontos = loadStrings("./../../data/20260401_ponto_onibus.csv");
}

function inicializarMap(){
    //Mapa centrado em BH
    mapaLeaflet = L.map('map').setView([-19.9167, -43.9345], 12);
    
    //Cria as ruas
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(mapaLeaflet);

    grupoVeiculos = L.layerGroup().addTo(mapaLeaflet);
    grupoPontos = L.layerGroup();

    dadosPontos.forEach(element => {
        let textoLimpo = element.GEOMETRIA.replace('(', '').replace(')', '');
        let coordenadas = textoLimpo.split(' ');
        coordenadas = converterParaLatLng(coordenadas[0], coordenadas[1]);
        element.lat = coordenadas[0];
        element.lng = coordenadas[1];
        L.marker([element.lat, element.lng]).addTo(grupoPontos);
    });
}

function converterParaLatLng(x, y) {
    const coords = proj4(utmFormat, "EPSG:4326", [x, y]);
    return [coords[1], coords[0]]; // Retorna [Lat, Lng]
}

function atualizarOnibus() {
    fetch(urlAPI)
        .then(response => response.json())
        .then(data => {
            // Lógica para limpar marcadores antigos e adicionar novos
            console.log("Dados atualizados!");
        });
}

function setup(){
    noCanvas();

    let csvString = dadosPontos.join('\n');
    let resultado = Papa.parse(csvString, {
        header: true,        
        dynamicTyping: true, 
        skipEmptyLines: true
    });

    dadosPontos = resultado.data;
    
    inicializarMap();
    atualizarOnibus();
    setInterval(atualizarOnibus, 20000);

}

function draw() {

}

