// (#83) Builds every robotaxi service's sculpted model off the page's thread and posts them back.
//
// Sculpting the Waymo Ojai (ojai-sculpt.ts, car-sculpt.ts) and RLE-packing its three LODs takes ~670–700 ms of CPU.
// Each RobotaxiModel is plain structured data (numbers, strings, arrays), so it crosses cleanly back to the page
// thread without blocking first picture or input control.
import { loadFineCore } from './fine-core.ts'
import { buildRobotaxiModel } from './robotaxi.ts'
import { ROBOTAXI_SERVICES } from './robotaxi-services.ts'

void loadFineCore().finally(() => {
  ;(self as unknown as Worker).postMessage(ROBOTAXI_SERVICES.map(buildRobotaxiModel))
})
