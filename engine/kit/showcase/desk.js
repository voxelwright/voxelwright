import './desk-controls.js';
import { adopt, ready, getStage, live } from '../src/index.js';

adopt();
window.vx = { live, get stage() { return getStage(); } };
await ready();
document.documentElement.dataset.ready = '1';
