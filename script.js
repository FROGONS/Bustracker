// BH RASTREADOR · script.js (rev 3 - Integrado)
// Stack: Leaflet · PapaParse · Proj4js · Fetch API

'use strict';

// Definições de projeção (UTM Sirgas 2000 para WGS84)
proj4.defs('SIRGAS2000_UTM23S',
    '+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'
);

// Constantes
const PBH_JSON    = 'http://localhost:3000/'; // Proxy local para contornar CORS
const CSV_LINHAS  = './bhtrans_bdlinha.csv';
const CSV_PONTOS  = './20260401_ponto_onibus.csv';
const REFRESH_MS  = 20_000;
const BH_CENTER   = [-19.9167, -43.9345];
const BH_ZOOM     = 13;

// Estado global da aplicação
const state = {
    map:             null,
    busLayer:        null,
    stopLayer:       null,
    userMarker:      null,
    userLatLng:      null,
    timerInterval:   null,
    refreshInterval: null,
    timerRemaining:  REFRESH_MS / 1000,
    activeFilter:    null,
    allLinhas:       [],   // [{NumeroLinha, Linha, Nome}]
    allPontos:       [],   // parsed CSV rows
    csvLoaded:       false,

    // Índices construídos após o carregamento dos CSVs para busca rápida
    linhaByNumero:   new Map(),  // NumeroLinha -> {Linha, Nome}
    pontosByCod:     new Map(),  // COD_LINHA -> { meta, paradas[] }
};

// 1. Inicialização do Mapa
function initMap() {
    state.map = L.map('map', {
        center:             BH_CENTER,
        zoom:               BH_ZOOM,
        zoomControl:        false,
        attributionControl: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/">CARTO</a>',
        subdomains:  'abcd',
        maxZoom:     19,
    }).addTo(state.map);

    L.control.zoom({ position: 'bottomright' }).addTo(state.map);

    state.busLayer  = L.layerGroup().addTo(state.map);
    state.stopLayer = L.layerGroup().addTo(state.map);
}

// 2. Carregamento dos dados em CSV
async function loadCSVs() {
    try {
        const [linhasRaw, pontosRaw] = await Promise.all([
            fetchCSV(CSV_LINHAS),
            fetchCSV(CSV_PONTOS),
        ]);
        state.allLinhas = linhasRaw;
        state.allPontos = pontosRaw;
        state.csvLoaded = true;

        buildIndexes();
        buildSuggestions();
        console.log(`[CSV] Linhas: ${linhasRaw.length} | Pontos: ${pontosRaw.length} | Linhas indexadas: ${state.pontosByCod.size}`);
    } catch (err) {
        console.warn('[CSV] Falha ao carregar CSVs:', err);
        showToast('⚠ CSVs locais não encontrados. Paradas indisponíveis.');
    }
}

function buildIndexes() {
    state.linhaByNumero.clear();
    for (const r of state.allLinhas) {
        const key = normalizeCode(r.NumeroLinha);
        if (key) state.linhaByNumero.set(key, r);
    }

    state.pontosByCod.clear();
    for (const row of state.allPontos) {
        const cod = normalizeCode(row.COD_LINHA);
        if (!cod) continue;

        let entry = state.pontosByCod.get(cod);
        if (!entry) {
            entry = {
                nomeLinha:    row.NOME_LINHA || '',
                origem:       row.ORIGEM     || '',
                subLinhas:    new Set(),
                paradas:      [],   // [{lat, lng, id, sub}]
            };
            state.pontosByCod.set(cod, entry);
        }
        if (row.NOME_SUB_LINHA) entry.subLinhas.add(row.NOME_SUB_LINHA);

        const latLng = utmToLatLng(row.GEOMETRIA);
        if (latLng) {
            entry.paradas.push({
                lat: latLng[0],
                lng: latLng[1],
                id:  row.IDENTIFICADOR_PONTO_ONIBUS || row.ID_PONTO_ONIBUS_LINHA || '',
                sub: row.NOME_SUB_LINHA || '',
            });
        }
    }
}

function fetchCSV(path) {
    return new Promise((resolve, reject) => {
        Papa.parse(path, {
            download:       true,
            header:         true,
            delimiter:      ';',
            skipEmptyLines: true,
            complete: r => resolve(r.data),
            error:    e => reject(e),
        });
    });
}

// 3. Busca e processamento das posições dos ônibus na API
async function fetchBuses() {
    console.log('Buscando ônibus...');
    setStatus('loading');

    try {
        const response = await fetch(PBH_JSON, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const text = await response.text();
        const buses = parseBusJSON(text);

        if (buses.length === 0) {
            throw new Error('Nenhum ônibus retornado pela API');
        }

        renderBuses(buses);
        setStatus('live', buses.length);
        console.log(`[API] OK — ${buses.length} ônibus`);
        return buses;
    } catch (err) {
        console.error('[API] Falha ao buscar ônibus:', err.message);
        setStatus('error');
        return [];
    }
}

function parseBusJSON(raw) {
    if (!raw) {
        console.error('[PARSE] raw vazio');
        return [];
    }
    let text = raw.trim();

    // Remove BOM (Byte Order Mark)
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    // Wrapper para lidar com proxies externos
    if (text.startsWith('{')) {
        try {
            const wrapper = JSON.parse(text);
            if (wrapper && typeof wrapper.contents === 'string') {
                text = wrapper.contents.trim();
            }
        } catch { }
    }

    // Normalização de aspas simples para duplas
    if (text.includes("'") && !text.includes('"')) {
        text = text.replace(/'/g, '"');
    }

    if (!(text.startsWith('[') || text.startsWith('{'))) {
        console.warn('[PARSE] Resposta não inicia com [ ou {');
        return [];
    }

    let arr;
    try {
        arr = JSON.parse(text);
    } catch (e) {
        console.error('[PARSE] JSON.parse falhou:', e.message);
        return [];
    }

    if (!Array.isArray(arr)) arr = [arr];

    // DEDUPLICAÇÃO E IDENTIFICAÇÃO
    // NV = Número do Veículo (ID único físico)
    // NL = Número da Linha
    // EV = Empresa
    const latestByVehicle = new Map();

    for (const obj of arr) {
        const latRaw = obj.LT ?? obj.LA ?? obj.lat ?? obj.latitude;
        const lngRaw = obj.LG ?? obj.LO ?? obj.lng ?? obj.longitude;

        const lat = parseCoord(latRaw);
        const lng = parseCoord(lngRaw);

        if (!isValidBHCoord(lat, lng)) {
            continue;
        }

        const vehicleId = String(obj.NV ?? '').trim();
        const linhaNum  = String(obj.NL ?? '').trim();

        if (!vehicleId) continue;

        const hr = String(obj.HR ?? '');

        // Mantém apenas a leitura mais recente de cada veículo
        const existing = latestByVehicle.get(vehicleId);
        if (!existing || hr > existing._hr) {
            latestByVehicle.set(vehicleId, {
                _hr:      hr,
                linhaNum: linhaNum,
                id:       vehicleId,
                lat, lng,
                speed:    parseFloat(String(obj.VL ?? '0').replace(',', '.')) || 0,
                direcao:  String(obj.DG ?? '')
            });
        }
    }

    const buses = Array.from(latestByVehicle.values()).map(b => {
        const { _hr, ...clean } = b;
        return clean;
    });

    return enrichLineCodes(buses);
}

// Cruza os dados da API com os dados dos arquivos CSV
function enrichLineCodes(buses) {
    return buses.map(b => {
        const info = state.linhaByNumero.get(normalizeCode(b.linhaNum));
        const linhaCod = info?.Linha || b.linhaNum;
        const nomeBd   = info?.Nome  || '';

        const pontosInfo =
            state.pontosByCod.get(normalizeCode(linhaCod)) ||
            state.pontosByCod.get(normalizeCode(b.linhaNum));

        let origem = '', destino = '', subVariantes = [], paradaMaisProxima = null, totalParadas = 0;

        if (pontosInfo) {
            origem       = pontosInfo.origem;
            const partes = (pontosInfo.nomeLinha || '').split(/[-–]/).map(s => s.trim());
            destino      = partes.length > 1 ? partes.slice(1).join(' - ') : '';
            subVariantes = Array.from(pontosInfo.subLinhas);
            totalParadas = pontosInfo.paradas.length;
            paradaMaisProxima = encontrarParadaMaisProxima(b.lat, b.lng, pontosInfo.paradas);
        }

        return {
            ...b,
            linha:        linhaCod,
            nome:         nomeBd || pontosInfo?.nomeLinha || '',
            origem,
            destino,
            subVariantes,
            totalParadas,
            paradaMaisProxima,
        };
    });
}

// Extrai a base principal da linha (ex: "67" de "67-01")
function getBaseLine(code) {
    return String(code || '').split('-')[0].trim().toUpperCase();
}

function encontrarParadaMaisProxima(busLat, busLng, paradas) {
    if (!paradas || paradas.length === 0) return null;

    let melhor = null;
    let menorDist = Infinity;

    for (const p of paradas) {
        const dist = haversine(busLat, busLng, p.lat, p.lng);
        if (dist < menorDist) {
            menorDist = dist;
            melhor = p;
        }
    }
    return { ...melhor, distancia: Math.round(menorDist) };
}

// Calcula distância em metros entre duas coordenadas
function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function parseCoord(val) {
    if (val === undefined || val === null) return NaN;
    return parseFloat(String(val).replace(',', '.'));
}

function isValidBHCoord(lat, lng) {
    return isFinite(lat) && isFinite(lng)
        && lat > -21 && lat < -18.5
        && lng > -45 && lng < -42.5;
}

// 4. Renderização dos Ônibus no Mapa
function renderBuses(buses) {
    state.busLayer.clearLayers();

    // Filtro inteligente: compara o código exato e a base da linha
    const filtered = state.activeFilter
        ? buses.filter(b => {
            const busca = normalizeCode(state.activeFilter);
            const buscaBase = getBaseLine(state.activeFilter);

            const busLinha = normalizeCode(b.linha);
            const busLinhaBase = getBaseLine(b.linha);
            const busApi = normalizeCode(b.linhaNum);
            const busApiBase = getBaseLine(b.linhaNum);

            // Exibe se o código for idêntico OU se a base for a mesma (ex: 67 == 67-01)
            return busLinha === busca || busApi === busca ||
                busLinhaBase === buscaBase || busApiBase === buscaBase;
        })
        : buses;

    for (const bus of filtered) {
        const marker = L.circleMarker([bus.lat, bus.lng], {
            radius:      6,
            fillColor:   '#00e5ff',
            color:       'rgba(0,229,255,0.35)',
            weight:      6,
            fillOpacity: 0.9,
        });

        const paradaHtml = bus.paradaMaisProxima
            ? `<br>📍 Próxima parada: <b>${escapeHtml(bus.paradaMaisProxima.id || '?')}</b>
               (${formatDistance(bus.paradaMaisProxima.distancia)})
               ${bus.paradaMaisProxima.sub ? `<br><small>Trajeto: ${escapeHtml(bus.paradaMaisProxima.sub)}</small>` : ''}`
            : '';

        const origemDest = (bus.origem || bus.destino)
            ? `${escapeHtml(bus.origem)}${bus.destino ? ' → ' + escapeHtml(bus.destino) : ''}<br>`
            : '';

        const variantes = (bus.subVariantes && bus.subVariantes.length > 0)
            ? `<small>Variações: ${bus.subVariantes.slice(0, 3).map(escapeHtml).join(', ')}${bus.subVariantes.length > 3 ? '…' : ''}</small><br>`
            : '';

        marker.bindPopup(`
      <div class="popup-title">
        <span class="popup-badge">${escapeHtml(bus.linha || bus.linhaNum)}</span> Veículo ${escapeHtml(bus.id)}
      </div>
      <div class="popup-info">
        ${bus.nome ? `<b>${escapeHtml(bus.nome)}</b><br>` : ''}
        ${origemDest}
        ${variantes}
        Velocidade: <b>${bus.speed} km/h</b><br>
        ${bus.direcao ? `Direção: <b>${escapeHtml(bus.direcao)}</b><br>` : ''}
        Lat: ${bus.lat.toFixed(5)} · Lng: ${bus.lng.toFixed(5)}
        ${bus.totalParadas ? `<br><small>${bus.totalParadas} paradas catalogadas</small>` : ''}
        ${paradaHtml}
      </div>
    `, { maxWidth: 280 });

        marker.addTo(state.busLayer);
    }

    if (state.activeFilter) {
        document.getElementById('lc-buses').textContent = filtered.length;
    }
}

// 5. Renderização das Paradas de Ônibus
function renderStops(linhaCode) {
    state.stopLayer.clearLayers();
    if (!state.csvLoaded || !linhaCode) return [];

    const normalCode = normalizeCode(linhaCode);
    const baseCode = getBaseLine(linhaCode);

    const matchingStops = state.allPontos.filter(row => {
        const cod = normalizeCode(String(row.COD_LINHA || ''));
        const codBase = getBaseLine(String(row.COD_LINHA || ''));

        return cod === normalCode || codBase === baseCode;
    });

    const stopLatLngs = [];

    for (const stop of matchingStops) {
        const latLng = utmToLatLng(stop.GEOMETRIA);
        if (!latLng) continue;

        stopLatLngs.push({ latLng, stop });

        const marker = L.circleMarker(latLng, {
            radius:      5,
            fillColor:   '#b388ff',
            color:       'rgba(179,136,255,0.35)',
            weight:      5,
            fillOpacity: 0.85,
        });

        marker.bindPopup(`
      <div class="popup-title">Parada ${escapeHtml(stop.IDENTIFICADOR_PONTO_ONIBUS || stop.ID_PONTO_ONIBUS_LINHA || '')}</div>
      <div class="popup-info">
        Linha: <span class="popup-badge">${escapeHtml(stop.COD_LINHA || '')}</span><br>
        ${escapeHtml(stop.NOME_LINHA || '')}<br>
        ${escapeHtml(stop.ORIGEM || '')}
      </div>
    `, { maxWidth: 240 });

        marker.addTo(state.stopLayer);
    }

    document.getElementById('lc-stops').textContent = stopLatLngs.length;

    if (state.userLatLng && stopLatLngs.length > 0) {
        highlightNearestStop(stopLatLngs);
    }

    return stopLatLngs;
}

function highlightNearestStop(stopLatLngs) {
    if (!state.userLatLng || stopLatLngs.length === 0) return;

    let nearest = null;
    let minDist  = Infinity;

    for (const item of stopLatLngs) {
        const dist = state.map.distance(state.userLatLng, item.latLng);
        if (dist < minDist) { minDist = dist; nearest = item; }
    }

    if (!nearest) return;

    const hlMarker = L.circleMarker(nearest.latLng, {
        radius:       9,
        fillColor:    '#ff1744',
        color:        'rgba(255,23,68,0.4)',
        weight:       7,
        fillOpacity:  1,
        zIndexOffset: 1000,
    });

    hlMarker.bindPopup(`
    <div class="popup-title" style="color:#ff4569">📍 Parada mais próxima</div>
    <div class="popup-info">
      ID: ${escapeHtml(nearest.stop.IDENTIFICADOR_PONTO_ONIBUS || nearest.stop.ID_PONTO_ONIBUS_LINHA || '')}<br>
      Linha: <span class="popup-badge">${escapeHtml(nearest.stop.COD_LINHA || '')}</span><br>
      Distância: <b>${formatDistance(minDist)}</b>
    </div>
  `, { maxWidth: 240 });

    hlMarker.addTo(state.stopLayer);
    hlMarker.openPopup();

    document.getElementById('lc-nearest').textContent = formatDistance(minDist);
    return nearest;
}

// 6. Conversão de Coordenadas (UTM SIRGAS2000 para WGS84)
function utmToLatLng(geometria) {
    if (!geometria) return null;
    const match = geometria.match(/POINT\s*\(\s*([\d.]+)\s+([\d.]+)\s*\)/i);
    if (!match) return null;
    const easting  = parseFloat(match[1]);
    const northing = parseFloat(match[2]);
    try {
        const [lng, lat] = proj4('SIRGAS2000_UTM23S', 'WGS84', [easting, northing]);
        if (!isFinite(lat) || !isFinite(lng)) return null;
        if (lat < -24 || lat > -15 || lng < -50 || lng > -38) return null;
        return [lat, lng];
    } catch { return null; }
}

// 7. Geolocalização do Usuário
function locateUser() {
    if (!navigator.geolocation) {
        showToast('⚠ Geolocalização não suportada neste navegador.');
        return;
    }
    showToast('📡 Obtendo sua localização…');
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const { latitude: lat, longitude: lng } = pos.coords;
            state.userLatLng = [lat, lng];
            placeUserMarker(lat, lng);
            state.map.setView([lat, lng], 15);
            showToast('📍 Localização encontrada!');
            if (state.activeFilter) renderStops(state.activeFilter);
        },
        (err) => {
            console.warn('[GEO]', err.message);
            showToast('⚠ Não foi possível obter localização.');
        },
        { enableHighAccuracy: true, timeout: 10_000 }
    );
}

function placeUserMarker(lat, lng) {
    if (state.userMarker) state.map.removeLayer(state.userMarker);
    state.userMarker = L.circleMarker([lat, lng], {
        radius:      8,
        fillColor:   '#76ff03',
        color:       'rgba(118,255,3,0.4)',
        weight:      8,
        fillOpacity: 1,
    }).bindPopup('<div class="popup-title" style="color:#76ff03">Você está aqui</div>')
        .addTo(state.map);
}

// 8. Lógica de Filtragem e Limpeza
function applyFilter(linhaCode) {
    state.activeFilter = linhaCode.trim().toUpperCase();

    const info = state.allLinhas.find(r =>
        normalizeCode(r.Linha)       === normalizeCode(state.activeFilter) ||
        normalizeCode(r.NumeroLinha) === normalizeCode(state.activeFilter)
    );

    const card = document.getElementById('line-card');
    card.classList.remove('d-none');
    document.getElementById('lc-code').textContent    = state.activeFilter;
    document.getElementById('lc-name').textContent    = info?.Nome || '';
    document.getElementById('lc-buses').textContent   = '…';
    document.getElementById('lc-stops').textContent   = '…';
    document.getElementById('lc-nearest').textContent = '–';
    document.getElementById('btn-clear').classList.remove('d-none');

    const stops = renderStops(state.activeFilter);
    if (stops && stops.length > 0) {
        const bounds = L.latLngBounds(stops.map(s => s.latLng));
        state.map.fitBounds(bounds, { padding: [40, 40] });
    }

    fetchBuses();
}

function clearFilter() {
    state.activeFilter = null;
    state.stopLayer.clearLayers();
    document.getElementById('btn-clear').classList.add('d-none');
    document.getElementById('line-card').classList.add('d-none');
    document.getElementById('line-input').value = '';
    document.getElementById('suggestions-box').innerHTML = '';
    state.map.setView(BH_CENTER, BH_ZOOM);
    fetchBuses();
}

// 9. Autocomplete e Sugestões da Barra de Pesquisa
function buildSuggestions() {
    state.allLinhas.sort((a, b) => (a.Linha || '').localeCompare(b.Linha || ''));
}

function updateSuggestions(query) {
    const box = document.getElementById('suggestions-box');
    box.innerHTML = '';
    if (!query || !state.csvLoaded) return;

    const q = query.toUpperCase();
    const matches = state.allLinhas
        .filter(r => r.Linha && (
            r.Linha.toUpperCase().startsWith(q) ||
            (r.NumeroLinha && String(r.NumeroLinha).startsWith(q)) ||
            (r.Nome && r.Nome.toUpperCase().includes(q))
        ))
        .slice(0, 8);

    for (const row of matches) {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.innerHTML = `
      <span class="sug-code">${escapeHtml(row.Linha)}</span>
      <span class="sug-name">${escapeHtml(row.Nome || '')}</span>
    `;
        item.addEventListener('click', () => {
            document.getElementById('line-input').value = row.Linha;
            box.innerHTML = '';
            applyFilter(row.Linha);
        });
        box.appendChild(item);
    }
}

// 10. Loop de Atualização em Tempo Real (Timer)
function startRefreshLoop() {
    const fill = document.getElementById('timer-fill');
    const text = document.getElementById('timer-text');
    state.timerRemaining = REFRESH_MS / 1000;

    if (state.refreshInterval) clearInterval(state.refreshInterval);
    if (state.timerInterval)   clearInterval(state.timerInterval);

    state.refreshInterval = setInterval(async () => {
        await fetchBuses();
        state.timerRemaining = REFRESH_MS / 1000;
    }, REFRESH_MS);

    state.timerInterval = setInterval(() => {
        state.timerRemaining = Math.max(0, state.timerRemaining - 1);
        const pct = (state.timerRemaining / (REFRESH_MS / 1000)) * 100;
        fill.style.width    = `${pct}%`;
        text.textContent    = `Atualiza em ${state.timerRemaining}s`;
    }, 1000);
}

// 11. Funções Auxiliares de Interface
function setStatus(type, count) {
    const dot  = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    const cnt  = document.getElementById('bus-count');

    dot.className = 'dot';
    switch (type) {
        case 'loading':
            dot.classList.add('dot--loading');
            text.textContent = 'Atualizando…';
            break;
        case 'live':
            dot.classList.add('dot--live');
            text.textContent = 'Ao vivo';
            if (count !== undefined) cnt.textContent = `${count} ônibus`;
            break;
        case 'error':
            dot.classList.add('dot--error');
            text.textContent = 'Sem conexão';
            break;
    }
}

let toastTimer = null;
function showToast(msg, duration = 3500) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.remove('d-none');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('d-none'), duration);
}

function formatDistance(meters) {
    return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

function normalizeCode(code) {
    return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// 12. Registro de Eventos da Interface (Listeners)
function bindEvents() {
    const input     = document.getElementById('line-input');
    const btnSearch = document.getElementById('btn-search');
    const btnClear  = document.getElementById('btn-clear');
    const btnLocate = document.getElementById('btn-locate');
    const toggleBtn = document.getElementById('sidebar-toggle');

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const val = input.value.trim();
            if (val) applyFilter(val);
            document.getElementById('suggestions-box').innerHTML = '';
        }
    });

    input.addEventListener('input', () => updateSuggestions(input.value.trim()));

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#filter-section')) {
            document.getElementById('suggestions-box').innerHTML = '';
        }
    });

    btnSearch.addEventListener('click', () => {
        const val = input.value.trim();
        if (val) applyFilter(val);
        document.getElementById('suggestions-box').innerHTML = '';
    });

    btnClear.addEventListener('click', clearFilter);
    btnLocate.addEventListener('click', locateUser);

    toggleBtn.addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('collapsed');
        setTimeout(() => state.map.invalidateSize(), 220);
    });
}
//Função para encontrar parada mais próxima
function findNearestStopGlobal() {
    if (!state.csvLoaded || state.allPontos.length === 0) {
        showToast('⚠ Dados de paradas ainda não carregados.');
        return;
    }

    if (!state.userLatLng) {
        showToast('📡 Obtendo sua localização…');
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { latitude: lat, longitude: lng } = pos.coords;
                state.userLatLng = [lat, lng];
                placeUserMarker(lat, lng);
                showToast('📍 Localização encontrada!');
                _doFindNearestStop();
            },
            (err) => {
                console.warn('[GEO]', err.message);
                showToast('⚠ Não foi possível obter localização.');
            },
            { enableHighAccuracy: true, timeout: 10_000 }
        );
        return;
    }

    _doFindNearestStop();
}

function _doFindNearestStop() {
    const [userLat, userLng] = state.userLatLng;

    showToast('🔍 Buscando parada mais próxima…');

    // Remove marcador anterior se existir
    if (state.nearestStopMarker) {
        state.map.removeLayer(state.nearestStopMarker);
        state.nearestStopMarker = null;
    }

    let nearest    = null;
    let nearestRow = null;
    let minDist    = Infinity;

    for (const row of state.allPontos) {
        const latLng = utmToLatLng(row.GEOMETRIA);
        if (!latLng) continue;

        const dist = haversine(userLat, userLng, latLng[0], latLng[1]);
        if (dist < minDist) {
            minDist    = dist;
            nearest    = latLng;
            nearestRow = row;
        }
    }

    if (!nearest || !nearestRow) {
        showToast('⚠ Nenhuma parada encontrada.');
        return;
    }

    const stopId    = nearestRow.IDENTIFICADOR_PONTO_ONIBUS || nearestRow.ID_PONTO_ONIBUS_LINHA || '–';
    const nomeLinha = nearestRow.NOME_LINHA || '';
    const codLinha  = nearestRow.COD_LINHA  || '';
    const distFmt   = formatDistance(minDist);

    state.nearestStopMarker = L.circleMarker(nearest, {
        radius:       11,
        fillColor:    '#ff1744',
        color:        'rgba(255,23,68,0.45)',
        weight:       8,
        fillOpacity:  1,
        zIndexOffset: 2000,
    }).bindPopup(`
      <div class="popup-title" style="color:#ff4569">📍 Parada mais próxima de você</div>
      <div class="popup-info">
        ID: <b>${escapeHtml(stopId)}</b><br>
        Linha: <span class="popup-badge">${escapeHtml(codLinha)}</span><br>
        ${nomeLinha ? `${escapeHtml(nomeLinha)}<br>` : ''}
        Distância: <b>${distFmt}</b>
      </div>
    `, { maxWidth: 260 }).addTo(state.map);

    state.nearestStopMarker.openPopup();
    state.map.setView(nearest, Math.max(state.map.getZoom(), 16));

    showToast(`📍 Parada ${stopId} · Linha ${codLinha} · ${distFmt}`, 5000);
}

// 13. Inicialização Principal
async function main() {
    initMap();
    bindEvents();
    loadCSVs().catch(console.warn);
    await fetchBuses();
    startRefreshLoop();
}

document.addEventListener('DOMContentLoaded', main);