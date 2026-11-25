// The private build opts in explicitly. Both builds copy only the files they use.
import { isAbsolute } from 'node:path'

export const eggOverlay = process.env.VOXELWRIGHT_EGG_MEDIA || null
if (eggOverlay && !isAbsolute(eggOverlay)) throw Error('VOXELWRIGHT_EGG_MEDIA must be an absolute directory')
export const landingVideos = ['rick.mp4', 'bad-apple.mp4']
