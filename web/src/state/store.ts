import {
    ParsedDescriptions,
    flattenAST,
    NestedDescriptions,
    nestAST,
    WorkerInterface,
    ParsedTransformation,
    traverseUpParsed,
    NestedTransformation,
    ParsedRaw,
    traverseDownNestedDescription,
    NestedDescription,
} from "pro-3d-video"
import { Keyframe, MotionEntity, distanceTo } from "pro-3d-video/motion"
//@ts-ignore
import create from "zustand"
import type x from "zustand"
import { combine } from "zustand/middleware"
import { clamp, generateUUID } from "three/src/math/MathUtils.js"
import { BufferGeometryLoader, Vector2Tuple } from "three"
//@ts-ignore
import Url from "./worker.js?url"

const createZustand = create as any as typeof x.default

export type DerivedSelectionState = {
    keyframes: Array<Keyframe>
    astIds: Array<string>
    keyframeIndiciesMap: Map<string, Array<Array<Keyframe>>>
}
export type PrimarySelectionState = {
    astIds?: Array<string>
    results?: Array<{ id: string; keyframeIndices?: Array<number> }>
}

export type AppState = {
    mode: "view" | "edit" | "derive" | "multi"
    confirmDerivedStreet?: () => Promise<{
        polylines: Array<Array<Vector2Tuple>>
        ratio: number
        offset: number
    }>
    confirmDerivedFootwalk?: () => Promise<{
        polylines: Array<Array<Vector2Tuple>>
        ratio: number
        offset: number
    }>
    onUpdateRequestedTimeSet: Set<(requestedTime: number) => void>
    deriveThresholdFootwalk: number
    deriveThresholdStreet: number
    descriptions: ParsedDescriptions
    workerInterface: WorkerInterface
    time: number
    duration: number
    requestedDuration: number
    playing: boolean
    result: any
    interpretationFinished: boolean
    textEdit: boolean
    primarySelection: PrimarySelectionState
    derivedSelection: DerivedSelectionState
    shift: boolean
    controlling: boolean
    selectedDescriptionId?: string
}

const loader = new BufferGeometryLoader()

export const useStore = createZustand(
    combine(createInitialState(), (set, get) => ({
        setControlling(controlling: boolean) {
            set({ controlling })
        },

        updateDescriptions(descriptions: ParsedDescriptions, partial?: Partial<AppState>) {
            const requestedDuration = Math.max(get().time * 2, 10)
            get().workerInterface.terminate()
            set({
                descriptions,
                workerInterface: startWorkerInterface(descriptions, requestedDuration),
                requestedDuration,
                ...partial,
            } as any)
        },

        updatePrimarySelection(primarySelection: PrimarySelectionState, partial?: Partial<AppState>) {
            set({
                primarySelection,
                derivedSelection: computeDerivedSelection(primarySelection, get().result),
                mode: "edit",
                ...partial,
            } as any)
        },

        deleteType(...types: Array<string | undefined>): void {
            const { descriptions } = get()
            const newDescriptions: ParsedDescriptions["descriptions"] = {}
            for (const [id, description] of Object.entries(descriptions.descriptions)) {
                if (types.includes(description.initialVariables.type)) {
                    continue
                }
                newDescriptions[id] = description
            }
            this.updateDescriptions({
                transformations: descriptions.transformations,
                nouns: descriptions.nouns,
                descriptions: newDescriptions,
            })
        },

        selectDescription(descriptionId: string): void {
            set({ selectedDescriptionId: descriptionId })
        },

        finishTextEdit(parsedResult: NestedDescriptions, descriptionId?: string): void {
            if (descriptionId == null) {
                this.updateDescriptions(flattenAST(parsedResult), { textEdit: false })
                return
            }
            Object.values(parsedResult)[0].astId = descriptionId
            this.updateDescriptions(flattenAST({ ...nestAST(get().descriptions, true), ...parsedResult }), {
                textEdit: false,
            })
        },

        addDescription(): void {
            const descriptionId = `d${generateUUID()}`
            this.updateDescriptions(
                flattenAST({
                    ...nestAST(get().descriptions, true),
                    New: {
                        initialVariables: {},
                        nouns: { Start: { transformation: { type: "this" } } },
                        rootNounIdentifier: "Start",
                        astId: descriptionId,
                    },
                }),
                { selectedDescriptionId: descriptionId }
            )
        },

        editTransformations(...edits: Array<{ astId: string; transformation: ParsedTransformation }>) {
            const { descriptions } = get()
            const newTransformations = { ...descriptions.transformations }
            for (const { astId, transformation } of edits) {
                newTransformations[astId] = transformation
            }
            this.updateDescriptions({
                ...descriptions,
                transformations: newTransformations,
            })
        },
        deleteSelected(): void {
            const { descriptions, derivedSelection } = get()
            for (const transformation of Object.values(descriptions.transformations)) {
                if ("childrenIds" in transformation) {
                    transformation.childrenIds = transformation.childrenIds.filter(
                        (id) => derivedSelection.keyframes.findIndex((keyframe) => keyframe.astId === id) === -1
                    )
                }
            }
            this.updateDescriptions(descriptions, { primarySelection: { astIds: [], results: [] } })
        },
        exitEdit(): void {
            this.updatePrimarySelection({ astIds: [], results: [] }, { mode: "view" })
        },
        concretize(): void {
            const { derivedSelection, result, descriptions } = get()
            if (result.agents == null) {
                return
            }
            const descriptionIdentifierToAstIdMap = new Map<string, Array<string>>()
            for (const astId of derivedSelection.astIds) {
                traverseUpParsed(
                    descriptions,
                    astId,
                    () => {
                        //nothing
                    },
                    () => {
                        //nothing
                    },
                    (id, description) => {
                        let entry = descriptionIdentifierToAstIdMap.get(description.identifier)
                        if (entry == null) {
                            descriptionIdentifierToAstIdMap.set(description.identifier, (entry = []))
                        }
                        entry.push(astId)
                    }
                )
            }

            const newDescriptions = nestAST(descriptions, true)
            for (const [descriptionIdentifier, astIds] of descriptionIdentifierToAstIdMap) {
                const agents = (result.agents as Array<MotionEntity>).filter(
                    (agent) => agent.keyframes.find((keyframe) => astIds.includes(keyframe.astId)) != null
                )
                const oldContent = newDescriptions[descriptionIdentifier]
                for (let i = 0; i < agents.length; i++) {
                    const nameFunction =
                        agents.length === 1
                            ? (name: string | undefined) => name
                            : (name: string | undefined) => (name == null ? undefined : `${name}${i}`)
                    const newDescription = structuredClone(oldContent)
                    for (const astId of astIds) {
                        const agent = agents[i]
                        if (agent.keyframes[0].astId === astId) {
                            newDescription.initialVariables.x = agent.keyframes[0].x
                            newDescription.initialVariables.y = agent.keyframes[0].y
                            newDescription.initialVariables.z = agent.keyframes[0].z
                            if (agent.keyframes[0].t != 0) {
                                newDescription.initialVariables.time = agent.keyframes[0].t
                            }
                        }
                        const replacement: NestedTransformation = {
                            type: "sequential",
                            children: [],
                            astId,
                        }
                        let keyframeIndex = 1
                        while (
                            keyframeIndex < agent.keyframes.length &&
                            agent.keyframes[keyframeIndex].astId != astId
                        ) {
                            keyframeIndex++
                        }
                        while (
                            keyframeIndex < agent.keyframes.length &&
                            agent.keyframes[keyframeIndex].astId === astId
                        ) {
                            const keyframe = agent.keyframes[keyframeIndex]
                            const prevKeyframe = agent.keyframes[keyframeIndex - 1]
                            const distanceToPrev = distanceTo(
                                prevKeyframe.x - keyframe.x,
                                prevKeyframe.y - keyframe.y,
                                prevKeyframe.z - keyframe.z
                            )
                            if (distanceToPrev < 0.01) {
                                replacement.children.push({
                                    type: "operation",
                                    identifier: "wait",
                                    children: [
                                        {
                                            type: "raw",
                                            value: keyframe.t - prevKeyframe.t,
                                        },
                                    ],
                                })
                            } else {
                                replacement.children.push({
                                    type: "operation",
                                    identifier: "moveTo",
                                    children: [keyframe.x, keyframe.y, keyframe.z].map((value) => ({
                                        type: "raw",
                                        value,
                                    })),
                                })
                            }
                            keyframeIndex++
                        }
                        traverseDownNestedDescription(
                            newDescription,
                            (t) => {
                                if (t.astId === astId) {
                                    return replacement
                                }
                                return t
                            },
                            (n) => n,
                            (d) => d
                        )
                    }
                    traverseDownNestedDescription(
                        newDescription,
                        (t) => {
                            t.astId = nameFunction(t.astId)
                            if (t.type === "nounReference" && t.descriptionIdentifier === descriptionIdentifier) {
                                t.descriptionIdentifier = nameFunction(t.descriptionIdentifier)!
                            }
                            return t
                        },
                        (n) => {
                            n.astId = nameFunction(n.astId)
                            return n
                        },
                        (d) => {
                            d.astId = nameFunction(d.astId)
                            return d
                        }
                    )
                    newDescriptions[nameFunction(descriptionIdentifier)!] = newDescription
                }
            }

            for (const descriptionIdentifier of descriptionIdentifierToAstIdMap.keys()) {
                delete newDescriptions[descriptionIdentifier]
            }

            this.updateDescriptions(flattenAST(newDescriptions))
        },
        split(fromAstId: string, toAstId: string, percentage: number): void {
            const {
                descriptions: { transformations },
            } = get()
            const fromTransformation = transformations[fromAstId]
            const toTransformation = transformations[toAstId]

            if (
                fromTransformation.type === "operation" &&
                fromTransformation.identifier === "moveTo" &&
                toTransformation.type === "operation" &&
                toTransformation.identifier === "moveTo"
            ) {
                const x1 = getRawValue(transformations[fromTransformation.childrenIds[0]])
                const y1 = getRawValue(transformations[fromTransformation.childrenIds[1]])
                const z1 = getRawValue(transformations[fromTransformation.childrenIds[2]])
                const x2 = getRawValue(transformations[toTransformation.childrenIds[0]])
                const y2 = getRawValue(transformations[toTransformation.childrenIds[1]])
                const z2 = getRawValue(transformations[toTransformation.childrenIds[2]])

                const x1_5 = (x1 + x2) / 2
                const y1_5 = (y1 + y2) / 2
                const z1_5 = (z1 + z2) / 2

                const newToAstId = `t${generateUUID()}`
                const middleAstId = `t${generateUUID()}`
                const middleParamXAstId = `t${generateUUID()}`
                const middleParamYAstId = `t${generateUUID()}`
                const middleParamZAstId = `t${generateUUID()}`

                this.editTransformations(
                    {
                        astId: toAstId,
                        transformation: {
                            type: "sequential",
                            childrenIds: [middleAstId, newToAstId],
                        },
                    },
                    {
                        astId: newToAstId,
                        transformation: toTransformation,
                    },
                    {
                        astId: middleAstId,
                        transformation: {
                            type: "operation",
                            childrenIds: [middleParamXAstId, middleParamYAstId, middleParamZAstId],
                            identifier: "moveTo",
                        },
                    },
                    {
                        astId: middleParamXAstId,
                        transformation: {
                            type: "raw",
                            value: x1_5,
                        },
                    },
                    {
                        astId: middleParamYAstId,
                        transformation: {
                            type: "raw",
                            value: y1_5,
                        },
                    },
                    {
                        astId: middleParamZAstId,
                        transformation: {
                            type: "raw",
                            value: z1_5,
                        },
                    }
                )
            }
        },

        enterDeriveBuildingsAndPathways(): void {
            set({ mode: "derive" })
        },

        enterMultiScenario(): void {
            set({ mode: "multi" })
        },

        setDeriveThresholdFootwalk(threshold: number): void {
            set({ deriveThresholdFootwalk: threshold })
        },

        setDeriveThresholdStreet(threshold: number): void {
            set({ deriveThresholdStreet: threshold })
        },

        async confirmDeriveBuildingsAndPathways(): Promise<void> {
            const footwalkResult = await get().confirmDerivedFootwalk?.()
            const streetResult = await get().confirmDerivedStreet?.()

            if (footwalkResult == null || streetResult == null) {
                return
            }

            this.addDescriptions(
                {
                    DerivedFootwalk: convertPathwaysToDescription(
                        footwalkResult.polylines,
                        3,
                        "footwalk",
                        footwalkResult.ratio,
                        footwalkResult.offset
                    ),
                    DerivedStreet: convertPathwaysToDescription(
                        streetResult.polylines,
                        10,
                        "street",
                        streetResult.ratio,
                        streetResult.offset
                    ),
                },
                { mode: "view" }
            )
        },

        enterView(): void {
            set({ mode: "view" })
        },

        select(primarySelection: PrimarySelectionState): void {
            const { shift, primarySelection: prevPrimarySelection } = get()
            if (shift) {
                this.updatePrimarySelection({
                    astIds: [...(prevPrimarySelection.astIds ?? []), ...(primarySelection.astIds ?? [])],
                    results: [...(prevPrimarySelection.results ?? []), ...(primarySelection.results ?? [])],
                })
            } else {
                this.updatePrimarySelection(primarySelection)
            }
        },

        beginTextEdit(): void {
            set({ textEdit: true })
        },

        togglePlaying() {
            set({ playing: !get().playing })
        },

        replaceResult({ agents = [], building, footwalk, street }: any, duration: number, final: boolean) {
            const result = {
                agents,
                building: building == null ? undefined : loader.parse(building),
                street: street == null ? undefined : loader.parse(street),
                footwalk: footwalk == null ? undefined : loader.parse(footwalk),
            }
            set({
                result,
                duration,
                interpretationFinished: final,
                derivedSelection: computeDerivedSelection(get().primarySelection, result),
            })
        },

        //TODOv2: appendResult(results: Array<Value>) {},

        addDescriptions(nestedDescriptions: NestedDescriptions, partial?: Partial<AppState>) {
            this.updateDescriptions(
                flattenAST({ ...nestedDescriptions, ...nestAST(get().descriptions, true) }),
                partial
            )
        },

        setTime(time: number) {
            set({ time: clamp(time, 0, get().duration), playing: false })
        },
    }))
)

export function convertPathwaysToDescription(
    polylines: Array<Array<Vector2Tuple>>,
    size: number,
    type: string,
    ratio: number,
    offset: number
): NestedDescription {
    return {
        rootNounIdentifier: "Start",
        initialVariables: { type },
        nouns: {
            Start: {
                transformation: {
                    type: "parallel",
                    children: polylines.map((polyline) => ({
                        type: "sequential",
                        children: [
                            {
                                type: "operation",
                                identifier: "pathwayFrom",
                                children: [
                                    {
                                        type: "raw",
                                        value: polyline[0][0] * ratio + offset,
                                    },
                                    {
                                        type: "raw",
                                        value: polyline[0][1] * ratio + offset,
                                    },
                                    {
                                        type: "raw",
                                        value: size,
                                    },
                                ],
                            },
                            ...polyline.slice(1).map<NestedTransformation>(([x, y], i) => {
                                return {
                                    type: "operation",
                                    identifier: "pathwayTo",
                                    children: [
                                        {
                                            type: "raw",
                                            value: x * ratio + offset,
                                        },
                                        {
                                            type: "raw",
                                            value: y * ratio + offset,
                                        },
                                        {
                                            type: "raw",
                                            value: size,
                                        },
                                    ],
                                }
                            }),
                        ],
                    })),
                },
            },
        },
    }
}

export function getRawValue(transformation: ParsedTransformation): any {
    if (transformation.type != "raw") {
        throw new Error(`unexpected type "${transformation}" of transformation`)
    }
    return transformation.value
}

function computeDerivedSelection(
    { astIds: astIdsSelection, results: resultsSelection }: PrimarySelectionState,
    result: any
): DerivedSelectionState {
    const agents: Array<MotionEntity> | undefined = result.agents
    const keyframeSet = new Set<Keyframe>()
    const astIds = new Set<string>(astIdsSelection)
    const resultIndices = new Map<string, Array<Array<Keyframe>>>()
    if (agents != null) {
        for (const agent of agents) {
            const keyframes = agent.keyframes
            const resultSelection = resultsSelection?.filter(({ id }) => agent.id === id)
            let currentKeyframes: Array<Keyframe> | undefined = undefined
            for (let keyframeIndex = 0; keyframeIndex < keyframes.length; keyframeIndex++) {
                const keyframe = keyframes[keyframeIndex]
                let isContained = false
                if (
                    resultSelection?.find(
                        ({ keyframeIndices }) => keyframeIndices == null || keyframeIndices.includes(keyframeIndex)
                    ) != null
                ) {
                    keyframeSet.add(keyframe)
                    astIds.add(keyframe.astId)
                    isContained = true
                } else if (astIdsSelection?.includes(keyframe.astId)) {
                    keyframeSet.add(keyframe)
                    isContained = true
                }

                if (isContained) {
                    if (currentKeyframes == null) {
                        currentKeyframes = []
                        setOrAdd(resultIndices, agent.id, currentKeyframes)
                    }
                    currentKeyframes.push(keyframe)
                } else {
                    currentKeyframes = undefined
                }
            }
        }
    }
    return {
        keyframes: Array.from(keyframeSet),
        astIds: Array.from(astIds),
        keyframeIndiciesMap: resultIndices,
    }
}

function setOrAdd(map: Map<string, Array<Array<Keyframe>>>, key: string, value: Array<Keyframe>): void {
    const entry = map.get(key)
    if (entry == null) {
        map.set(key, [value])
        return
    }
    entry.push(value)
}

export function updateTime(delta: number) {
    const state = useStore.getState()

    if (state.playing && state.time < state.duration) {
        state.time = state.duration === 0 ? 0 : state.time + delta
        if (state.interpretationFinished) {
            state.time %= state.duration
        }
    }

    //more than 80% of the timeline is played
    if (!state.interpretationFinished && state.time > state.requestedDuration * 0.8) {
        state.requestedDuration = state.requestedDuration * 2
        for (const onUpdateRequestedTime of state.onUpdateRequestedTimeSet) {
            onUpdateRequestedTime(state.requestedDuration)
        }
        state.workerInterface.updateRequestedProgress(state.requestedDuration)
    }
}

function createInitialState(): AppState {
    const descriptions: ParsedDescriptions = { descriptions: {}, nouns: {}, transformations: {} }
    const requestedDuration = 10
    return {
        mode: "view",
        descriptions,
        workerInterface: startWorkerInterface(descriptions, requestedDuration),
        deriveThresholdFootwalk: 0.5,
        deriveThresholdStreet: 0.5,
        time: 0,
        duration: 0,
        playing: true,
        result: {},
        interpretationFinished: true,
        requestedDuration,
        textEdit: false,
        primarySelection: {},
        derivedSelection: { keyframes: [], astIds: [], keyframeIndiciesMap: new Map() },
        shift: false,
        controlling: false,
        onUpdateRequestedTimeSet: new Set(),
    }
}

function startWorkerInterface(descriptions: ParsedDescriptions, requestedDuration: number): WorkerInterface {
    const workerInterface = new WorkerInterface(
        Url,
        {
            name: generateUUID(),
            type: "module",
        },
        (result, progress, isFinal) => useStore.getState().replaceResult(result, progress, isFinal)
    )
    workerInterface.interprete(nestAST(descriptions, true), requestedDuration)
    return workerInterface
}
