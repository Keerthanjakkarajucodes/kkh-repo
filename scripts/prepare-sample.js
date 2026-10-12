import { execSync } from 'child_process';
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const sampleAppDir = path.join(rootDir, 'sample-app');
const refDir = path.join(sampleAppDir, 'reference');

if (!existsSync(refDir)) {
  mkdirSync(refDir, { recursive: true });
}

const indexCssPath = path.join(sampleAppDir, 'src', 'index.css');
const refCssPath = path.join(sampleAppDir, 'src', 'reference.css');
const backupCssPath = path.join(sampleAppDir, 'src', 'index.css.defective.bak');

console.log('1. Backing up defective index.css...');
copyFileSync(indexCssPath, backupCssPath);

console.log('2. Swapping to clean reference.css and building...');
copyFileSync(refCssPath, indexCssPath);
execSync('npm run build', { cwd: sampleAppDir, stdio: 'inherit' });

console.log('3. Starting local static server for reference capture...');
const distDir = path.join(sampleAppDir, 'dist');

function getMimeType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html';
  if (filePath.endsWith('.css')) return 'text/css';
  if (filePath.endsWith('.js')) return 'application/javascript';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'text/plain';
}

const server = http.createServer((req, res) => {
  const reqUrl = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(distDir, reqUrl);
  if (existsSync(filePath)) {
    res.writeHead(200, { 'Content-Type': getMimeType(filePath) });
    res.end(readFileSync(filePath));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

await new Promise((resolve) => server.listen(4173, '127.0.0.1', resolve));
console.log('Static server listening on http://127.0.0.1:4173');

console.log('4. Capturing reference desktop screenshot via Playwright...');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 800 });
await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

const refImagePath = path.join(refDir, 'desktop.png');
await page.screenshot({ path: refImagePath, type: 'png' });
console.log(`Reference screenshot saved to ${refImagePath}`);

await browser.close();
server.close();

console.log('5. Restoring defective index.css and rebuilding sample app...');
copyFileSync(backupCssPath, indexCssPath);
execSync('npm run build', { cwd: sampleAppDir, stdio: 'inherit' });

console.log('Done! Sample app has defective index.css and reference screenshot is in sample-app/reference/desktop.png');
