// Smoke test for pl.mjs and capture.mjs. Zero dependencies: `node test/smoke.mjs`.
// Capture checks are skipped when no Chrome/Edge/Chromium is installed.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { capture, findBrowser } from '../skills/preview-lab/scripts/capture.mjs';

const PL = fileURLToPath(new URL('../skills/preview-lab/scripts/pl.mjs', import.meta.url));
const tmp = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'pl-test-')));
const project = join(tmp, 'proj'), home = join(tmp, 'home');
fs.mkdirSync(project);
const env = { ...process.env, PREVIEW_LAB_HOME: home };
const run = (cwd, ...a) => spawnSync(process.execPath, [PL, ...a], { cwd, env, encoding: 'utf8' });
const pl = (...a) => { const r = run(project, ...a); if (r.status !== 0) throw new Error(`pl ${a.join(' ')} → ${r.status}\n${r.stderr}`); return JSON.parse(r.stdout); };
const files = d => fs.readdirSync(d).sort();
const manifest = lab => JSON.parse(fs.readFileSync(join(lab, 'manifest.json'), 'utf8'));
const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8' });
const png = (f, body = 'x') => fs.writeFileSync(f, body);
const step = name => console.log('· ' + name);
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true })); // also on a failed assert

step('init copies the template; branding is the BRAND blocks only; upgrade keeps them');
git(project, 'init', '-q'); git(project, 'commit', '-q', '--allow-empty', '-m', 'init');
let s = pl('init');
assert.equal(s.index, 'unbranded');
const lab = s.lab, inbox = s.inbox, idx = join(lab, 'index.html');
assert.match(fs.readFileSync(idx, 'utf8'), /\[hidden\]\{display:none!important\}/); // without it the filters hide nothing
assert.equal(manifest(lab).project, 'proj');
// branding goes through "brand": the agent never has to read or edit index.html
assert.equal(pl('brand').copyKeys.send, 'Send feedback');
assert.equal(pl('brand').brand.light.accent, '#4f46e5');
const brandIn = o => spawnSync(process.execPath, [PL, 'brand', '-'], { cwd: project, env, encoding: 'utf8', input: JSON.stringify(o) });
const bad = brandIn({ light: { primary: '#000' }, copy: { nope: 'x' }, radius: '1px;}' });
assert.equal(bad.status, 4); assert.match(bad.stderr, /light\.primary[\s\S]*copy\.nope[\s\S]*radius/);
assert.equal(pl('status').index, 'unbranded'); // an invalid brand changes nothing
assert.match(JSON.parse(brandIn({ dark: { surface: '#0a0a0d' }, light: { muted: '#b0b0b0' } }).stdout).warnings.join(), /light: --muted on --bg[\s\S]*cards against the page/);
s = JSON.parse(brandIn({ name: 'Proj $& $1', logo: '<svg></svg>', lang: 'es', copy: { send: 'Enviar' }, light: { accent: '#0f766e', muted: '#5f5f69' }, dark: { surface: '#1e1e26' } }).stdout);
assert.equal(s.index, 'ok'); assert.equal(s.warnings, undefined);
const branded = fs.readFileSync(idx, 'utf8');
assert.match(branded, /--accent:#0f766e/); assert.ok(branded.includes('"name":"Proj $& $1","logo":"\\u003csvg>\\u003c/svg>","lang":"es","copy":{"send":"Enviar"}'));
assert.deepEqual(pick(pl('brand').brand, ['name', 'logo', 'lang', 'copy']), { name: 'Proj $& $1', logo: '<svg></svg>', lang: 'es', copy: { send: 'Enviar' } });
assert.equal(pl('status').index, 'ok');
assert.equal(pl('status').customized, undefined);
pl('upgrade');
assert.equal(fs.readFileSync(idx, 'utf8'), branded);
fs.writeFileSync(idx, branded.replace(/content="\d+"/, 'content="1"'));
assert.equal(pl('status').index, 'outdated');

step('upgrade refuses to drop custom edits unless forced');
let r = run(project, 'upgrade');
assert.equal(r.status, 5); assert.match(r.stderr, /CUSTOMIZED/);
pl('upgrade', '--force');
assert.equal(fs.readFileSync(idx, 'utf8'), branded);

step('add validates everything first: a bad file changes nothing and keeps the inbox');
png(join(inbox, 'a.png')); fs.writeFileSync(join(inbox, 'x.html'), 'hi');
fs.writeFileSync(join(inbox, 'bad.json'), JSON.stringify({ mode: 'fancy', items: [
  { id: 'a', title: 'A', shots: [{ src: 'a.png', label: 'm' }, { src: 'a.png', label: 'M' }] },
  { id: 'b', title: 'B', shots: [{ src: 'x.html' }, { src: 'missing.png' }] },
  { id: 'c', title: 'C' }, { id: 'no title', shots: [] }, { id: 'd', shots: [{ src: 'a.png', label: 'Live' }] },
  { id: 'e', title: 'E', capture: { url: 'http://x' } }] }));
r = run(project, 'add', join(inbox, 'bad.json'));
assert.equal(r.status, 4);
for (const msg of ['mode must be', 'share a label', 'not an image', 'shot file not found', 'nothing to show', 'bad id', 'needs a title', 'reserved', 'needs viewports'])
  assert.match(r.stderr, new RegExp(msg), msg);
assert.deepEqual(manifest(lab).items, []);
assert.deepEqual(files(inbox), ['a.png', 'bad.json', 'x.html']);
assert.deepEqual(files(join(lab, 'shots')), []);

step('add imports shots, defaults labels, cleans the inbox and junk');
fs.writeFileSync(join(lab, 'junk.log'), 'x');
fs.writeFileSync(join(inbox, 'items.json'), JSON.stringify({ title: 'T', items: [
  { id: 'a', title: 'A', shots: [{ src: 'a.png' }] }, { id: 'b', title: 'B', url: 'http://x' }, { id: 'c', title: 'C', url: 'http://y' }] }));
s = pl('add', join(inbox, 'items.json'));
assert.deepEqual(s.items, ['a', 'b', 'c']);
assert.equal(s.lab, undefined); // mutating commands answer in one short line
assert.equal(manifest(lab).items[0].shots[0].label, 'view 1');
assert.deepEqual(files(lab), ['inbox', 'index.html', 'manifest.json', 'shots']);
assert.deepEqual(files(inbox), []);
const first = files(join(lab, 'shots'));
assert.equal(first.length, 1);

step('replacing shots deletes the old file; metadata-only updates keep them');
png(join(inbox, 'a2.png'), 'y');
fs.writeFileSync(join(inbox, 'i.json'), JSON.stringify([{ id: 'a', shots: [{ label: 'mobile', src: 'a2.png' }] }]));
assert.deepEqual(pl('add', join(inbox, 'i.json')).changed, ['a']);
assert.equal(files(join(lab, 'shots')).length, 1);
assert.notEqual(files(join(lab, 'shots'))[0], first[0]);
spawnSync(process.execPath, [PL, 'add', '-'], { cwd: project, env, input: JSON.stringify([{ id: 'a', note: 'n' }]) });
assert.equal(manifest(lab).items[0].title, 'A');
assert.equal(manifest(lab).items[0].note, 'n');
assert.equal(manifest(lab).items[0].shots.length, 1);

step('boolean flags do not swallow the next argument');
assert.deepEqual(pl('remove', '--force', 'c').items, ['a', 'b']);

step('export: one self-contained file with the shots inlined and no local paths');
s = pl('export', join(tmp, 'out.html'));
const ex = fs.readFileSync(s.file, 'utf8');
assert.match(ex, /<script>window\.PL_DATA=\{"project":"proj"/); assert.match(ex, /"src":"data:image\/png;base64,/); assert.ok(!ex.includes(tmp));

step('serve: host and origin checks, traversal, malformed URLs; a send changes no items');
const srv = spawn(process.execPath, [PL, 'serve', '--port', '0', '--timeout', '1'], { cwd: project, env });
let out = '';
srv.stdout.on('data', d => (out += d));
const url = await new Promise(res => srv.stdout.on('data', () => { const m = out.match(/PREVIEW_LAB_URL (\S+)/); if (m) res(m[1]); }));
const port = new URL(url).port;
// fetch cannot fake the Host header or send a malformed path, so these go through curl
const raw = (path, headers = {}) => +spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--path-as-is',
  ...Object.entries(headers).flatMap(([k, v]) => ['-H', `${k}: ${v}`]), url.slice(0, -1) + path]).stdout.toString();
assert.equal((await fetch(url + 'manifest.json')).status, 200);
assert.equal((await fetch(url.replace('127.0.0.1', 'localhost') + 'manifest.json')).status, 200);
assert.equal(raw('/manifest.json', { Host: `evil.example:${port}` }), 403); // DNS rebinding
assert.equal(raw('/%E0%A4%A'), 400); // a malformed escape must not crash the server
assert.equal(raw('/..%2F..%2Fsecret'), 403); // encoded traversal reaches the guard
assert.equal((await fetch(url + 'server.json')).status, 403);
assert.equal((await fetch(url + 'manifest.json')).status, 200); // still alive
assert.equal(pl('status').server, url.slice(0, -1));
assert.equal((await fetch(url + 'feedback', { method: 'POST', headers: { origin: 'http://evil.test' }, body: '{"items":[]}' })).status, 403);
const item = (id, status, extra = {}) => ({ id, title: id.toUpperCase(), status, comment: '', areas: [], accepted: [], ...extra });
const post = (u, fb) => fetch(u + 'feedback', { method: 'POST', body: JSON.stringify(fb) });
assert.equal((await post(url, { project: 'proj', round: 1, items: [item('a', 'changes', { comment: 'tighter', areas: [{ shot: 'mobile', x: 1, y: 2, w: 30, h: 10, note: 'here' }] }), item('b', 'approved')], markdown: '# fb\n' })).status, 200);
assert.equal(await new Promise(res => srv.on('exit', res)), 0);
assert.match(out, /--- FEEDBACK ---\n# fb/);
assert.equal(fs.readFileSync(join(lab, 'feedback.md'), 'utf8'), '# fb\n');
s = pl('status');
assert.deepEqual(s.items, ['a', 'b']); assert.equal(s.pendingFeedback, true); assert.equal(s.server, undefined);
assert.equal(run(project, 'feedback').stdout, '# fb\n\n');

step('round archives the round read-only, drops approved items, keeps inbox captures and records previous; changes are Updated, additions New');
png(join(inbox, 'next.png'), 'z');
assert.equal(run(project, 'round', '--keep', 'x').status, 1);
s = pl('round');
assert.equal(s.round, 2); assert.deepEqual(s.items, ['a']); assert.deepEqual(s.removedApproved, ['b']);
assert.deepEqual(files(inbox), ['next.png']); // captured before `round`: must survive it
let m = manifest(lab);
assert.deepEqual(m.items[0].previous, { round: 1, status: 'changes', comment: 'tighter', areas: [{ shot: 'mobile', x: 1, y: 2, w: 30, h: 10, note: 'here' }] });
assert.equal(files(join(lab, 'shots')).length, 1); // a keeps its shot
assert.deepEqual(m.history.map(h => [h.round, h.items.map(i => i.id), h.feedback.items.map(i => i.status)]), [[1, ['a', 'b'], ['changes', 'approved']]]);
assert.equal(run(project, 'feedback').status, 4);
fs.writeFileSync(join(inbox, 'i.json'), JSON.stringify([{ id: 'a', shots: [{ label: 'mobile', src: 'next.png' }] }, { id: 'n', title: 'N', url: 'http://n' }]));
pl('add', join(inbox, 'i.json'));
m = manifest(lab);
assert.equal(m.items[0].updated, 2); assert.equal(m.items[1].added, 2);
// the same pixels again are not a change: a blanket recapture flags nothing
png(join(inbox, 'same.png'), 'z');
fs.writeFileSync(join(inbox, 'i.json'), JSON.stringify([{ id: 'a', shots: [{ label: 'mobile', src: 'same.png' }] }]));
assert.equal(pl('add', join(inbox, 'i.json')).changed, undefined);

step('serve --detach returns at once; feedback is read later; a second serve reuses the server');
r = run(project, 'serve', '--detach', '--port', '0', '--timeout', '1');
assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /Detached/);
const durl = r.stdout.match(/PREVIEW_LAB_URL (\S+)/)[1];
assert.ok(run(project, 'serve', '--detach').stdout.includes(`${durl} (already running)`));
assert.match(run(project, 'feedback').stderr, /NO_FEEDBACK yet/);
assert.equal((await post(durl, { project: 'proj', round: 2, items: [item('a', 'changes')], markdown: '# round 2\n' })).status, 200);
await new Promise(res => setTimeout(res, 800));
assert.equal(run(project, 'feedback').stdout, '# round 2\n\n');
assert.equal(pl('status').server, undefined);
assert.equal(fs.existsSync(join(lab, 'server.json')), false);
assert.equal(run(project, 'serve', '--detach', '--port', '0').status, 0);
assert.equal(pl('stop').stopped, true); assert.equal(pl('stop').stopped, false); assert.equal(pl('status').server, undefined);

step('worktrees: own lab and items, shared branding; labs of deleted checkouts are pruned');
const wt = join(tmp, 'wt');
assert.equal(git(project, 'worktree', 'add', '-q', wt).status, 0);
r = run(wt, 'init'); assert.equal(r.status, 0, r.stderr); s = JSON.parse(r.stdout);
assert.notEqual(s.lab, lab); assert.equal(s.index, 'ok'); assert.deepEqual(s.items, []);
assert.equal(fs.readFileSync(join(s.lab, 'index.html'), 'utf8'), branded);
assert.equal(manifest(s.lab).project, 'proj'); // named after the repo, not the worktree folder
const wtLab = s.lab;
git(project, 'worktree', 'remove', '--force', wt);
assert.equal(pl('init').pruned, 1);
assert.equal(fs.existsSync(wtLab), false);

step('complete mode: recommendations are validated, archived with their round and not carried into the next');
const recs = [{ id: 'r0', type: 'responsive', severity: 'medium', text: 'Wraps at 390px' }, { id: 'r1', type: 'a11y', severity: 'high', text: 'Raise contrast', area: { x: 1, y: 2, w: 3, h: 4 } }, { id: 'r2', type: 'copy', severity: 'low', text: 'Shorter' }];
const addRecs = list => spawnSync(process.execPath, [PL, 'add', '-'], { cwd: project, env, encoding: 'utf8', input: JSON.stringify({ mode: 'complete', items: [{ id: 'a', recommendations: list }] }) });
r = addRecs([{ id: 'r1', type: 'style', severity: 'urgent', text: '', area: { x: 200 } }, { id: 'r1', type: 'ui', severity: 'low', text: 'x' }]);
assert.equal(r.status, 4); assert.match(r.stderr, /type must be[\s\S]*severity must be[\s\S]*needs text[\s\S]*area needs[\s\S]*unique id/);
assert.deepEqual(pl('contrast', '#ffffff', '#767676'), { ratio: 4.54, text: true, largeText: true, ui: true });
assert.equal(pl('contrast', '#fff', '#34d399').text, false); assert.equal(run(project, 'contrast', 'red', '#fff').status, 1);
assert.equal(addRecs(recs).status, 0);
assert.deepEqual(manifest(lab).items.find(i => i.id === 'a').recommendations, recs);
pl('round', '--keep', '1');
assert.equal(manifest(lab).items.find(i => i.id === 'a').recommendations, undefined);
assert.deepEqual(manifest(lab).history.at(-1).items.find(i => i.id === 'a').recommendations, recs);

step('round --keep caps the history: older rounds and their shots are dropped');
assert.deepEqual(manifest(lab).history.map(h => h.round), [2]);
assert.equal(files(join(lab, 'shots')).length, 1);

step('packaging: SKILL.md frontmatter is valid for strict YAML parsers; every manifest carries the same version');
const front = fs.readFileSync(fileURLToPath(new URL('../skills/preview-lab/SKILL.md', import.meta.url)), 'utf8').split('---')[1];
assert.match(front, /^name: preview-lab$/m);
for (const line of front.split('\n').filter(l => /^\w+: /.test(l))) assert.ok(!/: .*: /.test(line), `plain YAML value with ": " breaks the skills CLI: ${line}`);
const ver = f => JSON.parse(fs.readFileSync(fileURLToPath(new URL('../' + f, import.meta.url)), 'utf8')).version;
assert.ok(ver('plugin.json')); assert.equal(ver('.claude-plugin/plugin.json'), ver('plugin.json')); assert.equal(ver('gemini-extension.json'), ver('plugin.json'));

step('reset empties the lab and its history but keeps its code; remove keeps shots past rounds still show');
pl('remove', 'a');
assert.deepEqual(files(join(lab, 'shots')), [manifest(lab).history[0].items[0].shots[0].src.slice(6)]);
s = pl('reset');
assert.deepEqual(s.items, []); assert.equal(manifest(lab).title, undefined); assert.equal(manifest(lab).history, undefined); assert.deepEqual(files(join(lab, 'shots')), []); assert.equal(fs.readFileSync(idx, 'utf8'), branded);

step('guards: never adopt a foreign folder; in-project labs are git-ignored');
const foreign = join(tmp, 'foreign'); fs.mkdirSync(foreign); fs.writeFileSync(join(foreign, 'keep.txt'), 'mine');
assert.notEqual(run(project, 'init', '--lab', foreign).status, 0);
assert.ok(fs.existsSync(join(foreign, 'keep.txt')));
s = pl('init', '--in-project');
assert.equal(s.lab, join(project, '.preview-lab'));
assert.match(fs.readFileSync(join(project, '.gitignore'), 'utf8'), /^\.preview-lab\/$/m);

if (process.platform !== 'win32') {
  step('home not writable: falls back to the project folder');
  const p2 = join(tmp, 'p2'), ro = join(tmp, 'ro'); fs.mkdirSync(p2); fs.mkdirSync(ro); fs.chmodSync(ro, 0o500);
  r = spawnSync(process.execPath, [PL, 'init'], { cwd: p2, env: { ...env, PREVIEW_LAB_HOME: join(ro, 'labs') }, encoding: 'utf8' });
  fs.chmodSync(ro, 0o700);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).lab, join(p2, '.preview-lab')); assert.match(JSON.parse(r.stdout).note, /not writable/);
}

if (!findBrowser()) console.log('· (no Chrome/Edge/Chromium found: capture checks skipped)');
else {
  step('capture inside add: viewport, dark, full page, element, actions; recapture replays the recipe');
  const page = `<!doctype html><meta name=viewport content="width=device-width"><style>body{margin:0}@media(prefers-color-scheme:dark){body{background:#000}}</style>
    <div id=card style="width:200px;height:80px;background:teal"></div><button id=b onclick="document.body.dataset.open=1">go</button><div style="height:2000px"></div>`;
  const wide = '<!doctype html><body style="margin:0"><div style="display:flex;justify-content:space-between"><b>left</b><b>right</b></div>'; // tiling shows on this
  const app = createServer((q, a) => { a.writeHead(200, { 'content-type': 'text/html' }); a.end(q.url === '/wide' ? wide : page); });
  await new Promise(res => app.listen(0, '127.0.0.1', res));
  const u = `http://127.0.0.1:${app.address().port}/`;
  const p3 = join(tmp, 'p3'); fs.mkdirSync(p3);
  // async on purpose: the sample page is served by this process, so it must not block while Chrome loads it
  const run3 = (input, ...a) => new Promise(res => {
    const c = spawn(process.execPath, [PL, ...a], { cwd: p3, env }); let stdout = '', stderr = '';
    c.stdout.on('data', d => (stdout += d)); c.stderr.on('data', d => (stderr += d));
    c.on('exit', status => res({ status, stdout, stderr })); c.stdin.end(input ? JSON.stringify(input) : '');
  });
  const add3 = input => run3(input, 'add', '-');
  const lab3 = JSON.parse(run(p3, 'init').stdout).lab;
  let x = await add3({ viewports: { mobile: [390, 600], desktop: [1000, 600] }, items: [
    { id: 'page', title: 'Page', url: u, capture: { schemes: ['light', 'dark'], viewports: ['mobile'] } },
    { id: 'full', title: 'Full', capture: { url: u, viewports: ['desktop'], fullPage: true } },
    { id: 'card', title: 'Card', capture: { url: u, viewports: ['desktop'], selector: '#card', padding: 10 } },
    { id: 'open', title: 'Open', capture: { url: u, viewports: ['desktop'], actions: [{ click: '#b' }, { wait: 'body[data-open]' }] } }] });
  assert.equal(x.status, 0, x.stderr);
  assert.equal(JSON.parse(x.stdout).captured, 5);
  const by = id => manifest(lab3).items.find(i => i.id === id);
  assert.deepEqual(by('page').shots.map(z => z.label), ['mobile', 'mobile dark']);
  assert.equal(by('page').shots[0].scale, 2); assert.equal(by('page').shots[0].captured, true);
  const size = f => { const b = fs.readFileSync(join(lab3, f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; }; // PNG IHDR
  assert.deepEqual(size(by('page').shots[0].src), [780, 1200]);
  assert.ok(size(by('full').shots[0].src)[1] > 2000);
  assert.deepEqual(size(by('card').shots[0].src), [210, 90]); // 200×80 element + 10px padding, clipped at the page edge
  assert.deepEqual(files(join(lab3, 'inbox')), []);
  const before = by('card').shots[0].src;
  assert.equal(JSON.parse((await run3(null, 'recapture', 'card')).stdout).captured, 1);
  assert.equal(by('card').shots[0].src, before); // same pixels → same content-hashed file

  step('parallel captures of one page are pixel-identical (a background tab used to come out tiled)');
  x = await add3({ items: ['p1', 'p2', 'p3', 'p4'].map(id => ({ id, title: id, capture: { url: u + 'wide', viewports: { d: [1000, 600] }, wait: 1500 } })) }); // the race needs a slow page
  assert.equal(x.status, 0, x.stderr);
  assert.equal(new Set(['p1', 'p2', 'p3', 'p4'].map(id => by(id).shots[0].src.slice(-12))).size, 1); // file names end in a content hash
  assert.equal(JSON.parse((await run3(null, 'remove', 'p1', 'p2', 'p3', 'p4')).stdout).items.length, 4);

  step('a failed capture changes nothing');
  x = await add3({ items: [{ id: 'dead', title: 'D', capture: { url: 'http://127.0.0.1:1/', viewports: { m: [300, 300] } } },
    { id: 'nosel', title: 'N', capture: { url: u, viewports: { m: [300, 300] }, selector: '#nope' } }] });
  assert.equal(x.status, 4); assert.match(x.stderr, /CAPTURE_FAILED[\s\S]*dead[\s\S]*selector not found: #nope/);
  assert.equal(manifest(lab3).items.length, 4); assert.deepEqual(files(join(lab3, 'inbox')), []);

  step('the lab page itself works in a browser, served and exported: open an item, approve it, close');
  const exported = JSON.parse(run(p3, 'export').stdout).file;
  const served = run(p3, 'serve', '--detach', '--port', '0').stdout.match(/PREVIEW_LAB_URL (\S+)/)[1];
  const use = [{ click: '.card' }, { click: '.verdict [data-s=approved]' }, { wait: 400 }, { click: '#close' }, { wait: '.card[data-status=approved]' }]; // a script error leaves no cards
  const labShots = await capture([served, pathToFileURL(exported).href].map((url, n) => ({ url, file: join(tmp, `lab${n}.png`), w: 1100, h: 700, selector: '.card', actions: use })));
  assert.deepEqual(labShots.map(z => z.ok), [true, true], JSON.stringify(labShots));
  run(p3, 'stop');
  app.close();
}

console.log('smoke ok');
