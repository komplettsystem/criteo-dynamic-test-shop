#!/usr/bin/env ts-node
/**
 * orchestrator.ts
 *
 * Runs the c1→c10 structured-data test sequence.
 *
 * For each config:
 *   1. Runs the Playwright test matrix for that config (fires events on the Netlify site)
 *   2. Waits for TEMO to receive events (polls /event-types)
 *   3. Calls automap.ts (in criteo-config-generator) to generate + push JQ for unmapped events
 *   4. Writes a per-config report
 *
 * All JQ generation, TEMO API interaction, and coverage tracking live in automap.ts.
 * This file only coordinates timing and reports.
 *
 * Usage:
 *   npx ts-node orchestrator.ts [--configs=c1,c2] [--prod] [--dry-run] [--skip-glup-wait]
 */

import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TEMO_PROD     = 'https://temo.crto.in';
const PARTNER_ID    = '126639';
const APP_ID        = `criteo.generic_gtm.${PARTNER_ID}`;
const AUTOMAP_SCRIPT = path.join(
    process.env.HOME!,
    'Documents/antigravity/criteo-website-compliance-technology-detector/services/criteo-config-generator/scripts/automap.ts',
);
const REPORTS_DIR = path.join(__dirname, 'automapper', 'reports');

const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => {
            const [k, ...v] = a.slice(2).split('=');
            return [k, v.join('=') || 'true'];
        }),
);

const configsArg  = args['configs'];
const prod        = args['prod'] === 'true';
const dryRun      = args['dry-run'] === 'true';
const skipGlupWait = args['skip-glup-wait'] === 'true';

const ALL_CONFIGS = ['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11'];
const configs     = configsArg ? configsArg.split(',') : ALL_CONFIGS;

// How long to poll TEMO for event arrival before giving up
const TEMO_POLL_TIMEOUT_MS  = 5 * 60 * 1000;  // 5 min
const TEMO_POLL_INTERVAL_MS = 15 * 1000;       // 15 sec

// ---------------------------------------------------------------------------
// TEMO helpers (read-only, always prod)
// ---------------------------------------------------------------------------

async function temoGetEventTypes(): Promise<string[]> {
    const res = await fetch(`${TEMO_PROD}/clients/apps/${encodeURIComponent(APP_ID)}/event-types`);
    if (!res.ok) throw new Error(`TEMO GET event-types → ${res.status}`);
    return res.json() as Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Wait for TEMO to see new events after page visits
// ---------------------------------------------------------------------------

async function waitForTemoEvents(knownBefore: string[], label: string): Promise<string[]> {
    const deadline = Date.now() + TEMO_POLL_TIMEOUT_MS;
    process.stderr.write(`  Polling TEMO for new events (timeout: ${TEMO_POLL_TIMEOUT_MS / 1000}s)...\n`);

    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, TEMO_POLL_INTERVAL_MS));
        try {
            const current = await temoGetEventTypes();
            const newTypes = current.filter(e => !knownBefore.includes(e));
            if (newTypes.length > 0 || current.length > 0) {
                process.stderr.write(`  TEMO has: [${current.join(', ')}]${newTypes.length ? `  (+${newTypes.join(', ')})` : ''}\n`);
                return current;
            }
        } catch (e: any) {
            process.stderr.write(`  TEMO poll error: ${e.message}\n`);
        }
    }

    process.stderr.write(`  Timed out waiting for TEMO events for ${label}\n`);
    return knownBefore;
}

// ---------------------------------------------------------------------------
// Run automap.ts via subprocess
// ---------------------------------------------------------------------------

interface AutomapReport {
    appId: string;
    configLabel: string;
    generatedAt: string;
    temoEnv: string;
    results: Array<{
        eventType: string;
        criteoEvent: string;
        status: string;
        jqLines?: number;
        confirmedByConfigs: string[];
        universal: boolean;
        error?: string;
    }>;
    summary: {
        total: number;
        alreadyMapped: number;
        newlyMapped: number;
        noSamples: number;
        failed: number;
        universal: number;
    };
}

function runAutomap(configLabel: string): AutomapReport | null {
    const reportFile = path.join(REPORTS_DIR, `automap-${configLabel}.json`);
    const automapArgs = [
        `--partner-id=${PARTNER_ID}`,
        `--config-label=${configLabel}`,
        `--report-out=${reportFile}`,
        prod   ? '--prod'    : '',
        dryRun ? '--dry-run' : '',
    ].filter(Boolean);

    process.stderr.write(`  Running automap.ts ${automapArgs.join(' ')}\n`);

    const result = spawnSync(
        'npx', ['ts-node', AUTOMAP_SCRIPT, ...automapArgs],
        {
            cwd: path.dirname(AUTOMAP_SCRIPT),
            encoding: 'utf8',
            timeout: 5 * 60 * 1000,
        },
    );

    if (result.stderr) process.stderr.write(result.stderr);

    if (result.status !== 0) {
        process.stderr.write(`  automap.ts failed (exit ${result.status})\n`);
        return null;
    }

    if (!fs.existsSync(reportFile)) {
        process.stderr.write(`  automap.ts did not write report to ${reportFile}\n`);
        return null;
    }

    try {
        return JSON.parse(fs.readFileSync(reportFile, 'utf8')) as AutomapReport;
    } catch {
        process.stderr.write(`  Failed to parse automap report\n`);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface ConfigReport {
    config: string;
    timestamp: string;
    // Unix seconds bracketing this config's browser events — use for Presto correlation:
    //   WHERE partnerid = 126639 AND user_timestamp BETWEEN eventWindow.start AND eventWindow.end
    eventWindow: { start: number; end: number };
    playwrightPassed: boolean;
    temoEventTypes: string[];
    automapReport: AutomapReport | null;
    errors: string[];
}

async function main() {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });

    const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
    console.log(`Run ID:  ${runId}`);
    console.log(`Configs: ${configs.join(', ')}`);
    console.log(`TEMO:    ${prod ? 'PRODUCTION' : 'preprod'}  dry-run: ${dryRun}\n`);

    // Snapshot current TEMO event types before we start
    let knownEventTypes: string[] = [];
    try {
        knownEventTypes = await temoGetEventTypes();
        console.log(`TEMO already knows: [${knownEventTypes.join(', ')}]\n`);
    } catch {
        console.log('Could not reach TEMO — continuing anyway\n');
    }

    const summaryRows: string[] = [];

    for (const config of configs) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`Config: ${config}`);
        console.log(`${'─'.repeat(60)}`);

        const pwStart = Math.floor(Date.now() / 1000);
        const report: ConfigReport = {
            config,
            timestamp: new Date().toISOString(),
            eventWindow: { start: pwStart, end: pwStart },   // end filled in after Playwright
            playwrightPassed: false,
            temoEventTypes: [],
            automapReport: null,
            errors: [],
        };

        // 1. Run Playwright for this config
        process.stderr.write(`  Running Playwright for ${config}...\n`);
        const pw = spawnSync(
            'npx', ['playwright', 'test', '--grep', `\\[${config}\\]`, '--config', 'playwright.config.ts'],
            { cwd: __dirname, encoding: 'utf8', timeout: 120_000 },
        );
        report.eventWindow.end = Math.floor(Date.now() / 1000);
        if (pw.stdout) process.stderr.write(pw.stdout.slice(-500));
        report.playwrightPassed = pw.status === 0;
        if (!report.playwrightPassed) {
            process.stderr.write(`  Playwright failed (exit ${pw.status})\n`);
            report.errors.push(`playwright exit ${pw.status}`);
        } else {
            process.stderr.write(`  Playwright: all tests passed\n`);
        }

        // 2. Wait for TEMO to receive events
        try {
            report.temoEventTypes = await waitForTemoEvents(knownEventTypes, config);
            knownEventTypes = report.temoEventTypes;
        } catch (e: any) {
            report.errors.push(`temo-poll: ${e.message}`);
        }

        // 3. Run automap
        const automapReport = runAutomap(config);
        report.automapReport = automapReport;

        if (automapReport) {
            const s = automapReport.summary;
            process.stderr.write(
                `  Automap: ${s.newlyMapped} new, ${s.alreadyMapped} carry-forward, ` +
                `${s.noSamples} no-samples, ${s.failed} failed\n`,
            );
        }

        // 4. Write per-config report
        const reportPath = path.join(REPORTS_DIR, `${config}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        process.stderr.write(`  Report: ${reportPath}\n`);

        const status = report.playwrightPassed
            ? (automapReport && automapReport.summary.failed === 0 ? '✓' : '⚠')
            : '✗';
        summaryRows.push(
            `${status} ${config.padEnd(4)} ` +
            `pw=${report.playwrightPassed ? 'pass' : 'FAIL'}  ` +
            `temo=[${report.temoEventTypes.join(',')}]  ` +
            (automapReport ? `new=${automapReport.summary.newlyMapped} carry=${automapReport.summary.alreadyMapped}` : 'automap=failed'),
        );
    }

    // 5. Summary
    console.log(`\n${'═'.repeat(60)}`);
    console.log('Summary');
    console.log('═'.repeat(60));
    for (const row of summaryRows) console.log(row);

    const summaryPath = path.join(REPORTS_DIR, 'orchestrator-summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify({
        runId,
        generatedAt: new Date().toISOString(),
        configs,
        rows: summaryRows,
        prestoVerification: {
            note: 'Use eventWindow.start/end from per-config reports to isolate events per config in Presto:',
            query: `SELECT eventname, integration_context.has_been_mapped AS mapped, COUNT(*)\n` +
                   `FROM glup_parquet.advertiser_event\n` +
                   `WHERE partnerid = ${PARTNER_ID} AND day = 'YYYY-MM-DD'\n` +
                   `  AND user_timestamp BETWEEN {eventWindow.start} AND {eventWindow.end}\n` +
                   `GROUP BY 1, 2`,
        },
    }, null, 2));
    console.log(`\nSummary: ${summaryPath}`);
}

main().catch(e => {
    console.error('Fatal:', e.message);
    process.exit(1);
});
