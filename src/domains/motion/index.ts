import { Vector3 } from "three"
import { OperationNextCallback, Operations } from "../../interpreter/index.js"
import { getEntityPositionAt, getKeyframeIndex } from "./helper.js"
import { isPathway, pathwaysToGeometry } from "../pathway/index.js"
import { Queue } from "../../interpreter/queue.js"
import { sampleGeometry } from "../sample.js"
import { findPathTo } from "./pathfinding.js"
import { NestedTransformation } from "../../index.js"

const TIME_STEP = 0.1 //ms

export const entityTypeDefaults = {
    pedestrian: {
        url: "models/human",
        radius: 1,
        speed: 1.5,
    },
    car: {
        url: "models/car",
        speed: 17,
        radius: 2.5,
    },
    bus: {
        url: "models/bus",
        speed: 14,
        radius: 3,
    },
    train: {
        url: "models/train",
        speed: 17,
        radius: 3,
    },
    cyclist: {
        url: "models/cyclist",
        radius: 1.5,
        speed: 4,
    },
    camera: {
        url: undefined,
        radius: 0,
        speed: 5,
    },
}

const positionHelper = new Vector3()

export function distanceTo(dx: number, dy: number, dz: number) {
    const squared = dx * dx + dy * dy + dz * dz
    if (squared === 0) {
        return 0
    }
    return Math.sqrt(squared)
}

export const operations: Operations = {
    follow: {
        defaultParameters: [],
        includeThis: true,
        includeQueue: true,
        execute: (
            next: OperationNextCallback,
            astId: string,
            entity: MotionEntity,
            queue: Queue,
            targetId: string,
            offsetX = 0,
            offsetY = 0,
            offsetZ = 0
        ) => {
            //find target
            const target: MotionEntity | undefined =
                queue.list.find(({ id, value }) => id === targetId && isMotionEntity(value.raw))?.value?.raw ??
                queue.results.find(({ id, raw }) => id === targetId && isMotionEntity(raw))?.raw

            if (target == null) {
                return next(
                    entity,
                    { type: "operation", astId, identifier: "wait", children: [{ type: "raw", value: 0.01 }] },
                    {
                        type: "operation",
                        identifier: "follow",
                        astId,
                        children: [targetId, offsetX, offsetY, offsetZ].map((value) => ({ type: "raw", value })),
                    }
                )
            }

            const lastKeyframe = entity.keyframes[entity.keyframes.length - 1]
            const currentTime = lastKeyframe.t
            const speed = lastKeyframe.speed

            if (currentTime === 0) {
                entity.keyframes.length = 0
            }

            //add all missing keyframes to this target with a very small delay (+ 0.01) and with the astId
            for (const keyframe of target.keyframes) {
                if (keyframe.t < currentTime) {
                    continue
                }
                entity.keyframes.push({
                    astId,
                    speed,
                    t: keyframe.t + 0.01,
                    x: keyframe.x + offsetX,
                    y: keyframe.y + offsetY,
                    z: keyframe.z + offsetZ,
                })
            }

            return next(entity, {
                type: "operation",
                identifier: "follow",
                astId,
                children: [targetId, offsetX, offsetY, offsetZ].map((value) => ({ type: "raw", value })),
            })
        },
    },
    moveTo: {
        defaultParameters: [],
        includeThis: true,
        includeQueue: false,
        execute: (
            next: OperationNextCallback,
            astId: string,
            entity: MotionEntity,
            x: number,
            y: number,
            z: number,
            deltaT?: number
        ) => {
            const { x: currentX, y: currentY, z: currentZ, t, speed } = entity.keyframes[entity.keyframes.length - 1]
            const dt = deltaT ?? distanceTo(currentX - x, currentY - y, currentZ - z) / speed
            entity.keyframes.push({ x, y, z, t: t + dt, astId, speed })
            return next(entity)
        },
    },
    speed: {
        defaultParameters: [],
        includeThis: true,
        includeQueue: false,
        execute: (next, astId, entity: MotionEntity, speed: number) => {
            entity.keyframes[entity.keyframes.length - 1].speed = speed
            return next(entity)
        },
    },
    later: {
        defaultParameters: [],
        includeQueue: false,
        execute: (next, astId, entity: MotionEntity, t: number) => {
            entity.keyframes[entity.keyframes.length - 1].t += t
            return next(entity)
        },
        includeThis: true,
    },
    clone: {
        defaultParameters: [],
        includeQueue: false,
        execute: (next, astId, entity: MotionEntity, amount: number) => {
            return next(new Array(amount).fill(null).map(() => structuredClone(entity)))
        },
        includeThis: true,
    },
    randomPointOn: {
        defaultParameters: [],
        execute: (next, astId, queue: Queue, type: string) => {
            const geometry = queue.getCached(type, (results) =>
                pathwaysToGeometry(results.map(({ raw }) => raw).filter(isPathway), type)
            )
            if (geometry == null) {
                return next(null)
            }
            const [{ x, y, z }] = sampleGeometry(geometry, 1)
            return next({ x, y, z })
        },
        includeQueue: true,
        includeThis: false,
    },
    pathOnToAndDodge: {
        defaultParameters: [],
        execute: (
            next,
            astId,
            entity: MotionEntity,
            queue: Queue,
            type: string,
            { x, y, z }: { x: number; y: number; z: number }
        ) => {
            const keyframe = entity.keyframes[entity.keyframes.length - 1]
            const path = findPathTo(queue, type, entity.radius, keyframe, x, y, z)
            if (path != null) {
                return next(
                    entity,
                    ...path.map<NestedTransformation>(({ x, y, z }) => ({
                        type: "precomputedOperation",
                        identifier: "moveToAndDodge",
                        parameters: [x, y, z],
                        astId,
                    }))
                )
            }
            return next(entity, { type: "operation", identifier: "wait", astId, children: [{ type: "raw", value: 1 }] })
        },
        includeQueue: true,
        includeThis: true,
    },
    pathOnTo: {
        defaultParameters: [],
        execute: (
            next,
            astId,
            entity: MotionEntity,
            queue: Queue,
            type: string,
            { x, y, z }: { x: number; y: number; z: number }
        ) => {
            const keyframe = entity.keyframes[entity.keyframes.length - 1]
            const path = findPathTo(queue, type, entity.radius, keyframe, x, y, z)
            if (path != null) {
                return next(
                    entity,
                    ...path.map<NestedTransformation>(({ x, y, z }) => ({
                        type: "precomputedOperation",
                        identifier: "moveTo",
                        parameters: [x, y, z],
                        astId,
                    }))
                )
            }
            return next(entity, { type: "operation", identifier: "wait", astId, children: [{ type: "raw", value: 1 }] })
        },
        includeQueue: true,
        includeThis: true,
    },
    spawnOn: {
        defaultParameters: [],
        execute: (next, astId, entity: MotionEntity, queue: Queue, type = "street", amount = 1) => {
            const pathwayGeometry = queue.getCached(type, (results) =>
                pathwaysToGeometry(results.map(({ raw }) => raw).filter(isPathway), type)
            )
            if (pathwayGeometry == null) {
                return next([])
            }
            const keyframe = entity.keyframes[entity.keyframes.length - 1]
            return next(
                sampleGeometry(pathwayGeometry, amount).map<MotionEntity>(({ x, y, z }) => ({
                    keyframes: [
                        {
                            x,
                            y,
                            z,
                            astId,
                            t: keyframe.t,
                            speed: keyframe.speed,
                        },
                    ],
                    type: entity.type,
                    radius: entity.radius,
                    url: entity.url,
                    id: "",
                }))
            )
        },
        includeQueue: true,
        includeThis: true,
    },
    wait: {
        defaultParameters: [],
        includeQueue: false,
        execute: (next, astId, entity: MotionEntity, t: number) => {
            const { x, y, z, t: oldT, speed } = entity.keyframes[entity.keyframes.length - 1]
            entity.keyframes.push({
                astId,
                x,
                y,
                z,
                t: oldT + t,
                speed,
            })
            return next(entity)
        },
        includeThis: true,
    },
    moveBy: {
        defaultParameters: [],
        includeThis: true,
        includeQueue: false,
        execute: (
            next: OperationNextCallback,
            astId: string,
            entity: MotionEntity,
            dx: number,
            dy: number,
            dz: number
        ) => {
            const { x, y, z, t, speed } = entity.keyframes[entity.keyframes.length - 1]
            const dt = distanceTo(dx, dy, dz) / speed
            entity.keyframes.push({ x: x + dx, y: y + dy, z: z + dz, t: t + dt, astId, speed })
            return next(entity)
        },
    },
    moveToAndDodge: {
        defaultParameters: [],
        includeThis: true,
        includeQueue: true,
        execute: (
            next: OperationNextCallback,
            astId: string,
            entity: MotionEntity,
            queue: Queue,
            targetX: number,
            targetY: number,
            targetZ: number
        ) => {
            const { x, y, z, t, speed } = entity.keyframes[entity.keyframes.length - 1]
            let dx = targetX - x
            let dy = targetY - y
            let dz = targetZ - z
            const fullDistanceLength = distanceTo(dx, dy, dz)
            const stepDistance = Math.min(TIME_STEP * speed, fullDistanceLength)
            const stepDuration = stepDistance / speed
            //normalise and apply the step size
            if (fullDistanceLength === 0) {
                dx = 0
                dy = 0
                dz = 0
            } else {
                dx = (dx / fullDistanceLength) * stepDistance
                dy = (dy / fullDistanceLength) * stepDistance
                dz = (dz / fullDistanceLength) * stepDistance
            }

            const newX = x + dx
            const newY = y + dy
            const newZ = z + dz

            let nextX = x,
                nextY = y,
                nextZ = z
            const nextT = t + stepDuration
            if (
                !isColliding(
                    entity,
                    queue.list.map(({ value: { raw } }) => raw).concat(queue.results.map(({ raw }) => raw)),
                    positionHelper.set(newX, newY, newZ),
                    nextT
                )
            ) {
                //not collide
                nextX = newX
                nextY = newY
                nextZ = newZ
            }

            entity.keyframes.push({ x: nextX, y: nextY, z: nextZ, t: nextT, astId, speed })

            if (fullDistanceLength <= stepDistance) {
                return next(entity) //done
            }
            return next(entity, {
                type: "precomputedOperation",
                identifier: "moveToAndDodge",
                parameters: [targetX, targetY, targetZ],
                astId,
            }) //schedule again
        },
    },
}

const targetEntityPositionHelper = new Vector3()

function isColliding(entity: MotionEntity, environment: Array<any>, position: Vector3, time: number) {
    for (const value of environment) {
        if (value != entity && isMotionEntity(value)) {
            const index = getKeyframeIndex(value.keyframes, time, TIME_STEP + 0.001)
            if (index == null) {
                continue
            }
            getEntityPositionAt(value.keyframes, time, index, targetEntityPositionHelper)
            const distance = position.distanceTo(targetEntityPositionHelper)
            if (distance < value.radius + entity.radius) {
                return true
            }
        }
    }
    return false
}

export function createMotionEntitiy({ type, x, y, z, time }: any, astId: string): MotionEntity {
    const defaults = entityTypeDefaults[(type ?? "pedestrian") as keyof typeof entityTypeDefaults]
    if (defaults == null) {
        throw new Error(`unknown type "${type}"`)
    }
    return {
        keyframes: [{ x: x ?? 0, y: y ?? 0, z: z ?? 0, t: time ?? 0, astId, speed: defaults.speed }],
        radius: defaults.radius,
        url: defaults.url,
        type,
        id: "",
    }
}

export function getMotionEntityProgress(entity: MotionEntity) {
    return entity.keyframes[entity.keyframes.length - 1].t
}

export type MotionEntity = {
    keyframes: Array<Keyframe>
    url?: string
    radius: number
    id: string
    type: string
}

export type Keyframe = {
    x: number
    y: number
    z: number
    t: number
    astId: string
    speed: number
}

export function isMotionEntity(value: unknown): value is MotionEntity {
    return typeof value === "object" && value != null && "keyframes" in value
}

export * from "./helper.js"
