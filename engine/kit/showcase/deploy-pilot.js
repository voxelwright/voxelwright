// A two-die pilot under one smoked window. Both dies stay in their sockets.
import { defineLook, MATERIALS } from '../src/index.js';

defineLook('deploy-pilot', {
  from: 'lit',
  materials: {
    steel: { day: '#726e60', night: '#566163', jitter: 0.012 },
    lens: { day: '#575e54', night: '#394743', jitter: 0.007 },
  },
  parts: {
    lamp: {
      build(live, model) {
        const socket = model.part('socket');
        socket.sunk = true;
        socket.slab(0, 0, -1, 9, 5, 2, 'steel', 1).carve(1, 1, -1, 7, 3, 2);
        const dies = model.part('dies');
        dies.sunk = true;
        dies.box(1, 1, -1, 7, 3, 1, 'gasket');
        dies.plot(2, 2, -1, 'lens').plot(6, 2, -1, 'lens');
        model.part('window').box(1, 1, 0, 7, 3, 1, 'lens');
        live.well = [1, 1, 8, 4];
        live.faceZ = 1;
        live.state.litRevision = undefined;
      },

      pose(live) {
        // Rebuild supplies fresh colours on a signal change. Recolour does
        // the same when the case theme or the accent changes.
        if (live.state.litRevision === live.tintRevision) return;
        live.state.litRevision = live.tintRevision;
        const signal = live.el.dataset.vxLight;
        if (signal !== 'go' && signal !== 'accent') return;
        const sourceX = signal === 'go' ? 2.5 : 6.5;
        const rgb = MATERIALS[signal === 'go' ? 'light-go' : 'light'][live.theme];
        const { socket, dies, window: lens } = live.model.byName;
        for (const part of [dies, lens, socket]) {
          for (let i = 0; i < part.count; i++) {
            const x = part.rest[i * 3] - sourceX, y = part.rest[i * 3 + 1] - 2.5;
            const squaredDistance = x * x + y * y;
            // Frost scatters the core along the window. Only a weak reflection
            // reaches the nearest steel cells. The carrier absorbs the light.
            const level = part === dies ? Number(squaredDistance === 0)
              : (part === lens ? 1 : 0.28) / (1 + squaredDistance * 0.28);
            const core = part === lens ? 0.42 * level ** 4 : 0;
            for (let c = 0; c < 3; c++) {
              const at = i * 4 + c;
              const light = rgb[c] + (1 - rgb[c]) * core;
              part.col[at] += (light - part.col[at]) * level;
            }
            if (part !== socket) part.col[i * 4 + 3] = level;
          }
        }
        live.glows = false; // Spill is already on the fitting.
      },
    },
  },
});
