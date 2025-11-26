export class ExarotonClient {
    private apiToken: string;
    private serverId: string;
    private baseUrl = 'https://api.exaroton.com/v1';

    constructor(apiToken: string, serverId: string) {
        this.apiToken = apiToken;
        this.serverId = serverId;
    }

    private async request(path: string, method: string = 'GET', body?: any) {
        let url = `${this.baseUrl}/servers/${this.serverId}`;
        if (path) {
            url += `/${path}`;
        }
        console.log(`Exaroton Request: ${method} ${url}`);
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json'
        };

        const response = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Exaroton API Error: ${response.status} ${text}`);
        }

        return response.json();
    }

    async getServerStatus(): Promise<number> {
        // Status codes: 0=OFFLINE, 1=ONLINE, 2=STARTING, 3=STOPPING, 4=RESTARTING, 5=SAVING, 6=LOADING, 7=CRASHED, 8=PENDING, 10=PREPARING
        const res = await this.request('');
        return res.data.status;
    }

    async startServer() {
        return this.request('start', 'POST');
    }

    async stopServer() {
        return this.request('stop', 'POST');
    }

    async restartServer() {
        return this.request('restart', 'POST');
    }

    async deleteFile(path: string) {
        return this.request(`files/data/${path}`, 'DELETE');
    }

    async executeCommand(command: string) {
        return this.request('command', 'POST', { command });
    }
}
