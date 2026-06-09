import http from "node:http";

const listenHost = process.env.LMSTUDIO_PROXY_HOST || "0.0.0.0";
const listenPort = Number(process.env.LMSTUDIO_PROXY_PORT || "1235");
const targetHost = process.env.LMSTUDIO_TARGET_HOST || "127.0.0.1";
const targetPort = Number(process.env.LMSTUDIO_TARGET_PORT || "1234");

function timestamp() {
  return new Date().toISOString();
}

const server = http.createServer((clientRequest, clientResponse) => {
  const startedAt = Date.now();
  console.log(`[${timestamp()}] ${clientRequest.method} ${clientRequest.url}`);

  if (clientRequest.url === "/health") {
    clientResponse.writeHead(200, { "content-type": "application/json" });
    clientResponse.end(JSON.stringify({
      ok: true,
      target: `http://${targetHost}:${targetPort}`,
    }));
    return;
  }

  const targetRequest = http.request(
    {
      hostname: targetHost,
      port: targetPort,
      path: clientRequest.url,
      method: clientRequest.method,
      headers: {
        ...clientRequest.headers,
        host: `${targetHost}:${targetPort}`,
      },
    },
    (targetResponse) => {
      clientResponse.writeHead(targetResponse.statusCode || 502, targetResponse.headers);
      targetResponse.pipe(clientResponse);
      targetResponse.on("end", () => {
        console.log(`[${timestamp()}] ${targetResponse.statusCode || 502} ${clientRequest.method} ${clientRequest.url} ${Date.now() - startedAt}ms`);
      });
    },
  );

  targetRequest.on("error", (error) => {
    console.error(`[${timestamp()}] 502 ${clientRequest.method} ${clientRequest.url}: ${error.message}`);
    clientResponse.writeHead(502, { "content-type": "application/json" });
    clientResponse.end(JSON.stringify({
      error: "LM Studio proxy could not reach local server",
      detail: error.message,
      target: `http://${targetHost}:${targetPort}`,
    }));
  });

  clientRequest.pipe(targetRequest);
});

server.listen(listenPort, listenHost, () => {
  console.log(`LM Studio proxy listening on http://${listenHost}:${listenPort}`);
  console.log(`Forwarding to http://${targetHost}:${targetPort}`);
});
