import { Canvas, useFrame } from "@react-three/fiber"
import { Interface2D } from "./components/interface-2d.js"
import { updateTime, useStore } from "./state/store.js"
import { DragEvent, useEffect, useMemo, useState } from "react"
import { ParsedDescriptions, WorkerInterface, nestAST, parse } from "pro-3d-video"
import { useKeyboard } from "./components/use-keyboard.js"
import { PathControl } from "./components/controls/path.js"
import { Paths } from "./components/viewer/path.js"
import { DeriveVisualization } from "./components/derive-visualization.js"
import { ResultView } from "./components/viewer/result.js"
//@ts-ignore
import Url from "./state/worker.js?worker&url"
import { generateUUID } from "three/src/math/MathUtils.js"
import { BufferGeometryLoader } from "three"

async function onDrop(e: DragEvent<HTMLDivElement>) {
    e.stopPropagation()
    e.preventDefault()
    if (e.dataTransfer?.files.length === 1) {
        try {
            const text = await e.dataTransfer.files[0].text()
            const parsed = parse(text)
            useStore.getState().finishTextEdit(parsed)
        } catch (error: any) {
            alert(error.message)
        }
    }
}

export default function App() {
    useKeyboard()
    const mode = useStore((state) => state.mode)
    return (
        <div style={{ width: "100vw", height: "100svh" }} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
            {mode === "multi" ? <MultiView /> : <SingleView />}
            <Interface2D />
        </div>
    )
}

function SingleView() {
    const mode = useStore((state) => state.mode)
    const result = useStore((state) => state.result)
    return (
        <Canvas
            onPointerMissed={(e) => {
                if (e.buttons === 0) {
                    useStore.getState().exitEdit()
                }
            }}
            gl={{ logarithmicDepthBuffer: true, antialias: true }}
            camera={{ far: 10000 }}
            style={{ width: "100vw", height: "100svh" }}>
            <Updater />
            {mode === "edit" && <Paths />}
            {mode === "edit" && <PathControl />}
            {mode === "derive" && (
                <>
                    <DeriveVisualization
                        type="Footwalk"
                        includeTypes={["pedestrian", undefined]}
                        color="red"
                        position={[0, -0.2, 0]}
                        rotation={[-Math.PI / 2, 0, 0]}
                        size={50}
                        far={100}
                    />
                    <DeriveVisualization
                        type="Street"
                        includeTypes={["bus", "car", "cyclist"]}
                        color="green"
                        position={[0, -0.2, 0]}
                        rotation={[-Math.PI / 2, 0, 0]}
                        size={50}
                        far={100}
                    />
                    <DeriveVisualization
                        invert
                        color="blue"
                        type="Buildings"
                        position={[0, -0.2, 0]}
                        rotation={[-Math.PI / 2, 0, 0]}
                        size={50}
                        far={100}
                    />
                </>
            )}
            <ResultView result={result} />
            {/*<Suspense fallback={null}>
        <Environment preset="city" />
</Suspense>*/}
        </Canvas>
    )
}

export function MultiView() {
    const descriptions = useStore((state) => state.descriptions)
    const concreteDescriptions = useMemo(() => {
        const unconcreteDescriptions: Array<ParsedDescriptions> = [descriptions]
        const concreteDescriptions: Array<ParsedDescriptions> = []
        outer: while (unconcreteDescriptions.length > 0) {
            const unconcreteDescription = unconcreteDescriptions.shift()!
            for (const [id, transformation] of Object.entries(unconcreteDescription.transformations)) {
                if (transformation.type === "stochasticSwitch") {
                    //stochastic switch found => remove and insert variants into unconcreteDescriptions
                    for (const childId of transformation.childrenIds) {
                        const clone = structuredClone(unconcreteDescription)
                        clone.transformations[id] = unconcreteDescription.transformations[childId]
                        unconcreteDescriptions.push(clone)
                    }
                    continue outer
                }
            }
            //no stochastic switch found => concrete description
            concreteDescriptions.push(unconcreteDescription)
        }
        return concreteDescriptions
    }, [descriptions])
    const size = `${(100 / Math.ceil(Math.sqrt(concreteDescriptions.length))).toFixed(2)}%`
    return (
        <div className="flex flex-wrap flex-row h-full">
            {concreteDescriptions.map((description, i) => (
                <MultiViewer key={i} index={i} description={description} size={size} />
            ))}
        </div>
    )
}

function Updater() {
    useFrame((_, delta) => {
        updateTime(delta)
    })
    return null
}

function MultiViewer({ description, index, size }: { index: number; description: ParsedDescriptions; size: string }) {
    const [finalDuration, setFinalDuration] = useState<number | undefined>(undefined)
    return (
        <div className="relative w-full h-full" style={{ maxWidth: size, maxHeight: size }}>
            <Canvas gl={{ logarithmicDepthBuffer: true, antialias: true }} camera={{ far: 10000 }}>
                {index === 0 && <Updater />}
                <ViewDescriptions setFinalDuration={setFinalDuration} index={index} descriptions={description} />
            </Canvas>
            {finalDuration != null && <div className="top-1 right-1 absolute z-10">Duration: {finalDuration}</div>}
        </div>
    )
}

const loader = new BufferGeometryLoader()

function ViewDescriptions({
    descriptions,
    index,
    setFinalDuration,
}: {
    descriptions: ParsedDescriptions
    index: number
    setFinalDuration?: (duration: number) => void
}) {
    const [result, setResult] = useState<any>(undefined)
    useEffect(() => {
        const workerInterface = new WorkerInterface(
            Url,
            {
                name: generateUUID(),
                type: "module",
            },
            ({ agents = [], building, footwalk, street }: any, duration: number, isFinal) => {
                const state = useStore.getState()
                state.allDurations[index] = duration
                state.allInterpretationFinished[index] = isFinal
                if (isFinal && setFinalDuration != null) {
                    setFinalDuration(duration)
                }
                setResult({
                    agents,
                    building: building == null ? undefined : loader.parse(building),
                    street: street == null ? undefined : loader.parse(street),
                    footwalk: footwalk == null ? undefined : loader.parse(footwalk),
                })
            }
        )
        workerInterface.interprete(nestAST(descriptions, true), useStore.getState().requestedDuration)
        const onUpdateRequestedTime = (requestedTime: number) => {
            workerInterface.updateRequestedProgress(requestedTime)
        }
        useStore.getState().onUpdateRequestedTimeSet.add(onUpdateRequestedTime)
        return () => {
            workerInterface.terminate()
            useStore.getState().onUpdateRequestedTimeSet.delete(onUpdateRequestedTime)
        }
    }, [descriptions])
    if (result == null) {
        return null
    }
    return <ResultView result={result} />
}
