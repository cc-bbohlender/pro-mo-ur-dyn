import { initializeWorker } from "pro-3d-video"
import {
    operations as buildingOperations,
    isPrimitive,
    makeTranslationMatrix,
    PointPrimitive,
    Primitive,
    primitivesToGeometry,
} from "pro-3d-video/building"
import { operations as motionOperations, isMotionEntity, createMotionEntitiy, MotionEntity } from "pro-3d-video/motion"
import { isPathway, Pathway, operations as pathwayOperations, pathwaysToGeometry } from "pro-3d-video/pathway"
import { BufferGeometryLoader, Matrix4 } from "three"

const loader = new BufferGeometryLoader()

initializeWorker({
    cloneValue(value) {
        if (value instanceof Primitive) {
            return value.clone()
        }
        return structuredClone(value)
    },
    compareProgress(v1: number, v2: number) {
        return v2 - v1
    },
    computeProgress(value) {
        if (isMotionEntity(value)) {
            return value.keyframes[value.keyframes.length - 1].t
        }
        return -1
    },
    computeDurationMS: 1000,
    createValue(variables, astId) {
        switch (variables.type ?? "pedestrian") {
            case "building":
                return new PointPrimitive(
                    makeTranslationMatrix(variables.x ?? 0, variables.y ?? 0, variables.z ?? 0, new Matrix4())
                )
            case "footwalk":
            case "street":
                return {
                    points: [{ x: variables.x ?? 0, y: variables.y ?? 0, size: variables.size ?? 0, astId }],
                    type: variables.type,
                } satisfies Pathway

            default:
                return createMotionEntitiy(variables, astId)
        }
    },
    operations: {
        ...buildingOperations,
        ...motionOperations,
        ...pathwayOperations,
    },
    shouldInterrrupt(startProgress, currentProgress) {
        return currentProgress - startProgress > 3 //3 seconds computed
    },
    serialize(queue, prevProgress, currentProgress) {
        const agents: Array<MotionEntity> = []
        for (const entry of queue.list) {
            if (!isMotionEntity(entry.value.raw)) {
                continue
            }
            entry.value.raw.id = entry.id
            agents.push(entry.value.raw)
        }
        for (const entry of queue.results) {
            if (!isMotionEntity(entry.raw)) {
                continue
            }
            entry.raw.id = entry.id
            agents.push(entry.raw)
        }

        return {
            building: queue
                .getCached("building", (results) =>
                    primitivesToGeometry(results.map(({ raw }) => raw).filter(isPrimitive))
                )
                ?.toJSON(),
            street: queue
                .getCached("street", (results) =>
                    pathwaysToGeometry(results.map(({ raw }) => raw).filter(isPathway), "street")
                )
                ?.toJSON(),
            footwalk: queue
                .getCached("footwalk", (results) =>
                    pathwaysToGeometry(results.map(({ raw }) => raw).filter(isPathway), "footwalk")
                )
                ?.toJSON(),
            agents,
        }
        /*return values.map((value) => {
            /*if (isMotionEntity(value.raw)) {
                const index = value.raw.keyframes.findIndex((keyframe) => keyframe.t > prevProgress)
                return { keyframes: value.raw.keyframes.slice(index), type: value.raw.type } satisfies MotionEntity
            }
            if (value.raw instanceof Primitive) {
                return serializePrimitive(value.raw)
            }
            return value.raw
        })*/
    },
})
