/**
 * CucumberTtaReporter
 * @author The Testing Academy
 * @description Custom TTA HTML Reporter for Cucumber runs (@cucumber/cucumber v13).
 * Generates the same TTA-style report as src/utils/CustomReporter.ts but driven by
 * the Cucumber event protocol. Register it in cucumber.json "format".
 */

import { EventEmitter } from 'node:events';
import * as fs from 'fs';
import * as path from 'path';
import { Formatter, IFormatterOptions, formatterHelpers } from '@cucumber/cucumber';
import type {
    Attachment,
    Duration,
    Envelope,
    PickleStep,
    TestCase,
    TestStepResult,
    Timestamp,
} from '@cucumber/messages';
import { TestStepResultStatus } from '@cucumber/messages';

const { GherkinDocumentParser, PickleParser } = formatterHelpers;

interface ReportStep {
    id: string;
    keyword: string;
    text: string;
    isHook: boolean;
    hookPhase: 'before' | 'after' | '';
    status: 'passed' | 'failed' | 'skipped' | 'undefined' | 'pending' | 'running';
    durationMs: number;
    error?: string;
    message?: string;
    screenshots: { name: string; path: string }[];
    logs: string[];
}

interface ReportScenario {
    id: string;
    attempt: number;
    feature: string;
    rule?: string;
    name: string;
    description: string;
    tags: string[];
    file: string;
    line?: number;
    status: 'passed' | 'failed' | 'skipped';
    durationMs: number;
    steps: ReportStep[];
    error?: string;
    errorStack?: string;
    screenshots: { name: string; path: string }[];
    locationLabel: string;
}

interface AttemptView {
    attempt: number;
    willBeRetried: boolean;
    gherkinDocument: { uri?: string; feature?: { name: string; keyword: string } };
    pickle: { name: string; uri: string; tags: readonly { name: string }[]; astNodeIds: readonly string[] };
    testCase: { id: string; testSteps: readonly { id: string; pickleStepId?: string; hookId?: string }[] };
    stepResults: Record<string, TestStepResult>;
    stepAttachments: Record<string, Attachment[]>;
    worstTestStepResult: TestStepResult;
}

const STATUS_WEIGHT: Record<string, number> = {
    UNKNOWN: 0,
    PASSED: 1,
    SKIPPED: 2,
    PENDING: 3,
    UNDEFINED: 4,
    AMBIGUOUS: 6,
    FAILED: 5,
};

export default class CucumberTtaReporter extends Formatter {
    private eventBroadcaster: EventEmitter;
    private runId: string = '';
    private startTime: Date = new Date();
    private endTime: Date = new Date();
    private reportDir: string;
    private outputFile: string;
    private screenshotsDir: string;
    private videosDir: string;
    private scenarioCounter: number = 0;

    constructor(options: IFormatterOptions) {
        super(options);
        this.eventBroadcaster = options.eventBroadcaster;

        const now = new Date();
        this.runId = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

        this.reportDir = path.join('tta-report', 'cucumber');
        this.screenshotsDir = path.join(this.reportDir, 'screenshots', this.runId);
        this.videosDir = path.join(this.reportDir, 'videos', this.runId);
        this.outputFile = path.join(this.reportDir, `report_${this.runId}.html`);

        console.log('\n╔════════════════════════════════════════════════════════════════╗');
        console.log('║         🥒 TTA CUCUMBER AUTOMATION - REAL-TIME REPORT          ║');
        console.log('╠════════════════════════════════════════════════════════════════╣');
        console.log(`║  📅 Run ID: ${this.runId.padEnd(48)}║`);
        console.log('╚════════════════════════════════════════════════════════════════╝\n');

        this.eventBroadcaster.on('envelope', (envelope: Envelope) => {
            if (envelope.testRunStarted) {
                this.startTime = this.toDate(envelope.testRunStarted.timestamp);
            } else if (envelope.testCaseFinished) {
                this.writeReport(false);
            } else if (envelope.testRunFinished) {
                this.endTime = this.toDate(envelope.testRunFinished.timestamp);
                this.writeReport(true);
            }
        });
    }

    /* ------------------------------------------------------------------ */
    /*  Data collection                                                     */
    /* ------------------------------------------------------------------ */

    private getAttempts(): AttemptView[] {
        const attempts = (this.eventDataCollector as unknown as {
            getTestCaseAttempts(): AttemptView[];
        }).getTestCaseAttempts();
        return attempts || [];
    }

    private getLocationLabel(attempt: AttemptView, line?: number): string {
        const file = attempt.pickle.uri.split('/').pop() || attempt.pickle.uri;
        return line ? `${file}:${line}` : file;
    }

    private getWorstStatus(results: TestStepResult[]): string {
        return results.reduce<string>((worst, result) => {
            const currentWeight = STATUS_WEIGHT[result.status] ?? 0;
            const worstWeight = STATUS_WEIGHT[worst] ?? 0;
            return currentWeight > worstWeight ? result.status : worst;
        }, 'UNKNOWN');
    }

    private buildScenarios(): ReportScenario[] {
        this.scenarioCounter = 0;
        return this.getAttempts()
            .filter((attempt) => !attempt.willBeRetried)
            .map((attempt) => this.buildScenario(attempt));
    }

    private buildScenario(attempt: AttemptView): ReportScenario {
        this.scenarioCounter++;

        const feature = attempt.gherkinDocument?.feature?.name || 'Unknown Feature';
        const pickle = attempt.pickle;
        const gherkinDocument = (this.eventDataCollector as {
            getGherkinDocument(uri: string): { uri?: string; feature?: { name: string } };
        }).getGherkinDocument(pickle.uri);

        const gherkinStepMap = GherkinDocumentParser.getGherkinStepMap(gherkinDocument as never);
        const gherkinScenarioMap = GherkinDocumentParser.getGherkinScenarioMap(gherkinDocument as never);
        const pickleStepMap = PickleParser.getPickleStepMap(pickle as never);

        let isBeforeHook = true;
        const steps: ReportStep[] = attempt.testCase.testSteps.map((testStep) => {
            const isHook = !testStep.pickleStepId;
            if (!isHook) {
                isBeforeHook = false;
            }
            return this.buildStep({
                testStep: testStep as { id: string; pickleStepId?: string },
                pickleStepMap,
                gherkinStepMap,
                isBeforeHook,
                stepResult: attempt.stepResults[testStep.id],
                stepAttachments: attempt.stepAttachments[testStep.id] || [],
            });
        });

        const worstStatus = this.getWorstStatus(Object.values(attempt.stepResults));
        const status: ReportScenario['status'] = this.mapStatus(worstStatus);

        let error: string | undefined;
        let errorStack: string | undefined;
        for (const step of steps) {
            if (step.status === 'failed' && step.message) {
                error = step.message;
            }
            if (step.status === 'failed' && step.error) {
                errorStack = step.error;
            }
        }
        if (!error && worstStatus === 'UNDEFINED') {
            error = 'One or more steps are undefined. No matching step definition found.';
        }

        const screenshots: { name: string; path: string }[] = [];
        for (const step of steps) {
            screenshots.push(...step.screenshots);
        }

        const pickleTags = (pickle.tags || []).map((t) => t.name);
        const scenarioTags = [...new Set(pickleTags)];

        let line: number | undefined;
        try {
            line = PickleParser.getPickleLocation({
                gherkinDocument: gherkinDocument as never,
                pickle: pickle as never,
            }).line;
        } catch {
            // Fallback: no line info
        }

        const rule = this.getScenarioRule(gherkinDocument, attempt);
        const description = this.getScenarioDescription(attempt);

        const durationMs = this.durationToMs(attempt.worstTestStepResult.duration);

        return {
            id: attempt.testCase.id,
            attempt: attempt.attempt,
            feature,
            rule,
            name: pickle.name,
            description,
            tags: scenarioTags,
            file: pickle.uri,
            line,
            status,
            durationMs,
            steps,
            error,
            errorStack,
            screenshots,
            locationLabel: this.getLocationLabel(attempt, line),
        };
    }

    private getScenarioRule(gherkinDocument: never, attempt: AttemptView): string | undefined {
        try {
            const gherkinScenarioMap = GherkinDocumentParser.getGherkinScenarioMap(gherkinDocument);
            const scenarioIds: string[] = Object.keys(gherkinScenarioMap);
            const scenarioId = (attempt.pickle.astNodeIds || []).find((id) => scenarioIds.includes(id));
            if (!scenarioId) return undefined;
            const exampleRuleMap = GherkinDocumentParser.getGherkinExampleRuleMap(gherkinDocument);
            return exampleRuleMap[scenarioId]?.name;
        } catch {
            return undefined;
        }
    }

    private getScenarioDescription(attempt: AttemptView): string {
        try {
            const gherkinDocument = (this.eventDataCollector as {
                getGherkinDocument(uri: string): never;
            }).getGherkinDocument(attempt.pickle.uri);
            const gherkinScenarioMap = GherkinDocumentParser.getGherkinScenarioMap(gherkinDocument);
            return PickleParser.getScenarioDescription?.({
                pickle: attempt.pickle as never,
                gherkinScenarioMap,
            }) || '';
        } catch {
            return '';
        }
    }

    private buildStep(args: {
        testStep: { id: string; pickleStepId?: string };
        pickleStepMap: Record<string, PickleStep>;
        gherkinStepMap: Record<string, never>;
        isBeforeHook: boolean;
        stepResult?: TestStepResult;
        stepAttachments: Attachment[];
    }): ReportStep {
        const { testStep, pickleStepMap, gherkinStepMap } = args;
        const isHook = !testStep.pickleStepId;

        let keyword = '';
        let text = '';
        let id = testStep.id;

        if (!isHook && testStep.pickleStepId) {
            const pickleStep = pickleStepMap[testStep.pickleStepId];
            if (pickleStep) {
                keyword = PickleParser.getStepKeyword({
                    pickleStep: pickleStep as never,
                    gherkinStepMap,
                });
                text = pickleStep.text;
                id = pickleStep.id;
            }
        }

        const hookPhase: ReportStep['hookPhase'] = isHook ? (args.isBeforeHook ? 'before' : 'after') : '';

        let status: ReportStep['status'] = 'running';
        let error: string | undefined;
        let message: string | undefined;
        let durationMs = 0;
        if (args.stepResult) {
            status = this.mapStatusForStep(args.stepResult.status);
            durationMs = this.durationToMs(args.stepResult.duration);
            message = args.stepResult.message;
            if (args.stepResult.exception) {
                error = args.stepResult.exception.stackTrace || args.stepResult.exception.message;
            }
        }

        const screenshots: { name: string; path: string }[] = [];
        const logs: string[] = [];
        for (const attachment of args.stepAttachments) {
            if (attachment.mediaType.startsWith('image/')) {
                const dest = this.saveAttachmentImage(attachment, this.scenarioCounter, screenshots.length + 1);
                if (dest) {
                    screenshots.push(dest);
                }
            } else if (attachment.mediaType.startsWith('text/')) {
                logs.push(this.decodeAttachment(attachment));
            }
        }

        return {
            id,
            keyword,
            text,
            isHook,
            hookPhase,
            status,
            durationMs,
            error,
            message,
            screenshots,
            logs,
        };
    }

    private mapStatus(status: string): ReportScenario['status'] {
        if (status === 'FAILED' || status === 'AMBIGUOUS') return 'failed';
        if (status === 'PASSED') return 'passed';
        return 'skipped';
    }

    private mapStatusForStep(status: string): ReportStep['status'] {
        if (status === 'FAILED' || status === 'AMBIGUOUS') return 'failed';
        if (status === 'PASSED') return 'passed';
        if (status === 'UNDEFINED') return 'undefined';
        if (status === 'PENDING') return 'pending';
        if (status === 'SKIPPED') return 'skipped';
        return 'running';
    }

    private saveAttachmentImage(attachment: Attachment, scenarioNo: number, attachmentNo: number): { name: string; path: string } | null {
        try {
            if (!fs.existsSync(this.screenshotsDir)) {
                fs.mkdirSync(this.screenshotsDir, { recursive: true });
            }
            const ext = attachment.mediaType === 'image/jpeg' ? 'jpg' : 'png';
            const fileName = `scenario-${scenarioNo}-attachment-${attachmentNo}.${ext}`;
            const destPath = path.join(this.screenshotsDir, fileName);
            let buffer: Buffer | null = null;
            try {
                buffer = Buffer.from(attachment.body || '', 'base64');
            } catch {
                buffer = null;
            }
            if (buffer && buffer.length > 0) {
                fs.writeFileSync(destPath, buffer);
                return {
                    name: attachment.fileName || `Attachment ${attachmentNo}`,
                    path: `screenshots/${this.runId}/${fileName}`,
                };
            }
        } catch {
            // Ignore attachment save errors
        }
        return null;
    }

    private decodeAttachment(attachment: Attachment): string {
        try {
            if (attachment.contentEncoding === 'BASE64') {
                return Buffer.from(attachment.body || '', 'base64').toString('utf-8');
            }
            return attachment.body || '';
        } catch {
            return '';
        }
    }

    private durationToMs(duration?: Duration): number {
        if (!duration) return 0;
        return (duration.seconds * 1000) + (duration.nanos / 1_000_000);
    }

    private toDate(ts?: Timestamp): Date {
        if (!ts) return new Date();
        return new Date((ts.seconds * 1000) + (ts.nanos / 1_000_000));
    }

    /* ------------------------------------------------------------------ */
    /*  Report writing                                                      */
    /* ------------------------------------------------------------------ */

    private writeReport(final: boolean): void {
        try {
            if (!fs.existsSync(this.reportDir)) {
                fs.mkdirSync(this.reportDir, { recursive: true });
            }

            const scenarios = this.buildScenarios();
            let html = this.generateHTML(scenarios);
            if (!final) {
                html = html.replace(
                    '<meta charset="UTF-8">',
                    '<meta charset="UTF-8">\n    <meta http-equiv="refresh" content="5">',
                );
            }
            fs.writeFileSync(this.outputFile, html);

            if (final) {
                this.updateIndex();
                this.updateHistory();
                this.printSummary(scenarios);
            }
        } catch (error) {
            console.error('❌ Cucumber TTA report update failed:', error);
        }
    }

    private updateIndex(): void {
        const indexPath = path.join(this.reportDir, 'index.html');
        const redirect = `<!DOCTYPE html>
<html><head><meta http-equiv="refresh" content="0;url=${path.basename(this.outputFile)}">
<title>TTA Cucumber Report - Latest</title></head>
<body><p>Redirecting to <a href="${path.basename(this.outputFile)}">latest cucumber report</a>...</p></body></html>`;
        fs.writeFileSync(indexPath, redirect);
    }

    private updateHistory(): void {
        const files = fs.readdirSync(this.reportDir)
            .filter((f) => f.startsWith('report_') && f.endsWith('.html'))
            .sort()
            .reverse();

        const historyHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>TTA Cucumber Report History</title>
    <style>
        body { font-family: 'Segoe UI', sans-serif; background: #f5f5f5; padding: 20px; }
        .header { background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; padding: 20px; text-align: center; margin-bottom: 20px; border-radius: 8px; }
        .report-list { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .report-item { padding: 12px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; }
        .report-item:hover { background: #f0fdf4; }
        .report-link { color: #047857; text-decoration: none; font-weight: 500; }
        .report-link:hover { text-decoration: underline; }
        .report-date { color: #666; font-size: 12px; }
        .latest-badge { background: #10b981; color: white; padding: 2px 8px; border-radius: 10px; font-size: 11px; margin-left: 10px; }
    </style>
</head>
<body>
    <div class="header"><h1>🥒 TTA Cucumber Report History</h1><p>The Testing Academy - Cucumber Framework</p></div>
    <div class="report-list">
        ${files.map((f, i) => {
            const match = f.match(/report_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.html/);
            const dateStr = match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}` : f;
            const latestBadge = i === 0 ? '<span class="latest-badge">LATEST</span>' : '';
            return `<div class="report-item">
                <a href="${f}" class="report-link">${f}${latestBadge}</a>
                <span class="report-date">${dateStr}</span>
            </div>`;
        }).join('\n')}
    </div>
</body>
</html>`;
        fs.writeFileSync(path.join(this.reportDir, 'history.html'), historyHtml);
    }

    private printSummary(scenarios: ReportScenario[]): void {
        const passed = scenarios.filter((s) => s.status === 'passed').length;
        const failed = scenarios.filter((s) => s.status === 'failed').length;
        const skipped = scenarios.filter((s) => s.status === 'skipped').length;
        const total = scenarios.length;
        const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0';
        const duration = this.formatDuration(this.endTime.getTime() - this.startTime.getTime());

        console.log('\n╔════════════════════════════════════════════════════════════════╗');
        console.log('║                  🥒 FINAL CUCUMBER SUMMARY                      ║');
        console.log('╠════════════════════════════════════════════════════════════════╣');
        console.log(`║  ✅ Passed:  ${String(passed).padEnd(49)}║`);
        console.log(`║  ❌ Failed:  ${String(failed).padEnd(49)}║`);
        console.log(`║  ⏭️  Skipped: ${String(skipped).padEnd(49)}║`);
        console.log(`║  📊 Total:   ${String(total).padEnd(49)}║`);
        console.log('╠════════════════════════════════════════════════════════════════╣');
        console.log(`║  ⏱️  Duration: ${duration.padEnd(47)}║`);
        console.log(`║  📈 Pass Rate: ${(passRate + '%').padEnd(47)}║`);
        console.log('╚════════════════════════════════════════════════════════════════╝');

        console.log('\n🥒 Generating TTA Cucumber HTML Report...');
        console.log(`✅ Report generated: ${this.outputFile}`);
    }

    /* ------------------------------------------------------------------ */
    /*  HTML generation                                                     */
    /* ------------------------------------------------------------------ */

    private generateHTML(scenarios: ReportScenario[]): string {
        const passed = scenarios.filter((s) => s.status === 'passed').length;
        const failed = scenarios.filter((s) => s.status === 'failed').length;
        const skipped = scenarios.filter((s) => s.status === 'skipped').length;
        const total = scenarios.length;
        const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0';
        const totalDuration = this.endTime.getTime() - this.startTime.getTime();
        const env = process.env.TEST_ENV || 'UAT';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TTA Cucumber Automation Report</title>
    <style>
        ${this.getStyles()}
    </style>
</head>
<body>
    <div class="header">
        <h1>🥒 TTA Cucumber Automation Report</h1>
        <p class="header-subtitle">The Testing Academy - Cucumber BDD Framework</p>
    </div>

    <div class="container">
        <!-- Stats Dashboard -->
        <div class="stats-dashboard">
            <div class="stat-card">
                <div class="stat-value">${total}</div>
                <div class="stat-label">Total Scenarios</div>
            </div>
            <div class="stat-card passed">
                <div class="stat-value">${passed}</div>
                <div class="stat-label">Passed</div>
            </div>
            <div class="stat-card failed">
                <div class="stat-value">${failed}</div>
                <div class="stat-label">Failed</div>
            </div>
            <div class="stat-card skipped">
                <div class="stat-value">${skipped}</div>
                <div class="stat-label">Skipped</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${passRate}%</div>
                <div class="stat-label">Pass Rate</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${this.formatDuration(totalDuration)}</div>
                <div class="stat-label">Duration</div>
            </div>
        </div>

        <!-- Meta Info Bar -->
        <div class="meta-section">
            <div class="meta-item">
                <span class="meta-label">Environment</span>
                <span class="env-badge">🌐 ${env.toUpperCase()}</span>
            </div>
            <div class="meta-item">
                <span class="meta-label">Framework</span>
                <span class="browser-badge">🥒 Cucumber BDD</span>
            </div>
            <div class="meta-item">
                <span class="meta-label">Platform</span>
                <span class="meta-value">${process.platform === 'darwin' ? 'Mac' : process.platform === 'win32' ? 'Windows' : 'Linux'}</span>
            </div>
            <div class="meta-item">
                <span class="meta-label">Run ID</span>
                <span class="meta-value" style="font-family: 'JetBrains Mono', monospace; font-size: 12px;">${this.runId}</span>
            </div>
            <div class="meta-item">
                <span class="meta-label">Started</span>
                <span class="meta-value">${this.formatTime(this.startTime)}</span>
            </div>
            <div class="meta-item">
                <span class="meta-label">Finished</span>
                <span class="meta-value">${this.formatTime(this.endTime)}</span>
            </div>
        </div>

        ${this.generateFilters()}
        ${this.generateTestTable(scenarios)}
    </div>

    <div id="screenshotModal" class="modal">
        <span class="modal-close">&times;</span>
        <img id="modalImage" class="modal-content" src="" alt="Screenshot">
    </div>

    <footer class="report-footer">
        <p>Built with ❤️ by <a href="https://thetestingacademy.com" target="_blank">Pramod Dutta</a> | <a href="https://thetestingacademy.com" target="_blank">The Testing Academy</a></p>
    </footer>

    <script>
        ${this.getScripts()}
    </script>
</body>
</html>`;
    }

    private generateFilters(): string {
        return `
        <div class="filters">
            <div class="filter-group">
                <strong>🏷️ Tags:</strong>
                <label><input type="checkbox" class="group-filter" value="all" checked onchange="filterByGroup(this)"><span>All</span></label>
                <label><input type="checkbox" class="group-filter" value="p0" onchange="filterByGroup(this)"><span>P0</span></label>
                <label><input type="checkbox" class="group-filter" value="p1" onchange="filterByGroup(this)"><span>P1</span></label>
                <label><input type="checkbox" class="group-filter" value="smoke" onchange="filterByGroup(this)"><span>Smoke</span></label>
            </div>
            <div class="filter-group">
                <strong>📊 Status:</strong>
                <label><input type="checkbox" class="status-filter" value="all" checked onchange="filterByStatus(this)"><span>All</span></label>
                <label><input type="checkbox" class="status-filter" value="passed" onchange="filterByStatus(this)"><span>✅ Passed</span></label>
                <label><input type="checkbox" class="status-filter" value="failed" onchange="filterByStatus(this)"><span>❌ Failed</span></label>
                <label><input type="checkbox" class="status-filter" value="skipped" onchange="filterByStatus(this)"><span>⏭️ Skipped</span></label>
            </div>
        </div>`;
    }

    private generateTestTable(scenarios: ReportScenario[]): string {
        let html = '<div class="test-table-container">';

        html += `
        <table class="test-table">
            <thead>
                <tr>
                    <th>S.No</th>
                    <th>Feature</th>
                    <th>Scenario</th>
                    <th>Tags</th>
                    <th>File</th>
                    <th>Duration</th>
                    <th>Status</th>
                    <th>Screenshot</th>
                </tr>
            </thead>
            <tbody>`;

        let serialNo = 1;
        for (const scenario of scenarios) {
            const statusClass = scenario.status;
            const statusText = scenario.status === 'passed' ? 'Passed' : scenario.status === 'failed' ? 'Failed' : 'Skipped';
            const duration = this.formatDuration(scenario.durationMs);
            const tagsData = scenario.tags.join(',').toLowerCase();
            const firstScreenshot = scenario.screenshots[0]?.path || '';

            html += `
                <tr class="test-row ${statusClass}" data-test-id="${scenario.id}" data-tags="${tagsData}">
                    <td class="col-sno">${serialNo}</td>
                    <td class="col-suite">
                        <span class="feature-name">${this.escapeHtml(scenario.feature)}</span>
                        ${scenario.attempt > 0 ? `<span class="retry-badge">attempt #${scenario.attempt}</span>` : ''}
                    </td>
                    <td class="col-testname">
                        <span class="test-name-link" onclick="toggleTestDetail('${scenario.id}')">${this.escapeHtml(scenario.name)}</span>
                        ${scenario.rule ? `<div class="scenario-rule">${this.escapeHtml(scenario.rule)}</div>` : ''}
                        ${scenario.description ? `<div class="scenario-desc">${this.escapeHtml(scenario.description)}</div>` : ''}
                    </td>
                    <td class="col-tags">${this.renderTags(scenario.tags)}</td>
                    <td class="col-file">${this.escapeHtml(scenario.locationLabel)}</td>
                    <td class="col-duration">${duration}</td>
                    <td class="col-status"><span class="status-badge ${statusClass}">${statusText}</span></td>
                    <td class="col-screenshot">
                        ${firstScreenshot ? `<a href="${firstScreenshot}" target="_blank" class="screenshot-link">📷 View</a>` : 'N/A'}
                    </td>
                </tr>
                <tr class="test-detail-row" id="detail-row-${scenario.id}" style="display: none;">
                    <td colspan="8">
                        <div class="test-detail" id="detail-${scenario.id}">
                            ${this.generateScenarioDetailPanel(scenario)}
                        </div>
                    </td>
                </tr>`;

            serialNo++;
        }

        html += `
            </tbody>
        </table>
        </div>`;

        return html;
    }

    private renderTags(tags: string[]): string {
        if (!tags || tags.length === 0) return '<span class="no-tags">—</span>';
        return tags.map((t) => `<span class="tag">${this.escapeHtml(t)}</span>`).join(' ');
    }

    private generateScenarioDetailPanel(scenario: ReportScenario): string {
        let html = '<div class="detail-panel">';

        if (scenario.error) {
            html += `
            <div class="detail-section error-section">
                <div class="section-header" onclick="toggleSection(this)">
                    <span class="section-arrow">▼</span> Errors
                </div>
                <div class="section-content">
                    <div class="error-box">
                        <pre class="error-message">${this.escapeHtml(scenario.error)}</pre>
                        ${scenario.errorStack ? `<details class="stack-details"><summary>Call Stack</summary><pre class="stack-trace-content">${this.escapeHtml(scenario.errorStack)}</pre></details>` : ''}
                    </div>
                </div>
            </div>`;
        }

        html += `
            <div class="detail-section steps-section">
                <div class="section-header" onclick="toggleSection(this)">
                    <span class="section-arrow">▼</span> Steps
                </div>
                <div class="section-content">
                    <div class="steps-list">`;

        for (let stepIndex = 0; stepIndex < scenario.steps.length; stepIndex++) {
            const step = scenario.steps[stepIndex];
            const stepId = `step-${scenario.id}-${stepIndex}`;
            const icon = this.stepIcon(step.status);
            const stepClass = step.status;
            const label = step.isHook
                ? `<span class="hook-badge">🔧 ${step.hookPhase === 'before' ? 'Before Hook' : 'After Hook'}</span>`
                : `${this.escapeHtml(step.keyword)}<span class="step-text">${this.escapeHtml(step.text)}</span>`;

            html += `
                    <div class="step-item-container">
                        <div class="step-item ${stepClass} expandable" onclick="toggleStepDetails(this, '${stepId}-details')">
                            <span class="step-expand-icon">▶</span>
                            <span class="step-icon ${stepClass}">${icon}</span>
                            <span class="step-name">${label}</span>
                            <span class="step-time">${this.formatDuration(step.durationMs)}</span>
                        </div>
                        <div id="${stepId}-details" class="step-details" style="display: none;">
                            <div class="step-meta">
                                <span class="step-meta-item">⏳ Duration: ${this.formatDuration(step.durationMs)}</span>
                                <span class="step-meta-item">🏷️ Status: ${step.status.toUpperCase()}</span>
                            </div>`;

            if (step.message) {
                html += `
                            <div class="step-error">
                                <div class="step-error-header">❌ ${step.status === 'undefined' ? 'Undefined Step' : 'Error'}</div>
                                <div class="step-error-message">${this.escapeHtml(step.message)}</div>
                            </div>`;
            }

            if (step.error) {
                html += `
                            <div class="step-stack-trace">
                                <div class="step-stack-header">📜 Stack Trace</div>
                                <pre class="step-stack-content">${this.escapeHtml(step.error)}</pre>
                            </div>`;
            }

            if (step.logs.length > 0) {
                html += `
                            <div class="step-console">
                                <div class="step-console-header">📋 Console Output (${step.logs.length} lines)</div>
                                <div class="step-console-content">`;
                for (const log of step.logs) {
                    html += `<div class="console-line">${this.escapeHtml(log)}</div>`;
                }
                html += `
                                </div>
                            </div>`;
            }

            if (step.screenshots.length > 0) {
                html += `
                            <div class="step-screenshot">
                                <div class="step-screenshot-header">📷 Screenshot</div>`;
                for (const shot of step.screenshots) {
                    html += `
                                <a href="${shot.path}" target="_blank">
                                    <img src="${shot.path}" alt="Step Screenshot" class="step-screenshot-img"/>
                                </a>`;
                }
                html += `
                            </div>`;
            }

            html += `
                        </div>
                    </div>`;
        }

        html += `
                    </div>
                </div>
            </div>`;

        if (scenario.screenshots.length > 0) {
            html += `
            <div class="detail-section screenshots-section">
                <div class="section-header" onclick="toggleSection(this)">
                    <span class="section-arrow">▼</span> Screenshots
                </div>
                <div class="section-content">
                    <div class="screenshots-grid">`;

            for (const screenshot of scenario.screenshots) {
                html += `
                    <div class="screenshot-item">
                        <a href="${screenshot.path}" target="_blank" class="screenshot-link">
                            <img src="${screenshot.path}" alt="${screenshot.name}" class="screenshot-preview"/>
                        </a>
                        <div class="screenshot-name">📎 ${this.escapeHtml(screenshot.name)}</div>
                    </div>`;
            }

            html += `
                    </div>
                </div>
            </div>`;
        }

        html += '</div>';
        return html;
    }

    private stepIcon(status: string): string {
        switch (status) {
            case 'passed': return '✓';
            case 'failed': return '✗';
            case 'undefined': return '?';
            case 'pending': return '⏳';
            case 'skipped': return '⏭️';
            default: return '⏳';
        }
    }

    private escapeHtml(text: string): string {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    private formatTime(date: Date): string {
        return date.toLocaleString('en-US', {
            month: 'short',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        });
    }

    private formatDuration(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        if (minutes > 0) {
            return `${minutes}m ${remainingSeconds}s`;
        }
        const hundredths = Math.floor((ms % 1000) / 10);
        return remainingSeconds > 0 || ms >= 1000 ? `${remainingSeconds}s` : `${ms}ms`;
    }

    private getStyles(): string {
        return `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

        :root {
            --primary: #059669;
            --primary-light: #10b981;
            --primary-dark: #047857;
            --primary-bg: #ecfdf5;
            --accent: #0d9488;
            --success: #22c55e;
            --danger: #ef4444;
            --warning: #f59e0b;
            --info: #3b82f6;
            --dark: #1e293b;
            --gray-50: #f8fafc;
            --gray-100: #f1f5f9;
            --gray-200: #e2e8f0;
            --gray-300: #cbd5e1;
            --gray-400: #94a3b8;
            --gray-500: #64748b;
            --gray-600: #475569;
            --gray-700: #334155;
            --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
            --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
            --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
            --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
            --radius: 12px;
            --radius-sm: 8px;
            --radius-lg: 16px;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 14px;
            line-height: 1.6;
            background: linear-gradient(135deg, var(--gray-100) 0%, var(--primary-bg) 100%);
            min-height: 100vh;
            color: var(--gray-700);
        }

        /* ========== HEADER ========== */
        .header {
            background: linear-gradient(135deg, var(--primary) 0%, var(--accent) 50%, var(--primary-dark) 100%);
            color: white;
            padding: 40px 20px;
            text-align: center;
            position: relative;
            overflow: hidden;
        }
        .header::before {
            content: '';
            position: absolute;
            top: -50%;
            left: -50%;
            width: 200%;
            height: 200%;
            background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 60%);
            animation: pulse 15s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { transform: scale(1); opacity: 0.5; }
            50% { transform: scale(1.1); opacity: 0.3; }
        }
        .header h1 {
            font-size: 32px;
            font-weight: 700;
            letter-spacing: -0.5px;
            position: relative;
            text-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        .header-subtitle {
            margin-top: 8px;
            font-size: 16px;
            font-weight: 400;
            opacity: 0.9;
            position: relative;
        }

        /* ========== CONTAINER ========== */
        .container {
            max-width: 1600px;
            margin: 0 auto;
            padding: 30px;
        }

        /* ========== STATS DASHBOARD ========== */
        .stats-dashboard {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: white;
            border-radius: var(--radius);
            padding: 24px;
            box-shadow: var(--shadow);
            transition: transform 0.2s, box-shadow 0.2s;
            border-left: 4px solid var(--primary);
        }
        .stat-card:hover {
            transform: translateY(-2px);
            box-shadow: var(--shadow-lg);
        }
        .stat-card.passed { border-left-color: var(--success); }
        .stat-card.failed { border-left-color: var(--danger); }
        .stat-card.skipped { border-left-color: var(--gray-400); }
        .stat-value {
            font-size: 36px;
            font-weight: 700;
            color: var(--dark);
            line-height: 1;
        }
        .stat-label {
            font-size: 13px;
            color: var(--gray-500);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-top: 8px;
            font-weight: 500;
        }

        /* ========== META SECTION ========== */
        .meta-section {
            background: white;
            padding: 20px 24px;
            margin-bottom: 24px;
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            display: flex;
            flex-wrap: wrap;
            gap: 24px;
            align-items: center;
        }
        .meta-item {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .meta-label {
            font-size: 12px;
            color: var(--gray-500);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 600;
        }
        .meta-value {
            font-weight: 600;
            color: var(--dark);
        }
        .env-badge, .browser-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .env-badge {
            background: linear-gradient(135deg, var(--primary-light) 0%, var(--primary) 100%);
            color: white;
            box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
        }
        .browser-badge {
            background: var(--gray-100);
            color: var(--gray-700);
            border: 1px solid var(--gray-200);
        }

        /* ========== FILTERS ========== */
        .filters {
            background: white;
            padding: 20px 24px;
            margin-bottom: 24px;
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            display: flex;
            flex-wrap: wrap;
            gap: 30px;
            align-items: center;
        }
        .filter-group {
            display: flex;
            align-items: center;
            gap: 12px;
            flex-wrap: wrap;
        }
        .filter-group strong {
            font-size: 13px;
            color: var(--gray-600);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .filter-group label {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 8px 16px;
            background: var(--gray-50);
            border: 1px solid var(--gray-200);
            border-radius: 20px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s;
        }
        .filter-group label:hover {
            background: var(--primary-bg);
            border-color: var(--primary-light);
        }
        .filter-group input[type="checkbox"] {
            accent-color: var(--primary);
            width: 16px;
            height: 16px;
        }
        .filter-group input[type="checkbox"]:checked + span {
            color: var(--primary);
        }

        /* ========== TEST TABLE ========== */
        .test-table-container {
            background: white;
            border-radius: var(--radius);
            box-shadow: var(--shadow-lg);
            overflow: hidden;
        }
        .test-table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            font-size: 13px;
        }
        .test-table thead {
            background: linear-gradient(135deg, var(--dark) 0%, var(--gray-700) 100%);
            color: white;
            position: sticky;
            top: 0;
            z-index: 10;
        }
        .test-table th {
            padding: 16px 12px;
            text-align: left;
            font-weight: 600;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border: none;
            white-space: nowrap;
        }
        .test-table td {
            padding: 14px 12px;
            border-bottom: 1px solid var(--gray-100);
            vertical-align: middle;
        }
        .test-table tbody tr {
            background: white;
            transition: all 0.2s;
        }
        .test-table tbody tr:nth-child(even) {
            background: var(--gray-50);
        }
        .test-row:hover {
            background: var(--primary-bg) !important;
            transform: scale(1.001);
        }
        .test-row.failed {
            background: #fef2f2 !important;
            border-left: 3px solid var(--danger);
        }
        .test-row.failed:hover {
            background: #fee2e2 !important;
        }
        .test-row.passed {
            border-left: 3px solid transparent;
        }

        /* Column widths */
        .col-sno { width: 50px; text-align: center; font-weight: 600; color: var(--gray-400); }
        .col-suite { min-width: 160px; }
        .col-testname { min-width: 280px; }
        .col-tags { min-width: 120px; }
        .col-file { min-width: 150px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--gray-500); }
        .col-duration { width: 80px; text-align: center; font-weight: 600; }
        .col-status { width: 100px; text-align: center; }
        .col-screenshot { width: 90px; text-align: center; }

        .feature-name {
            font-weight: 600;
            color: var(--primary-dark);
            font-size: 13px;
        }
        .retry-badge {
            display: inline-block;
            margin-left: 8px;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 600;
            background: #ede9fe;
            color: #7c3aed;
        }
        .scenario-rule {
            font-size: 11px;
            color: var(--gray-500);
            margin-top: 2px;
        }
        .scenario-desc {
            font-size: 11px;
            color: var(--gray-400);
            margin-top: 2px;
        }
        .block-title {
            font-size: 20px;
            font-weight: 700;
            color: var(--dark);
            margin-bottom: 16px;
        }

        .test-name-link {
            color: var(--dark);
            cursor: pointer;
            text-decoration: none;
            font-weight: 500;
            transition: color 0.2s;
        }
        .test-name-link:hover {
            color: var(--primary);
        }

        /* Status Badges */
        .status-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 6px 14px;
            border-radius: 20px;
            font-weight: 600;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            gap: 4px;
        }
        .status-badge.passed {
            background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
            color: white;
            box-shadow: 0 2px 8px rgba(34, 197, 94, 0.3);
        }
        .status-badge.failed {
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
            color: white;
            box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
        }
        .status-badge.skipped {
            background: var(--gray-200);
            color: var(--gray-600);
        }

        /* Action Links */
        .screenshot-link {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 6px 12px;
            border-radius: var(--radius-sm);
            text-decoration: none;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.2s;
            background: var(--primary-bg);
            color: var(--primary);
        }
        .screenshot-link:hover {
            background: var(--primary);
            color: white;
        }

        /* Tags */
        .tag {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            margin: 2px;
            background: var(--primary-bg);
            color: var(--primary-dark);
            border: 1px solid var(--primary-light);
        }
        .no-tags { color: var(--gray-300); }

        /* ========== TEST DETAIL PANEL ========== */
        .test-detail-row { background: var(--gray-50) !important; }
        .test-detail-row td { padding: 0 !important; }
        .test-detail {
            margin: 16px 24px;
            border-radius: var(--radius);
            background: white;
            box-shadow: var(--shadow);
            overflow: hidden;
        }
        .detail-panel { padding: 0; }
        .detail-section {
            border-bottom: 1px solid var(--gray-100);
        }
        .detail-section:last-child { border-bottom: none; }
        .section-header {
            padding: 16px 20px;
            background: var(--gray-50);
            cursor: pointer;
            font-weight: 600;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 10px;
            transition: background 0.2s;
        }
        .section-header:hover { background: var(--gray-100); }
        .section-arrow {
            font-size: 12px;
            color: var(--gray-400);
            transition: transform 0.3s;
        }
        .section-collapsed .section-arrow { transform: rotate(-90deg); }
        .section-collapsed .section-content { display: none; }
        .section-content { padding: 20px; }

        /* Error Section */
        .error-section .section-header {
            background: #fef2f2;
            color: var(--danger);
        }
        .error-box {
            background: white;
            border: 1px solid #fecaca;
            border-radius: var(--radius-sm);
            padding: 16px;
            border-left: 4px solid var(--danger);
        }
        .error-message {
            margin: 0;
            color: var(--danger);
            font-family: 'JetBrains Mono', monospace;
            font-size: 13px;
            white-space: pre-wrap;
            word-break: break-word;
            line-height: 1.6;
        }
        .stack-details { margin-top: 16px; }
        .stack-details summary {
            cursor: pointer;
            color: var(--gray-500);
            font-size: 13px;
            font-weight: 500;
            padding: 8px 0;
        }
        .stack-trace-content {
            margin: 12px 0 0 0;
            padding: 16px;
            background: var(--dark);
            color: #a7f3d0;
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            border-radius: var(--radius-sm);
            overflow-x: auto;
            max-height: 300px;
            overflow-y: auto;
            line-height: 1.6;
        }

        /* Steps Section */
        .steps-list {
            background: white;
            border-radius: var(--radius-sm);
            border: 1px solid var(--gray-100);
            overflow: hidden;
        }
        .step-item-container {
            border-bottom: 1px solid var(--gray-100);
        }
        .step-item-container:last-child { border-bottom: none; }
        .step-item {
            display: flex;
            align-items: center;
            padding: 14px 16px;
            transition: background 0.2s;
        }
        .step-item.expandable { cursor: pointer; }
        .step-item.expandable:hover { background: var(--gray-50); }
        .step-item.failed { background: #fef2f2; }
        .step-item.undefined { background: #fffbeb; }
        .step-expand-icon {
            width: 20px;
            font-size: 10px;
            color: var(--gray-400);
            transition: transform 0.3s;
        }
        .step-item.expanded .step-expand-icon { transform: rotate(90deg); }
        .step-icon {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 12px;
            font-size: 14px;
            flex-shrink: 0;
        }
        .step-icon.passed {
            background: #dcfce7;
            color: var(--success);
        }
        .step-icon.failed {
            background: #fee2e2;
            color: var(--danger);
        }
        .step-icon.undefined {
            background: #fef3c7;
            color: var(--warning);
        }
        .step-icon.skipped, .step-icon.pending, .step-icon.running {
            background: var(--gray-100);
            color: var(--gray-500);
        }
        .step-name {
            flex: 1;
            font-size: 13px;
            font-weight: 500;
            color: var(--dark);
        }
        .step-text { font-weight: 400; margin-left: 2px; }
        .hook-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 600;
            background: #f0f9ff;
            color: #0369a1;
        }
        .step-time {
            color: var(--gray-500);
            font-size: 12px;
            font-family: 'JetBrains Mono', monospace;
            background: var(--gray-100);
            padding: 4px 10px;
            border-radius: 12px;
        }
        .step-details {
            background: var(--gray-50);
            border-top: 1px solid var(--gray-100);
            padding: 16px 20px 16px 56px;
        }
        .step-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 20px;
            color: var(--gray-500);
            font-size: 12px;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px dashed var(--gray-200);
        }
        .step-meta-item {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .step-console { margin-bottom: 16px; }
        .step-console-header {
            font-weight: 600;
            color: var(--dark);
            margin-bottom: 10px;
            font-size: 13px;
        }
        .step-console-content {
            background: var(--dark);
            color: #a7f3d0;
            padding: 16px;
            border-radius: var(--radius-sm);
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            line-height: 1.6;
            max-height: 300px;
            overflow-y: auto;
        }
        .console-line {
            padding: 4px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .console-line:last-child { border-bottom: none; }

        /* Screenshots */
        .step-screenshot { margin-bottom: 16px; }
        .step-screenshot-header { font-weight: 600; color: var(--dark); margin-bottom: 10px; }
        .step-screenshot-img {
            max-width: 100%;
            max-height: 250px;
            border: 1px solid var(--gray-200);
            border-radius: var(--radius-sm);
            box-shadow: var(--shadow);
        }
        .step-error { margin-bottom: 16px; }
        .step-error-header { font-weight: 600; color: var(--danger); margin-bottom: 10px; }
        .step-error-message {
            background: #fef2f2;
            color: #b91c1c;
            padding: 16px;
            border-radius: var(--radius-sm);
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            border-left: 4px solid var(--danger);
            white-space: pre-wrap;
            word-break: break-word;
        }
        .step-stack-trace { margin-top: 12px; }
        .step-stack-header { font-weight: 600; color: var(--warning); margin-bottom: 10px; }
        .step-stack-content {
            background: #fffbeb;
            color: #92400e;
            padding: 16px;
            border-radius: var(--radius-sm);
            font-family: 'JetBrains Mono', monospace;
            font-size: 11px;
            max-height: 200px;
            overflow-y: auto;
            margin: 0;
            border-left: 4px solid var(--warning);
            white-space: pre-wrap;
            word-break: break-word;
        }

        /* Screenshots Grid */
        .screenshots-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
            gap: 20px;
        }
        .screenshot-item {
            background: white;
            border: 1px solid var(--gray-200);
            border-radius: var(--radius);
            overflow: hidden;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .screenshot-item:hover {
            transform: translateY(-4px);
            box-shadow: var(--shadow-lg);
        }
        .screenshot-preview {
            width: 100%;
            height: 160px;
            object-fit: cover;
            display: block;
        }
        .screenshot-name {
            padding: 12px;
            font-size: 12px;
            color: var(--gray-600);
            border-top: 1px solid var(--gray-100);
            font-weight: 500;
        }

        /* ========== MODAL ========== */
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.95);
            justify-content: center;
            align-items: center;
            backdrop-filter: blur(4px);
        }
        .modal.active { display: flex; }
        .modal-content {
            max-width: 95%;
            max-height: 95%;
            object-fit: contain;
            border-radius: var(--radius);
            box-shadow: var(--shadow-xl);
        }
        .modal-close {
            position: absolute;
            top: 20px;
            right: 30px;
            color: white;
            font-size: 40px;
            cursor: pointer;
            transition: color 0.2s, transform 0.2s;
        }
        .modal-close:hover {
            color: var(--primary-light);
            transform: scale(1.1);
        }

        /* ========== FOOTER ========== */
        .report-footer {
            text-align: center;
            padding: 30px 20px;
            background: linear-gradient(135deg, var(--dark) 0%, var(--gray-700) 100%);
            color: white;
            margin-top: 40px;
        }
        .report-footer p {
            font-size: 14px;
            opacity: 0.9;
        }
        .report-footer a {
            color: var(--primary-light);
            text-decoration: none;
            font-weight: 600;
            transition: color 0.2s;
        }
        .report-footer a:hover {
            color: white;
            text-decoration: underline;
        }

        /* ========== RESPONSIVE ========== */
        @media (max-width: 1200px) {
            .container { padding: 20px; }
            .test-table { font-size: 12px; }
        }
        @media (max-width: 768px) {
            .header { padding: 30px 15px; }
            .header h1 { font-size: 24px; }
            .meta-section, .filters { flex-direction: column; align-items: flex-start; }
            .stats-dashboard { grid-template-columns: repeat(2, 1fr); }
        }
        `;
    }

    private getScripts(): string {
        return `
        function toggleTestDetail(testId) {
            const detailRow = document.getElementById('detail-row-' + testId);
            if (detailRow) {
                detailRow.style.display = detailRow.style.display === 'none' ? 'table-row' : 'none';
            }
        }

        function toggleSection(header) {
            const section = header.parentElement;
            section.classList.toggle('section-collapsed');
        }

        function toggleStepDetails(stepElement, detailsId) {
            const details = document.getElementById(detailsId);
            if (details) {
                if (details.style.display === 'none') {
                    details.style.display = 'block';
                    stepElement.classList.add('expanded');
                } else {
                    details.style.display = 'none';
                    stepElement.classList.remove('expanded');
                }
            }
        }

        function filterByStatus(checkbox) {
            const allCheckbox = document.querySelector('.status-filter[value="all"]');
            if (checkbox.value === 'all') {
                if (checkbox.checked) {
                    document.querySelectorAll('.status-filter:not([value="all"])').forEach(cb => cb.checked = false);
                }
            } else {
                if (checkbox.checked && allCheckbox) {
                    allCheckbox.checked = false;
                }
                const anyChecked = document.querySelectorAll('.status-filter:not([value="all"]):checked').length > 0;
                if (!anyChecked && allCheckbox) {
                    allCheckbox.checked = true;
                }
            }
            applyFilters();
        }

        function filterByGroup(checkbox) {
            const allCheckbox = document.querySelector('.group-filter[value="all"]');
            if (checkbox.value === 'all') {
                if (checkbox.checked) {
                    document.querySelectorAll('.group-filter:not([value="all"])').forEach(cb => cb.checked = false);
                }
            } else {
                if (checkbox.checked && allCheckbox) {
                    allCheckbox.checked = false;
                }
                const anyChecked = document.querySelectorAll('.group-filter:not([value="all"]):checked').length > 0;
                if (!anyChecked && allCheckbox) {
                    allCheckbox.checked = true;
                }
            }
            applyFilters();
        }

        function applyFilters() {
            const statusAll = document.querySelector('.status-filter[value="all"]')?.checked;
            const groupAll = document.querySelector('.group-filter[value="all"]')?.checked;
            const statusFilters = Array.from(document.querySelectorAll('.status-filter:not([value="all"]):checked')).map(f => f.value);
            const groupFilters = Array.from(document.querySelectorAll('.group-filter:not([value="all"]):checked')).map(f => f.value);

            document.querySelectorAll('.test-row').forEach(row => {
                let statusMatch = statusAll;
                if (!statusMatch) {
                    const rowStatus = row.classList.contains('passed') ? 'passed' :
                                       row.classList.contains('failed') ? 'failed' : 'skipped';
                    statusMatch = statusFilters.includes(rowStatus);
                }

                let groupMatch = groupAll;
                if (!groupMatch) {
                    const tags = row.getAttribute('data-tags') || '';
                    groupMatch = groupFilters.some(g => tags.toLowerCase().includes(g.toLowerCase()));
                }

                const testId = row.getAttribute('data-test-id');
                const detailRow = document.getElementById('detail-row-' + testId);

                row.style.display = (statusMatch && groupMatch) ? '' : 'none';
                if (detailRow && detailRow.style.display !== 'none') {
                    detailRow.style.display = (statusMatch && groupMatch) ? 'table-row' : 'none';
                }
            });
        }

        document.addEventListener('DOMContentLoaded', function() {
            const modal = document.getElementById('screenshotModal');
            const modalImg = document.getElementById('modalImage');
            const closeBtn = document.querySelector('.modal-close');

            document.querySelectorAll('.screenshot-link').forEach(link => {
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (modal && modalImg) {
                        modal.classList.add('active');
                        modalImg.src = this.href;
                    }
                });
            });

            if (closeBtn) {
                closeBtn.addEventListener('click', function() {
                    modal.classList.remove('active');
                });
            }
            if (modal) {
                modal.addEventListener('click', function(e) {
                    if (e.target === modal) {
                        modal.classList.remove('active');
                    }
                });
            }
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && modal) {
                    modal.classList.remove('active');
                }
            });

            // Auto-expand failed tests
            document.querySelectorAll('.test-row.failed').forEach(row => {
                const testId = row.getAttribute('data-test-id');
                if (testId) {
                    toggleTestDetail(testId);
                }
            });
        });
        `;
    }
}