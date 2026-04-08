/** App entry — keeps the same URL as before (`/js/chore-tracker.js`). */
import { initI18n } from './i18n.js';

await initI18n();
await import('./main.js');
