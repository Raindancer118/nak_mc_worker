
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ExarotonClient } from './exaroton';
import { getHtml } from './html';

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

    // If no secret is set in env, we might want to fail open or closed. 
    // Secure by default: fail if not set, or log a warning. 
    // For this task, we assume it must be set.
    if (!validKey) {
        console.error("API_SECRET is not set in the environment!");
        return c.json({ error: 'Server configuration error' }, 500);
    }

    if (!apiKey || apiKey !== validKey) {
        return c.json({ error: 'Unauthorized' }, 401);
    }

    await next();
});

// Initialize Database
app.post('/api/admin/init-db', async (c) => {
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

app.get('/', async (c) => {
    try {
        const totalRuns = await c.env.DB.prepare('SELECT COUNT(*) as count FROM runs').first<{ count: number }>();

        const bestRun = await c.env.DB.prepare(`
            SELECT r.duration, p.minecraft_name 
            FROM runs r 
            JOIN players p ON r.id = p.run_id 
            WHERE r.status = 'FINISHED' AND r.duration IS NOT NULL AND p.role = 'RUNNER'
            ORDER BY r.duration ASC 
            LIMIT 1
        `).first<{ duration: number; minecraft_name: string }>();

        const lastRun = await c.env.DB.prepare(`
            SELECT r.duration, p.minecraft_name 
            FROM runs r 
            JOIN players p ON r.id = p.run_id 
            WHERE r.status = 'FINISHED' AND r.duration IS NOT NULL AND p.role = 'RUNNER'
            ORDER BY r.ended_at DESC 
            LIMIT 1
        `).first<{ duration: number; minecraft_name: string }>();

        return c.html(getHtml({
            totalRuns: totalRuns?.count || 0,
            bestTime: bestRun ? formatDuration(bestRun.duration) : '--:--',
            bestPlayer: bestRun?.minecraft_name || '-',
            lastRunTime: lastRun ? formatDuration(lastRun.duration) : '--:--',
            lastRunPlayer: lastRun?.minecraft_name || '-'
        }));
    } catch (e) {
        console.error(e);
        return c.text('NAK Minecraft Speedrun Worker is running! (Stats unavailable)');
    }
});

// Initialize a new run
app.post('/api/run/init', async (c) => {
    const { run_id, type, seed, players } = await c.req.json<{
        run_id: string;
        type: 'SOLO' | 'TEAM';
        seed: string;
        players: { name: string; role: 'RUNNER' | 'SPECTATOR' }[];
    }>();

    if (!run_id || !type || !seed || !players) {
        return c.json({ error: 'Missing required fields' }, 400);
    }

    try {
        const now = Date.now();
        await c.env.DB.prepare(
            'INSERT INTO runs (id, type, seed, status, created_at) VALUES (?, ?, ?, ?, ?)'
        )
            .bind(run_id, type, seed, 'CREATED', now)
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
    let serverId = c.env.EXA_SERVER_ID?.trim();
    const secret = c.env.EXA_SECRET?.trim();

    if (!serverId || !secret) {
        return c.json({ error: 'Exaroton configuration missing' }, 500);
    }

    if (serverId.startsWith('#')) {
        serverId = serverId.substring(1);
    }
    const client = new ExarotonClient(secret, serverId);

    try {
        // 1. Stop Server
        await client.stopServer();

        // 2. Wait for Offline
        let status = await client.getServerStatus();
        while (status !== 0) { // 0 = OFFLINE
            await new Promise(resolve => setTimeout(resolve, 2000));
            status = await client.getServerStatus();
        }

        // 3. Delete World
        // Note: Exaroton might require specific paths. Usually 'world' is the folder.
        try {
            await client.deleteFile('world');
            await client.deleteFile('world_nether');
            await client.deleteFile('world_the_end');
        } catch (e) {
            console.warn('Failed to delete some world files', e);
        }

        // 4. Start Server
        await client.startServer();

        return c.json({ success: true, message: 'Server reset initiated' });
    } catch (e) {
        console.error(e);
        return c.json({ error: 'Failed to reset server' }, 500);
    }
});

// Finish run
app.post('/api/run/finish', async (c) => {
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
