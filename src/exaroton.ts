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
        console.log(`[Exaroton] Request: ${method} ${url}`);
        if (body) {
            console.log(`[Exaroton] Request Body: ${JSON.stringify(body)}`);
        }

        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json'
        };

        const response = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined
        });

        console.log(`[Exaroton] Response Status: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const text = await response.text();
            console.error(`[Exaroton] Error Response Body: ${text}`);
            throw new Error(`Exaroton API Error: ${response.status} ${text}`);
        }

        const data = await response.json();
        console.log(`[Exaroton] Response Data: ${JSON.stringify(data)}`);
        return data;
    }

    async getServerStatus(): Promise<number> {
        // Status codes: 0=OFFLINE, 1=ONLINE, 2=STARTING, 3=STOPPING, 4=RESTARTING, 5=SAVING, 6=LOADING, 7=CRASHED, 8=PENDING, 10=PREPARING
        console.log('[Exaroton] Getting server status...');
        const res = await this.request('');
        return res.data.status;
    }

    async startServer() {
        console.log('[Exaroton] Starting server...');
        return this.request('start', 'POST');
    }

    async stopServer() {
        console.log('[Exaroton] Stopping server...');
        return this.request('stop', 'POST');
    }

    async restartServer() {
        console.log('[Exaroton] Restarting server...');
        return this.request('restart', 'POST');
    }

    async getFileInfo(path: string) {
        console.log(`[Exaroton] Getting file info for: ${path}`);
        return this.request(`files/info/${path}`);
    }

    async deleteFile(path: string) {
        console.log(`[Exaroton] Deleting file: ${path}`);
        return this.request(`files/data/${path}`, 'DELETE');
    }

    async deleteRecursive(path: string) {
        console.log(`[Exaroton] Deleting recursively: ${path}`);
        try {
            const info = await this.getFileInfo(path);

            // Check if it's a directory and has children
            // Note: The exact API response structure for children needs to be verified. 
            // Assuming data.children or data.files based on common patterns.
            const children = info.data?.children || info.data?.files;

            if (info.data?.isDirectory && children && Array.isArray(children)) {
                console.log(`[Exaroton] Found ${children.length} children in ${path}`);
                for (const child of children) {
                    const childName = child.name || child; // Handle object or string
                    await this.deleteRecursive(`${path}/${childName}`);
                }
            }

            // Delete the item itself
            await this.deleteFile(path);
        } catch (e) {
            console.warn(`[Exaroton] Failed to delete ${path} (might be already gone or not allowed):`, e);
            // Don't throw, so we can continue deleting other things
        }
    }

    async executeCommand(command: string) {
        console.log(`[Exaroton] Executing command: ${command}`);
        return this.request('command', 'POST', { command });
    }
}
