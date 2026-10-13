// A tiny CI dashboard on your phone: run builds, watch them progress, open one for details.
// Run: node examples/builds.mjs   (with the Remote PC agent running on this PC)
import { PhoneApp, ui } from '../node/index.js';

const state = { autoDeploy: true, branch: 'main', builds: [] };
let next = 1;

function runBuild() {
  const build = { id: next++, branch: state.branch, progress: 0, status: 'Running', started: new Date() };
  state.builds.unshift(build);
  const timer = setInterval(() => {
    build.progress = Math.min(1, build.progress + 0.1);
    if (build.progress >= 1) {
      clearInterval(timer);
      build.status = Math.random() < 0.85 ? 'Passed' : 'Failed';
      app.toast(`Build #${build.id} ${build.status.toLowerCase()}`);
    }
    app.update();
  }, 500);
}

const statusIcon = (b) =>
  b.status === 'Passed' ? ui.icon('checkmark.circle.fill', 'green', 'plain') : b.status === 'Failed' ? ui.icon('xmark.octagon.fill', 'red', 'plain') : ui.icon('clock.fill', 'orange', 'plain');

function detail(build) {
  return () =>
    ui.screen(`Build #${build.id}`, [
      ui.section([ui.label('Branch', build.branch), ui.label('Status', build.status), ui.label('Started', build.started.toLocaleTimeString())]),
      build.status === 'Running' ? ui.section('Progress', [ui.progress(build.progress, { label: `${Math.round(build.progress * 100)}%` })]) : ui.section([]),
      ui.section([ui.button('Run again', () => runBuild(), { style: 'prominent' })]),
    ]);
}

const app = new PhoneApp({ id: 'builds', name: 'Builds', icon: ui.icon('hammer.fill', 'orange'), description: 'CI on this PC' }, () =>
  ui.screen(
    'Builds',
    [
      ui.section('Settings', [
        ui.choice('Branch', ['main', 'develop', 'release'], state.branch, (b) => (state.branch = b)),
        ui.toggle('Deploy when green', state.autoDeploy, (on) => (state.autoDeploy = on)),
      ]),
      ui.section(
        'Recent',
        state.builds.map((b) =>
          ui.item(`#${b.id} · ${b.branch}`, {
            id: `build-${b.id}`,
            subtitle: b.status === 'Running' ? `${Math.round(b.progress * 100)}%` : b.status,
            meta: b.started.toLocaleTimeString(),
            icon: statusIcon(b),
            chevron: true,
            onTap: () => app.push(detail(b)),
            swipe: [{ title: 'Delete', role: 'destructive', symbol: 'trash', onTap: () => (state.builds = state.builds.filter((x) => x !== b)) }],
          }),
        ),
      ),
    ],
    { largeTitle: true, actions: [ui.action('Run', () => runBuild(), { symbol: 'play.fill' })], empty: { title: 'No builds yet', symbol: 'hammer' } },
  ),
);

await app.connect();
console.log('Builds is on your phone. Ctrl+C to stop.');
