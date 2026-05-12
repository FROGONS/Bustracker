const http = require('http');
const https = require('https');

const PORT = 3000;
const TARGET_URL = 'https://temporeal.pbh.gov.br/?param=D';

const server = http.createServer((req, res) => {
    // Libera o CORS para o frontend
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    console.log(`[PROXY] Buscando dados da BHTRANS...`);

    const options = {
        agent: new https.Agent({ rejectUnauthorized: false }),
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Connection': 'keep-alive',
            'Referer': 'https://temporeal.pbh.gov.br/'
        }
    };

    https.get(TARGET_URL, options, (targetRes) => {
        const chunks = [];

        targetRes.on('data', chunk => chunks.push(chunk));

        targetRes.on('end', () => {
            let data = Buffer.concat(chunks).toString('utf8');
            console.log(`[PROXY] Status da BHTRANS: HTTP ${targetRes.statusCode} | ${data.length} bytes brutos`);

            // ── NORMALIZAÇÃO: a BHTRANS retorna JSON com aspas simples,
            // o que NÃO é JSON válido. Convertemos para aspas duplas.
            let normalized = data.trim();

            // Remove BOM se existir
            if (normalized.charCodeAt(0) === 0xFEFF) {
                normalized = normalized.slice(1);
            }

            // Troca aspas simples por aspas duplas (apenas se não houver duplas)
            if (normalized.includes("'") && !normalized.includes('"')) {
                normalized = normalized.replace(/'/g, '"');
            }

            // Valida que é um JSON parseável antes de enviar
            try {
                JSON.parse(normalized);
                console.log(`[PROXY] JSON validado com sucesso.`);
            } catch (e) {
                console.warn(`[PROXY] Aviso: resposta não é JSON válido após normalização (${e.message}). Enviando bruto.`);
                normalized = data; // devolve original e deixa o frontend tentar
            }

            res.writeHead(targetRes.statusCode, {
                'Content-Type': 'application/json; charset=utf-8'
            });
            res.end(normalized);
            console.log(`[PROXY] Dados enviados ao frontend! (${normalized.length} bytes)`);
        });

    }).on('error', (err) => {
        console.error('[PROXY] Erro:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
    });
});

server.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`Proxy BH Rastreador rodando na porta ${PORT}`);
    console.log(`URL do Proxy: http://localhost:${PORT}`);
    console.log(`=========================================`);
});