import { useStore } from "../state/store.js"
import { NestedDescriptions } from "pro-3d-video"
import { Panel } from "./panel.js"
import simplify from "simplify-js"
import { exportGLTF as exportBuildingGLTF } from "pro-3d-video/building"
import { exportGLTF as exportMotionGLTF } from "pro-3d-video/motion"
import { AnimationClip, KeyframeTrack, Object3D } from "three"
import { GLTFExporter, GLTFExporterOptions } from "three/examples/jsm/exporters/GLTFExporter.js"

export function Toolbar() {
    return (
        <Panel className="rounded gap-3 p-3 flex flex-row">
            <div onClick={importScene} className="btn btn-outline btn-sm">
                Import
            </div>
            <div onClick={exportScene} className="btn btn-outline btn-sm">
                Export
            </div>
        </Panel>
    )
}

const gltfExporter = new GLTFExporter()

async function exportScene() {
    const { result, duration } = useStore.getState()

    const objects: Array<Object3D> = []
    const tracks: Array<KeyframeTrack> = []

    exportBuildingGLTF(result, objects, tracks)
    exportMotionGLTF(result, objects, tracks)
    const root = new Object3D()
    root.add(...objects)
    const binary = (await gltfExporter.parseAsync(root, {
        binary: true,
        forceIndices: true,
        animations: [new AnimationClip("animation", duration, tracks)],
    })) as ArrayBuffer

    const a = document.createElement("a")
    a.href = window.URL.createObjectURL(new Blob([binary], { type: "model/gltf-binary" }))
    a.download = `scene.glb`
    a.click()
}

async function importScene() {
    const text = await (await fetch("bookstore0.txt")).text()
    const dataset = text.split("\n").map((line) => line.split(" "))
    const map = new Map<
        string,
        {
            x1: number
            y1: number
            x2: number
            y2: number
            t: number
            u1: number
            u2: number
            u3: number
            type: string
        }[]
    >()
    for (const [id, x1, y1, x2, y2, t, u1, u2, u3, type] of dataset) {
        const entry = map.get(id) ?? []
        entry.push({
            x1: +x1 / 100,
            y1: +y1 / 100,
            x2: +x2 / 100,
            y2: +y2 / 100,
            t: +t / 100,
            u1: +u1,
            u2: +u2,
            u3: +u3,
            type,
        })
        map.set(id, entry)
    }
    const descriptions: NestedDescriptions = {}

    for (const [name, keyframes] of map.entries()) {
        const simplifiedKeyframes = simplify(
            keyframes.map((data) => ({ ...getCenter(data), t: data.t })),
            0.1
        ) as Array<{
            x: number
            y: number
            t: number
        }>
        let lastTime = simplifiedKeyframes[0].t
        const startCenter = simplifiedKeyframes[0]
        descriptions[name] = {
            initialVariables: { x: startCenter.x, y: 0, z: startCenter.y, t: lastTime },
            nouns: {
                Start: {
                    transformation: {
                        type: "sequential",
                        children: simplifiedKeyframes.slice(1).map(({ x, y, t }) => {
                            const deltaT = t - lastTime
                            lastTime = t
                            return {
                                type: "operation",
                                children: [
                                    { type: "raw", value: x },
                                    { type: "raw", value: 0 },
                                    { type: "raw", value: y },
                                    { type: "raw", value: deltaT },
                                ],
                                identifier: "moveTo",
                            }
                        }),
                    },
                },
            },
            rootNounIdentifier: "Start",
        }
    }

    useStore.getState().addDescriptions(descriptions)
}

function getCenter({ x1, x2, y1, y2 }: { x1: number; y1: number; x2: number; y2: number }): { x: number; y: number } {
    return {
        x: (x1 + x2) / 2,
        y: (y1 + y2) / 2,
    }
}
