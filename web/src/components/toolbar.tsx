import { useStore } from "../state/store.js"
import { NestedDescriptions, parse } from "pro-3d-video"
import { Panel } from "./panel.js"
import simplify from "simplify-js"
import { AnimationClip, KeyframeTrack, Object3D } from "three"
import { GLTFExporter, GLTFExporterOptions } from "three/examples/jsm/exporters/GLTFExporter.js"
import {
    convertLotsToDescriptions,
    convertPathwaysToDescription,
    loadMapLayers,
    tileMeterRatio,
} from "../state/mapbox.js"
import { exportGeometryResult } from "./viewer/geometry-result.js"
import { exportMotion } from "./viewer/agents.js"

export function Toolbar() {
    return (
        <Panel className="rounded gap-3 p-3 flex flex-col">
            <div onClick={() => importAgents(0.2, 0.1)} className="btn btn-outline border-slate-300 btn-sm">
                Import Agents
            </div>
            <div onClick={importBuildingsPathways} className="btn btn-outline border-slate-300 btn-sm">
                Import Buildings & Pathways
            </div>
            <div
                onClick={() => useStore.getState().deleteType("building")}
                className="btn btn-outline border-slate-300 btn-sm">
                Delete Buildings
            </div>
            <div
                onClick={() => useStore.getState().deleteType("footwalk", "street")}
                className="btn btn-outline border-slate-300 btn-sm">
                Delete Pathways
            </div>
            <div
                onClick={() => useStore.getState().deleteType(undefined, "pedestrian", "cyclist", "bus", "car")}
                className="btn btn-outline border-slate-300 btn-sm">
                Delete Agents
            </div>
            <div
                onClick={() => useStore.getState().enterDeriveBuildingsAndPathways()}
                className="btn btn-outline border-slate-300 btn-sm">
                Derive Buildings & Pathways
            </div>
            <div
                onClick={() => useStore.getState().enterMultiScenario()}
                className="btn btn-outline border-slate-300 btn-sm">
                View Scenarios
            </div>
            <div onClick={exportScene} className="btn btn-outline border-slate-300 btn-sm">
                Export
            </div>
        </Panel>
    )
}

const gltfExporter = new GLTFExporter()

async function exportScene() {
    const { duration } = useStore.getState()

    const objects: Array<Object3D> = []
    const tracks: Array<KeyframeTrack> = []

    exportGeometryResult(objects, tracks, "building", "white")
    exportGeometryResult(objects, tracks, "footwalk", "white", [0, 0.05, 0])
    exportGeometryResult(objects, tracks, "street", "gray")

    await exportMotion(objects, tracks)

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

const defaultDescription = parse(`Default (type: "building", interprete: false) {
    Building--> this
}`)

async function importBuildingsPathways() {
    const layers = await loadMapLayers("_18-77198-98516.mvt", 98516, 18)
    useStore.getState().addDescriptions({
        ...defaultDescription,
        ...convertLotsToDescriptions(layers),
        Streets: convertPathwaysToDescription(layers, 10, "street", ["street", "secondary"]),
        Footwalks: convertPathwaysToDescription(layers, 3, "footwalk", ["footwalk", "path"]),
    })
}

async function importAgents(spaceScale: number, timeScale: number) {
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
            x1: +x1 * spaceScale,
            y1: +y1 * spaceScale,
            x2: +x2 * spaceScale,
            y2: +y2 * spaceScale,
            t: +t * timeScale,
            u1: +u1,
            u2: +u2,
            u3: +u3,
            type,
        })
        map.set(id, entry)
    }
    const descriptions: NestedDescriptions = {}

    for (const [name, keyframes] of map.entries()) {
        const regex = /\"/g
        const typeName: string | undefined = keyframes[0].type?.replace(regex, "")
        let type: string
        switch (typeName) {
            case "Bus":
            case "Car":
            case "Pedestrian":
                type = typeName.toLocaleLowerCase()
                break
            case "Biker":
                type = "cyclist"
                break
            default:
                continue
        }
        const simplifiedKeyframes = simplify(
            keyframes.map((data) => ({ ...getCenter(data), t: data.t })),
            2
        ) as Array<{
            x: number
            y: number
            t: number
        }>
        let lastTime = simplifiedKeyframes[0].t
        const startCenter = simplifiedKeyframes[0]
        descriptions[name] = {
            initialVariables: { x: startCenter.x, y: 0, z: startCenter.y, t: lastTime, type },
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
