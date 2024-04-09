import * as http from 'http';

export function waitForAuthentication() {
    return new Promise<string>((resolve, reject) => {
        const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
            try {
                if (req.url && req.url.indexOf('/oauth2callback') > -1) {
                    let chunks: Buffer[] = []; // Use a Buffer array to collect data chunks
                    req.on('data', (chunk: Buffer) => {
                        chunks.push(chunk);
                    }).on('end', () => {
                        const body = Buffer.concat(chunks).toString(); // Convert Buffer array to string
                        console.log(body);
                        resolve(body);
                        server.close(); // It's a good idea to close the server after handling the request
                    });
                } else {
                    res.writeHead(404);
                    res.end(); // End response if URL doesn't match
                }
            } catch (e) {
                reject(e);
                console.log(e);
            }
        }).listen(3001);
    });
}
