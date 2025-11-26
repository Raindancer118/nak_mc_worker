export const getHtml = (stats: {
    totalRuns: number;
    bestTime: string;
    bestPlayer: string;
    lastRunTime: string;
    lastRunPlayer: string;
}) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NAK Speedrun Server</title>
    <style>
        :root {
            --bg: #0a0a0a;
            --card-bg: #161616;
            --text: #e0e0e0;
            --accent: #00ff9d;
            --accent-glow: rgba(0, 255, 157, 0.2);
            --secondary: #bd00ff;
        }
        
        body {
            margin: 0;
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            background: var(--bg);
            color: var(--text);
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100vh;
        }

        .container {
            width: 100%;
            max-width: 800px;
            padding: 2rem;
            box-sizing: border-box;
        }

        header {
            text-align: center;
            margin-bottom: 4rem;
            position: relative;
        }

        h1 {
            font-size: 3rem;
            font-weight: 800;
            margin: 0;
            background: linear-gradient(135deg, var(--accent), var(--secondary));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            text-transform: uppercase;
            letter-spacing: -2px;
        }

        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            background: rgba(0, 255, 157, 0.1);
            color: var(--accent);
            padding: 0.5rem 1rem;
            border-radius: 999px;
            font-weight: 600;
            font-size: 0.875rem;
            margin-top: 1rem;
            border: 1px solid rgba(0, 255, 157, 0.2);
        }

        .pulse {
            width: 8px;
            height: 8px;
            background: var(--accent);
            border-radius: 50%;
            box-shadow: 0 0 0 0 rgba(0, 255, 157, 0.7);
            animation: pulse 2s infinite;
        }

        @keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(0, 255, 157, 0.7); }
            70% { box-shadow: 0 0 0 10px rgba(0, 255, 157, 0); }
            100% { box-shadow: 0 0 0 0 rgba(0, 255, 157, 0); }
        }

        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1.5rem;
        }

        .card {
            background: var(--card-bg);
            padding: 2rem;
            border-radius: 16px;
            border: 1px solid rgba(255, 255, 255, 0.05);
            transition: transform 0.2s, box-shadow 0.2s;
        }

        .card:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
            border-color: rgba(255, 255, 255, 0.1);
        }

        .card-label {
            font-size: 0.875rem;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 0.5rem;
        }

        .card-value {
            font-size: 2rem;
            font-weight: 700;
            color: #fff;
        }

        .card-sub {
            font-size: 0.875rem;
            color: #666;
            margin-top: 0.5rem;
        }

        .highlight {
            color: var(--accent);
        }
        
        footer {
            margin-top: auto;
            padding: 2rem;
            color: #444;
            font-size: 0.875rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>NAK Speedrun</h1>
            <div class="status-badge">
                <div class="pulse"></div>
                SYSTEM OPERATIONAL
            </div>
        </header>

        <div class="grid">
            <div class="card">
                <div class="card-label">Total Runs</div>
                <div class="card-value">${stats.totalRuns}</div>
                <div class="card-sub">Attempts recorded</div>
            </div>

            <div class="card">
                <div class="card-label">Fastest Run</div>
                <div class="card-value highlight">${stats.bestTime}</div>
                <div class="card-sub">by ${stats.bestPlayer || 'N/A'}</div>
            </div>

            <div class="card">
                <div class="card-label">Last Run</div>
                <div class="card-value">${stats.lastRunTime}</div>
                <div class="card-sub">by ${stats.lastRunPlayer || 'N/A'}</div>
            </div>
        </div>
    </div>
    <footer>
        Running on Cloudflare Workers & Exaroton
    </footer>
</body>
</html>
`;
