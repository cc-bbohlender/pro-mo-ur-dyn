import { Vector3 } from "three"
import { Keyframe } from "./index.js"

const helperVector = new Vector3()

/**
 * backwards search for position at time
 */
export function getEntityPositionAt(keyframes: Array<Keyframe>, time: number, target: Vector3, tolerance = 0): boolean {
    if (keyframes.length === 0) {
        return false
    }
    if (keyframes.length === 1) {
        if (Math.abs(keyframes[0].t - time) >= tolerance) {
            return false
        }
        const { x, y, z } = keyframes[0]
        target.set(x, y, z)
        return true
    }
    let index = keyframes.length - 2
    while (index > 0 && keyframes[index].t > time) {
        index--
    }
    if (keyframes[index].t <= time + tolerance && time - tolerance <= keyframes[index + 1].t) {
        const { x: x1, y: y1, z: z1, t: t1 } = keyframes[index]
        helperVector.set(x1, y1, z1)
        const { x: x2, y: y2, z: z2, t: t2 } = keyframes[index + 1]
        target.set(x2, y2, z2)
        const percent = (time - t1) / (t2 - t1)
        target.sub(helperVector).multiplyScalar(percent).add(helperVector)
        return true
    }
    return false
}
