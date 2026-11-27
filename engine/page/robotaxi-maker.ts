// (#83, a prototype behind `?late=taxi`) Makes every robotaxi service's model off the page's thread and sends them.
//
// Measured on a cold visit (test/launch-perf.mjs --profile): street.ts made them as it was set up, 674 to 699 ms of
// sculpting (ojai-sculpt.ts, car-sculpt.ts) in one task on the page's thread, just before the first picture. A model
// is plain data (numbers, strings, typed arrays), so it crosses to the page as it is.
import { buildRobotaxiModel } from './robotaxi.ts'
import { ROBOTAXI_SERVICES } from './robotaxi-services.ts'

;(self as unknown as Worker).postMessage(ROBOTAXI_SERVICES.map(buildRobotaxiModel))
