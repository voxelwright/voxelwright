// A rule's own thread (#264): it holds the rule's interpreter (box.mjs) and nothing else. The world's process
// starts one for each rule (run.mjs), posts it what happened as text, and is posted back what the rule answered.
// It is given the rule's text and no more: it imports nothing of the world's, and the world ends it whole when a
// call takes too long or it is no longer wanted.
import { parentPort, workerData } from 'node:worker_threads'
import { open } from './box.mjs'

const box = await open(workerData.source)
if (box.error) parentPort.postMessage({ failed: box.error })
else {
  parentPort.on('message', ({ n, json }) => {
    const began = performance.now(), answer = box.call(json)
    parentPort.postMessage({ n, ms: performance.now() - began, ...answer })
  })
  parentPort.postMessage({ listens: box.listens })
}
