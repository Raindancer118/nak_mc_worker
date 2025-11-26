import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
    DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('/*', cors());

app.get('/', (c) => c.text('NAK Minecraft Speedrun Worker is running!'));

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
    return `${hours}h ${minutes}m ${seconds}s`;
}

export default app;
