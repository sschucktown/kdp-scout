import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('dist/popup', { recursive: true });
await copyFile('manifest.json', 'dist/manifest.json');
await copyFile('src/popup/popup.html', 'dist/popup/popup.html');
await copyFile('src/popup/popup.css', 'dist/popup/popup.css');
await copyFile('src/popup/market-metrics.css', 'dist/popup/market-metrics.css');
await copyFile('src/popup/review-research.css', 'dist/popup/review-research.css');
