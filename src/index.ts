
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ExarotonClient } from './exaroton';
import html from './page.html';

type Bindings = {
    DB: D1Database;
    API_SECRET: string;
    EXA_SECRET: string;
    EXA_SERVER_ID: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/*', cors());

// Authentication Middleware
app.use('/api/*', async (c, next) => {
    const apiKey = c.req.header('X-API-Key');
    const validKey = c.env.API_SECRET;

    console.log(`[API] Incoming request: ${c.req.method} ${c.req.url}`);

    // If no secret is set in env, we might want to fail open or closed. 
    // Secure by default: fail if not set, or log a warning. 
    // For this task, we assume it must be set.
    if (!validKey) {
        console.error("[API] API_SECRET is not set in the environment!");
        return c.json({ error: 'Server configuration error' }, 500);
    }

    if (!apiKey || apiKey !== validKey) {
        console.warn(`[API] Unauthorized access attempt. Key provided: ${apiKey ? 'YES' : 'NO'}`);
        return c.json({ error: 'Unauthorized' }, 401);
    }

    await next();
    await next();
});

// Health Check
app.get('/api/health', (c) => {
    return c.json({ status: 'OK' });
});

// Initialize Database
app.post('/api/admin/init-db', async (c) => {
    console.log('[API] /api/admin/init-db called');
    try {
        await c.env.DB.batch([
            c.env.DB.prepare('DROP TABLE IF EXISTS cheat_logs'),
            c.env.DB.prepare('DROP TABLE IF EXISTS time_logs'),
            c.env.DB.prepare('DROP TABLE IF EXISTS players'),
            c.env.DB.prepare('DROP TABLE IF EXISTS runs'),
            c.env.DB.prepare('DROP TABLE IF EXISTS solved_seeds'),
            c.env.DB.prepare(`CREATE TABLE runs (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                seed TEXT NOT NULL,
                goal TEXT DEFAULT 'ENDER_DRAGON',
                hardcore INTEGER DEFAULT 0,
                set_seed INTEGER DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'CREATED',
                created_at INTEGER NOT NULL,
                ended_at INTEGER,
                duration INTEGER
            )`),
            c.env.DB.prepare(`CREATE TABLE players (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                minecraft_name TEXT NOT NULL,
                role TEXT NOT NULL,
                FOREIGN KEY (run_id) REFERENCES runs(id)
            )`),
            c.env.DB.prepare(`CREATE TABLE time_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                action TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (run_id) REFERENCES runs(id)
            )`),
            c.env.DB.prepare(`CREATE TABLE cheat_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                player_name TEXT NOT NULL,
                details TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY (run_id) REFERENCES runs(id)
            )`),
            c.env.DB.prepare(`CREATE TABLE solved_seeds (
                seed TEXT PRIMARY KEY,
                solved_at INTEGER NOT NULL
            )`)
        ]);
        return c.json({ success: true, message: 'Database initialized' });
    } catch (e) {
        console.error(e);
        return c.json({ error: 'Failed to initialize database' }, 500);
    }
});

async function getStats(env: Bindings) {
    // 1. Get Server Status
    let serverStatus = 'UNKNOWN';
    try {
        if (env.EXA_SECRET && env.EXA_SERVER_ID) {
            let serverId = env.EXA_SERVER_ID.trim();
            if (serverId.startsWith('#')) serverId = serverId.substring(1);
            const client = new ExarotonClient(env.EXA_SECRET.trim(), serverId);
            const status = await client.getServerStatus();
            // Map status codes to text
            const statusMap: Record<number, string> = {
                0: 'OFFLINE', 1: 'ONLINE', 2: 'STARTING', 3: 'STOPPING',
                4: 'RESTARTING', 5: 'SAVING', 6: 'LOADING', 7: 'CRASHED',
                8: 'PENDING', 10: 'PREPARING'
            };
            serverStatus = statusMap[status] || `UNKNOWN (${status})`;
        }
    } catch (e) {
        console.error('Failed to fetch Exaroton status:', e);
        serverStatus = 'ERROR';
    }

    // 2. Get Totals
    const totalRuns = await env.DB.prepare('SELECT COUNT(*) as count FROM runs').first<{ count: number }>();
    const finishedRuns = await env.DB.prepare("SELECT COUNT(*) as count FROM runs WHERE status = 'FINISHED'").first<{ count: number }>();

    // 3. Get Leaderboard (Top 10)
    const { results: leaderboard } = await env.DB.prepare(`
        SELECT r.id, r.duration, r.ended_at, p.minecraft_name, r.goal, r.hardcore
        FROM runs r 
        JOIN players p ON r.id = p.run_id 
        WHERE r.status = 'FINISHED' AND r.duration IS NOT NULL AND p.role = 'RUNNER' AND r.set_seed = 0
        ORDER BY r.duration ASC 
        LIMIT 10
    `).all<{ id: string, duration: number, ended_at: number, minecraft_name: string, goal: string, hardcore: number }>();

    // 3.1 Get Set Seed Leaderboard (Top 10)
    const { results: setSeedLeaderboard } = await env.DB.prepare(`
        SELECT r.id, r.duration, r.ended_at, p.minecraft_name, r.goal, r.hardcore, r.seed
        FROM runs r 
        JOIN players p ON r.id = p.run_id 
        WHERE r.status = 'FINISHED' AND r.duration IS NOT NULL AND p.role = 'RUNNER' AND r.set_seed = 1
        ORDER BY r.duration ASC 
        LIMIT 10
    `).all<{ id: string, duration: number, ended_at: number, minecraft_name: string, goal: string, hardcore: number, seed: string }>();

    // 4. Get Recent Runs (Last 10)
    const { results: recentRuns } = await env.DB.prepare(`
        SELECT r.id, r.duration, r.ended_at, p.minecraft_name, r.status, r.goal, r.hardcore, r.set_seed
        FROM runs r 
        JOIN players p ON r.id = p.run_id 
        WHERE r.status = 'FINISHED' AND p.role = 'RUNNER'
        ORDER BY r.ended_at DESC 
        LIMIT 10
    `).all<{ id: string, duration: number, ended_at: number, minecraft_name: string, status: string, goal: string, hardcore: number, set_seed: number }>();

    // 5. Get Active Run
    const activeRun = await env.DB.prepare(`
        SELECT r.id, r.created_at, r.status, p.minecraft_name, r.goal, r.hardcore, r.set_seed
        FROM runs r
        JOIN players p ON r.id = p.run_id
        WHERE r.status IN ('CREATED', 'STARTED', 'PAUSED') AND p.role = 'RUNNER'
        ORDER BY r.created_at DESC
        LIMIT 1
    `).first<{ id: string, created_at: number, status: string, minecraft_name: string, goal: string, hardcore: number, set_seed: number }>();

    return {
        server_status: serverStatus,
        totals: {
            total_runs: totalRuns?.count || 0,
            finished_runs: finishedRuns?.count || 0
        },
        leaderboard: leaderboard.map(r => ({
            ...r,
            duration_formatted: formatDuration(r.duration)
        })),
        set_seed_leaderboard: setSeedLeaderboard.map(r => ({
            ...r,
            duration_formatted: formatDuration(r.duration)
        })),
        recent_runs: recentRuns.map(r => ({
            ...r,
            duration_formatted: r.duration ? formatDuration(r.duration) : '-'
        })),
        active_run: activeRun || null
    };
}

app.get('/status', async (c) => {
    console.log(`[Worker] Serving Status Page (SSR) to ${c.req.header('User-Agent') || 'Unknown'}`);
    try {
        const stats = await getStats(c.env);
        // Inject stats into HTML
        const page = html.replace('{{STATS_PAYLOAD}}', JSON.stringify(stats));
        return c.html(page);
    } catch (e) {
        console.error(e);
        return c.text('Failed to load status page', 500);
    }
});

app.get('/public-stats', async (c) => {
    console.log(`[Worker] Serving Public Stats API to ${c.req.header('User-Agent') || 'Unknown'}`);
    try {
        const stats = await getStats(c.env);
        return c.json(stats);
    } catch (e) {
        console.error(e);
        return c.json({ error: 'Failed to fetch stats' }, 500);
    }
});

// Initialize a new run
app.post('/api/run/init', async (c) => {
    console.log('[API] /api/run/init called');
    const { run_id, type, seed, players, goal, hardcore, set_seed } = await c.req.json<{
        run_id: string;
        type: 'SOLO' | 'TEAM';
        seed: string;
        players: { name: string; role: 'RUNNER' | 'SPECTATOR' }[];
        goal?: string;
        hardcore?: boolean;
        set_seed?: boolean;
    }>();

    if (!run_id || !type || !seed || !players) {
        return c.json({ error: 'Missing required fields' }, 400);
    }

    try {
        const now = Date.now();
        await c.env.DB.prepare(
            'INSERT INTO runs (id, type, seed, status, created_at, goal, hardcore, set_seed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
            .bind(run_id, type, seed, 'CREATED', now, goal || 'ENDER_DRAGON', hardcore ? 1 : 0, set_seed ? 1 : 0)
            .run();

        const playerStmt = c.env.DB.prepare(
            'INSERT INTO players (run_id, minecraft_name, role) VALUES (?, ?, ?)'
        );
        const batch = players.map((p) => playerStmt.bind(run_id, p.name, p.role));
        await c.env.DB.batch(batch);

        return c.json({ success: true, message: 'Run initialized' });
    } catch (e) {
        console.error(e);
        return c.json({ error: 'Failed to initialize run' }, 500);
    }
});

// Update run state (START, PAUSE, RESUME, ABORT)
app.post('/api/run/update-state', async (c) => {
    console.log('[API] /api/run/update-state called');
    const { run_id, action } = await c.req.json<{
        run_id: string;
        action: 'START' | 'PAUSE' | 'RESUME' | 'ABORT';
    }>();

    if (!run_id || !action) {
        return c.json({ error: 'Missing required fields' }, 400);
    }

    try {
        const now = Date.now();
        let newStatus = '';

        switch (action) {
            case 'START':
            case 'RESUME':
                newStatus = 'RUNNING';
                break;
            case 'PAUSE':
                newStatus = 'PAUSED';
                break;
            case 'ABORT':
                newStatus = 'ABORTED';
                break;
            case 'FAIL':
                newStatus = 'FAILED';
                break;
            default:
                return c.json({ error: 'Invalid action' }, 400);
        }

        // Update run status
        await c.env.DB.prepare('UPDATE runs SET status = ? WHERE id = ?')
            .bind(newStatus, run_id)
            .run();

        // Log time action
        await c.env.DB.prepare(
            'INSERT INTO time_logs (run_id, action, timestamp) VALUES (?, ?, ?)'
        )
            .bind(run_id, action, now)
            .run();

        return c.json({ success: true, status: newStatus });
    } catch (e) {
        console.error(e);
        return c.json({ error: 'Failed to update state' }, 500);
    }
});

// Log cheat suspicion
app.post('/api/run/cheat', async (c) => {
    console.log('[API] /api/run/cheat called');
    const { run_id, player_name, details } = await c.req.json<{
        run_id: string;
        player_name: string;
        details: string;
    }>();

    try {
        await c.env.DB.prepare(
            'INSERT INTO cheat_logs (run_id, player_name, details, timestamp) VALUES (?, ?, ?, ?)'
        )
            .bind(run_id, player_name, details, Date.now())
            .run();

        return c.json({ success: true });
    } catch (e) {
        return c.json({ error: 'Failed to log cheat' }, 500);
    }
});

// Reset World and Restart Server
app.post('/api/run/reset', async (c) => {
    console.log('[API] /api/run/reset called');
    let serverId = c.env.EXA_SERVER_ID?.trim();
    const secret = c.env.EXA_SECRET?.trim();

    if (!serverId || !secret) {
        console.error(`[API] Exaroton configuration missing. ServerID: ${serverId ? 'SET' : 'MISSING'}, Secret: ${secret ? 'SET' : 'MISSING'}`);
        return c.json({ error: 'Exaroton configuration missing' }, 500);
    }

    if (serverId.startsWith('#')) {
        serverId = serverId.substring(1);
    }
    const client = new ExarotonClient(secret, serverId);

    // Run reset logic in background
    c.executionCtx.waitUntil((async () => {
        try {
            // 1. Stop Server
            console.log('[API] Stopping server...');
            await client.stopServer();

            // 2. Wait for Offline
            console.log('[API] Waiting for server to be OFFLINE...');
            let status = await client.getServerStatus();
            // Wait up to 5 minutes (100 attempts * 3 seconds)
            let attempts = 0;
            while (status !== 0 && attempts < 100) { // 0 = OFFLINE
                console.log(`[API] Server status: ${status} (waiting for 0). Attempt ${attempts + 1}/100`);
                await new Promise(resolve => setTimeout(resolve, 3000));
                status = await client.getServerStatus();
                attempts++;
            }

            if (status !== 0) {
                console.error('[API] Server failed to stop in time. Aborting reset.');
                return;
            }
            console.log('[API] Server is OFFLINE');

            // 3. Delete World
            console.log('[API] Deleting world files...');
            try {
                // Try deleting directories directly (API might support it, and recursion hits subrequest limits)
                await client.deleteFile('world');
                await client.deleteFile('world_nether');
                await client.deleteFile('world_the_end');
            } catch (e) {
                console.warn('[API] Failed to delete some world files', e);
            }

            // 4. Start Server
            console.log('[API] Starting server...');
            await client.startServer();

            console.log('[API] Reset completed successfully');
        } catch (e) {
            console.error('[API] Background reset task failed:', e);
        }
    })());

    return c.json({ success: true, message: 'Server reset initiated in background' }, 202);
});

// Restart Server
app.post('/api/server/restart', async (c) => {
    console.log('[API] /api/server/restart called');
    const { seed, is_set_seed } = await c.req.json<{ seed?: string; is_set_seed?: boolean }>().catch(() => ({ seed: undefined, is_set_seed: undefined }));

    let serverId = c.env.EXA_SERVER_ID?.trim();
    const secret = c.env.EXA_SECRET?.trim();

    if (!serverId || !secret) {
        return c.json({ error: 'Exaroton configuration missing' }, 500);
    }

    if (serverId.startsWith('#')) {
        serverId = serverId.substring(1);
    }
    const client = new ExarotonClient(secret, serverId);

    c.executionCtx.waitUntil((async () => {
        try {
            if (seed) {
                console.log(`[API] Restarting with seed: ${seed} (Set Seed: ${is_set_seed})`);

                // 1. Stop Server
                await client.stopServer();

                // 2. Wait for Offline
                let status = await client.getServerStatus();
                let attempts = 0;
                while (status !== 0 && attempts < 100) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    status = await client.getServerStatus();
                    attempts++;
                }

                if (status !== 0) {
                    console.error('[API] Server failed to stop. Aborting seed update.');
                    return;
                }

                // 3. Update server.properties
                try {
                    const propsContent = await client.getFileContent('server.properties');
                    const lines = propsContent.split('\n');
                    const newLines = lines.map(line => {
                        if (line.startsWith('level-seed=')) {
                            return `level-seed=${seed}`;
                        }
                        return line;
                    });
                    // If level-seed wasn't found, add it (though it should be there)
                    if (!lines.some(l => l.startsWith('level-seed='))) {
                        newLines.push(`level-seed=${seed}`);
                    }

                    await client.uploadFile('server.properties', newLines.join('\n'));
                    console.log('[API] Updated server.properties with new seed');
                } catch (e) {
                    console.error('[API] Failed to update server.properties', e);
                }

                // 4. Delete World
                await client.deleteFile('world');
                await client.deleteFile('world_nether');
                await client.deleteFile('world_the_end');

                // 5. Start Server
                await client.startServer();
            } else {
                // Standard restart
                await client.restartServer();
                console.log('[API] Restart triggered via Exaroton API');
            }
        } catch (e) {
            console.error('[API] Background restart failed:', e);
        }
    })());

    return c.json({ success: true, message: 'Server restart initiated' }, 202);
});

// Finish run
app.post('/api/run/finish', async (c) => {
    console.log('[API] /api/run/finish called');
    const { run_id } = await c.req.json<{ run_id: string }>();

    try {
        const now = Date.now();

        // 1. Update status and ended_at
        await c.env.DB.prepare(
            'UPDATE runs SET status = ?, ended_at = ? WHERE id = ?'
        )
            .bind('FINISHED', now, run_id)
            .run();

        // 2. Log END action
        await c.env.DB.prepare(
            'INSERT INTO time_logs (run_id, action, timestamp) VALUES (?, ?, ?)'
        )
            .bind(run_id, 'END', now)
            .run();

        // 3. Mark seed as solved
        const run = await c.env.DB.prepare('SELECT seed FROM runs WHERE id = ?')
            .bind(run_id)
            .first<{ seed: string }>();

        if (run) {
            await c.env.DB.prepare('INSERT OR IGNORE INTO solved_seeds (seed, solved_at) VALUES (?, ?)')
                .bind(run.seed, now)
                .run();
        }

        // 4. Calculate stats
        const stats = await calculateStats(c.env.DB, run_id);

        // 5. Update run with duration
        await c.env.DB.prepare('UPDATE runs SET duration = ? WHERE id = ?')
            .bind(stats.duration_ms, run_id)
            .run();

        return c.json({ success: true, stats });
    } catch (e) {
        console.error(e);
        return c.json({ error: 'Failed to finish run' }, 500);
    }
});

// Get stats for a run
app.get('/api/run/:run_id/stats', async (c) => {
    const run_id = c.req.param('run_id');
    console.log(`[API] /api/run/${run_id}/stats called`);
    try {
        const stats = await calculateStats(c.env.DB, run_id);
        return c.json(stats);
    } catch (e) {
        return c.json({ error: 'Failed to fetch stats' }, 500);
    }
});

// Check if seed is solved
app.get('/api/seed/:seed/check', async (c) => {
    const seed = c.req.param('seed');
    console.log(`[API] /api/seed/${seed}/check called`);
    const result = await c.env.DB.prepare('SELECT 1 FROM solved_seeds WHERE seed = ?').bind(seed).first();
    return c.json({ solved: !!result });
});

async function calculateStats(db: D1Database, runId: string) {
    const run = await db.prepare('SELECT * FROM runs WHERE id = ?').bind(runId).first<{
        id: string;
        type: string;
        seed: string;
        created_at: number;
        ended_at: number;
        goal: string;
        hardcore: number;
        set_seed: number;
    }>();

    if (!run) throw new Error('Run not found');

    const players = await db.prepare('SELECT minecraft_name FROM players WHERE run_id = ? AND role = ?')
        .bind(runId, 'RUNNER')
        .all<{ minecraft_name: string }>();

    const timeLogs = await db.prepare('SELECT action, timestamp FROM time_logs WHERE run_id = ? ORDER BY timestamp ASC')
        .bind(runId)
        .all<{ action: string; timestamp: number }>();

    let totalTimeMs = 0;
    let lastStartTime = 0;
    let isRunning = false;

    for (const log of timeLogs.results) {
        if (log.action === 'START' || log.action === 'RESUME') {
            if (!isRunning) {
                lastStartTime = log.timestamp;
                isRunning = true;
            }
        } else if (log.action === 'PAUSE' || log.action === 'END') {
            if (isRunning) {
                totalTimeMs += (log.timestamp - lastStartTime);
                isRunning = false;
            }
        }
    }

    // If still running (shouldn't happen for finished runs, but for live stats), add current duration
    if (isRunning) {
        totalTimeMs += (Date.now() - lastStartTime);
    }

    const cheatCount = await db.prepare('SELECT COUNT(*) as count FROM cheat_logs WHERE run_id = ?')
        .bind(runId)
        .first<{ count: number }>();

    return {
        run_id: run.id,
        type: run.type,
        seed: run.seed,
        goal: run.goal,
        hardcore: !!run.hardcore,
        set_seed: !!run.set_seed,
        duration_ms: totalTimeMs,
        duration_formatted: formatDuration(totalTimeMs),
        players: players.results.map(p => p.minecraft_name),
        cheat_incidents: cheatCount?.count || 0,
        solved_at: run.ended_at
    };
}

function formatDuration(ms: number): string {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)));
    return `${hours}h ${minutes}m ${seconds} s`;
}

export default app;
