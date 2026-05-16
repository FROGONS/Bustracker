// ============================================================================
// VARIÁVEIS GLOBAIS E CONSTANTES
// ============================================================================

let mapaLeaflet;
let grupoVeiculos;
let grupoPontos;
let grupoPontoProximo;

let dadosPontos = [];
let mapaLinhas = new Map();
let cacheVeiculos = [];
let intervaloAtualizacao = null;

const CAMINHO_PONTOS = "data/20260401_ponto_onibus.csv";
const CAMINHO_LINHAS = "data/bhtrans_bdlinha.csv";
const URL_API = "https://corsproxy.io/?url=https://temporeal.pbh.gov.br/?param=D";
const TEMPO_ATUALIZACAO_MS = 20000;

// Sistema de coordenadas usado no arquivo de pontos: SIRGAS 2000 / UTM zone 23S.
const UTM_FORMAT = "+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";

const elementos = {};

// ============================================================================
// INICIALIZAÇÃO E EVENTOS DA INTERFACE (DOM)
// ============================================================================

document.addEventListener("DOMContentLoaded", iniciarAplicacao);

async function iniciarAplicacao() {
    mapearElementosHTML();
    inicializarMapa();
    configurarEventos();

    try {
        atualizarStatus("Carregando arquivos CSV...");
        await carregarDadosLocais();
        preencherListaDeLinhas();

        atualizarStatus("Arquivos carregados. Buscando ônibus em tempo real...");
        await atualizarOnibus();

        intervaloAtualizacao = setInterval(atualizarOnibus, TEMPO_ATUALIZACAO_MS);
    } catch (erro) {
        console.error(erro);
        atualizarStatus("Erro ao carregar o projeto. Confira se está usando Live Server.");
    }
}

function mapearElementosHTML() {
    elementos.filtroLinha = document.getElementById("filtroLinha");
    elementos.listaLinhas = document.getElementById("listaLinhas");
    elementos.btnLimparFiltro = document.getElementById("btnLimparFiltro");
    elementos.btnAtualizar = document.getElementById("btnAtualizar");
    elementos.statusSistema = document.getElementById("statusSistema");
    elementos.statusFiltro = document.getElementById("statusFiltro");
}

function configurarEventos() {
    elementos.filtroLinha.addEventListener("change", aplicarFiltroLinha);

    elementos.filtroLinha.addEventListener("keydown", (evento) => {
        if (evento.key === "Enter") {
            aplicarFiltroLinha();
        }
    });

    elementos.btnLimparFiltro.addEventListener("click", () => {
        elementos.filtroLinha.value = "";
        aplicarFiltroLinha();
    });

    elementos.btnAtualizar.addEventListener("click", atualizarOnibus);
}

// ============================================================================
// MAPA (LEAFLET)
// ============================================================================


function inicializarMapa() {
    mapaLeaflet = L.map("map").setView([-19.9167, -43.9345], 12);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors"
    }).addTo(mapaLeaflet);

    grupoVeiculos = L.layerGroup().addTo(mapaLeaflet);
    grupoPontos = L.layerGroup().addTo(mapaLeaflet);
    grupoPontoProximo = L.layerGroup().addTo(mapaLeaflet);
}

// ============================================================================
// DADOS (CSV/API)
// ============================================================================


async function carregarDadosLocais() {
    const [textoPontos, textoLinhas] = await Promise.all([
        carregarTexto(CAMINHO_PONTOS, "utf-8"),
        carregarTexto(CAMINHO_LINHAS, "iso-8859-1")
    ]);

    dadosPontos = parsearPontos(textoPontos);
    mapaLinhas = parsearLinhas(textoLinhas);
}

async function carregarTexto(caminho, codificacao) {
    const resposta = await fetch(caminho);

    if (!resposta.ok) {
        throw new Error(`Não foi possível carregar ${caminho}`);
    }

    const buffer = await resposta.arrayBuffer();
    return new TextDecoder(codificacao).decode(buffer);
}

function parsearPontos(textoCSV) {
    const resultado = Papa.parse(textoCSV, {
        header: true,
        delimiter: ";",
        skipEmptyLines: true
    });

    return resultado.data
        .map((ponto) => {
            const coordenadas = extrairLatLngDaGeometria(ponto.GEOMETRIA);

            if (!coordenadas) {
                return null;
            }

            return {
                id: ponto.ID_PONTO_ONIBUS_LINHA,
                codigoLinha: normalizarCodigoLinha(ponto.COD_LINHA),
                nomeLinha: ponto.NOME_LINHA,
                nomeSubLinha: ponto.NOME_SUB_LINHA,
                origem: ponto.ORIGEM,
                identificador: ponto.IDENTIFICADOR_PONTO_ONIBUS,
                lat: coordenadas.lat,
                lng: coordenadas.lng
            };
        })
        .filter(Boolean);
}

function parsearLinhas(textoCSV) {
    const resultado = Papa.parse(textoCSV, {
        header: true,
        delimiter: ";",
        skipEmptyLines: true
    });

    const mapa = new Map();

    resultado.data.forEach((linha) => {
        const codigoLinha = normalizarCodigoLinha(linha.Linha);
        const numeroLinha = normalizarCodigoLinha(linha.NumeroLinha);
        const nomeLinha = linha.Nome?.trim() || "Nome não encontrado";

        if (codigoLinha && !mapa.has(codigoLinha)) {
            mapa.set(codigoLinha, nomeLinha);
        }

        // Algumas bases usam NumeroLinha; por isso também guardamos essa chave.
        if (numeroLinha && !mapa.has(numeroLinha)) {
            mapa.set(numeroLinha, nomeLinha);
        }
    });

    return mapa;
}

function preencherListaDeLinhas() {
    const codigosOrdenados = [...mapaLinhas.keys()]
        .filter((codigo) => codigo.length > 1)
        .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));

    elementos.listaLinhas.innerHTML = "";

    codigosOrdenados.forEach((codigo) => {
        const option = document.createElement("option");
        option.value = `${codigo} - ${mapaLinhas.get(codigo)}`;
        elementos.listaLinhas.appendChild(option);
    });
}



// ============================================================================
// LÓGICA DE ÔNIBUS EM TEMPO REAL
// ============================================================================


async function atualizarOnibus() {
    try {
        const resposta = await fetch(URL_API);

        if (!resposta.ok) {
            throw new Error("Falha na API de ônibus");
        }

        const dadosAPI = await resposta.json();
        cacheVeiculos = Array.isArray(dadosAPI) ? dadosAPI : [];
        desenharVeiculos();
    } catch (erro) {
        console.error(erro);
        atualizarStatus("Não foi possível buscar os ônibus agora. Tente atualizar novamente.");
    }
}

function desenharVeiculos() {
    const filtro = obterLinhaDigitada();
    const veiculosFiltrados = filtrarVeiculosPorLinha(cacheVeiculos, filtro);

    grupoVeiculos.clearLayers();

    veiculosFiltrados.forEach((veiculo) => {
        const lat = Number(veiculo.LT);
        const lng = Number(veiculo.LG);

        if (Number.isNaN(lat) || Number.isNaN(lng)) {
            return;
        }

        const codigoLinha = normalizarCodigoLinha(veiculo.NL || veiculo.LINHA || veiculo.COD_LINHA);
        const nomeLinha = mapaLinhas.get(codigoLinha) || mapaLinhas.get(obterCodigoBase(codigoLinha)) || "Linha sem nome na base";

        const marcador = L.circleMarker([lat, lng], {
            radius: 6,
            color: "#e63946",
            fillColor: "#e63946",
            fillOpacity: 0.85,
            weight: 2
        });

        marcador.bindPopup(`
            <strong>Linha ${codigoLinha || "não informada"}</strong><br>
            ${nomeLinha}<br>
            <small>Veículo: ${veiculo.VL || veiculo.NV || "não informado"}</small>
        `);

        marcador.addTo(grupoVeiculos);
    });

    const agora = new Date().toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });

    atualizarStatus(`Atualizado às ${agora}. Ônibus exibidos: ${veiculosFiltrados.length}.`);
}

function filtrarVeiculosPorLinha(veiculos, filtro) {
    if (!filtro) {
        return veiculos;
    }

    const filtroNormalizado = normalizarCodigoLinha(filtro);
    const filtroBase = obterCodigoBase(filtroNormalizado);

    return veiculos.filter((veiculo) => {
        const codigoVeiculo = normalizarCodigoLinha(veiculo.NL || veiculo.LINHA || veiculo.COD_LINHA);
        return codigoVeiculo === filtroNormalizado || obterCodigoBase(codigoVeiculo) === filtroBase;
    });
}

// ============================================================================
// LÓGICA DE FILTROS E PONTOS DE PARADA
// ============================================================================

function aplicarFiltroLinha() {
    const codigoLinha = obterLinhaDigitada();

    grupoPontos.clearLayers();
    grupoPontoProximo.clearLayers();

    if (!codigoLinha) {
        elementos.statusFiltro.textContent = "Visão geral: todos os ônibus ativos.";
        desenharVeiculos();
        mapaLeaflet.setView([-19.9167, -43.9345], 12);
        return;
    }

    const pontosDaLinha = buscarPontosDaLinha(codigoLinha);
    desenharPontosDaLinha(pontosDaLinha, codigoLinha);
    destacarPontoMaisProximo(pontosDaLinha);
    desenharVeiculos();
}

function buscarPontosDaLinha(codigoLinha) {
    const filtro = normalizarCodigoLinha(codigoLinha);
    const filtroBase = obterCodigoBase(filtro);

    return dadosPontos.filter((ponto) => {
        return ponto.codigoLinha === filtro || obterCodigoBase(ponto.codigoLinha) === filtroBase;
    });
}

function desenharPontosDaLinha(pontosDaLinha, codigoLinha) {
    if (pontosDaLinha.length === 0) {
        elementos.statusFiltro.textContent = `Linha ${codigoLinha}: nenhum ponto encontrado no CSV.`;
        return;
    }

    const limites = [];

    pontosDaLinha.forEach((ponto) => {
        const marcador = L.circleMarker([ponto.lat, ponto.lng], {
            radius: 4,
            color: "#1d3557",
            fillColor: "#1d3557",
            fillOpacity: 0.65,
            weight: 1
        });

        marcador.bindPopup(`
            <strong>Ponto ${ponto.identificador}</strong><br>
            Linha: ${ponto.codigoLinha} - ${ponto.nomeLinha}<br>
            Sentido/variação: ${ponto.nomeSubLinha || "não informado"}<br>
            Origem: ${ponto.origem || "não informada"}
        `);

        marcador.addTo(grupoPontos);
        limites.push([ponto.lat, ponto.lng]);
    });

    elementos.statusFiltro.textContent = `Linha ${codigoLinha}: ${pontosDaLinha.length} pontos de parada exibidos.`;

    if (limites.length > 0) {
        mapaLeaflet.fitBounds(limites, { padding: [32, 32], maxZoom: 15 });
    }
}

function destacarPontoMaisProximo(pontosDaLinha) {
    if (pontosDaLinha.length === 0) {
        return;
    }

    if (!navigator.geolocation) {
        elementos.statusFiltro.textContent += " Geolocalização não disponível neste navegador.";
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (posicao) => {
            const usuario = {
                lat: posicao.coords.latitude,
                lng: posicao.coords.longitude
            };

            const pontoMaisProximo = encontrarPontoMaisProximo(usuario, pontosDaLinha);

            if (!pontoMaisProximo) {
                return;
            }

            L.circleMarker([usuario.lat, usuario.lng], {
                radius: 7,
                color: "#0d6efd",
                fillColor: "#0d6efd",
                fillOpacity: 0.85,
                weight: 2
            })
                .bindPopup("<strong>Sua localização aproximada</strong>")
                .addTo(grupoPontoProximo);

            L.circleMarker([pontoMaisProximo.lat, pontoMaisProximo.lng], {
                radius: 9,
                color: "#2a9d8f",
                fillColor: "#2a9d8f",
                fillOpacity: 0.95,
                weight: 3
            })
                .bindPopup(`
                    <strong>Ponto mais próximo</strong><br>
                    Ponto ${pontoMaisProximo.identificador}<br>
                    Distância aproximada: ${formatarDistancia(pontoMaisProximo.distancia)}
                `)
                .addTo(grupoPontoProximo);

            elementos.statusFiltro.textContent += ` Ponto mais próximo: ${pontoMaisProximo.identificador} (${formatarDistancia(pontoMaisProximo.distancia)}).`;
        },
        () => {
            elementos.statusFiltro.textContent += " Permita a localização do navegador para destacar o ponto mais próximo.";
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 30000
        }
    );
}

// ============================================================================
// CÁLCULOS GEOGRÁFICOS E MATEMÁTICA
// ============================================================================

function extrairLatLngDaGeometria(geometria) {
    if (!geometria) {
        return null;
    }

    const resultado = geometria.match(/POINT\s*\(([-\d.]+)\s+([-\d.]+)\)/i);

    if (!resultado) {
        return null;
    }

    const x = Number(resultado[1]);
    const y = Number(resultado[2]);

    if (Number.isNaN(x) || Number.isNaN(y)) {
        return null;
    }

    const [longitude, latitude] = proj4(UTM_FORMAT, "EPSG:4326", [x, y]);
    return { lat: latitude, lng: longitude };
}

function encontrarPontoMaisProximo(usuario, pontosDaLinha) {
    let melhorPonto = null;
    let menorDistancia = Infinity;

    pontosDaLinha.forEach((ponto) => {
        const distancia = calcularDistanciaMetros(usuario.lat, usuario.lng, ponto.lat, ponto.lng);

        if (distancia < menorDistancia) {
            menorDistancia = distancia;
            melhorPonto = { ...ponto, distancia };
        }
    });

    return melhorPonto;
}

function calcularDistanciaMetros(lat1, lng1, lat2, lng2) {
    const raioTerra = 6371000;
    const lat1Rad = grausParaRadianos(lat1);
    const lat2Rad = grausParaRadianos(lat2);
    const diferencaLat = grausParaRadianos(lat2 - lat1);
    const diferencaLng = grausParaRadianos(lng2 - lng1);

    const a = Math.sin(diferencaLat / 2) ** 2 +
        Math.cos(lat1Rad) * Math.cos(lat2Rad) *
        Math.sin(diferencaLng / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return raioTerra * c;
}

function grausParaRadianos(valor) {
    return valor * Math.PI / 180;
}

// ============================================================================
// FUNÇÕES UTILITÁRIAS E FORMATAÇÃO
// ============================================================================

function formatarDistancia(distanciaMetros) {
    if (distanciaMetros < 1000) {
        return `${Math.round(distanciaMetros)} m`;
    }

    return `${(distanciaMetros / 1000).toFixed(2).replace(".", ",")} km`;
}

function obterLinhaDigitada() {
    const valor = elementos.filtroLinha.value.trim();

    if (!valor) {
        return "";
    }

    // Quando o usuário escolhe uma opção do datalist, o valor fica "8001A - Nome da linha".
    return normalizarCodigoLinha(valor.split(" - ")[0]);
}

function normalizarCodigoLinha(valor) {
    return String(valor || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
}

function obterCodigoBase(codigoLinha) {
    return normalizarCodigoLinha(codigoLinha).split("-")[0];
}

function atualizarStatus(mensagem) {
    elementos.statusSistema.textContent = mensagem;
}
